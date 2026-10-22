#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createHub } from './app.js';
import { loadConfig } from './config.js';
import { hostBanner } from './host-banner.js';
import { HostTokenAuth } from './infra/auth/host-token-auth.js';

const USAGE = `Usage: agentcowork <command> [options]

Commands:
  host     Run a hub on this machine (invite-token auth)
  serve    Run a team server (GitLab auth) — available in M3

Options (host):
  --port <n>       Port to listen on (default 7420, env AGENTCOWORK_PORT)
  --bind <addr>    Address to bind (default 0.0.0.0, env AGENTCOWORK_BIND)
  --db <path>      SQLite file (default ~/.agentcowork/host.db, env AGENTCOWORK_DB)
  -h, --help       Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      bind: { type: 'string' },
      db: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'host':
      return runHost({
        port: values.port === undefined ? undefined : Number(values.port),
        bind: values.bind,
        dbPath: values.db,
      });
    case 'serve':
      process.stderr.write('`agentcowork serve` is not implemented yet (planned for M3).\n');
      return 1;
    default:
      process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

async function runHost(overrides: { port?: number; bind?: string; dbPath?: string }) {
  const config = loadConfig('host', overrides);
  const auth = new HostTokenAuth();
  const hub = createHub(config, auth);
  const port = await hub.listen();
  process.stdout.write(
    hostBanner({
      port,
      bind: config.bind,
      token: auth.token,
      publicUrl: config.publicUrl,
      dbPath: config.dbPath,
    }) + '\n',
  );

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  process.stdout.write('\nShutting down...\n');
  await hub.close();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
