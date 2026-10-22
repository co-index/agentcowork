import type { JoinResult, SyncContext } from '@agentcowork/shared';
import { createServices, type Services } from '../src/app.js';
import { AppError } from '../src/domain/errors.js';
import type { Principal } from '../src/domain/models.js';

export const alice: Principal = { userId: 'u_alice', name: 'alice', scope: 'personal' };
export const bob: Principal = { userId: 'u_bob', name: 'bob', scope: 'personal' };
export const carol: Principal = { userId: 'u_carol', name: 'carol', scope: 'personal' };

export function makeServices(
  opts: { waitMaxSeconds?: number; heartbeatSeconds?: number; idlePauseMs?: number } = {},
) {
  return createServices({
    dbPath: ':memory:',
    waitMaxSeconds: opts.waitMaxSeconds ?? 2,
    heartbeatSeconds: opts.heartbeatSeconds ?? 0,
    idlePauseMs: opts.idlePauseMs,
  });
}

export async function closeServices(s: Services) {
  s.waits.dispose();
  await s.repo.close();
}

/** Room with alice (host, backend) and bob (frontend). */
export async function roomWithTwo(s: Services) {
  const host = await s.rooms.create(alice, {
    title: 'Order export',
    type: 'feature',
    slug: 'REQ-1',
    requirement: 'Export orders as CSV',
    role: 'backend',
  });
  const guest = await s.rooms.join(bob, { room: 'REQ-1', role: 'frontend' });
  return { host, guest };
}

export function post(
  s: Services,
  who: Principal,
  member: Pick<JoinResult, 'participant_id'>,
  sync: SyncContext,
  content: string,
  extra: Record<string, unknown> = {},
) {
  return s.messages.post(who, {
    room: 'REQ-1',
    participant_id: member.participant_id,
    content,
    kind: 'chat',
    expected_last_seq: sync.current_seq,
    reply_token: sync.reply_token,
    ...extra,
  });
}

export async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError && err.code === code) return err;
    throw new Error(`Expected AppError ${code}, got ${String(err)}`);
  }
  throw new Error(`Expected AppError ${code}, but the call succeeded`);
}
