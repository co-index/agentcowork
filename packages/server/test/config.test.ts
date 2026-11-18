import { describe, expect, it } from 'vitest';
import { loadConfig, offlineAfterMs } from '../src/config.js';
import { HostTokenAuth } from '../src/infra/auth/host-token-auth.js';

describe('host configuration', () => {
  it('loads an explicit token from the environment', async () => {
    const config = loadConfig('host', {}, { AGENTCOWORK_TOKEN: 'acw_host_test-token' });
    expect(config.token).toBe('acw_host_test-token');
    const auth = new HostTokenAuth(config.token);
    expect(await auth.authenticate('acw_host_test-token')).toMatchObject({ userId: 'host' });
    expect(await auth.authenticate('wrong')).toBeUndefined();
  });

  it('keeps the token unset when the environment is empty', () => {
    expect(loadConfig('host', {}, { AGENTCOWORK_TOKEN: '' }).token).toBeUndefined();
  });

  it('rejects a whitespace-only token', () => {
    expect(() => loadConfig('host', {}, { AGENTCOWORK_TOKEN: '   ' })).toThrow(
      'AGENTCOWORK_TOKEN must not be empty',
    );
  });
});

describe('offline threshold', () => {
  it('defaults to 10 minutes, separate from the wait limit', () => {
    const config = loadConfig('host', {}, {});
    expect(offlineAfterMs(config)).toBe(10 * 60_000);
    // Shortening waits for a client with a short tool timeout does not shorten it.
    expect(offlineAfterMs({ ...config, waitMaxSeconds: 60 })).toBe(10 * 60_000);
  });

  it('is never shorter than one full wait plus a minute', () => {
    const config = loadConfig('host', {}, { AGENTCOWORK_OFFLINE_AFTER_SECONDS: '30' });
    expect(offlineAfterMs(config)).toBe((240 + 60) * 1000);
  });
});
