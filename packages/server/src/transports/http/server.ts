import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Services } from '../../app.js';
import type { AuthProvider } from '../../services/ports.js';
import { registerMcpEndpoint } from '../mcp/endpoint.js';
import { registerApi } from './api.js';

export interface HttpOptions {
  /** Directory with the built Web UI; skipped when missing. */
  webRoot?: string;
}

export function buildHttpServer(
  services: Services,
  auth: AuthProvider,
  opts: HttpOptions = {},
): FastifyInstance {
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
  registerApi(app, services, auth);

  if (opts.webRoot && existsSync(opts.webRoot)) {
    app.register(fastifyStatic, { root: opts.webRoot, wildcard: false });
    // Single-page app: unknown non-API GETs get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/mcp')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    });
  }
  return app;
}
