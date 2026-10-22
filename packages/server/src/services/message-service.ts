import type {
  ListResult,
  MessageView,
  MsgListInput,
  MsgPostInput,
  MsgWaitInput,
  PostResult,
  SyncContext,
  WaitResult,
} from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import {
  mentions,
  type Message,
  type Participant,
  type Principal,
  type Room,
} from '../domain/models.js';
import type { Repository } from './ports.js';
import type { ReplyTokens } from './reply-tokens.js';
import type { RoomService } from './room-service.js';
import type { Thread } from './thread.js';
import { nameIndex, toMemberStatus, toMessageView } from './views.js';
import type { WaitCoordinator } from './wait-coordinator.js';

/** Max messages handed back by one msg_wait / conflict response; the rest come next call. */
export const BATCH_LIMIT = 50;

export interface WaitOptions {
  signal?: AbortSignal;
  onHeartbeat?: (elapsedMs: number) => void;
}

interface Batch {
  /** All messages after the cursor, own included, capped at BATCH_LIMIT. */
  messages: Message[];
  hasMore: boolean;
  /** Highest seq the caller has now seen. */
  seenSeq: number;
}

export class MessageService {
  constructor(
    private readonly repo: Repository,
    private readonly rooms: RoomService,
    private readonly thread: Thread,
    private readonly tokens: ReplyTokens,
    private readonly waits: WaitCoordinator,
    private readonly waitMaxSeconds: number,
  ) {}

  async wait(
    principal: Principal,
    input: MsgWaitInput,
    opts: WaitOptions = {},
  ): Promise<WaitResult> {
    const { room, participant } = await this.rooms.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    const wakes = (m: Message) =>
      m.participantId !== participant.id &&
      (!input.only_when_mentioned || m.senderType === 'human' || mentions(m, participant));
    const timeoutSeconds = Math.min(
      input.timeout_seconds ?? this.waitMaxSeconds,
      this.waitMaxSeconds,
    );

    // Register first, then read the backlog: nothing can arrive unnoticed in between.
    const handle = this.waits.register({
      roomId: room.id,
      matches: wakes,
      timeoutMs: timeoutSeconds * 1000,
      ...opts,
    });
    let batch = await this.readAfter(room.id, input.after_seq);
    let timedOut = false;
    try {
      if (!batch.messages.some(wakes)) {
        await this.rooms.setStatus(participant, 'waiting');
        const outcome = await handle.promise;
        timedOut = outcome === 'timeout';
        batch = await this.readAfter(room.id, input.after_seq);
      }
    } finally {
      handle.cancel();
      const fresh = await this.repo.findParticipant(participant.id);
      if (fresh && fresh.status === 'waiting') await this.rooms.setStatus(fresh, 'online');
    }

    const others = batch.messages.filter((m) => m.participantId !== participant.id);
    const members = await this.repo.listParticipants(room.id);
    const freshRoom = (await this.repo.findRoom(room.id)) ?? room;
    return {
      messages: this.views(others, members),
      has_more: batch.hasMore,
      timed_out: timedOut && !others.some(wakes),
      sync: await this.tokens.issue(participant, batch.seenSeq),
      stage: freshRoom.stage,
      room_status: freshRoom.status,
      members_status: members.filter((m) => m.status !== 'left').map(toMemberStatus),
      hint: this.hint(participant, others, batch, timedOut),
    };
  }

  async post(principal: Principal, input: MsgPostInput): Promise<PostResult> {
    const { room, participant } = await this.rooms.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    if (room.status !== 'open') throw new AppError('ROOM_CLOSED', `Room is ${room.status}`);
    if (input.kind === 'decision' && room.hostParticipantId !== participant.id) {
      throw new AppError('FORBIDDEN', 'Only the host (or a human) may post kind=decision');
    }

    return this.thread.lock(room.id, async () => {
      const token = await this.tokens.redeem(participant, input.reply_token);
      const currentSeq = await this.repo.currentSeq(room.id);
      if (input.expected_last_seq > currentSeq) {
        throw await this.syncError(
          'INVALID_ARGUMENT',
          `expected_last_seq ${input.expected_last_seq} is ahead of the room (current ${currentSeq})`,
          room,
          participant,
          currentSeq,
        );
      }
      if (input.reply_to_seq !== undefined && input.reply_to_seq > currentSeq) {
        throw new AppError('INVALID_ARGUMENT', `reply_to_seq ${input.reply_to_seq} does not exist`);
      }
      if (!token) {
        throw await this.syncError(
          'TOKEN_INVALID',
          'reply_token is invalid, expired or already used. Read missed_messages and retry with the new sync.',
          room,
          participant,
          input.expected_last_seq,
        );
      }
      // Messages you posted yourself never make your context stale.
      const batch = await this.readAfter(room.id, input.expected_last_seq);
      if (batch.messages.some((m) => m.participantId !== participant.id)) {
        throw await this.syncError(
          'STALE_CONTEXT',
          'New messages arrived since expected_last_seq. Read missed_messages, then rewrite or resend.',
          room,
          participant,
          input.expected_last_seq,
        );
      }

      const message = await this.thread.appendLocked({
        roomId: room.id,
        senderType: 'agent',
        participantId: participant.id,
        userId: principal.userId,
        kind: input.kind,
        content: input.content,
        mentions: input.mentions ?? [],
        replyToSeq: input.reply_to_seq ?? null,
        evidence: input.evidence ?? [],
        ready: input.ready ?? false,
      });
      return { seq: message.seq, sync: await this.tokens.issue(participant, message.seq) };
    });
  }

  async list(input: MsgListInput): Promise<ListResult> {
    const room = await this.rooms.requireRoom(input.room);
    const limit = input.limit ?? 50;
    const rows = await this.repo.listMessages(room.id, {
      afterSeq: input.after_seq,
      beforeSeq: input.before_seq,
      limit: limit + 1,
    });
    // Ascending reads overflow at the end; "latest before X" reads overflow at the start.
    const hasMore = rows.length > limit;
    const page = !hasMore
      ? rows
      : input.after_seq !== undefined
        ? rows.slice(0, limit)
        : rows.slice(1);
    const members = await this.repo.listParticipants(room.id);
    return { messages: this.views(page, members), has_more: hasMore };
  }

  private async readAfter(roomId: string, afterSeq: number): Promise<Batch> {
    const rows = await this.repo.listMessages(roomId, { afterSeq, limit: BATCH_LIMIT + 1 });
    const hasMore = rows.length > BATCH_LIMIT;
    const messages = hasMore ? rows.slice(0, BATCH_LIMIT) : rows;
    const seenSeq = messages.at(-1)?.seq ?? Math.min(afterSeq, await this.repo.currentSeq(roomId));
    return { messages, hasMore, seenSeq };
  }

  /** Builds a sync-failure error that carries what the caller missed plus a fresh token. */
  private async syncError(
    code: 'STALE_CONTEXT' | 'TOKEN_INVALID' | 'INVALID_ARGUMENT',
    message: string,
    room: Room,
    participant: Participant,
    afterSeq: number,
  ): Promise<AppError> {
    const batch = await this.readAfter(room.id, afterSeq);
    const members = await this.repo.listParticipants(room.id);
    const missed = batch.messages.filter((m) => m.participantId !== participant.id);
    const sync: SyncContext = await this.tokens.issue(participant, batch.seenSeq);
    return new AppError(code, message, {
      missed_messages: this.views(missed, members),
      has_more: batch.hasMore,
      sync,
    });
  }

  private views(messages: Message[], members: Participant[]): MessageView[] {
    const names = nameIndex(members);
    return messages.map((m) => toMessageView(m, names));
  }

  private hint(
    participant: Participant,
    others: Message[],
    batch: Batch,
    timedOut: boolean,
  ): string | undefined {
    const mentioned = others.filter((m) => mentions(m, participant)).map((m) => m.seq);
    if (mentioned.length)
      return `You were mentioned in seq ${mentioned.join(', ')}; please answer.`;
    if (others.some((m) => m.senderType === 'human')) return 'A human spoke; read it carefully.';
    if (batch.hasMore)
      return `More messages pending; call msg_wait again with after_seq=${batch.seenSeq}.`;
    if (timedOut && others.length === 0) {
      return `No new messages. Call msg_wait again with after_seq=${batch.seenSeq}.`;
    }
    return undefined;
  }
}
