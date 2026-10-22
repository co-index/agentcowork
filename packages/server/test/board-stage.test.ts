import type { SyncContext } from '@agentcowork/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '../src/app.js';
import { STAGE_GUIDANCE } from '../src/services/rules.js';
import {
  alice,
  bob,
  closeServices,
  expectAppError,
  makeServices,
  post,
  roomWithTwo,
} from './helpers.js';

async function refresh(s: Services, who: typeof alice, participantId: string, afterSeq: number) {
  return s.messages.wait(who, {
    room: 'REQ-1',
    participant_id: participantId,
    after_seq: afterSeq,
    timeout_seconds: 1,
  });
}

describe('BoardService', () => {
  let s: Services;
  beforeEach(() => {
    s = makeServices();
  });
  afterEach(() => closeServices(s));

  it('room_create stores the requirement on the board and join summarises it', async () => {
    const { guest } = await roomWithTwo(s);
    expect(guest.board_summary.requirement).toEqual({
      version: 1,
      excerpt: 'Export orders as CSV',
    });
  });

  it('updates with optimistic locking and keeps history', async () => {
    const { host, guest } = await roomWithTwo(s);
    const v1 = await s.board.updateByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      key: 'contract',
      content: 'GET /orders/export',
      base_version: 0,
    });
    expect(v1.version).toBe(1);

    const err = await expectAppError(
      s.board.updateByAgent(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        key: 'contract',
        content: 'stale edit',
        base_version: 0,
      }),
      'VERSION_CONFLICT',
    );
    expect((err.data.current as { content: string }).content).toBe('GET /orders/export');

    await s.board.updateByAgent(bob, {
      room: 'REQ-1',
      participant_id: guest.participant_id,
      key: 'contract',
      content: 'GET /orders/export?format=csv',
      base_version: 1,
    });
    const { sections } = await s.board.get({ room: 'REQ-1', keys: ['contract'] });
    expect(sections.contract).toMatchObject({ version: 2, updated_by: 'frontend·bob' });

    const { versions } = await s.board.history('REQ-1', 'contract');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);

    const all = await s.messages.list({ room: 'REQ-1' });
    expect(all.messages.at(-1)?.content).toMatch(/updated board section "contract" \(v2\)/);
  });

  it('humans can edit the board', async () => {
    await roomWithTwo(s);
    const res = await s.board.updateByHuman(alice, 'REQ-1', 'Alice', {
      key: 'decisions',
      content: '- CSV only',
      base_version: 0,
    });
    expect(res.version).toBe(1);
    const { sections } = await s.board.get({ room: 'REQ-1' });
    expect(sections.decisions?.updated_by).toBe('Alice (human)');
  });

  it('redacts secrets written to the board', async () => {
    const { host } = await roomWithTwo(s);
    const res = await s.board.updateByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      key: 'context.backend',
      content: 'token glpat-abcdefghijklmnopqrstu',
      base_version: 0,
    });
    expect(res.redacted).toEqual(['gitlab_token']);
    const { sections } = await s.board.get({ room: 'REQ-1' });
    expect(sections['context.backend']?.content).toBe('token [REDACTED:gitlab_token]');
  });
});

describe('StageService', () => {
  let s: Services;
  beforeEach(() => {
    s = makeServices({ idlePauseMs: 50 });
  });
  afterEach(() => closeServices(s));

  it('only the host (or a human) changes the stage; guidance is broadcast', async () => {
    const { host, guest } = await roomWithTwo(s);
    await expectAppError(
      s.stages.setByAgent(bob, {
        room: 'REQ-1',
        participant_id: guest.participant_id,
        stage: 'research',
      }),
      'FORBIDDEN',
    );
    await expectAppError(
      s.stages.setByAgent(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        stage: 'locate',
      }),
      'INVALID_ARGUMENT',
    );

    const waiting = s.messages.wait(bob, {
      room: 'REQ-1',
      participant_id: guest.participant_id,
      after_seq: guest.sync.current_seq,
      only_when_mentioned: true,
    });
    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'research',
    });
    const res = await waiting;
    expect(res.stage).toBe('research');
    expect(res.messages.at(-1)?.content).toContain(STAGE_GUIDANCE.research);
    expect(res.hint).toContain('Research');

    await s.stages.setByHuman(bob, 'REQ-1', 'Bob', 'discuss');
    expect((await s.repo.findRoom('REQ-1'))?.stage).toBe('discuss');
  });

  it('enforces the per-stage speaking limit and resets it on stage change', async () => {
    const { host, guest } = await roomWithTwo(s);
    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'research',
    });
    let sync: SyncContext = (await refresh(s, bob, guest.participant_id, guest.sync.current_seq))
      .sync;
    for (let i = 0; i < 3; i++) sync = (await post(s, bob, guest, sync, `report ${i}`)).sync;
    const err = await expectAppError(post(s, bob, guest, sync, 'one too many'), 'LIMIT_REACHED');
    expect(err.data).toMatchObject({ limit: 3, used: 3 });

    // The refused post did not burn the token.
    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'discuss',
    });
    const fresh = await refresh(s, bob, guest.participant_id, sync.current_seq);
    await post(s, bob, guest, fresh.sync, 'new stage, new budget');
  });

  it('announces when every online participant is ready', async () => {
    const { host, guest } = await roomWithTwo(s);
    let hostSync = (await refresh(s, alice, host.participant_id, host.sync.current_seq)).sync;
    hostSync = (await post(s, alice, host, hostSync, 'backend done', { ready: true })).sync;

    let bobWait = await refresh(s, bob, guest.participant_id, guest.sync.current_seq);
    expect(bobWait.members_status.find((m) => m.role === 'backend')?.ready).toBe(true);
    await post(s, bob, guest, bobWait.sync, 'frontend done', { ready: true });

    const list = await s.messages.list({ room: 'REQ-1' });
    expect(list.messages.at(-1)?.content).toMatch(/All online participants are ready/);
    expect(list.messages.at(-1)?.content).toMatch(/"research"/);

    bobWait = await refresh(s, bob, guest.participant_id, bobWait.sync.current_seq);
    expect(bobWait.members_status.every((m) => m.ready)).toBe(true);
  });

  it('pauses after the message budget; agents get ROOM_PAUSED; a human resumes', async () => {
    const { guest } = await roomWithTwo(s);
    const room = (await s.repo.findRoom('REQ-1'))!;
    await s.repo.updateRoom(room.id, { settings: { messageBudget: 3 } });

    let sync = guest.sync;
    // roomWithTwo already has one agent message (the requirement).
    for (let i = 0; i < 2; i++) sync = (await post(s, bob, guest, sync, `m${i}`)).sync;
    expect((await s.repo.findRoom('REQ-1'))?.status).toBe('paused');

    const waited = await refresh(s, bob, guest.participant_id, sync.current_seq);
    expect(waited.room_status).toBe('paused');
    expect(waited.hint).toMatch(/paused/);
    await expectAppError(post(s, bob, guest, waited.sync, 'more'), 'ROOM_PAUSED');

    await s.messages.postAsHuman(alice, 'REQ-1', {
      name: 'Alice',
      content: 'carry on',
      kind: 'chat',
    });
    expect((await s.repo.findRoom('REQ-1'))?.status).toBe('open');
    const after = await refresh(s, bob, guest.participant_id, waited.sync.current_seq);
    expect(after.hint).toMatch(/human/);
    await post(s, bob, guest, after.sync, 'resumed');
  });

  it('pauses idle rooms and stage_set resumes them', async () => {
    const { host } = await roomWithTwo(s);
    await new Promise((r) => setTimeout(r, 80));
    const paused = await s.stages.pauseIdleRooms();
    expect(paused).toHaveLength(1);
    expect((await s.repo.findRoom('REQ-1'))?.status).toBe('paused');
    expect(await s.stages.pauseIdleRooms()).toEqual([]);

    await s.stages.setByAgent(alice, {
      room: 'REQ-1',
      participant_id: host.participant_id,
      stage: 'briefing',
    });
    expect((await s.repo.findRoom('REQ-1'))?.status).toBe('open');
  });

  it('human messages wake only_when_mentioned waiters and may be decisions', async () => {
    const { guest } = await roomWithTwo(s);
    const waiting = s.messages.wait(bob, {
      room: 'REQ-1',
      participant_id: guest.participant_id,
      after_seq: guest.sync.current_seq,
      only_when_mentioned: true,
    });
    await s.messages.postAsHuman(alice, 'REQ-1', {
      name: 'Alice',
      content: 'Use CSV',
      kind: 'decision',
    });
    const res = await waiting;
    expect(res.messages[0]).toMatchObject({
      sender: 'Alice',
      sender_type: 'human',
      kind: 'decision',
    });
  });

  it('room_list shows open and paused rooms', async () => {
    await roomWithTwo(s);
    await s.rooms.create(alice, { title: 'Other', type: 'bug', role: 'qa' });
    const { rooms } = await s.rooms.list();
    expect(rooms).toHaveLength(2);
    expect(rooms.find((r) => r.slug === 'REQ-1')).toMatchObject({
      member_count: 2,
      stage: 'briefing',
    });
  });
});
