import type { Message } from '../domain/models.js';
import type { EventBus } from './ports.js';

export type WaitOutcome = 'woken' | 'timeout' | 'aborted';

export interface WaitRequest {
  roomId: string;
  /** Called for each new message in the room; return true to wake the waiter. */
  matches: (message: Message) => boolean;
  timeoutMs: number;
  /** Aborted when the client disconnects or cancels the request. */
  signal?: AbortSignal;
  /** Invoked every `heartbeatMs` while suspended (used for MCP progress notifications). */
  onHeartbeat?: (elapsedMs: number) => void;
}

export interface WaitHandle {
  readonly promise: Promise<WaitOutcome>;
  /** Settles the wait as aborted and releases resources. Safe to call repeatedly. */
  cancel(): void;
}

interface Waiter {
  matches: (message: Message) => boolean;
  settle: (outcome: WaitOutcome) => void;
}

/**
 * Suspends msg_wait callers until a matching message arrives, the timeout fires or the
 * client goes away. Register *before* reading the backlog so no message can slip through
 * between the read and the subscription.
 */
export class WaitCoordinator {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly unsubscribe: () => void;

  constructor(
    bus: EventBus,
    private readonly heartbeatMs: number,
  ) {
    this.unsubscribe = bus.subscribe((event) => {
      if (event.type !== 'message.created') return;
      for (const waiter of [...(this.waiters.get(event.roomId) ?? [])]) {
        if (waiter.matches(event.message)) waiter.settle('woken');
      }
    });
  }

  register(req: WaitRequest): WaitHandle {
    let settle!: (outcome: WaitOutcome) => void;
    const promise = new Promise<WaitOutcome>((resolve) => {
      const startedAt = Date.now();
      let done = false;
      const timer = setTimeout(() => settle('timeout'), req.timeoutMs);
      const heartbeat =
        req.onHeartbeat && this.heartbeatMs > 0
          ? setInterval(() => req.onHeartbeat?.(Date.now() - startedAt), this.heartbeatMs)
          : undefined;
      const onAbort = () => settle('aborted');
      const waiter: Waiter = { matches: req.matches, settle: (o) => settle(o) };

      settle = (outcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (heartbeat) clearInterval(heartbeat);
        req.signal?.removeEventListener('abort', onAbort);
        const set = this.waiters.get(req.roomId);
        set?.delete(waiter);
        if (set?.size === 0) this.waiters.delete(req.roomId);
        resolve(outcome);
      };

      let set = this.waiters.get(req.roomId);
      if (!set) this.waiters.set(req.roomId, (set = new Set()));
      set.add(waiter);
      if (req.signal?.aborted) settle('aborted');
      else req.signal?.addEventListener('abort', onAbort, { once: true });
    });
    return { promise, cancel: () => settle('aborted') };
  }

  waiterCount(roomId?: string): number {
    if (roomId) return this.waiters.get(roomId)?.size ?? 0;
    let n = 0;
    for (const set of this.waiters.values()) n += set.size;
    return n;
  }

  /** Wakes every waiter (as aborted) and detaches from the bus. */
  dispose(): void {
    this.unsubscribe();
    for (const set of [...this.waiters.values()]) for (const w of [...set]) w.settle('aborted');
  }
}
