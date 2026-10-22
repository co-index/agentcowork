import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '../src/app.js';
import {
  alice,
  bob,
  closeServices,
  expectAppError,
  makeServices,
  post,
  roomWithTwo,
} from './helpers.js';

describe('MessageService', () => {
  let s: Services;
  beforeEach(() => {
    s = makeServices();
  });
  afterEach(() => closeServices(s));

  describe('strict sync', () => {
    it('accepts a post with a fresh token and returns a new sync', async () => {
      const { guest } = await roomWithTwo(s);
      const res = await post(s, bob, guest, guest.sync, 'hello');
      expect(res.seq).toBe(guest.sync.current_seq + 1);
      expect(res.sync.current_seq).toBe(res.seq);
      expect(res.sync.reply_token).not.toBe(guest.sync.reply_token);
    });

    it('returns STALE_CONTEXT with missed messages when someone else spoke first', async () => {
      const { host, guest } = await roomWithTwo(s);
      // alice's join-time sync predates bob's join message, so refresh it first.
      const hostWait = await s.messages.wait(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        after_seq: host.sync.current_seq,
      });
      await post(s, alice, host, hostWait.sync, 'backend first');

      const err = await expectAppError(
        post(s, bob, guest, guest.sync, 'frontend'),
        'STALE_CONTEXT',
      );
      const missed = err.data.missed_messages as { content: string }[];
      expect(missed.map((m) => m.content)).toEqual(['backend first']);

      // The sync returned with the conflict lets bob post straight away.
      const sync = err.data.sync as typeof guest.sync;
      const ok = await post(s, bob, guest, sync, 'frontend, after reading');
      expect(ok.seq).toBe(sync.current_seq + 1);
    });

    it('does not treat your own messages as a conflict', async () => {
      const { guest } = await roomWithTwo(s);
      const first = await post(s, bob, guest, guest.sync, 'one');
      // Stale expected_last_seq, but the only newer message is bob's own.
      const second = await post(
        s,
        bob,
        guest,
        {
          current_seq: guest.sync.current_seq,
          reply_token: first.sync.reply_token,
        },
        'two',
      );
      expect(second.seq).toBe(first.seq + 1);
    });

    it('rejects a reused token', async () => {
      const { guest } = await roomWithTwo(s);
      await post(s, bob, guest, guest.sync, 'one');
      const err = await expectAppError(post(s, bob, guest, guest.sync, 'again'), 'TOKEN_INVALID');
      expect(err.data.sync).toBeDefined();
    });

    it("rejects another participant's token", async () => {
      const { host, guest } = await roomWithTwo(s);
      await expectAppError(
        post(
          s,
          bob,
          guest,
          { current_seq: guest.sync.current_seq, reply_token: host.sync.reply_token },
          'x',
        ),
        'TOKEN_INVALID',
      );
    });

    it('serializes concurrent posts: exactly one wins, the rest get STALE_CONTEXT', async () => {
      const { host, guest } = await roomWithTwo(s);
      const hostSync = (
        await s.messages.wait(alice, {
          room: 'REQ-1',
          participant_id: host.participant_id,
          after_seq: host.sync.current_seq,
        })
      ).sync;
      const results = await Promise.allSettled([
        post(s, alice, host, hostSync, 'a'),
        post(s, bob, guest, guest.sync, 'b'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason.code).toBe('STALE_CONTEXT');
    });
  });

  describe('msg_wait', () => {
    it('returns backlog immediately, excluding own messages', async () => {
      const { host, guest } = await roomWithTwo(s);
      await post(s, bob, guest, guest.sync, 'from bob');
      const res = await s.messages.wait(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        after_seq: 0,
      });
      expect(res.timed_out).toBe(false);
      expect(res.messages.some((m) => m.participant_id === host.participant_id)).toBe(false);
      expect(res.messages.at(-1)?.content).toBe('from bob');
      expect(res.sync.current_seq).toBe(
        await s.repo.currentSeq((await s.repo.findRoom('REQ-1'))!.id),
      );
    });

    it('is woken by a new message from someone else', async () => {
      const { host, guest } = await roomWithTwo(s);
      const waiting = s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        after_seq: guest.sync.current_seq,
        timeout_seconds: 2,
      });
      await new Promise((r) => setTimeout(r, 30));
      const status = (await s.repo.findParticipant(guest.participant_id))?.status;
      expect(status).toBe('waiting');

      const hostSync = (
        await s.messages.wait(alice, {
          room: 'REQ-1',
          participant_id: host.participant_id,
          after_seq: host.sync.current_seq,
        })
      ).sync;
      await post(s, alice, host, hostSync, 'ping', { mentions: ['frontend'] });

      const res = await waiting;
      expect(res.timed_out).toBe(false);
      expect(res.messages.map((m) => m.content)).toEqual(['ping']);
      expect(res.hint).toMatch(/mentioned/);
      expect((await s.repo.findParticipant(guest.participant_id))?.status).toBe('online');
    });

    it('times out with timed_out=true and a usable sync', async () => {
      const { guest } = await roomWithTwo(s);
      const started = Date.now();
      const res = await s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        after_seq: guest.sync.current_seq,
        timeout_seconds: 1,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
      expect(res.timed_out).toBe(true);
      expect(res.messages).toEqual([]);
      await post(s, bob, guest, res.sync, 'still here');
    });

    it('caps timeout_seconds at the configured maximum', async () => {
      const { guest } = await roomWithTwo(s);
      const started = Date.now();
      await s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        after_seq: guest.sync.current_seq,
        timeout_seconds: 999,
      });
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('only_when_mentioned ignores chatter but returns it once mentioned', async () => {
      const { host, guest } = await roomWithTwo(s);
      let sync = (
        await s.messages.wait(alice, {
          room: 'REQ-1',
          participant_id: host.participant_id,
          after_seq: host.sync.current_seq,
        })
      ).sync;
      const waiting = s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        after_seq: guest.sync.current_seq,
        only_when_mentioned: true,
      });
      sync = (await post(s, alice, host, sync, 'thinking aloud')).sync;
      await new Promise((r) => setTimeout(r, 50));
      await post(s, alice, host, sync, '@frontend question', { mentions: [guest.participant_id] });
      const res = await waiting;
      expect(res.messages.map((m) => m.content)).toEqual(['thinking aloud', '@frontend question']);
    });

    it('aborting releases the waiter', async () => {
      const { guest } = await roomWithTwo(s);
      const ac = new AbortController();
      const waiting = s.messages.wait(
        bob,
        { room: 'REQ-1', participant_id: guest.participant_id, after_seq: guest.sync.current_seq },
        { signal: ac.signal },
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(s.waits.waiterCount()).toBe(1);
      ac.abort();
      await waiting;
      expect(s.waits.waiterCount()).toBe(0);
    });
  });

  describe('permissions and validation', () => {
    it('only the host may post decisions', async () => {
      const { guest } = await roomWithTwo(s);
      await expectAppError(
        post(s, bob, guest, guest.sync, 'we decide', { kind: 'decision' }),
        'FORBIDDEN',
      );
    });

    it("cannot act as someone else's participant", async () => {
      const { guest } = await roomWithTwo(s);
      await expectAppError(post(s, alice, guest, guest.sync, 'impostor'), 'FORBIDDEN');
    });

    it('left participants can no longer post', async () => {
      const { guest } = await roomWithTwo(s);
      await s.rooms.leave(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        summary: 'bye',
      });
      await expectAppError(post(s, bob, guest, guest.sync, 'ghost'), 'NOT_A_PARTICIPANT');
    });
  });

  describe('msg_list', () => {
    it('pages forward and backward', async () => {
      const { guest } = await roomWithTwo(s);
      let sync = guest.sync;
      for (let i = 0; i < 5; i++) sync = (await post(s, bob, guest, sync, `m${i}`)).sync;
      const total = sync.current_seq;

      const latest = await s.messages.list({ room: 'REQ-1', limit: 2 });
      expect(latest.messages.map((m) => m.content)).toEqual(['m3', 'm4']);
      expect(latest.has_more).toBe(true);

      const older = await s.messages.list({
        room: 'REQ-1',
        before_seq: latest.messages[0]!.seq,
        limit: 2,
      });
      expect(older.messages.map((m) => m.content)).toEqual(['m1', 'm2']);

      const forward = await s.messages.list({ room: 'REQ-1', after_seq: 0, limit: total });
      expect(forward.messages.map((m) => m.seq)).toEqual(
        Array.from({ length: total }, (_, i) => i + 1),
      );
      expect(forward.has_more).toBe(false);
    });
  });
});
