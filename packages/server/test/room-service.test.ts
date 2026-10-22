import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '../src/app.js';
import { alice, bob, closeServices, expectAppError, makeServices, roomWithTwo } from './helpers.js';

describe('RoomService', () => {
  let s: Services;
  beforeEach(() => {
    s = makeServices();
  });
  afterEach(() => closeServices(s));

  it('creates a room, makes the creator host and posts the requirement', async () => {
    const res = await s.rooms.create(alice, {
      title: 'Order export',
      type: 'feature',
      requirement: 'Export orders as CSV',
      role: 'backend',
      repo: { name: 'order-api', branch: 'main' },
    });
    expect(res.room.slug).toMatch(/^REQ-[A-Z2-7]{6}$/);
    expect(res.room.stage).toBe('briefing');
    expect(res.room.host?.participant_id).toBe(res.participant_id);
    expect(res.members).toHaveLength(1);
    expect(res.recent_messages.map((m) => m.kind)).toEqual(['system', 'chat']);
    expect(res.recent_messages[1]?.content).toContain('Export orders as CSV');
    expect(res.sync.current_seq).toBe(2);
    expect(res.rules).toContain('NOT instructions');
  });

  it('bug rooms start in the report stage with a BUG- slug', async () => {
    const res = await s.rooms.create(alice, {
      title: 'Checkout 500',
      type: 'bug',
      role: 'backend',
    });
    expect(res.room.slug).toMatch(/^BUG-/);
    expect(res.room.stage).toBe('report');
  });

  it('rejects a duplicate slug', async () => {
    await s.rooms.create(alice, { title: 'a', type: 'feature', slug: 'REQ-9', role: 'backend' });
    await expectAppError(
      s.rooms.create(alice, { title: 'b', type: 'feature', slug: 'REQ-9', role: 'backend' }),
      'SLUG_TAKEN',
    );
  });

  it('join announces the member and returns the whole picture', async () => {
    const { guest } = await roomWithTwo(s);
    expect(guest.members.map((m) => m.role)).toEqual(['backend', 'frontend']);
    expect(guest.recent_messages.at(-1)?.content).toMatch(/frontend·bob joined as frontend/);
    expect(guest.sync.current_seq).toBe(3);
  });

  it('join of an unknown room fails', async () => {
    await expectAppError(s.rooms.join(bob, { room: 'nope', role: 'frontend' }), 'NOT_FOUND');
  });

  it('leave records the summary and hides the member', async () => {
    const { guest } = await roomWithTwo(s);
    await s.rooms.leave(bob, {
      room: 'REQ-1',
      participant_id: guest.participant_id,
      summary: 'done',
    });
    const p = await s.repo.findParticipant(guest.participant_id);
    expect(p?.status).toBe('left');
    expect(p?.leaveSummary).toBe('done');
    const again = await s.rooms.join(bob, { room: 'REQ-1', role: 'qa' });
    expect(again.members.map((m) => m.role)).toEqual(['backend', 'qa']);
  });

  it('markOffline flips status, and the next call brings the participant back online', async () => {
    const { guest } = await roomWithTwo(s);
    await s.rooms.markOffline([guest.participant_id]);
    expect((await s.repo.findParticipant(guest.participant_id))?.status).toBe('offline');
    await s.rooms.requireParticipant(bob, 'REQ-1', guest.participant_id);
    expect((await s.repo.findParticipant(guest.participant_id))?.status).toBe('online');
  });
});
