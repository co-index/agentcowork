import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
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
