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
