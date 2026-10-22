import { BROADCAST, type Message, type NewMessage } from '../domain/models.js';
import { newId } from './ids.js';
import { KeyedMutex } from './keyed-mutex.js';
import type { Clock, EventBus, Repository } from './ports.js';

export type ThreadEntry = Omit<NewMessage, 'id' | 'createdAt'>;

/**
 * The only way messages enter a room. Every append happens under the room lock, so a
 * strict-sync check done under the same lock cannot be overtaken by a concurrent append.
 */
export class Thread {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly repo: Repository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  lock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(roomId, fn);
  }

  /** Caller must hold the room lock. */
  async appendLocked(entry: ThreadEntry): Promise<Message> {
    const message = await this.repo.appendMessage({
      ...entry,
      id: newId('m'),
      createdAt: this.clock.now(),
    });
    this.bus.publish({ type: 'message.created', roomId: message.roomId, message });
    return message;
  }

  append(entry: ThreadEntry): Promise<Message> {
    return this.lock(entry.roomId, () => this.appendLocked(entry));
  }

  /** Hub-authored message. `broadcast` mentions "@all" so it also wakes only_when_mentioned waiters. */
  system(roomId: string, content: string, opts: { broadcast?: boolean } = {}): Promise<Message> {
    return this.lock(roomId, () => this.systemLocked(roomId, content, opts));
  }

  /** Caller must hold the room lock. */
  systemLocked(roomId: string, content: string, opts: { broadcast?: boolean } = {}) {
    return this.appendLocked({
      roomId,
      senderType: 'system',
      participantId: null,
      userId: null,
      senderName: null,
      kind: 'system',
      content,
      mentions: opts.broadcast ? [BROADCAST] : [],
      replyToSeq: null,
      evidence: [],
      ready: false,
    });
  }
}
