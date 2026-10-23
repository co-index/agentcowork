import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../src/app.js';
import { DEFAULT_LIMITS, loadConfig } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';
import { alice } from './helpers.js';

const auth = new HostTokenAuth();
let hub: Hub;
let base: string;

beforeAll(async () => {
  hub = createHub(
    loadConfig('host', {
      port: 0,
      bind: '127.0.0.1',
      dbPath: ':memory:',
      waitMaxSeconds: 3,
      heartbeatSeconds: 0,
      webRoot: undefined,
      limits: { ...DEFAULT_LIMITS, maxSessions: 2, maxEventStreams: 1 },
    }),
    auth,
  );
  base = `http://127.0.0.1:${await hub.listen()}`;
  await hub.services.rooms.create(alice, {
    title: 't',
    type: 'feature',
    slug: 'REQ-L',
    role: 'qa',
  });
});

afterAll(() => hub.close());

async function connect() {
  const client = new Client({ name: 'limits', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${auth.token}` } },
    }),
  );
  return client;
}

describe('session cap', () => {
  it('evicts the longest-idle session, and refuses when every session is busy', async () => {
    const first = await connect();
    const second = await connect();
    // Full: the idle `first` session is evicted to admit `third`.
    const third = await connect();
    await expect(first.listTools()).rejects.toThrow();
    await third.listTools();

    // Keep both remaining sessions busy with a long msg_wait, then try a new session.
    const parse = (r: Awaited<ReturnType<Client['callTool']>>) =>
      JSON.parse((r.content as { text: string }[])[0]!.text);
    const joined: { participant_id: string }[] = [];
    for (const c of [second, third]) {
      joined.push(
        parse(
          await c.callTool({ name: 'room_join', arguments: { room: 'REQ-L', role: 'frontend' } }),
        ),
      );
    }
    // Wait from the current seq so neither call is woken by the other's join message.
    const room = (await hub.services.repo.findRoom('REQ-L'))!;
    const seq = await hub.services.repo.currentSeq(room.id);
    const busy = Promise.all(
      [second, third].map((c, i) =>
        c.callTool({
          name: 'msg_wait',
          arguments: {
            room: 'REQ-L',
            participant_id: joined[i]!.participant_id,
            after_seq: seq,
            timeout_seconds: 2,
          },
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 300));
    await expect(connect()).rejects.toThrow();
    await busy;
    await Promise.all([first, second, third].map((c) => c.close().catch(() => undefined)));
  });
});

describe('event stream cap', () => {
  it('refuses a second web event stream with 429 TOO_MANY', async () => {
    const headers = { authorization: `Bearer ${auth.token}` };
    const ac = new AbortController();
    const open = await fetch(`${base}/api/rooms/REQ-L/events`, { headers, signal: ac.signal });
    expect(open.status).toBe(200);
    const refused = await fetch(`${base}/api/rooms/REQ-L/events`, { headers });
    expect(refused.status).toBe(429);
    expect((await refused.json()) as { error: string }).toMatchObject({ error: 'TOO_MANY' });

    ac.abort();
    await new Promise((r) => setTimeout(r, 100));
    const reopened = await fetch(`${base}/api/rooms/REQ-L/events`, { headers });
    expect(reopened.status).toBe(200);
    await reopened.body?.cancel();
  });
});
