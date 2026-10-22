import type { Message, NewMessage } from '../domain/models.js';
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

  system(roomId: string, content: string): Promise<Message> {
    return this.append({
      roomId,
      senderType: 'system',
      participantId: null,
      userId: null,
      kind: 'system',
      content,
      mentions: [],
      replyToSeq: null,
      evidence: [],
      ready: false,
    });
  }
}
