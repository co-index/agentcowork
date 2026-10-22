import {
  initialStage,
  type JoinResult,
  type RoomCreateInput,
  type RoomJoinInput,
  type RoomLeaveInput,
  type RoomListInput,
  type RoomSummaryView,
} from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import type { Participant, Principal, Room } from '../domain/models.js';
import type { Access } from './access.js';
import type { BoardService } from './board-service.js';
import { newId, randomToken } from './ids.js';
import type { Clock, EventBus, Repository } from './ports.js';
import type { ReplyTokens } from './reply-tokens.js';
import { ROOM_RULES } from './rules.js';
import type { Thread } from './thread.js';
import { nameIndex, toMemberView, toMessageView, toRoomView } from './views.js';

const RECENT_MESSAGES = 30;

export class RoomService {
  constructor(
    private readonly repo: Repository,
    private readonly bus: EventBus,
    private readonly access: Access,
    private readonly thread: Thread,
    private readonly tokens: ReplyTokens,
    private readonly board: BoardService,
    private readonly clock: Clock,
  ) {}

  async list(input: RoomListInput = {}): Promise<{ rooms: RoomSummaryView[] }> {
    const rooms = await this.repo.listRooms(input.status ?? ['open', 'paused']);
    const out: RoomSummaryView[] = [];
    for (const room of rooms) out.push(await this.summarize(room));
    return { rooms: out };
  }

  async summarize(room: Room): Promise<RoomSummaryView> {
    const members = await this.repo.listParticipants(room.id);
    return {
      ...toRoomView(room, members),
      member_count: members.filter((m) => m.status !== 'left').length,
      last_message_at: room.lastMessageAt ? new Date(room.lastMessageAt).toISOString() : null,
      created_at: new Date(room.createdAt).toISOString(),
    };
  }

  /** Creates a room; the creator joins immediately and becomes its host. */
  async create(principal: Principal, input: RoomCreateInput): Promise<JoinResult> {
    const room: Room = {
      id: newId('r'),
      slug: input.slug ?? '',
      title: input.title,
      type: input.type,
      stage: initialStage(input.type),
      status: 'open',
      hostParticipantId: null,
      createdBy: principal.userId,
      settings: {},
      stageStartedSeq: 0,
      budgetStartSeq: 0,
      lastMessageAt: this.clock.now(),
      createdAt: this.clock.now(),
      closedAt: null,
    };
    if (input.slug) {
      await this.repo.createRoom(room);
    } else {
      await this.createWithGeneratedSlug(room);
    }

    const participant = await this.addParticipant(principal, room, input);
    await this.repo.updateRoom(room.id, { hostParticipantId: participant.id });
    room.hostParticipantId = participant.id;

    await this.thread.system(
      room.id,
      `Room "${room.title}" created by ${participant.displayName} (host).`,
    );
    if (input.requirement?.trim()) {
      await this.board.update(
        { kind: 'agent', principal, participant },
        room.id,
        {
          key: room.type === 'bug' ? 'bug.symptom' : 'requirement',
          content: input.requirement,
          base_version: 0,
        },
        { announce: false },
      );
      await this.thread.append({
        roomId: room.id,
        senderType: 'agent',
        participantId: participant.id,
        userId: principal.userId,
        senderName: null,
        kind: 'chat',
        content: `## ${room.type === 'bug' ? 'Bug report' : 'Requirement'}\n\n${input.requirement}`,
        mentions: [],
        replyToSeq: null,
        evidence: [],
        ready: false,
      });
    }
    return this.joinResult(room, participant);
  }

  async join(principal: Principal, input: RoomJoinInput): Promise<JoinResult> {
    const room = await this.access.requireRoom(input.room);
    if (room.status === 'closed' || room.status === 'archived') {
      throw new AppError('ROOM_CLOSED', `Room "${input.room}" is ${room.status}`);
    }
    const participant = await this.addParticipant(principal, room, input);
    await this.thread.system(
      room.id,
      `${participant.displayName} joined as ${participant.role}` +
        (participant.repo ? ` (repo: ${participant.repo.name})` : '') +
        '.',
    );
    return this.joinResult(room, participant);
  }

  async leave(principal: Principal, input: RoomLeaveInput): Promise<{ ok: true }> {
    const { room, participant } = await this.access.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    const now = this.clock.now();
    await this.repo.updateParticipant(participant.id, {
      status: 'left',
      leftAt: now,
      lastSeenAt: now,
      leaveSummary: input.summary ?? null,
    });
    this.bus.publish({
      type: 'participant.updated',
      roomId: room.id,
      participantId: participant.id,
    });
    await this.thread.system(
      room.id,
      `${participant.displayName} left.` + (input.summary ? `\n\nSummary:\n${input.summary}` : ''),
    );
    return { ok: true };
  }

  private async addParticipant(
    principal: Principal,
    room: Room,
    input: Pick<RoomJoinInput, 'role' | 'display_name' | 'repo' | 'client'>,
  ): Promise<Participant> {
    const now = this.clock.now();
    const participant: Participant = {
      id: newId('p'),
      roomId: room.id,
      userId: principal.userId,
      role: input.role,
      displayName: input.display_name ?? `${input.role}·${principal.name}`,
      repo: input.repo ?? null,
      client: input.client ?? null,
      status: 'online',
      lastSeenAt: now,
      joinedAt: now,
      leftAt: null,
      leaveSummary: null,
    };
    await this.repo.createParticipant(participant);
    this.bus.publish({
      type: 'participant.updated',
      roomId: room.id,
      participantId: participant.id,
    });
    return participant;
  }

  private async joinResult(room: Room, participant: Participant): Promise<JoinResult> {
    const members = await this.repo.listParticipants(room.id);
    const recent = await this.repo.listMessages(room.id, { limit: RECENT_MESSAGES });
    // Derive from what we return, so a message landing in between is never silently skipped.
    const currentSeq = recent.at(-1)?.seq ?? 0;
    const names = nameIndex(members);
    return {
      participant_id: participant.id,
      room: toRoomView(room, members),
      members: members.filter((m) => m.status !== 'left').map(toMemberView),
      board_summary: await this.board.summary(room.id),
      recent_messages: recent.map((m) => toMessageView(m, names)),
      sync: await this.tokens.issue(participant, currentSeq),
      rules: ROOM_RULES,
    };
  }

  private async createWithGeneratedSlug(room: Room): Promise<void> {
    const prefix = room.type === 'bug' ? 'BUG' : 'REQ';
    for (let attempt = 0; ; attempt++) {
      room.slug = `${prefix}-${randomToken(6).toUpperCase()}`;
      try {
        await this.repo.createRoom(room);
        return;
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'SLUG_TAKEN') || attempt >= 5) throw err;
      }
    }
  }
}
