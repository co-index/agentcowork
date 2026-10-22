import type {
  HumanPostInput,
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
  BROADCAST,
  mentions,
  type Message,
  type Participant,
  type Principal,
  type Room,
} from '../domain/models.js';
import { redact } from '../security/redact.js';
import type { Repository } from './ports.js';
import type { ReplyTokens } from './reply-tokens.js';
import type { Access } from './access.js';
import { STAGE_GUIDANCE } from './rules.js';
import type { StageService } from './stage-service.js';
import type { Thread } from './thread.js';
import { nameIndex, toMessageView } from './views.js';
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
  /** Concurrent msg_wait calls per participant; status returns to online when the last ends. */
  private readonly activeWaits = new Map<string, number>();

  constructor(
    private readonly repo: Repository,
    private readonly access: Access,
    private readonly stages: StageService,
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
    const { room, participant } = await this.access.requireParticipant(
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
      // A paused or closed room returns at once so agents stop polling it.
      if (room.status === 'open' && !batch.messages.some(wakes)) {
        this.activeWaits.set(participant.id, (this.activeWaits.get(participant.id) ?? 0) + 1);
        try {
          await this.access.setStatus(participant, 'waiting');
          const outcome = await handle.promise;
          timedOut = outcome === 'timeout';
          batch = await this.readAfter(room.id, input.after_seq);
        } finally {
          const left = (this.activeWaits.get(participant.id) ?? 1) - 1;
          if (left > 0) this.activeWaits.set(participant.id, left);
          else this.activeWaits.delete(participant.id);
        }
      }
    } finally {
      handle.cancel();
      const fresh = await this.repo.findParticipant(participant.id);
      if (fresh?.status === 'waiting' && !this.activeWaits.has(participant.id)) {
        await this.access.setStatus(fresh, 'online');
      }
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
      members_status: await this.stages.memberStatus(freshRoom, members),
      hint: this.hint(freshRoom, participant, others, batch, timedOut),
    };
  }

  async post(principal: Principal, input: MsgPostInput): Promise<PostResult> {
    const ctx = await this.access.requireParticipant(principal, input.room, input.participant_id);
    const { participant } = ctx;

    return this.thread.lock(ctx.room.id, async () => {
      const room = (await this.repo.findRoom(ctx.room.id)) ?? ctx.room;
      // Re-check under the lock: a concurrent room_leave may have run since requireParticipant.
      const current = await this.repo.findParticipant(participant.id);
      if (!current || current.status === 'left') {
        throw new AppError('NOT_A_PARTICIPANT', 'You have left this room; call room_join again');
      }
      if (input.kind === 'decision' && room.hostParticipantId !== participant.id) {
        throw new AppError('FORBIDDEN', 'Only the host (or a human) may post kind=decision');
      }
      // Checked before redeeming, so a refused post does not burn the token.
      await this.stages.assertCanSpeak(room, participant);

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
      // The token proves what the caller was actually shown, so never trust a cursor past it.
      // Messages you posted yourself never make your context stale.
      const seenSeq = Math.min(input.expected_last_seq, token.issuedAtSeq);
      const batch = await this.readAfter(room.id, seenSeq);
      if (batch.messages.some((m) => m.participantId !== participant.id)) {
        throw await this.syncError(
          'STALE_CONTEXT',
          'New messages arrived since your last sync. Read missed_messages, then rewrite or resend.',
          room,
          participant,
          seenSeq,
        );
      }

      const { text, kinds } = redact(input.content);
      const message = await this.thread.appendLocked({
        roomId: room.id,
        senderType: 'agent',
        participantId: participant.id,
        userId: principal.userId,
        senderName: null,
        kind: input.kind,
        content: text,
        mentions: input.mentions ?? [],
        replyToSeq: input.reply_to_seq ?? null,
        evidence: input.evidence ?? [],
        ready: input.ready ?? false,
      });
      await this.stages.afterAgentPost(room, message);
      // Hub messages appended by afterAgentPost are new context: the next sync starts before them.
      return {
        seq: message.seq,
        sync: await this.tokens.issue(participant, message.seq),
        ...(kinds.length ? { redacted: kinds } : {}),
      };
    });
  }

  /** A human speaking from the Web UI: no strict sync, wakes everyone, lifts a pause. */
  async postAsHuman(
    principal: Principal,
    roomRef: string,
    input: HumanPostInput,
  ): Promise<{ seq: number; redacted?: string[] }> {
    const ref = await this.access.requireRoom(roomRef);
    return this.thread.lock(ref.id, async () => {
      const room = (await this.repo.findRoom(ref.id)) ?? ref;
      if (room.status === 'closed' || room.status === 'archived') {
        throw new AppError('ROOM_CLOSED', `Room is ${room.status}`);
      }
      await this.stages.resumeLocked(room);
      const { text, kinds } = redact(input.content);
      const message = await this.thread.appendLocked({
        roomId: room.id,
        senderType: 'human',
        participantId: null,
        userId: principal.userId,
        senderName: input.name,
        kind: input.kind,
        content: text,
        mentions: input.mentions ?? [],
        replyToSeq: null,
        evidence: [],
        ready: false,
      });
      return { seq: message.seq, ...(kinds.length ? { redacted: kinds } : {}) };
    });
  }

  async list(input: MsgListInput): Promise<ListResult> {
    const room = await this.access.requireRoom(input.room);
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
    room: Room,
    participant: Participant,
    others: Message[],
    batch: Batch,
    timedOut: boolean,
  ): string | undefined {
    if (room.status === 'paused') {
      const reason = this.stages.pauseReason(room) ?? 'waiting for a human';
      return `Room is paused (${reason}). Stop calling msg_wait and report to your local user.`;
    }
    if (room.status !== 'open')
      return `Room is ${room.status}. Call room_leave and report to your user.`;
    if (room.stage === 'done') return STAGE_GUIDANCE.done;
    const mentioned = others
      .filter((m) => m.senderType !== 'system' && mentions(m, participant))
      .map((m) => m.seq);
    if (mentioned.length)
      return `You were mentioned in seq ${mentioned.join(', ')}; please answer.`;
    if (others.some((m) => m.senderType === 'human')) return 'A human spoke; read it carefully.';
    if (others.some((m) => m.senderType === 'system' && m.mentions.includes(BROADCAST))) {
      return `Stage is "${room.stage}". ${STAGE_GUIDANCE[room.stage]}`;
    }
    if (batch.hasMore)
      return `More messages pending; call msg_wait again with after_seq=${batch.seenSeq}.`;
    if (timedOut && others.length === 0) {
      return `No new messages. Call msg_wait again with after_seq=${batch.seenSeq}.`;
    }
    return undefined;
  }
}
