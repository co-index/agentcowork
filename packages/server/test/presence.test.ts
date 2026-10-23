import type { SyncContext } from '@agentcowork/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices, type Services } from '../src/app.js';
import { alice, bob, closeServices, expectAppError, post } from './helpers.js';

const MIN = 60_000;
const STALE_MS = 8 * MIN;

describe('presence and reconnect', () => {
  let s: Services;
  let now: number;

  beforeEach(() => {
    now = Date.parse('2026-10-23T09:00:00Z');
    s = createServices(
      { dbPath: ':memory:', waitMaxSeconds: 2, heartbeatSeconds: 0 },
      { now: () => now },
    );
  });
  afterEach(() => closeServices(s));

  async function setup(frontendRepo = { name: 'admin-web', worktree: '/work/admin-web' }) {
    const host = await s.rooms.create(alice, {
      title: 'Order export',
      type: 'feature',
      slug: 'REQ-1',
      role: 'backend',
    });
    const guest = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend', repo: frontendRepo });
    const hostSync = (
      await s.messages.wait(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        after_seq: host.sync.current_seq,
        timeout_seconds: 1,
      })
    ).sync;
    return { host, guest, hostSync };
  }

  const status = async (id: string) => (await s.repo.findParticipant(id))?.status;

  describe('stale detection', () => {
    it('marks a silent participant offline after the stale period', async () => {
      const { guest } = await setup();
      now += 5 * MIN;
      expect(await s.access.markStale(STALE_MS, () => false)).toEqual([]);
      now += 4 * MIN;
      // The host was silent just as long, so both go offline.
      expect(await s.access.markStale(STALE_MS, () => false)).toContain(guest.participant_id);
      expect(await status(guest.participant_id)).toBe('offline');
    });

    it('never marks a participant that is currently waiting', async () => {
      const { guest } = await setup();
      const ac = new AbortController();
      const waiting = s.messages.wait(
        bob,
        { room: 'REQ-1', participant_id: guest.participant_id, after_seq: guest.sync.current_seq },
        { signal: ac.signal },
      );
      await new Promise((r) => setTimeout(r, 20));
      now += 30 * MIN;
      const marked = await s.access.markStale(STALE_MS, (id) => s.messages.isWaiting(id));
      expect(marked).not.toContain(guest.participant_id);
      ac.abort();
      await waiting;
    });

    it('a wait ending on its own does not count as the client being seen', async () => {
      const { guest } = await setup();
      const before = (await s.repo.findParticipant(guest.participant_id))!.lastSeenAt;
      const waiting = s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        after_seq: guest.sync.current_seq,
        timeout_seconds: 1,
      });
      // The wait started at `before`; time passes while it is suspended, then it times out.
      await new Promise((r) => setTimeout(r, 20));
      now += 3 * MIN;
      await waiting;
      expect((await s.repo.findParticipant(guest.participant_id))!.lastSeenAt).toBe(before);
    });
  });

  describe('resume on join', () => {
    it('resumes the offline participant with the same role and worktree and reports what it missed', async () => {
      const { host, guest, hostSync } = await setup();
      await s.access.markOffline([guest.participant_id]);

      let sync: SyncContext = hostSync;
      sync = (await post(s, alice, host, sync, 'general update')).sync;
      const asked = await post(s, alice, host, sync, 'can the filters pass through?', {
        mentions: ['frontend'],
      });

      const again = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        repo: { name: 'admin-web', worktree: '/work/admin-web' },
      });
      expect(again.participant_id).toBe(guest.participant_id);
      expect(again.members.filter((m) => m.role === 'frontend')).toHaveLength(1);
      expect(again.resumed).toMatchObject({
        missed_count: 2,
        mentioned_seqs: [asked.seq],
        since_seq: guest.sync.current_seq,
      });
      expect(again.resumed?.hint).toMatch(new RegExp(`mentioned in seq ${asked.seq}`));
      expect(again.recent_messages.at(-1)?.content).toMatch(/frontend·bob reconnected/);
      expect(await status(guest.participant_id)).toBe('online');

      // The resumed participant posts normally with the new sync.
      await post(s, bob, again, again.sync, 'yes, they can');
    });

    it('does not take over an online participant implicitly', async () => {
      const { guest } = await setup();
      const second = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        repo: { name: 'admin-web', worktree: '/work/admin-web' },
      });
      expect(second.participant_id).not.toBe(guest.participant_id);
      expect(second.resumed).toBeUndefined();
    });

    it('does not resume across different worktrees', async () => {
      const { guest } = await setup();
      await s.access.markOffline([guest.participant_id]);
      const other = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        repo: { name: 'admin-web', worktree: '/work/admin-web-2' },
      });
      expect(other.participant_id).not.toBe(guest.participant_id);
    });

    it('resumes by explicit participant_id, but only your own and not after leaving', async () => {
      const { guest } = await setup();
      const resumed = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        participant_id: guest.participant_id,
      });
      expect(resumed.participant_id).toBe(guest.participant_id);

      await expectAppError(
        s.rooms.join(alice, {
          room: 'REQ-1',
          role: 'frontend',
          participant_id: guest.participant_id,
        }),
        'FORBIDDEN',
      );
      await s.rooms.leave(bob, { room: 'REQ-1', participant_id: guest.participant_id });
      await expectAppError(
        s.rooms.join(bob, {
          room: 'REQ-1',
          role: 'frontend',
          participant_id: guest.participant_id,
        }),
        'NOT_A_PARTICIPANT',
      );
    });

    it('points to msg_list when more was missed than recent_messages holds', async () => {
      const { host, guest, hostSync } = await setup();
      await s.access.markOffline([guest.participant_id]);
      let sync = hostSync;
      for (let i = 0; i < 35; i++) sync = (await post(s, alice, host, sync, `m${i}`)).sync;
      const again = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        repo: { name: 'admin-web', worktree: '/work/admin-web' },
      });
      expect(again.resumed?.missed_count).toBe(35);
      expect(again.resumed?.hint).toMatch(
        new RegExp(`msg_list\\(after_seq=${guest.sync.current_seq}\\)`),
      );
    });
  });

  describe('offline mention notice', () => {
    it('warns when mentioning an offline or absent member, not an online one', async () => {
      const { host, guest, hostSync } = await setup();
      let res = await post(s, alice, host, hostSync, 'ping', { mentions: ['frontend'] });
      expect(res.notice).toBeUndefined();

      await s.access.markOffline([guest.participant_id]);
      now += 12 * MIN;
      // Reply tokens live 10 minutes, so re-sync after the clock jump.
      const fresh = await s.messages.wait(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        after_seq: res.sync.current_seq,
        timeout_seconds: 1,
      });
      res = await post(s, alice, host, fresh.sync, 'still there?', { mentions: ['frontend'] });
      expect(res.notice).toMatch(/frontend·bob is offline \(last seen 12 min ago\)/);

      res = await post(s, alice, host, res.sync, 'design?', { mentions: ['ui'] });
      expect(res.notice).toMatch(/nobody with role or id "ui"/);

      res = await post(s, alice, host, res.sync, 'all', { mentions: ['@all'] });
      expect(res.notice).toBeUndefined();
    });
  });
});
