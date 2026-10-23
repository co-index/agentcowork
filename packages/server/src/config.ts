import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Mode = 'host' | 'server';

/** Caps that keep a misbehaving or malicious token holder from exhausting the hub. */
export interface Limits {
  /** MCP sessions alive at once; idle ones are evicted first when full. */
  maxSessions: number;
  /** msg_wait calls suspended at once, across all rooms. */
  maxWaiters: number;
  /** Concurrent msg_wait calls per participant (a well-behaved agent uses one). */
  maxWaitsPerParticipant: number;
  /** Web UI event streams open at once. */
  maxEventStreams: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSessions: 200,
  maxWaiters: 1000,
  maxWaitsPerParticipant: 4,
  maxEventStreams: 200,
};

export interface Config {
  mode: Mode;
  port: number;
  bind: string;
  /** SQLite file path, or ':memory:'. */
  dbPath: string;
  publicUrl: string | undefined;
  /** Upper bound for a single msg_wait. */
  waitMaxSeconds: number;
  /** Interval for MCP progress notifications while msg_wait is suspended. */
  heartbeatSeconds: number;
  /** Built Web UI directory, if any. */
  webRoot: string | undefined;
  limits: Limits;
}

export function loadConfig(
  mode: Mode,
  overrides: Partial<Config> = {},
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const defaults: Config = {
    mode,
    port: intEnv(env.AGENTCOWORK_PORT, 7420),
    bind: env.AGENTCOWORK_BIND ?? '0.0.0.0',
    dbPath:
      env.AGENTCOWORK_DB ??
      (mode === 'host' ? join(homedir(), '.agentcowork', 'host.db') : '/data/agentcowork.db'),
    publicUrl: env.AGENTCOWORK_PUBLIC_URL || undefined,
    waitMaxSeconds: intEnv(env.AGENTCOWORK_WAIT_MAX_SECONDS, 240),
    heartbeatSeconds: intEnv(env.AGENTCOWORK_HEARTBEAT_SECONDS, 15),
    webRoot: env.AGENTCOWORK_WEB_ROOT || defaultWebRoot(),
    limits: {
      maxSessions: intEnv(env.AGENTCOWORK_MAX_SESSIONS, DEFAULT_LIMITS.maxSessions),
      maxWaiters: intEnv(env.AGENTCOWORK_MAX_WAITERS, DEFAULT_LIMITS.maxWaiters),
      maxWaitsPerParticipant: intEnv(
        env.AGENTCOWORK_MAX_WAITS_PER_PARTICIPANT,
        DEFAULT_LIMITS.maxWaitsPerParticipant,
      ),
      maxEventStreams: intEnv(env.AGENTCOWORK_MAX_EVENT_STREAMS, DEFAULT_LIMITS.maxEventStreams),
    },
  };
  const merged = { ...defaults, ...stripUndefined(overrides) };
  if (merged.waitMaxSeconds < 1) throw new Error('AGENTCOWORK_WAIT_MAX_SECONDS must be >= 1');
  return merged;
}

/** Published package ships the UI in `web/`; in the monorepo it is `packages/web/dist`. */
function defaultWebRoot(): string | undefined {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return [join(pkgRoot, 'web'), join(pkgRoot, '..', 'web', 'dist')].find((dir) =>
    existsSync(join(dir, 'index.html')),
  );
}

function intEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, got "${value}"`);
  return n;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
