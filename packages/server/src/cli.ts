#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { backupSqliteDatabase } from './infra/db/sqlite-repository.js';
import { createHub } from './app.js';
import { loadConfig } from './config.js';
import { hostBanner } from './host-banner.js';
import { BootstrapTokenAuth, HostTokenAuth } from './infra/auth/host-token-auth.js';

const USAGE = `Usage: agentcowork <command> [options]

Commands:
  host     Run a hub on this machine (invite-token auth)
  backup   Copy a consistent SQLite database snapshot
  serve    Run a team server (shared bootstrap token; GitLab auth planned)

Options (host/serve):
  --port <n>       Port to listen on (default 7420, env AGENTCOWORK_PORT)
  --bind <addr>    Address to bind (default 0.0.0.0, env AGENTCOWORK_BIND)
  --db <path>      SQLite file (default ~/.agentcowork/host.db, env AGENTCOWORK_DB)
  --token <value>  Bearer token (env AGENTCOWORK_TOKEN; random for host, required for serve)
  --output <path>  Backup destination (backup command only)
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
      token: { type: 'string' },
      output: { type: 'string' },
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
        token: values.token,
      });
    case 'backup':
      return runBackup({ dbPath: values.db, output: values.output });
    case 'serve':
      return runServe({
        port: values.port === undefined ? undefined : Number(values.port),
        bind: values.bind,
        dbPath: values.db,
        token: values.token,
      });
    default:
      process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

async function runHost(overrides: {
  port?: number;
  bind?: string;
  dbPath?: string;
  token?: string;
}) {
  const config = loadConfig('host', overrides);
  const auth = new HostTokenAuth(config.token);
  const hub = createHub(config, auth);
  const port = await hub.listen();
  process.stdout.write(
    hostBanner({
      port,
      bind: config.bind,
      token: auth.token,
      publicUrl: config.publicUrl,
      dbPath: config.dbPath,
      hasWeb: config.webRoot !== undefined,
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

async function runServe(overrides: {
  port?: number;
  bind?: string;
  dbPath?: string;
  token?: string;
}) {
  const config = loadConfig('server', overrides);
  if (!config.token) {
    throw new Error('Server mode requires AGENTCOWORK_TOKEN or --token');
  }
  const auth = new BootstrapTokenAuth(config.token);
  const hub = createHub(config, auth);
  const port = await hub.listen();
  process.stdout.write(
    `AgentCowork server is running\n  URL: http://127.0.0.1:${port}\n  Database: ${config.dbPath}\n` +
      '  Authentication: shared bootstrap token (GitLab OAuth is not enabled yet)\n',
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

async function runBackup(input: { dbPath?: string; output?: string }): Promise<number> {
  if (!input.dbPath || !input.output) {
    process.stderr.write('backup requires --db <path> and --output <path>\n');
    return 1;
  }
  await backupSqliteDatabase(input.dbPath, input.output);
  process.stdout.write(`SQLite backup written to ${input.output}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
