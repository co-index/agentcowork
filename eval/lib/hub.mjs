// Starts an isolated hub for one evaluation run and talks to its REST API.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

export async function startHub(repoRoot, workDir) {
  const port = await freePort();
  const token = `acw_host_${randomBytes(16).toString('hex')}`;
  const log = openSync(join(workDir, 'hub.log'), 'a');
  const child = spawn(
    process.execPath,
    [
      join(repoRoot, 'packages/server/dist/cli.js'),
      'host',
      '--port',
      String(port),
      '--bind',
      '127.0.0.1',
      '--db',
      join(workDir, 'hub.db'),
    ],
    { env: { ...process.env, AGENTCOWORK_TOKEN: token }, stdio: ['ignore', log, log] },
  );
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return {
    base,
    token,
    stop: () => child.kill('SIGTERM'),
    api: async (path) => {
      const res = await fetch(`${base}/api${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
      return res.json();
    },
  };
}

/** Every message of a room, following has_more. */
export async function allMessages(hub, room) {
  const out = [];
  for (let after = 0; ;) {
    const page = await hub.api(`/rooms/${room}/messages?after_seq=${after}&limit=200`);
    out.push(...page.messages);
    if (!page.has_more || page.messages.length === 0) return out;
    after = out.at(-1).seq;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
