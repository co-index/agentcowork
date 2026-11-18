import type { JoinResult, SyncContext } from '@agentcowork/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServices, type Services } from '../src/app.js';
import type { Principal } from '../src/domain/models.js';
import { alice, bob, carol, closeServices, expectAppError } from './helpers.js';

const MIN = 60_000;
const OFFLINE_MS = 10 * MIN;

/** Regressions for the 2026-11 design review: agents that pause, restart, go quiet or stall. */
describe('review regressions', () => {
  let s: Services;
  let now: number;

  beforeEach(() => {
    now = Date.parse('2026-11-17T09:00:00Z');
    s = createServices(
      { dbPath: ':memory:', waitMaxSeconds: 240, heartbeatSeconds: 0 },
      { now: () => now },
    );
  });
  afterEach(() => closeServices(s));

  const FE_REPO = { name: 'admin-web', worktree: '/w/admin-web' };

  async function room() {
    const host = await s.rooms.create(alice, {
      title: 'Order export',
      type: 'feature',
      slug: 'REQ-1',
      role: 'backend',
      repo: { name: 'order-api', worktree: '/w/order-api' },
    });
    const fe = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend', repo: FE_REPO });
    return { host, fe };
  }

  const syncOf = async (who: Principal, member: Pick<JoinResult, 'participant_id'>) =>
    (
      await s.messages.wait(who, {
        room: 'REQ-1',
        participant_id: member.participant_id,
        after_seq: 0,
        timeout_seconds: 1,
      })
    ).sync;

  const post = (
    who: Principal,
    member: Pick<JoinResult, 'participant_id'>,
    sync: SyncContext,
    content: string,
    extra: Record<string, unknown> = {},
  ) =>
    s.messages.post(who, {
      room: 'REQ-1',
      participant_id: member.participant_id,
      content,
      kind: 'chat',
      expected_last_seq: sync.current_seq,
      reply_token: sync.reply_token,
      ...extra,
    });

  const contents = async () =>
    (await s.messages.list({ room: 'REQ-1', limit: 200 })).messages.map((m) => m.content);

  it('a host that left during a pause rejoins with its identity and host role', async () => {
    const { host } = await room();
    await s.stages.pauseByHuman(alice, 'REQ-1', 'pm');
    const paused = (await contents()).at(-1)!;
    expect(paused).toMatch(/do not call room_leave/);
    // Older agents may still leave; that must not cost the room its host.
    await s.rooms.leave(alice, { room: 'REQ-1', participant_id: host.participant_id });
    await s.stages.resumeByHuman(alice, 'REQ-1', 'pm');
    const back = await s.rooms.join(alice, {
      room: 'REQ-1',
      role: 'backend',
      participant_id: host.participant_id,
    });
    expect(back.participant_id).toBe(host.participant_id);
    expect(back.room.host?.participant_id).toBe(host.participant_id);
    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'research',
    });
    // Even without the id, the same role and worktree finds the left participant.
    await s.rooms.leave(alice, { room: 'REQ-1', participant_id: host.participant_id });
    const implicit = await s.rooms.join(alice, {
      room: 'REQ-1',
      role: 'backend',
      repo: { name: 'order-api', worktree: '/w/order-api' },
    });
    expect(implicit.participant_id).toBe(host.participant_id);
  });

  it('an agent working locally for minutes after a long wait is not marked offline', async () => {
    const { host, fe } = await room();
    const start = now;
    const pending = s.messages.wait(bob, {
      room: 'REQ-1',
      participant_id: fe.participant_id,
      after_seq: fe.sync.current_seq,
      timeout_seconds: 2,
    });
    await new Promise((r) => setTimeout(r, 30));
    now = start + 239_000;
    await post(alice, host, await syncOf(alice, host), 'please look at X');
    expect((await pending).messages.length).toBeGreaterThan(0);
    now += 6 * MIN; // reading code
    expect(await s.access.markStale(OFFLINE_MS, () => false)).not.toContain(fe.participant_id);
  });

  it('a restarted agent that forgot its id takes over its old seat instead of a ghost', async () => {
    const { host, fe } = await room();
    now += 2 * MIN;
    const again = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend', repo: FE_REPO });
    expect(again.participant_id).toBe(fe.participant_id);
    expect(
      (await s.repo.listParticipants(host.room.id)).filter((m) => m.role === 'frontend'),
    ).toHaveLength(1);
  });

  it('an offline ghost replaced by a present member of the same checkout does not block', async () => {
    const { host, fe } = await room();
    // The old seat is waiting (cannot be taken over), so the restart creates a second member.
    const ac = new AbortController();
    const listening = s.messages.wait(
      bob,
      { room: 'REQ-1', participant_id: fe.participant_id, after_seq: fe.sync.current_seq },
      { signal: ac.signal },
    );
    await new Promise((r) => setTimeout(r, 20));
    const second = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend', repo: FE_REPO });
    expect(second.participant_id).not.toBe(fe.participant_id);
    ac.abort();
    await listening;
    await s.access.markOffline([fe.participant_id]);
    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'research',
    });
    // A human can also clean it up.
    await s.rooms.removeByHuman(alice, 'REQ-1', fe.participant_id, 'PM');
    expect((await s.repo.findParticipant(fe.participant_id))?.status).toBe('left');
    expect((await contents()).at(-1)).toMatch(/was removed by PM \(human\)/);
  });

  describe('readiness', () => {
    async function inResearch() {
      const r = await room();
      await s.stages.setByAgent(alice, {
        room: 'REQ-1',
        participant_id: r.host.participant_id,
        stage: 'research',
      });
      return r;
    }

    it('a member who used its quota can still post ready once, and is counted ready', async () => {
      const { fe } = await inResearch();
      let sync = await syncOf(bob, fe);
      for (let i = 0; i < 3; i++) sync = (await post(bob, fe, sync, `finding ${i}`)).sync;
      // Quota used up: the member already counts as ready, without the host having to be.
      expect((await contents()).at(-1)).toMatch(/All online participants are ready/);
      // The announcement is new context, so read it first.
      sync = await syncOf(bob, fe);
      sync = (await post(bob, fe, sync, 'Nothing to add; ready.', { ready: true })).sync;
      await expectAppError(post(bob, fe, sync, 'one more', { ready: true }), 'LIMIT_REACHED');
    });

    it('the host is not waited for; a member dropping out completes "all ready"', async () => {
      const { fe } = await inResearch();
      const app = await s.rooms.join(carol, { room: 'REQ-1', role: 'app' });
      await post(bob, fe, await syncOf(bob, fe), 'Nothing to add; ready.', { ready: true });
      expect((await contents()).some((c) => c.includes('are ready'))).toBe(false);
      await s.access.markOffline([app.participant_id]);
      // The recount runs off the presence event.
      await new Promise((r) => setTimeout(r, 30));
      expect((await contents()).at(-1)).toMatch(/All online participants are ready/);
    });
  });

  describe('Web seat', () => {
    async function webRoom() {
      const created = await s.rooms.create(alice, {
        title: 'Web room',
        type: 'feature',
        slug: 'REQ-1',
        role: 'product',
        client: { name: 'web' },
      });
      const fe = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend' });
      const be = await s.rooms.join(carol, { room: 'REQ-1', role: 'backend' });
      return { created, fe, be };
    }

    it('is not waited for, never goes offline, and is not reported as offline', async () => {
      const { created, fe, be } = await webRoom();
      await s.stages.setByHuman(alice, 'REQ-1', 'pm', 'research');
      await post(bob, fe, await syncOf(bob, fe), 'report', { ready: true });
      await post(carol, be, await syncOf(carol, be), 'report', { ready: true });
      expect((await contents()).at(-1)).toMatch(/A human can advance the stage in the Web UI/);

      now += 30 * MIN;
      const marked = await s.access.markStale(OFFLINE_MS, () => false);
      expect(marked).not.toContain(created.participant_id);
      const r = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        participant_id: fe.participant_id,
      });
      const res = await post(bob, fe, r.sync, 'which statuses?', {
        kind: 'question',
        mentions: ['product'],
      });
      expect(res.notice).toBeUndefined();
    });

    it('is never taken over implicitly by a product agent', async () => {
      const { created } = await webRoom();
      const agent = await s.rooms.join(alice, {
        room: 'REQ-1',
        role: 'product',
        client: { name: 'claude-code' },
      });
      expect(agent.participant_id).not.toBe(created.participant_id);
      expect(agent.room.host?.participant_id).toBe(created.participant_id);
    });
  });

  describe('notices (joins, board updates)', () => {
    it('do not make a post stale, not even your own board update', async () => {
      const { fe } = await room();
      const sync = await syncOf(bob, fe);
      await s.board.updateByAgent(bob, {
        room: 'REQ-1',
        participant_id: fe.participant_id,
        key: 'context.frontend',
        content: 'list page in src/orders',
        base_version: 0,
      });
      await s.rooms.join(carol, { room: 'REQ-1', role: 'app' });
      await post(bob, fe, sync, 'report', { kind: 'report' });
    });

    it('do not wake waiting members, but wake the host', async () => {
      const { host, fe } = await room();
      const feWait = s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: fe.participant_id,
        after_seq: (await syncOf(bob, fe)).current_seq,
        timeout_seconds: 1,
      });
      const hostWait = s.messages.wait(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        after_seq: (await syncOf(alice, host)).current_seq,
        timeout_seconds: 1,
      });
      await new Promise((r) => setTimeout(r, 30));
      await s.rooms.join(carol, { room: 'REQ-1', role: 'app' });
      const [fr, hr] = await Promise.all([feWait, hostWait]);
      expect(hr.timed_out).toBe(false);
      expect(hr.messages.at(-1)?.content).toMatch(/joined as app/);
      // The member sleeps on; the notice is handed over with the batch anyway.
      expect(fr.timed_out).toBe(true);
      expect(fr.messages.at(-1)?.content).toMatch(/joined as app/);
    });
  });

  describe('sync and cursors', () => {
    it('an inflated expected_last_seq hands back the messages the caller missed', async () => {
      const { host, fe } = await room();
      const fs = await syncOf(bob, fe);
      const important = await post(alice, host, await syncOf(alice, host), 'contract changed');
      const err = await expectAppError(
        s.messages.post(bob, {
          room: 'REQ-1',
          participant_id: fe.participant_id,
          content: 'my proposal',
          kind: 'proposal',
          expected_last_seq: fs.current_seq + 50,
          reply_token: fs.reply_token,
        }),
        'INVALID_ARGUMENT',
      );
      const missed = err.data.missed_messages as { seq: number }[];
      expect(missed.map((m) => m.seq)).toContain(important.seq);
    });

    it('an after_seq ahead of the room does not skip the next message', async () => {
      const { host, fe } = await room();
      const waiting = s.messages.wait(bob, {
        room: 'REQ-1',
        participant_id: fe.participant_id,
        after_seq: fe.sync.current_seq + 3,
        timeout_seconds: 2,
      });
      await new Promise((r) => setTimeout(r, 30));
      const q = await post(alice, host, await syncOf(alice, host), 'Q for frontend', {
        kind: 'question',
        mentions: ['frontend'],
      });
      const res = await waiting;
      expect(res.messages.map((m) => m.seq)).toContain(q.seq);
    });
  });

  it('strips credentials from repo.remote_url before anyone sees it', async () => {
    await room();
    const token = 'glpat-' + 'a1B2c3D4e5F6g7H8i9J0';
    await s.rooms.join(carol, {
      room: 'REQ-1',
      role: 'app',
      repo: { name: 'app', remote_url: `https://oauth2:${token}@gitlab.corp/app.git` },
    });
    const view = await s.rooms.join(alice, { room: 'REQ-1', role: 'qa' });
    expect(JSON.stringify(view.members)).not.toContain(token);
    expect(view.members.find((m) => m.role === 'app')?.repo?.remote_url).toBe(
      'https://gitlab.corp/app.git',
    );
  });
});
