import { AppError } from '../domain/errors.js';
import type { Message } from '../domain/models.js';
import type { EventBus } from './ports.js';

export type WaitOutcome = 'woken' | 'timeout' | 'aborted';

export interface WaitRequest {
  roomId: string;
  /** Who waits (participant id); counted against the per-participant cap. */
  waiterId?: string;
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
  waiterId?: string;
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

  private readonly perWaiter = new Map<string, number>();
  private total = 0;

  constructor(
    bus: EventBus,
    private readonly heartbeatMs: number,
    private readonly limits: { maxWaiters: number; maxWaitsPerParticipant: number } = {
      maxWaiters: Infinity,
      maxWaitsPerParticipant: Infinity,
    },
  ) {
    this.unsubscribe = bus.subscribe((event) => {
      if (event.type !== 'message.created') return;
      for (const waiter of [...(this.waiters.get(event.roomId) ?? [])]) {
        if (waiter.matches(event.message)) waiter.settle('woken');
      }
    });
  }

  /** Throws AppError('TOO_MANY') when a waiter cap is reached. */
  register(req: WaitRequest): WaitHandle {
    if (this.total >= this.limits.maxWaiters) {
      throw new AppError('TOO_MANY', 'The hub has too many waiting requests; retry shortly');
    }
    if (
      req.waiterId !== undefined &&
      (this.perWaiter.get(req.waiterId) ?? 0) >= this.limits.maxWaitsPerParticipant
    ) {
      throw new AppError(
        'TOO_MANY',
        `Too many concurrent msg_wait calls for this participant (max ${this.limits.maxWaitsPerParticipant}); ` +
          'wait for the previous call to return',
      );
    }
    this.count(req.waiterId, +1);
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
      const waiter: Waiter = {
        waiterId: req.waiterId,
        matches: req.matches,
        settle: (o) => settle(o),
      };

      settle = (outcome) => {
        if (done) return;
        done = true;
        this.count(req.waiterId, -1);
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

  private count(waiterId: string | undefined, delta: 1 | -1) {
    this.total += delta;
    if (waiterId === undefined) return;
    const n = (this.perWaiter.get(waiterId) ?? 0) + delta;
    if (n > 0) this.perWaiter.set(waiterId, n);
    else this.perWaiter.delete(waiterId);
  }

  /** Wakes every waiter (as aborted) and detaches from the bus. */
  dispose(): void {
    this.unsubscribe();
    for (const set of [...this.waiters.values()]) for (const w of [...set]) w.settle('aborted');
  }
}
