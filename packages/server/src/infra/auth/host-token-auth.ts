import type { Principal } from '../../domain/models.js';
import { randomToken, sha256 } from '../../services/ids.js';
import type { AuthProvider } from '../../services/ports.js';

/** Shared bearer-token authentication for Host and the early Server bootstrap mode. */
export class BootstrapTokenAuth implements AuthProvider {
  private readonly tokenHash: string;

  constructor(readonly token: string) {
    this.tokenHash = sha256(token);
  }

  async authenticate(bearerToken: string): Promise<Principal | undefined> {
    if (sha256(bearerToken) !== this.tokenHash) return undefined;
    return { userId: 'host', name: 'host', scope: 'host' };
  }
}

/** Host mode generates an invite token unless the caller supplies one. */
export class HostTokenAuth extends BootstrapTokenAuth {
  constructor(token: string = `acw_host_${randomToken(24)}`) {
    super(token);
  }
}
