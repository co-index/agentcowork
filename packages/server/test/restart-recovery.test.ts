import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';

type ToolPayload = {
  room?: { slug: string };
  participant_id?: string;
  resumed?: { missed_count: number };
  recent_messages?: Array<{ content: string }>;
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text) as T;
}

async function connect(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: 'restart-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe('Hub restart recovery', () => {
  it('reconnects with the same participant after the MCP session is lost', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentcowork-restart-'));
    directories.push(directory);
    const dbPath = join(directory, 'host.db');
    const token = 'acw_host_restart_test_token';
    const auth = new HostTokenAuth(token);
    const config = loadConfig('host', {
      port: 0,
      bind: '127.0.0.1',
      dbPath,
      token,
      waitMaxSeconds: 2,
      heartbeatSeconds: 0,
      webRoot: undefined,
    });

    let hub: Hub | undefined = createHub(config, auth);
    const firstBase = `http://127.0.0.1:${await hub.listen()}`;
    const first = await connect(firstBase, token);
    const firstTransport = first.transport as StreamableHTTPClientTransport;
    const created = await call<ToolPayload>(first, 'room_create', {
      title: 'Restart recovery',
      role: 'backend',
      requirement: 'Keep the room data after a restart',
    });
    const participantId = created.participant_id!;
    const oldSessionId = firstTransport.sessionId!;

    await hub.close();
    hub = createHub(config, auth);
    const secondBase = `http://127.0.0.1:${await hub.listen()}`;

    const staleSession = await fetch(`${secondBase}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': oldSessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(staleSession.status).toBe(404);

    const second = await connect(secondBase, token);
    const resumed = await call<ToolPayload>(second, 'room_join', {
      room: created.room!.slug,
      participant_id: participantId,
      role: 'backend',
    });
    expect(resumed.participant_id).toBe(participantId);
    expect(resumed.resumed).toMatchObject({
      missed_count: expect.any(Number),
      mentioned_seqs: expect.any(Array),
      since_seq: expect.any(Number),
    });
    expect(resumed.recent_messages?.some((m) => m.content.includes('Keep the room data'))).toBe(
      true,
    );

    await second.close();
    await first.close().catch(() => undefined);
    await hub.close();
    hub = undefined;
  });
});
