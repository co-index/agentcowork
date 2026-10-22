import { randomUUID } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../../app.js';
import type { Principal } from '../../domain/models.js';
import type { AuthProvider } from '../../services/ports.js';
import { createMcpServer } from './tools.js';

const SESSION_IDLE_MS = 30 * 60 * 1000;

interface Session {
  transport: StreamableHTTPServerTransport;
  principal: Principal;
  participants: Set<string>;
  lastActiveAt: number;
  /** Requests currently being served (a pending msg_wait keeps the session alive). */
  inFlight: number;
}

/**
 * MCP Streamable HTTP endpoint at /mcp (stateful sessions, one McpServer per session).
 * Only Streamable HTTP is supported; the deprecated HTTP+SSE transport is not.
 */
export function registerMcpEndpoint(app: FastifyInstance, services: Services, auth: AuthProvider) {
  const sessions = new Map<string, Session>();

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const principal = match ? await auth.authenticate(match[1]!) : undefined;
    if (!principal) {
      await reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="agentcowork"')
        .send(jsonRpcError(-32001, 'Missing or invalid bearer token'));
      return undefined;
    }
    return { principal, token: match![1]! };
  };

  const serve = async (
    session: Session,
    req: FastifyRequest,
    reply: FastifyReply,
    token: string,
  ) => {
    const authInfo: AuthInfo = {
      token,
      clientId: session.principal.userId,
      scopes: [],
      extra: { principal: session.principal },
    };
    session.lastActiveAt = Date.now();
    session.inFlight++;
    reply.hijack();
    try {
      await session.transport.handleRequest(
        Object.assign(req.raw, { auth: authInfo }),
        reply.raw,
        req.body,
      );
    } finally {
      session.inFlight--;
      session.lastActiveAt = Date.now();
    }
  };

  const closeSession = (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    void services.rooms.markOffline(session.participants).catch(() => undefined);
  };

  app.post('/mcp', async (req, reply) => {
    const authed = await authenticate(req, reply);
    if (!authed) return;
    const sessionId = req.headers['mcp-session-id'];

    if (typeof sessionId === 'string') {
      const session = sessions.get(sessionId);
      if (!session) return reply.code(404).send(jsonRpcError(-32001, 'Session not found'));
      if (session.principal.userId !== authed.principal.userId) {
        return reply.code(403).send(jsonRpcError(-32001, 'Session belongs to another user'));
      }
      return serve(session, req, reply, authed.token);
    }

    if (!isInitializeRequest(req.body)) {
      return reply
        .code(400)
        .send(jsonRpcError(-32000, 'Bad Request: no session id and not an initialize request'));
    }

    const participants = new Set<string>();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, session);
      },
    });
    const session: Session = {
      transport,
      principal: authed.principal,
      participants,
      lastActiveAt: Date.now(),
      inFlight: 0,
    };
    transport.onclose = () => {
      if (transport.sessionId) closeSession(transport.sessionId);
    };
    const server = createMcpServer(services, { track: (id) => participants.add(id) });
    await server.connect(transport);
    return serve(session, req, reply, authed.token);
  });

  const existingSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const authed = await authenticate(req, reply);
    if (!authed) return;
    const sessionId = req.headers['mcp-session-id'];
    const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!session) return reply.code(404).send(jsonRpcError(-32001, 'Session not found'));
    if (session.principal.userId !== authed.principal.userId) {
      return reply.code(403).send(jsonRpcError(-32001, 'Session belongs to another user'));
    }
    return serve(session, req, reply, authed.token);
  };
  app.get('/mcp', existingSession);
  app.delete('/mcp', existingSession);

  // Clients that vanish without DELETE would otherwise leak sessions.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions) {
      if (s.inFlight > 0 || s.lastActiveAt >= cutoff) continue;
      closeSession(id);
      void s.transport.close();
    }
  }, 60_000);
  sweeper.unref();

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    await Promise.all([...sessions.values()].map((s) => s.transport.close()));
    sessions.clear();
  });

  return { sessionCount: () => sessions.size };
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
