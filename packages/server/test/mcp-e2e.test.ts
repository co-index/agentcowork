import type { JoinResult, MessageView, SyncContext, WaitResult } from '@agentcowork/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';

let hub: Hub;
let baseUrl: string;
const auth = new HostTokenAuth();

beforeAll(async () => {
  const config = loadConfig('host', {
    port: 0,
    bind: '127.0.0.1',
    dbPath: ':memory:',
    waitMaxSeconds: 3,
    heartbeatSeconds: 1,
  });
  hub = createHub(config, auth);
  const port = await hub.listen();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await hub.close();
});

async function connect(token = auth.token): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/** Calls a tool and parses its JSON payload; errors come back as { error, ... } objects. */
async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  options?: Parameters<Client['callTool']>[2],
): Promise<T & { error?: string }> {
  const res = await client.callTool({ name, arguments: args }, undefined, options);
  const content = res.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text) as T & { error?: string };
}

describe('MCP endpoint', () => {
  it('rejects requests without a valid bearer token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    await expect(connect('acw_host_wrong')).rejects.toThrow();
  });

  it('lists the ten tools from the design', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'board_get',
        'board_update',
        'msg_list',
        'msg_post',
        'msg_wait',
        'room_create',
        'room_join',
        'room_leave',
        'room_list',
        'stage_set',
      ].sort(),
    );
    await client.close();
  });

  it('returns business errors as tool errors with a code', async () => {
    const client = await connect();
    const res = await call(client, 'room_join', { room: 'missing', role: 'frontend' });
    expect(res.error).toBe('NOT_FOUND');
    await client.close();
  });

  it('sends progress notifications while msg_wait is suspended', async () => {
    const client = await connect();
    const created = await call<JoinResult>(client, 'room_create', {
      title: 'progress',
      role: 'backend',
    });
    const progress: number[] = [];
    const res = await call<WaitResult>(
      client,
      'msg_wait',
      {
        room: created.room.slug,
        participant_id: created.participant_id,
        after_seq: created.sync.current_seq,
        timeout_seconds: 3,
      },
      { onprogress: (p) => progress.push(p.progress), resetTimeoutOnProgress: true },
    );
    expect(res.timed_out).toBe(true);
    expect(progress.length).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it('marks participants offline when their session ends', async () => {
    const host = await connect();
    const created = await call<JoinResult>(host, 'room_create', {
      title: 'offline',
      role: 'backend',
    });
    const guest = await connect();
    const joined = await call<JoinResult>(guest, 'room_join', {
      room: created.room.slug,
      role: 'frontend',
    });
    await (guest.transport as StreamableHTTPClientTransport).terminateSession();
    await guest.close();
    await new Promise((r) => setTimeout(r, 50));
    const res = await call<WaitResult>(host, 'msg_wait', {
      room: created.room.slug,
      participant_id: created.participant_id,
      after_seq: created.sync.current_seq,
      timeout_seconds: 1,
    });
    const status = res.members_status.find((m) => m.participant_id === joined.participant_id);
    expect(status?.status).toBe('offline');
    await host.close();
  });

  it('closing an old session does not mark a participant offline that a newer session drives', async () => {
    const first = await connect();
    const created = await call<JoinResult>(first, 'room_create', {
      title: 'reconnect',
      role: 'backend',
    });
    // The client reconnects: a new session keeps driving the same participant.
    const second = await connect();
    const waiting = call<WaitResult>(second, 'msg_wait', {
      room: created.room.slug,
      participant_id: created.participant_id,
      after_seq: created.sync.current_seq,
      timeout_seconds: 2,
    });
    await new Promise((r) => setTimeout(r, 100));
    await (first.transport as StreamableHTTPClientTransport).terminateSession();
    await first.close();
    await new Promise((r) => setTimeout(r, 100));
    const p = await hub.services.repo.findParticipant(created.participant_id);
    expect(p?.status).toBe('waiting');
    await waiting;
    await second.close();
  });

  it('an agent that lost its session resumes its participant from a new client', async () => {
    const host = await connect();
    const created = await call<JoinResult>(host, 'room_create', {
      title: 'resume',
      role: 'backend',
    });
    const before = await connect();
    const joined = await call<JoinResult>(before, 'room_join', {
      room: created.room.slug,
      role: 'frontend',
      repo: { name: 'admin-web' },
    });
    await (before.transport as StreamableHTTPClientTransport).terminateSession();
    await before.close();

    const after = await connect();
    const resumed = await call<JoinResult>(after, 'room_join', {
      room: created.room.slug,
      role: 'frontend',
      repo: { name: 'admin-web' },
    });
    expect(resumed.participant_id).toBe(joined.participant_id);
    expect(resumed.resumed).toBeDefined();
    expect(resumed.members.filter((m) => m.role === 'frontend')).toHaveLength(1);
    await Promise.all([host.close(), after.close()]);
  });

  it('three agents discuss concurrently without losing or duplicating messages', async () => {
    const ROUNDS = 5;
    const roles = ['backend', 'frontend', 'app'] as const;
    const clients = await Promise.all(roles.map(() => connect()));

    const created = await call<JoinResult>(clients[0]!, 'room_create', {
      title: 'Three-way discussion',
      role: 'backend',
      requirement: 'Add order export',
    });
    const slug = created.room.slug;
    const joins = [
      created,
      ...(await Promise.all(
        clients
          .slice(1)
          .map((c, i) => call<JoinResult>(c, 'room_join', { room: slug, role: roles[i + 1] })),
      )),
    ];

    let conflicts = 0;
    const agent = async (index: number) => {
      const client = clients[index]!;
      const me = joins[index]!;
      const seen = new Map<number, MessageView>();
      for (const m of me.recent_messages) seen.set(m.seq, m);
      let sync: SyncContext = me.sync;
      let posted = 0;

      while (posted < ROUNDS) {
        // Everyone but the host waits for a message before speaking.
        if (index !== 0 || posted > 0) {
          const res = await call<WaitResult>(client, 'msg_wait', {
            room: slug,
            participant_id: me.participant_id,
            after_seq: sync.current_seq,
            timeout_seconds: 1,
          });
          for (const m of res.messages) seen.set(m.seq, m);
          sync = res.sync;
        }
        // Post, retrying on conflicts with the context handed back by the hub.
        for (;;) {
          const res = await call<{
            seq: number;
            sync: SyncContext;
            missed_messages?: MessageView[];
          }>(client, 'msg_post', {
            room: slug,
            participant_id: me.participant_id,
            kind: 'chat',
            content: `${roles[index]} round ${posted}`,
            expected_last_seq: sync.current_seq,
            reply_token: sync.reply_token,
          });
          if (!res.error) {
            sync = res.sync;
            posted++;
            break;
          }
          expect(res.error).toBe('STALE_CONTEXT');
          conflicts++;
          for (const m of res.missed_messages ?? []) seen.set(m.seq, m);
          sync = res.sync;
        }
      }
      return { me, seen };
    };

    const results = await Promise.all(roles.map((_, i) => agent(i)));

    const all = await call<{ messages: MessageView[] }>(clients[0]!, 'msg_list', {
      room: slug,
      after_seq: 0,
      limit: 200,
    });
    const seqs = all.messages.map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));

    const chats = all.messages.filter((m) => m.content.includes(' round '));
    expect(chats).toHaveLength(ROUNDS * roles.length);
    expect(new Set(chats.map((m) => m.content)).size).toBe(chats.length);

    // Strict sync: before each post, the author had seen every earlier message from others.
    for (const { me, seen } of results) {
      for (const mine of chats.filter((m) => m.participant_id === me.participant_id)) {
        const earlierFromOthers = all.messages.filter(
          (m) => m.seq < mine.seq && m.participant_id !== me.participant_id,
        );
        for (const m of earlierFromOthers) expect(seen.has(m.seq)).toBe(true);
      }
    }
    console.info(`[e2e] 3 agents x ${ROUNDS} rounds, ${conflicts} sync conflicts resolved`);
    await Promise.all(clients.map((c) => c.close()));
  });
});
