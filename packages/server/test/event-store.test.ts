import { createServer, request, type Server } from 'node:http';
import type { JoinResult, WaitResult } from '@agentcowork/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';
import { BoundedEventStore } from '../src/transports/mcp/event-store.js';

const msg = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', method: 'm', params: { id } });

describe('BoundedEventStore', () => {
  it('replays events after the given id, for that stream only', async () => {
    const store = new BoundedEventStore();
    const a1 = await store.storeEvent('a', msg(1));
    await store.storeEvent('b', msg(2));
    await store.storeEvent('a', msg(3));
    await store.storeEvent('a', msg(4));
    const sent: unknown[] = [];
    const stream = await store.replayEventsAfter(a1, {
      send: async (_id, m) =>
        void sent.push((m as unknown as { params: { id: number } }).params.id),
    });
    expect(stream).toBe('a');
    expect(sent).toEqual([3, 4]);
    expect(await store.getStreamIdForEventId(a1)).toBe('a');
  });

  it('unknown ids replay nothing', async () => {
    const store = new BoundedEventStore();
    await store.storeEvent('a', msg(1));
    expect(await store.replayEventsAfter('a_nope', { send: async () => undefined })).toBe('');
  });

  it('is bounded by count and age', async () => {
    let now = 0;
    const store = new BoundedEventStore(3, 1000, () => now);
    for (let i = 0; i < 5; i++) await store.storeEvent('a', msg(i));
    expect(store.size).toBe(3);
    now = 5000;
    await store.storeEvent('a', msg(9));
    expect(store.size).toBe(1);
  });
});

/**
 * A proxy that kills every streaming (SSE) response after `cutAfterMs`, like an nginx
 * whose proxy_read_timeout is shorter than the hub's heartbeat.
 */
function cuttingProxy(
  target: number,
  cutAfterMs: number,
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const upstream = request(
      { host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
        if (String(up.headers['content-type']).includes('text/event-stream')) {
          setTimeout(() => {
            up.destroy();
            res.destroy();
          }, cutAfterMs);
        }
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    }),
  );
}

describe('resumable msg_wait behind a proxy that cuts streams', () => {
  const auth = new HostTokenAuth();
  let hub: Hub;
  let proxy: Server;
  let proxyPort: number;

  beforeAll(async () => {
    hub = createHub(
      loadConfig('host', {
        port: 0,
        bind: '127.0.0.1',
        dbPath: ':memory:',
        waitMaxSeconds: 2,
        heartbeatSeconds: 0,
        webRoot: undefined,
      }),
      auth,
    );
    const port = await hub.listen();
    ({ server: proxy, port: proxyPort } = await cuttingProxy(port, 500));
  });

  afterAll(async () => {
    proxy.closeAllConnections();
    await new Promise((r) => proxy.close(r));
    await hub.close();
  });

  it('still delivers the msg_wait result after the stream is cut', async () => {
    const client = new Client({ name: 'cut', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${proxyPort}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${auth.token}` } },
        reconnectionOptions: {
          initialReconnectionDelay: 200,
          maxReconnectionDelay: 500,
          reconnectionDelayGrowFactor: 1.2,
          maxRetries: 50,
        },
      }),
    );
    const parse = (r: Awaited<ReturnType<Client['callTool']>>) =>
      JSON.parse((r.content as { text: string }[])[0]!.text);

    const created = parse(
      await client.callTool({ name: 'room_create', arguments: { title: 'cut', role: 'backend' } }),
    ) as JoinResult;
    const started = Date.now();
    const res = parse(
      await client.callTool(
        {
          name: 'msg_wait',
          arguments: {
            room: created.room.slug,
            participant_id: created.participant_id,
            after_seq: created.sync.current_seq,
            timeout_seconds: 2,
          },
        },
        undefined,
        { timeout: 15_000 },
      ),
    ) as WaitResult;
    expect(res.timed_out).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    await client.close();
  });
});
