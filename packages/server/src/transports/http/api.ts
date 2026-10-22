import { HumanPostInput, MsgListInput } from '@agentcowork/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../app.js';
import { AppError } from '../../domain/errors.js';
import type { Principal } from '../../domain/models.js';
import { stagesFor } from '../../domain/stages.js';
import type { AuthProvider } from '../../services/ports.js';
import { nameIndex, toMemberView, toMessageView } from '../../services/views.js';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_A_PARTICIPANT: 403,
  INVALID_ARGUMENT: 400,
  SLUG_TAKEN: 409,
  VERSION_CONFLICT: 409,
  STALE_CONTEXT: 409,
  TOKEN_INVALID: 409,
  ROOM_CLOSED: 409,
  ROOM_PAUSED: 409,
  LIMIT_REACHED: 429,
};

const SSE_KEEPALIVE_MS = 15_000;

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/**
 * REST + SSE for the Web UI (design 12). Humans read rooms and speak; agents use MCP.
 * The UI reads SSE with fetch (EventSource cannot send headers), so auth is header-only.
 */
export function registerApi(app: FastifyInstance, services: Services, auth: AuthProvider) {
  app.register(
    async (api) => {
      api.addHook('onRequest', async (req, reply) => {
        // Header only: tokens in URLs end up in proxy logs and browser history.
        const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
        const principal = token ? await auth.authenticate(token) : undefined;
        if (!principal) {
          return reply
            .code(401)
            .send({ error: 'UNAUTHORIZED', message: 'Missing or invalid token' });
        }
        req.principal = principal;
      });

      api.setErrorHandler((err, _req, reply) => {
        if (err instanceof AppError) {
          return reply
            .code(STATUS_BY_CODE[err.code] ?? 400)
            .send({ error: err.code, message: err.message, ...err.data });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: 'INVALID_ARGUMENT', message: z.prettifyError(err) });
        }
        reply.log.error(err);
        return reply.code(500).send({ error: 'INTERNAL', message: 'Internal error' });
      });

      api.get('/rooms', async () => services.rooms.list({ status: ['open', 'paused', 'closed'] }));

      api.get('/rooms/:room', async (req) => roomDetail(services, roomParam(req)));

      api.get('/rooms/:room/messages', async (req) => {
        const q = req.query as Record<string, string | undefined>;
        const input = MsgListInput.parse({
          room: roomParam(req),
          after_seq: optionalInt(q.after_seq),
          before_seq: optionalInt(q.before_seq),
          limit: optionalInt(q.limit),
        });
        return services.messages.list(input);
      });

      api.post('/rooms/:room/messages', async (req, reply) => {
        const input = HumanPostInput.parse(req.body);
        const result = await services.messages.postAsHuman(req.principal!, roomParam(req), input);
        return reply.code(201).send(result);
      });

      api.get('/rooms/:room/board/:key/history', async (req) => {
        const { key } = req.params as { key: string };
        return services.board.history(roomParam(req), key);
      });

      api.get('/rooms/:room/events', async (req, reply) => streamEvents(services, req, reply));
    },
    { prefix: '/api' },
  );
}

async function roomDetail(services: Services, ref: string) {
  const room = await services.access.requireRoom(ref);
  const members = await services.repo.listParticipants(room.id);
  const status = await services.stages.memberStatus(room, members);
  const ready = new Map(status.map((m) => [m.participant_id, m.ready]));
  return {
    room: await services.rooms.summarize(room),
    stages: stagesFor(room.type),
    pause_reason: services.stages.pauseReason(room) ?? null,
    members: members
      .filter((m) => m.status !== 'left')
      .map((m) => ({ ...toMemberView(m), ready: ready.get(m.id) ?? false })),
    board: (await services.board.get({ room: room.id })).sections,
  };
}

/** Server-sent events: `message` (a new MessageView) and `members` (presence changed). */
async function streamEvents(services: Services, req: FastifyRequest, reply: FastifyReply) {
  const room = await services.access.requireRoom(roomParam(req));
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('ready', { room: room.slug });

  // Serialize per-connection work so events keep their order even though lookups are async.
  let chain = Promise.resolve();
  const unsubscribe = services.bus.subscribe((event) => {
    if (event.roomId !== room.id) return;
    chain = chain
      .then(async () => {
        const members = await services.repo.listParticipants(room.id);
        if (event.type === 'message.created') {
          send('message', toMessageView(event.message, nameIndex(members)));
        } else {
          send('members', { participant_id: event.participantId });
        }
      })
      .catch(() => undefined);
  });
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), SSE_KEEPALIVE_MS);
  const close = () => {
    clearInterval(keepAlive);
    unsubscribe();
  };
  req.raw.on('close', close);
  res.on('error', close);
}

function roomParam(req: FastifyRequest): string {
  return (req.params as { room: string }).room;
}

function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}
