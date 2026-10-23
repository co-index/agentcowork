import { AppError } from '../domain/errors.js';
import type { Participant, Principal, Room } from '../domain/models.js';
import type { Clock, EventBus, Repository } from './ports.js';

export interface ParticipantContext {
  room: Room;
  participant: Participant;
}

/** Resolves rooms and the caller's participants; tracks presence. Shared by all services. */
export class Access {
  constructor(
    private readonly repo: Repository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async requireRoom(ref: string): Promise<Room> {
    const room = await this.repo.findRoom(ref);
    if (!room) throw new AppError('NOT_FOUND', `Room "${ref}" not found`);
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

  /**
   * Updates presence. `touch: false` keeps lastSeenAt unchanged, for transitions the hub makes
   * on its own (a wait ending, a stale participant going offline) rather than client activity.
   */
  async setStatus(
    participant: Participant,
    status: Participant['status'],
    opts: { touch?: boolean } = {},
  ): Promise<void> {
    const changed = participant.status !== status;
    participant.status = status;
    if (opts.touch !== false) participant.lastSeenAt = this.clock.now();
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

  /**
   * Marks participants offline that sent nothing for `staleMs` and are not mid-request.
   * Catches agents whose machine went away without closing its MCP session.
   */
  async markStale(staleMs: number, isBusy: (participantId: string) => boolean): Promise<string[]> {
    const stale = await this.repo.listStaleParticipants(this.clock.now() - staleMs);
    const marked: string[] = [];
    for (const p of stale) {
      if (isBusy(p.id)) continue;
      await this.setStatus(p, 'offline', { touch: false });
      marked.push(p.id);
    }
    return marked;
  }

  /** Called when the MCP session that drove these participants goes away. */
  async markOffline(participantIds: Iterable<string>): Promise<void> {
    for (const id of participantIds) {
      const p = await this.repo.findParticipant(id);
      if (p && p.status !== 'left') await this.setStatus(p, 'offline');
    }
  }
}
