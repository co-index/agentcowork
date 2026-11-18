import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';
import { alice } from './helpers.js';

let hub: Hub;
let base: string;
const auth = new HostTokenAuth();
const headers = { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' };

beforeAll(async () => {
  const webRoot = mkdtempSync(join(tmpdir(), 'acw-web-'));
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>AgentCowork</title>');
  hub = createHub(
    loadConfig('host', {
      port: 0,
      bind: '127.0.0.1',
      dbPath: ':memory:',
      waitMaxSeconds: 2,
      heartbeatSeconds: 0,
      webRoot,
    }),
    auth,
  );
  base = `http://127.0.0.1:${await hub.listen()}`;
  await hub.services.rooms.create(alice, {
    title: 'Order export',
    type: 'feature',
    slug: 'REQ-7',
    requirement: 'Export orders as CSV',
    role: 'backend',
  });
});

afterAll(() => hub.close());

// Response bodies are asserted field by field below.
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

/** Reads SSE events from a fetch response until `count` events matched `want`. */
async function collectEvents(res: Response, count: number) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: { event: string; data: string }[] = [];
  let buffer = '';
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i: number;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data });
    }
  }
  await reader.cancel();
  return events;
}

describe('REST API', () => {
  it('requires a token', async () => {
    expect((await fetch(`${base}/api/rooms`)).status).toBe(401);
    // Tokens in URLs leak into logs; only the Authorization header is accepted.
    expect((await fetch(`${base}/api/rooms?token=${auth.token}`)).status).toBe(401);
  });

  it('lists rooms and returns room detail with board and stages', async () => {
    const list = await json(fetch(`${base}/api/rooms`, { headers }));
    expect(list.rooms.map((r: { slug: string }) => r.slug)).toContain('REQ-7');

    const detail = await json(fetch(`${base}/api/rooms/REQ-7`, { headers }));
    expect(detail.room).toMatchObject({ slug: 'REQ-7', stage: 'briefing', member_count: 1 });
    expect(detail.stages[0]).toBe('briefing');
    expect(detail.board.requirement.content).toBe('Export orders as CSV');
    expect(detail.members[0]).toMatchObject({ role: 'backend', ready: false });
  });

  it('returns raw (unfenced) message content to browsers', async () => {
    const res = await json(fetch(`${base}/api/rooms/REQ-7/messages?limit=10`, { headers }));
    expect(res.messages.at(-1).content).toContain('Export orders as CSV');
    expect(res.messages.at(-1).content).not.toContain('room-content');
  });

  it('lets a human answer a question and remove a stale member', async () => {
    const created = await json(
      fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Answers', type: 'feature', role: 'product' }),
      }),
    );
    const slug = created.room.slug as string;
    const fe = await hub.services.rooms.join(alice, { room: slug, role: 'frontend' });
    const send = (body: object) =>
      fetch(`${base}/api/rooms/${slug}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'PM', ...body }),
      });
    const asked = await json(
      send({ kind: 'question', content: 'Paging?', mentions: ['@frontend', '@all'] }),
    );
    expect(
      (await json(fetch(`${base}/api/rooms/${slug}`, { headers }))).pending_questions,
    ).toHaveLength(1);
    expect((await send({ kind: 'answer', content: 'x', reply_to_seq: 9999 })).status).toBe(400);
    expect(
      (await send({ kind: 'answer', content: '20 per page', reply_to_seq: asked.seq })).status,
    ).toBe(201);
    const detail = await json(fetch(`${base}/api/rooms/${slug}`, { headers }));
    expect(detail.pending_questions).toEqual([]);

    const removed = await fetch(`${base}/api/rooms/${slug}/members/${fe.participant_id}/remove`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'PM' }),
    });
    expect(removed.status).toBe(200);
    const after = await json(fetch(`${base}/api/rooms/${slug}`, { headers }));
    expect(after.members.map((m: { role: string }) => m.role)).toEqual(['product']);
    const missing = await fetch(`${base}/api/rooms/${slug}/members/p_nope/remove`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(missing.status).toBe(404);
  });

  it('shows pending questions and asks before advancing past offline members', async () => {
    const created = await json(
      fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Absent', type: 'feature', role: 'product' }),
      }),
    );
    const slug = created.room.slug as string;
    const frontend = await hub.services.rooms.join(alice, { room: slug, role: 'frontend' });
    const asked = await json(
      fetch(`${base}/api/rooms/${slug}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'PM',
          kind: 'question',
          content: 'Is pagination done?',
          mentions: ['frontend'],
        }),
      }),
    );
    // Both go offline; only the agent seat counts as absent, not the creator's Web seat.
    await hub.services.access.markOffline([created.participant_id, frontend.participant_id]);

    const detail = await json(fetch(`${base}/api/rooms/${slug}`, { headers }));
    expect(detail.pending_questions).toEqual([
      expect.objectContaining({ seq: asked.seq, sender: 'PM', waiting_on: ['frontend'] }),
    ]);
    expect(typeof detail.members[0].last_seen_at).toBe('string');

    const stage = (body: object) =>
      fetch(`${base}/api/rooms/${slug}/stage`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'PM', stage: 'research', ...body }),
      });
    const blocked = await stage({});
    expect(blocked.status).toBe(409);
    const err = await json(blocked);
    expect(err.error).toBe('MEMBERS_OFFLINE');
    expect(err.offline).toEqual([
      expect.objectContaining({
        participant_id: frontend.participant_id,
        pending_question_seqs: [asked.seq],
      }),
    ]);
    const ok = await stage({ allow_absent: true });
    expect(ok.status).toBe(200);
  });

  it('lets a human create, advance, edit and close a room', async () => {
    const created = await json(
      fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: 'Human controls',
          type: 'feature',
          requirement: 'Coordinate from the Web UI',
          role: 'product',
        }),
      }),
    );
    expect(created.room.stage).toBe('briefing');
    const slug = created.room.slug as string;

    const stage = await fetch(`${base}/api/rooms/${slug}/stage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', stage: 'research' }),
    });
    expect(stage.status).toBe(200);
    expect(await json(stage)).toMatchObject({ stage: 'research', previous: 'briefing' });

    const board = await fetch(`${base}/api/rooms/${slug}/board/contract`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: 'GET /orders', base_version: 0 }),
    });
    expect(board.status).toBe(200);
    expect(await json(board)).toMatchObject({ key: 'contract', version: 1 });

    const paused = await fetch(`${base}/api/rooms/${slug}/pause`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(paused.status).toBe(200);
    expect((await json(paused)).status).toBe('paused');

    const resumed = await fetch(`${base}/api/rooms/${slug}/resume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(resumed.status).toBe(200);
    expect((await json(resumed)).status).toBe('open');

    const closed = await fetch(`${base}/api/rooms/${slug}/close`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    });
    expect(closed.status).toBe(200);
    expect(await json(closed)).toEqual({ ok: true });
    expect((await json(fetch(`${base}/api/rooms/${slug}`, { headers }))).room.status).toBe(
      'closed',
    );

    const invalidBoard = await fetch(`${base}/api/rooms/REQ-7/board/invalid%20key`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: 'x', base_version: -1 }),
    });
    expect(invalidBoard.status).toBe(400);
    expect((await json(invalidBoard)).error).toBe('INVALID_ARGUMENT');
  });

  it('maps errors to HTTP status codes', async () => {
    const missing = await fetch(`${base}/api/rooms/NOPE`, { headers });
    expect(missing.status).toBe(404);
    expect((await json(missing)).error).toBe('NOT_FOUND');

    const bad = await fetch(`${base}/api/rooms/REQ-7/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '', content: '' }),
    });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe('INVALID_ARGUMENT');
  });

  it('streams new messages over SSE, including human posts', async () => {
    const stream = await fetch(`${base}/api/rooms/REQ-7/events`, { headers });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const eventsPromise = collectEvents(stream, 2);

    await new Promise((r) => setTimeout(r, 50));
    const posted = await fetch(`${base}/api/rooms/REQ-7/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', content: 'Please keep it CSV', kind: 'decision' }),
    });
    expect(posted.status).toBe(201);

    const events = await eventsPromise;
    expect(events[0]!.event).toBe('ready');
    const message = JSON.parse(events[1]!.data);
    expect(message).toMatchObject({
      sender: 'Alice',
      sender_type: 'human',
      kind: 'decision',
      content: 'Please keep it CSV',
    });
  });

  it('serves the web UI with SPA fallback but keeps unknown API paths as 404', async () => {
    const index = await fetch(`${base}/`);
    expect(await index.text()).toContain('AgentCowork');
    const deep = await fetch(`${base}/some/route`);
    expect(await deep.text()).toContain('AgentCowork');
    expect((await fetch(`${base}/api/nope`, { headers })).status).toBe(404);
  });
});
