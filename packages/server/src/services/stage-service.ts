import type { AbsentMemberView, MemberStatusView, Stage, StageSetInput } from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import {
  actorLabel,
  isWebSeat,
  sameRepo,
  type Actor,
  type Message,
  type Participant,
  type Principal,
  type Room,
} from '../domain/models.js';
import type { Access } from './access.js';
import {
  IDLE_PAUSE_MS,
  isStageOf,
  nextStage,
  ROOM_MESSAGE_BUDGET,
  speakingLimit,
  stagesFor,
} from '../domain/stages.js';
import type { Clock, Repository } from './ports.js';
import { owes, type Questions } from './questions.js';
import { STAGE_GUIDANCE } from './rules.js';
import type { Thread } from './thread.js';
import { toMemberStatus } from './views.js';

/** Keys used in room.settings. */
interface StageSettings {
  pauseReason?: string;
  /** stageStartedSeq of the stage for which "everyone is ready" was already announced. */
  readyAnnouncedFor?: number;
  messageBudget?: number;
}

/** Stage machine and anti-runaway rules (design 8.3, 8.4). */
export class StageService {
  constructor(
    private readonly repo: Repository,
    private readonly access: Access,
    private readonly thread: Thread,
    private readonly questions: Questions,
    private readonly clock: Clock,
    private readonly idlePauseMs = IDLE_PAUSE_MS,
  ) {}

  async setByAgent(principal: Principal, input: StageSetInput) {
    const { room, participant } = await this.access.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    return this.set({ kind: 'agent', principal, participant }, room, input.stage, {
      allowAbsent: input.allow_absent,
    });
  }

  async setByHuman(
    principal: Principal,
    roomRef: string,
    name: string,
    stage: Stage,
    opts: { allowAbsent?: boolean } = {},
  ) {
    const room = await this.access.requireRoom(roomRef);
    return this.set({ kind: 'human', principal, name }, room, stage, opts);
  }

  async pauseByHuman(principal: Principal, roomRef: string, name: string) {
    const room = await this.access.requireRoom(roomRef);
    return this.thread.lock(room.id, async () => {
      const fresh = (await this.repo.findRoom(room.id)) ?? room;
      if (fresh.status === 'closed' || fresh.status === 'archived') {
        throw new AppError('ROOM_CLOSED', `Room is ${fresh.status}`);
      }
      if (fresh.status === 'paused') return { status: 'paused' as const };
      await this.pauseLocked(fresh, `paused by ${name || principal.name}`);
      return { status: 'paused' as const };
    });
  }

  async resumeByHuman(principal: Principal, roomRef: string, name: string) {
    const room = await this.access.requireRoom(roomRef);
    return this.thread.lock(room.id, async () => {
      const fresh = (await this.repo.findRoom(room.id)) ?? room;
      if (fresh.status === 'closed' || fresh.status === 'archived') {
        throw new AppError('ROOM_CLOSED', `Room is ${fresh.status}`);
      }
      if (fresh.status !== 'paused') return { status: fresh.status as 'open' };
      await this.resumeLocked(fresh);
      await this.thread.systemLocked(room.id, `Room resumed by ${name || principal.name}.`, {
        broadcast: true,
      });
      return { status: 'open' as const };
    });
  }

  /**
   * Moves the room to `stage` (forward or back). Also resumes a paused room.
   * Moving forward while members are offline needs `allowAbsent` (design 9.2).
   */
  async set(
    actor: Actor,
    room: Room,
    stage: Stage,
    opts: { allowAbsent?: boolean } = {},
  ): Promise<{ stage: Stage; previous: Stage }> {
    if (actor.kind === 'agent' && room.hostParticipantId !== actor.participant.id) {
      throw new AppError('FORBIDDEN', 'Only the host may change the stage');
    }
    if (!isStageOf(room.type, stage)) {
      throw new AppError('INVALID_ARGUMENT', `"${stage}" is not a stage of ${room.type} rooms`);
    }
    if (room.status === 'closed' || room.status === 'archived') {
      throw new AppError('ROOM_CLOSED', `Room is ${room.status}`);
    }
    return this.thread.lock(room.id, async () => {
      room = (await this.repo.findRoom(room.id)) ?? room;
      const previous = room.stage;
      const order = stagesFor(room.type);
      const forward = order.indexOf(stage) > order.indexOf(previous);
      const absent = forward ? await this.absentMembers(room) : [];
      if (absent.length > 0 && !opts.allowAbsent) throw absentError(absent);
      const currentSeq = await this.repo.currentSeq(room.id);
      const settings = { ...(room.settings as StageSettings) };
      delete settings.pauseReason;
      await this.repo.updateRoom(room.id, {
        stage,
        status: 'open',
        stageStartedSeq: currentSeq,
        ...(room.status === 'paused' ? { budgetStartSeq: currentSeq } : {}),
        settings: settings as Record<string, unknown>,
      });
      const resumed = room.status === 'paused' ? ' The room is resumed.' : '';
      const change =
        previous === stage ? `Stage stays "${stage}".` : `Stage changed: ${previous} → ${stage}.`;
      const without = absent.length
        ? ` Moved on while offline: ${absent.map((m) => m.display_name).join(', ')}.`
        : '';
      await this.thread.systemLocked(
        room.id,
        `${change}${resumed}${without} (by ${actorLabel(actor)})\n\n${STAGE_GUIDANCE[stage]}`,
        { broadcast: true },
      );
      return { stage, previous };
    });
  }

  /**
   * Throws LIMIT_REACHED / ROOM_PAUSED if the participant may not speak now. Call under the room lock.
   * The first ready=true post of a stage is always allowed, so a member who has nothing to add
   * or used up its quota can still say it is done (design 8.3).
   */
  async assertCanSpeak(
    room: Room,
    participant: Participant,
    opts: { ready?: boolean } = {},
  ): Promise<void> {
    if (room.status === 'paused') {
      throw new AppError(
        'ROOM_PAUSED',
        `Room is paused: ${(room.settings as StageSettings).pauseReason ?? 'waiting for a human'}. ` +
          'Stop posting and report to your local user.',
      );
    }
    if (room.status !== 'open') throw new AppError('ROOM_CLOSED', `Room is ${room.status}`);
    const limit = speakingLimit(room.type, room.stage);
    if (limit === null) return;
    const used = await this.repo.countAgentMessages(room.id, room.stageStartedSeq, participant.id);
    if (used >= limit) {
      if (opts.ready) {
        const ready = await this.repo.readyParticipants(room.id, room.stageStartedSeq);
        if (!ready.has(participant.id)) return;
      }
      throw new AppError(
        'LIMIT_REACHED',
        `You used all ${limit} messages allowed in stage "${room.stage}". Only call msg_wait until the stage advances` +
          ' (one short ready=true message is still allowed if you have not sent one).',
        { limit, used },
      );
    }
  }

  /** Budget and ready bookkeeping after an agent message. Call under the room lock. */
  async afterAgentPost(room: Room, message: Message): Promise<void> {
    const settings = room.settings as StageSettings;
    const budget = settings.messageBudget ?? ROOM_MESSAGE_BUDGET;
    const used = await this.repo.countAgentMessages(room.id, room.budgetStartSeq);
    if (used >= budget) {
      await this.pauseLocked(
        room,
        `the room reached ${budget} agent messages; a human should review and resume it`,
      );
      return;
    }
    void message;
    await this.announceIfAllReady(room);
  }

  /**
   * Re-counts readiness when a member goes offline or leaves, so the last member that was not
   * ready dropping out does not leave the stage stuck (design 8.3).
   */
  async recheckReady(roomId: string): Promise<void> {
    await this.thread.lock(roomId, async () => {
      const room = await this.repo.findRoom(roomId);
      if (room) await this.announceIfAllReady(room);
    });
  }

  /** Announces once per stage that every counted member is ready. Call under the room lock. */
  private async announceIfAllReady(room: Room): Promise<void> {
    const settings = room.settings as StageSettings;
    if (room.status !== 'open' || room.stage === 'done') return;
    if (settings.readyAnnouncedFor === room.stageStartedSeq) return;
    const members = await this.repo.listParticipants(room.id);
    // The host decides when to move on, and a Web seat is a human: neither is waited for.
    const counted = members.filter(
      (m) =>
        (m.status === 'online' || m.status === 'waiting') &&
        m.id !== room.hostParticipantId &&
        !isWebSeat(m),
    );
    if (counted.length === 0) return;
    const ready = await this.readySet(room, counted);
    if (!counted.every((m) => ready.has(m.id))) return;
    await this.repo.updateRoom(room.id, {
      settings: { ...room.settings, readyAnnouncedFor: room.stageStartedSeq },
    });
    room.settings = { ...room.settings, readyAnnouncedFor: room.stageStartedSeq };
    const next = nextStage(room.type, room.stage);
    const host = members.find((m) => m.id === room.hostParticipantId);
    const who =
      !host || isWebSeat(host) || host.status === 'left'
        ? 'A human can advance the stage in the Web UI'
        : 'The host may call stage_set';
    await this.thread.systemLocked(
      room.id,
      `All online participants are ready to finish stage "${room.stage}".` +
        (next ? ` ${who} with stage "${next}".` : ''),
      { broadcast: true },
    );
  }

  /** Members that posted ready=true this stage or used up their speaking quota. */
  private async readySet(room: Room, members: Participant[]): Promise<Set<string>> {
    const ready = await this.repo.readyParticipants(room.id, room.stageStartedSeq);
    const limit = speakingLimit(room.type, room.stage);
    if (limit !== null) {
      for (const m of members) {
        if (ready.has(m.id)) continue;
        const used = await this.repo.countAgentMessages(room.id, room.stageStartedSeq, m.id);
        if (used >= limit) ready.add(m.id);
      }
    }
    return ready;
  }

  /** Lifts a pause after a human steps in (keeps the stage). Call under the room lock. */
  async resumeLocked(room: Room): Promise<void> {
    if (room.status !== 'paused') return;
    const settings = { ...(room.settings as StageSettings) };
    delete settings.pauseReason;
    room.status = 'open';
    room.budgetStartSeq = await this.repo.currentSeq(room.id);
    await this.repo.updateRoom(room.id, {
      status: 'open',
      budgetStartSeq: room.budgetStartSeq,
      settings: settings as Record<string, unknown>,
    });
  }

  /** Pauses open rooms without messages for the idle period. Returns the paused room ids. */
  async pauseIdleRooms(): Promise<string[]> {
    const cutoff = this.clock.now() - this.idlePauseMs;
    const paused: string[] = [];
    for (const room of await this.repo.listRooms(['open'])) {
      if (room.lastMessageAt >= cutoff) continue;
      await this.thread.lock(room.id, async () => {
        const fresh = await this.repo.findRoom(room.id);
        if (fresh?.status !== 'open' || fresh.lastMessageAt >= cutoff) return;
        await this.pauseLocked(
          fresh,
          `no new messages for ${Math.round(this.idlePauseMs / 60000)} minutes`,
        );
        paused.push(room.id);
      });
    }
    return paused;
  }

  async memberStatus(room: Room, members: Participant[]): Promise<MemberStatusView[]> {
    const ready = await this.readySet(room, members);
    return members
      .filter((m) => m.status !== 'left')
      .map((m) => ({ ...toMemberStatus(m), ready: ready.has(m.id) }));
  }

  /** Offline members with the questions they still owe; they block moving forward. */
  async absentMembers(room: Room): Promise<AbsentMemberView[]> {
    const members = await this.repo.listParticipants(room.id);
    const present = members.filter((m) => m.status === 'online' || m.status === 'waiting');
    const offline = members.filter(
      (m) =>
        m.status === 'offline' &&
        // A Web seat is a human, not an absent agent (design 9.2).
        !isWebSeat(m) &&
        // Replaced by a present member of the same role and checkout, e.g. after a restart.
        !present.some((p) => p.role === m.role && sameRepo(p.repo, m.repo)),
    );
    if (offline.length === 0) return [];
    const pending = await this.questions.pending(room.id);
    return offline.map((m) => ({
      participant_id: m.id,
      display_name: m.displayName,
      role: m.role,
      last_seen_at: new Date(m.lastSeenAt).toISOString(),
      pending_question_seqs: pending.filter((q) => owes(q, m)).map((q) => q.message.seq),
    }));
  }

  pauseReason(room: Room): string | undefined {
    return (room.settings as StageSettings).pauseReason;
  }

  private async pauseLocked(room: Room, reason: string): Promise<void> {
    await this.repo.updateRoom(room.id, {
      status: 'paused',
      settings: { ...room.settings, pauseReason: reason },
    });
    room.status = 'paused';
    await this.thread.systemLocked(
      room.id,
      `Room paused: ${reason}. Agents: stop looping and report to your local user, but do not ` +
        'call room_leave. A human (or the host via stage_set) can resume the room; then call ' +
        'room_join again with your participant_id and continue.',
      { broadcast: true },
    );
  }
}

function absentError(absent: AbsentMemberView[]): AppError {
  const who = absent
    .map((m) => {
      const owed = m.pending_question_seqs.length
        ? `, still owes answers to seq ${m.pending_question_seqs.join(', ')}`
        : '';
      return `${m.display_name} (${m.role}${owed})`;
    })
    .join('; ');
  return new AppError(
    'MEMBERS_OFFLINE',
    `Offline: ${who}. Moving on would leave them out. Wait for them or ask a human; or record ` +
      'their open items in open_questions and retry with allow_absent=true.',
    { offline: absent },
  );
}
