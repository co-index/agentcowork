import type { MemberStatusView, Stage, StageSetInput } from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import {
  actorLabel,
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
} from '../domain/stages.js';
import type { Clock, Repository } from './ports.js';
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
    private readonly clock: Clock,
    private readonly idlePauseMs = IDLE_PAUSE_MS,
  ) {}

  async setByAgent(principal: Principal, input: StageSetInput) {
    const { room, participant } = await this.access.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    return this.set({ kind: 'agent', principal, participant }, room, input.stage);
  }

  async setByHuman(principal: Principal, roomRef: string, name: string, stage: Stage) {
    const room = await this.access.requireRoom(roomRef);
    return this.set({ kind: 'human', principal, name }, room, stage);
  }

  /** Moves the room to `stage` (forward or back). Also resumes a paused room. */
  async set(actor: Actor, room: Room, stage: Stage): Promise<{ stage: Stage; previous: Stage }> {
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
      await this.thread.systemLocked(
        room.id,
        `${change}${resumed} (by ${actorLabel(actor)})\n\n${STAGE_GUIDANCE[stage]}`,
        { broadcast: true },
      );
      return { stage, previous };
    });
  }

  /** Throws LIMIT_REACHED / ROOM_PAUSED if the participant may not speak now. Call under the room lock. */
  async assertCanSpeak(room: Room, participant: Participant): Promise<void> {
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
      throw new AppError(
        'LIMIT_REACHED',
        `You used all ${limit} messages allowed in stage "${room.stage}". Only call msg_wait until the stage advances.`,
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
    if (message.ready && settings.readyAnnouncedFor !== room.stageStartedSeq) {
      const members = await this.activeMembers(room.id);
      const ready = await this.repo.readyParticipants(room.id, room.stageStartedSeq);
      if (members.length > 0 && members.every((m) => ready.has(m.id))) {
        await this.repo.updateRoom(room.id, {
          settings: { ...room.settings, readyAnnouncedFor: room.stageStartedSeq },
        });
        const next = nextStage(room.type, room.stage);
        await this.thread.systemLocked(
          room.id,
          `All online participants are ready to finish stage "${room.stage}".` +
            (next ? ` The host may call stage_set with stage "${next}".` : ''),
          { broadcast: true },
        );
      }
    }
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
    const ready = await this.repo.readyParticipants(room.id, room.stageStartedSeq);
    return members
      .filter((m) => m.status !== 'left')
      .map((m) => ({ ...toMemberStatus(m), ready: ready.has(m.id) }));
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
      `Room paused: ${reason}. Agents: stop looping and report to your local user. ` +
        'A human (or the host via stage_set) can resume the room.',
      { broadcast: true },
    );
  }

  private async activeMembers(roomId: string): Promise<Participant[]> {
    const members = await this.repo.listParticipants(roomId);
    return members.filter((m) => m.status === 'online' || m.status === 'waiting');
  }
}
