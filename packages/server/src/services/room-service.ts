import {
  initialStage,
  type JoinResult,
  type RoomCreateInput,
  type RoomJoinInput,
  type RoomLeaveInput,
  type RoomListInput,
  type RepoInfo,
  type RoomSummaryView,
} from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import { mentions, type Participant, type Principal, type Room } from '../domain/models.js';
import type { Access } from './access.js';
import type { BoardService } from './board-service.js';
import { redact } from '../security/redact.js';
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
    const previous = await this.findResumable(principal, room.id, input);
    if (previous) return this.resume(room, previous, input);

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
      leaveSummary: input.summary === undefined ? null : redact(input.summary).text,
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
      lastSeenSeq: 0,
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

  /**
   * The participant a join should resume: the explicit `participant_id`, or else the most
   * recently seen *offline* participant of this user with the same role and repository.
   * Online participants are never taken over implicitly (Host mode shares one user id).
   */
  private async findResumable(
    principal: Principal,
    roomId: string,
    input: RoomJoinInput,
  ): Promise<Participant | undefined> {
    if (input.participant_id) {
      const p = await this.repo.findParticipant(input.participant_id);
      if (!p || p.roomId !== roomId || p.status === 'left') {
        throw new AppError(
          'NOT_A_PARTICIPANT',
          `"${input.participant_id}" cannot be resumed in this room; join without participant_id`,
        );
      }
      if (p.userId !== principal.userId) {
        throw new AppError('FORBIDDEN', 'This participant belongs to another user');
      }
      return p;
    }
    const members = await this.repo.listParticipants(roomId);
    return members
      .filter(
        (m) =>
          m.status === 'offline' &&
          m.userId === principal.userId &&
          m.role === input.role &&
          sameRepo(m.repo, input.repo ?? null),
      )
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
  }

  private async resume(room: Room, p: Participant, input: RoomJoinInput): Promise<JoinResult> {
    const since = p.lastSeenSeq;
    const missed = await this.repo.listMessages(room.id, { afterSeq: since, limit: 1000 });
    const fromOthers = missed.filter((m) => m.participantId !== p.id);
    const mentioned = fromOthers
      .filter((m) => m.senderType !== 'system' && mentions(m, p))
      .map((m) => m.seq);

    const changes = {
      ...(input.display_name ? { displayName: input.display_name } : {}),
      ...(input.repo ? { repo: input.repo } : {}),
      ...(input.client ? { client: input.client } : {}),
    };
    if (Object.keys(changes).length > 0) await this.repo.updateParticipant(p.id, changes);
    const fresh = { ...p, ...(await this.repo.findParticipant(p.id))! };
    await this.access.setStatus(fresh, 'online');
    await this.thread.system(room.id, `${fresh.displayName} reconnected.`);

    const result = await this.joinResult(room, fresh);
    const unseen = fromOthers.filter((m) => m.seq < (result.recent_messages[0]?.seq ?? 0)).length;
    const hint = [
      `Welcome back. ${fromOthers.length} message(s) from others arrived while you were away.`,
      mentioned.length
        ? `You were mentioned in seq ${mentioned.join(', ')}: answer those first.`
        : '',
      unseen > 0
        ? `${unseen} of them are older than recent_messages; read them with msg_list(after_seq=${since}).`
        : '',
      'Check board_get for decisions made meanwhile.',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      ...result,
      resumed: {
        missed_count: fromOthers.length,
        mentioned_seqs: mentioned,
        since_seq: since,
        hint,
      },
    };
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

/** Same checkout: worktree when both know it, else repository name, else both unspecified. */
function sameRepo(a: RepoInfo | null, b: RepoInfo | null): boolean {
  if (!a || !b) return !a && !b;
  if (a.worktree && b.worktree) return a.worktree === b.worktree;
  return a.name === b.name;
}
