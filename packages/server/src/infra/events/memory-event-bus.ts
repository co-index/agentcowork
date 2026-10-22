import type { EventBus, HubEvent } from '../../services/ports.js';

/** In-process broadcast. Handlers run synchronously; a throwing handler does not affect others. */
export class MemoryEventBus implements EventBus {
  private readonly handlers = new Set<(event: HubEvent) => void>();

  publish(event: HubEvent): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch (err) {
        console.error('[event-bus] handler failed', err);
      }
    }
  }

  subscribe(handler: (event: HubEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
