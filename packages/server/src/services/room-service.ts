import {
  initialStage,
  type JoinResult,
  type RoomCreateInput,
  type RoomJoinInput,
  type RoomLeaveInput,
} from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import type { Participant, Principal, Room } from '../domain/models.js';
import { newId, randomToken } from './ids.js';
import type { Clock, EventBus, Repository } from './ports.js';
import type { ReplyTokens } from './reply-tokens.js';
import { ROOM_RULES } from './rules.js';
import type { Thread } from './thread.js';
import { nameIndex, toMemberView, toMessageView, toRoomView } from './views.js';

const RECENT_MESSAGES = 30;

export interface ParticipantContext {
  room: Room;
  participant: Participant;
}

export class RoomService {
  constructor(
    private readonly repo: Repository,
    private readonly bus: EventBus,
    private readonly thread: Thread,
    private readonly tokens: ReplyTokens,
    private readonly clock: Clock,
  ) {}

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
      await this.thread.append({
        roomId: room.id,
        senderType: 'agent',
        participantId: participant.id,
        userId: principal.userId,
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
    const room = await this.requireOpenRoom(input.room);
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
    const { room, participant } = await this.requireParticipant(
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

  async requireRoom(ref: string): Promise<Room> {
    const room = await this.repo.findRoom(ref);
    if (!room) throw new AppError('NOT_FOUND', `Room "${ref}" not found`);
    return room;
  }

  async requireOpenRoom(ref: string): Promise<Room> {
    const room = await this.requireRoom(ref);
    if (room.status !== 'open')
      throw new AppError('ROOM_CLOSED', `Room "${ref}" is ${room.status}`);
    return room;
  }

  /** Resolves an active participant owned by the caller, and marks it as seen. */
  async requireParticipant(
    principal: Principal,
    roomRef: string,
    participantId: string,
  ): Promise<ParticipantContext> {
    const room = await this.requireRoom(roomRef);
    const participant = await this.repo.findParticipant(participantId);
    if (!participant || participant.roomId !== room.id || participant.status === 'left') {
      throw new AppError(
        'NOT_A_PARTICIPANT',
        `"${participantId}" is not an active participant of room "${roomRef}"; call room_join first`,
      );
    }
    if (participant.userId !== principal.userId) {
      throw new AppError('FORBIDDEN', 'This participant belongs to another user');
    }
    await this.setStatus(
      participant,
      participant.status === 'offline' ? 'online' : participant.status,
    );
    return { room, participant };
  }

  async setStatus(participant: Participant, status: Participant['status']): Promise<void> {
    const changed = participant.status !== status;
    participant.status = status;
    participant.lastSeenAt = this.clock.now();
    await this.repo.updateParticipant(participant.id, {
      status,
      lastSeenAt: participant.lastSeenAt,
    });
    if (changed) {
      this.bus.publish({
        type: 'participant.updated',
        roomId: participant.roomId,
        participantId: participant.id,
      });
    }
  }

  /** Called when the MCP session that drove these participants goes away. */
  async markOffline(participantIds: Iterable<string>): Promise<void> {
    for (const id of participantIds) {
      const p = await this.repo.findParticipant(id);
      if (p && p.status !== 'left') await this.setStatus(p, 'offline');
    }
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
