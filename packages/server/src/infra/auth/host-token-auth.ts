import type { Principal } from '../../domain/models.js';
import { randomToken, sha256 } from '../../services/ids.js';
import type { AuthProvider } from '../../services/ports.js';

/**
 * Host mode: one invite token generated at startup, kept only as a hash in memory,
 * so it stops working when the process restarts. Every holder is the anonymous "host" user.
 */
export class HostTokenAuth implements AuthProvider {
  private readonly tokenHash: string;

  constructor(readonly token: string = `acw_host_${randomToken(24)}`) {
    this.tokenHash = sha256(token);
  }

  async authenticate(bearerToken: string): Promise<Principal | undefined> {
    if (sha256(bearerToken) !== this.tokenHash) return undefined;
    return { userId: 'host', name: 'host', scope: 'host' };
  }
}
