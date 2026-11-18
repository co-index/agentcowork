import type { JoinResult, SyncContext } from '@agentcowork/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Services } from '../src/app.js';
import type { Principal } from '../src/domain/models.js';
import {
  alice,
  bob,
  carol,
  closeServices,
  expectAppError,
  makeServices,
  post,
  roomWithTwo,
} from './helpers.js';

describe('pending questions and absent members (design 9.2)', () => {
  let s: Services;
  let host: JoinResult;
  let guest: JoinResult;

  beforeEach(async () => {
    s = makeServices();
    ({ host, guest } = await roomWithTwo(s));
  });
  afterEach(() => closeServices(s));

  /** Fresh sync for a member: reads its backlog without waiting. */
  async function syncOf(who: Principal, member: JoinResult): Promise<SyncContext> {
    const res = await s.messages.wait(who, {
      room: 'REQ-1',
      participant_id: member.participant_id,
      after_seq: 0,
      timeout_seconds: 1,
    });
    return res.sync;
  }

  async function ask(who: Principal, member: JoinResult, mentions: string[], content = 'Q?') {
    return post(s, who, member, await syncOf(who, member), content, { kind: 'question', mentions });
  }

  async function reply(who: Principal, member: JoinResult, toSeq: number, kind = 'answer') {
    return post(s, who, member, await syncOf(who, member), 'A.', { kind, reply_to_seq: toSeq });
  }

  const pending = async () =>
    (await s.questions.pending(host.room.id)).map((q) => ({
      seq: q.message.seq,
      waitingOn: q.waitingOn,
    }));

  describe('tracking', () => {
    it('keeps a question pending until the target replies with reply_to_seq', async () => {
      const q = await ask(alice, host, ['frontend']);
      expect(await pending()).toEqual([{ seq: q.seq, waitingOn: ['frontend'] }]);

      // Talking without reply_to_seq does not count as an answer.
      await post(s, bob, guest, await syncOf(bob, guest), 'Looking into it', { kind: 'chat' });
      expect(await pending()).toHaveLength(1);

      await reply(bob, guest, q.seq);
      expect(await pending()).toEqual([]);
    });

    it('tracks every target separately and ignores @all and the asker', async () => {
      const third = await s.rooms.join(carol, { room: 'REQ-1', role: 'app' });
      const q = await ask(alice, host, ['frontend', third.participant_id, '@all', 'backend']);
      expect(await pending()).toEqual([
        { seq: q.seq, waitingOn: ['frontend', third.participant_id] },
      ]);
      await reply(carol, third, q.seq, 'chat');
      expect(await pending()).toEqual([{ seq: q.seq, waitingOn: ['frontend'] }]);
    });

    it('counts questions from humans and ignores other kinds', async () => {
      await post(s, alice, host, await syncOf(alice, host), 'FYI', {
        kind: 'proposal',
        mentions: ['frontend'],
      });
      const human = await s.messages.postAsHuman(alice, 'REQ-1', {
        name: 'PM',
        content: 'Can the list be sorted?',
        kind: 'question',
        mentions: ['frontend'],
      });
      expect(await pending()).toEqual([{ seq: human.seq, waitingOn: ['frontend'] }]);
    });

    it('keeps a question to a member who left, and hands it over when it rejoins', async () => {
      const q = await ask(alice, host, [guest.participant_id]);
      await s.rooms.leave(bob, { room: 'REQ-1', participant_id: guest.participant_id });
      expect(await pending()).toEqual([{ seq: q.seq, waitingOn: [guest.participant_id] }]);
      const back = await s.rooms.join(bob, {
        room: 'REQ-1',
        role: 'frontend',
        participant_id: guest.participant_id,
      });
      expect(back.pending_questions?.map((m) => m.seq)).toEqual([q.seq]);
    });

    it('a human reply resolves the whole question; mentions are normalized', async () => {
      const q = await ask(alice, host, ['@frontend', 'app', 'all']);
      const stored = (await s.messages.list({ room: 'REQ-1', after_seq: q.seq - 1, limit: 1 }))
        .messages[0];
      expect(stored?.mentions).toEqual(['frontend', 'app', '@all']);
      await s.messages.postAsHuman(alice, 'REQ-1', {
        name: 'PM',
        content: 'Frontend shows 20 per page.',
        kind: 'answer',
        reply_to_seq: q.seq,
      });
      expect(await pending()).toEqual([]);
    });
  });

  describe('answers cited in the text', () => {
    it('counts "seq N" in an answer, but not "#N" list markers', async () => {
      const q1 = await ask(alice, host, ['frontend'], 'Paging?');
      const q2 = await ask(alice, host, ['frontend'], 'Sorting?');
      await post(s, bob, guest, await syncOf(bob, guest), `Decisions #${q2.seq} look fine.`);
      expect((await pending()).map((p) => p.seq)).toEqual([q1.seq, q2.seq]);
      await post(s, bob, guest, await syncOf(bob, guest), `On seq ${q1.seq} and seq ${q2.seq}: …`, {
        kind: 'answer',
      });
      expect(await pending()).toEqual([]);
    });

    it('reminds an agent that posts while it still owes answers', async () => {
      const q = await ask(alice, host, ['frontend'], 'Paging?');
      const res = await post(s, bob, guest, await syncOf(bob, guest), 'Something else');
      expect(res.notice).toMatch(
        new RegExp(`still owe answers to question seq ${q.seq} \\(from backend·alice\\)`),
      );
      const answered = await post(s, bob, guest, await syncOf(bob, guest), '20 per page', {
        kind: 'answer',
        reply_to_seq: q.seq,
      });
      expect(answered.notice).toBeUndefined();
    });
  });

  describe('handing questions over on room_join', () => {
    it('gives a role that joins later the questions asked before it arrived', async () => {
      const q = await ask(alice, host, ['app'], 'Does the app list orders?');
      const app = await s.rooms.join(carol, { room: 'REQ-1', role: 'app' });
      expect(app.pending_questions?.map((m) => m.seq)).toEqual([q.seq]);
      expect(app.pending_questions?.[0]?.content).toBe('Does the app list orders?');
      // Others do not get it.
      const again = await s.rooms.join(alice, { room: 'REQ-1', role: 'qa' });
      expect(again.pending_questions).toBeUndefined();
    });

    it('hands owed questions to a resumed participant and asks to answer them first', async () => {
      await s.access.markOffline([guest.participant_id]);
      const q = await ask(alice, host, ['frontend']);
      const back = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend' });
      expect(back.participant_id).toBe(guest.participant_id);
      expect(back.pending_questions?.map((m) => m.seq)).toEqual([q.seq]);
      expect(back.resumed?.hint).toMatch(new RegExp(`owe answers.*seq ${q.seq}.*reply_to_seq`));
    });
  });

  describe('stage changes while members are offline', () => {
    it('refuses to move forward without allow_absent and lists who is missing', async () => {
      const q = await ask(alice, host, ['frontend']);
      await s.access.markOffline([guest.participant_id]);
      const err = await expectAppError(
        s.stages.setByAgent(alice, {
          room: 'REQ-1',
          participant_id: host.participant_id,
          stage: 'research',
        }),
        'MEMBERS_OFFLINE',
      );
      expect(err.message).toMatch(/frontend·bob.*seq/);
      expect(err.data.offline).toEqual([
        expect.objectContaining({
          participant_id: guest.participant_id,
          role: 'frontend',
          pending_question_seqs: [q.seq],
        }),
      ]);
      expect((await s.repo.findRoom('REQ-1'))?.stage).toBe('briefing');

      const ok = await s.stages.setByAgent(alice, {
        room: 'REQ-1',
        participant_id: host.participant_id,
        stage: 'research',
        allow_absent: true,
      });
      expect(ok).toEqual({ stage: 'research', previous: 'briefing' });
      const last = (await s.messages.list({ room: 'REQ-1', before_seq: 1e9, limit: 1 }))
        .messages[0];
      expect(last?.content).toMatch(/Moved on while offline: frontend·bob/);
    });

    it('does not check when moving back, staying, or when everyone is online', async () => {
      await s.stages.setByHuman(alice, 'REQ-1', 'PM', 'discuss');
      await s.access.markOffline([guest.participant_id]);
      await s.stages.setByHuman(alice, 'REQ-1', 'PM', 'discuss');
      await s.stages.setByHuman(alice, 'REQ-1', 'PM', 'research');
      await expectAppError(s.stages.setByHuman(alice, 'REQ-1', 'PM', 'done'), 'MEMBERS_OFFLINE');
      await s.stages.setByHuman(alice, 'REQ-1', 'PM', 'done', { allowAbsent: true });
      expect((await s.repo.findRoom('REQ-1'))?.stage).toBe('done');
    });
  });
});
