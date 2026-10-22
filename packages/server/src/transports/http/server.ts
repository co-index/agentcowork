import Fastify, { type FastifyInstance } from 'fastify';
import type { Services } from '../../app.js';
import type { AuthProvider } from '../../services/ports.js';
import { registerMcpEndpoint } from '../mcp/endpoint.js';

export function buildHttpServer(services: Services, auth: AuthProvider): FastifyInstance {
  const app = Fastify({
    logger: process.env.AGENTCOWORK_LOG ? { level: process.env.AGENTCOWORK_LOG } : false,
    bodyLimit: 4 * 1024 * 1024,
    // msg_wait holds requests open for minutes; never let the HTTP layer cut them.
    requestTimeout: 0,
    connectionTimeout: 0,
    forceCloseConnections: true,
  });

  app.get('/healthz', async () => ({ ok: true }));
  registerMcpEndpoint(app, services, auth);
  return app;
}
