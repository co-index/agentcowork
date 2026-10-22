import type {
  EventId,
  EventStore,
  StreamId,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

interface StoredEvent {
  id: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
  at: number;
}

/**
 * Per-session, bounded event store that makes SSE responses resumable. If a proxy cuts a
 * long msg_wait stream, the client reconnects with Last-Event-ID and the result is replayed
 * instead of being lost (which would leave the agent's tool call hanging).
 */
export class BoundedEventStore implements EventStore {
  private readonly events: StoredEvent[] = [];
  private counter = 0;

  constructor(
    private readonly maxEvents = 500,
    private readonly maxAgeMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const id = `${streamId}_${(++this.counter).toString().padStart(10, '0')}`;
    this.events.push({ id, streamId, message, at: this.now() });
    this.prune();
    return id;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.events.find((e) => e.id === eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    this.prune();
    const index = this.events.findIndex((e) => e.id === lastEventId);
    if (index === -1) return '';
    const { streamId } = this.events[index]!;
    for (const e of this.events.slice(index + 1)) {
      if (e.streamId === streamId) await send(e.id, e.message);
    }
    return streamId;
  }

  get size(): number {
    return this.events.length;
  }

  private prune() {
    const cutoff = this.now() - this.maxAgeMs;
    let drop = 0;
    while (drop < this.events.length && this.events[drop]!.at < cutoff) drop++;
    drop = Math.max(drop, this.events.length - this.maxEvents);
    if (drop > 0) this.events.splice(0, drop);
  }
}
