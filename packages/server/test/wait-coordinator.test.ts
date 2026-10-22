import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/domain/models.js';
import { MemoryEventBus } from '../src/infra/events/memory-event-bus.js';
import { WaitCoordinator } from '../src/services/wait-coordinator.js';

function msg(roomId: string, participantId: string, seq = 1): Message {
  return {
    id: `m${seq}`,
    roomId,
    seq,
    senderType: 'agent',
    participantId,
    userId: null,
    senderName: null,
    kind: 'chat',
    content: 'hi',
    mentions: [],
    replyToSeq: null,
    evidence: [],
    ready: false,
    createdAt: 0,
  };
}

describe('WaitCoordinator', () => {
  afterEach(() => vi.useRealTimers());

  it('wakes a matching waiter and ignores other rooms / non-matching messages', async () => {
    const bus = new MemoryEventBus();
    const wc = new WaitCoordinator(bus, 0);
    const handle = wc.register({
      roomId: 'r1',
      matches: (m) => m.participantId !== 'me',
      timeoutMs: 5000,
    });
    bus.publish({ type: 'message.created', roomId: 'r2', message: msg('r2', 'other') });
    bus.publish({ type: 'message.created', roomId: 'r1', message: msg('r1', 'me') });
    expect(wc.waiterCount('r1')).toBe(1);
    bus.publish({ type: 'message.created', roomId: 'r1', message: msg('r1', 'other') });
    await expect(handle.promise).resolves.toBe('woken');
    expect(wc.waiterCount()).toBe(0);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const wc = new WaitCoordinator(new MemoryEventBus(), 0);
    const handle = wc.register({ roomId: 'r1', matches: () => true, timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    await expect(handle.promise).resolves.toBe('timeout');
    expect(wc.waiterCount()).toBe(0);
  });

  it('cleans up when the client aborts', async () => {
    const wc = new WaitCoordinator(new MemoryEventBus(), 0);
    const ac = new AbortController();
    const handle = wc.register({
      roomId: 'r1',
      matches: () => true,
      timeoutMs: 5000,
      signal: ac.signal,
    });
    ac.abort();
    await expect(handle.promise).resolves.toBe('aborted');
    expect(wc.waiterCount()).toBe(0);
  });

  it('treats an already-aborted signal as aborted immediately', async () => {
    const wc = new WaitCoordinator(new MemoryEventBus(), 0);
    const handle = wc.register({
      roomId: 'r1',
      matches: () => true,
      timeoutMs: 5000,
      signal: AbortSignal.abort(),
    });
    await expect(handle.promise).resolves.toBe('aborted');
    expect(wc.waiterCount()).toBe(0);
  });

  it('emits heartbeats while suspended and stops afterwards', async () => {
    vi.useFakeTimers();
    const wc = new WaitCoordinator(new MemoryEventBus(), 100);
    const beats: number[] = [];
    const handle = wc.register({
      roomId: 'r1',
      matches: () => true,
      timeoutMs: 350,
      onHeartbeat: (ms) => beats.push(ms),
    });
    vi.advanceTimersByTime(350);
    await handle.promise;
    vi.advanceTimersByTime(1000);
    expect(beats).toEqual([100, 200, 300]);
  });

  it('dispose releases every waiter', async () => {
    const wc = new WaitCoordinator(new MemoryEventBus(), 0);
    const a = wc.register({ roomId: 'r1', matches: () => true, timeoutMs: 5000 });
    const b = wc.register({ roomId: 'r2', matches: () => true, timeoutMs: 5000 });
    wc.dispose();
    await expect(Promise.all([a.promise, b.promise])).resolves.toEqual(['aborted', 'aborted']);
  });
});
