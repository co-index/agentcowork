import type { FastifyInstance } from 'fastify';
import { DEFAULT_LIMITS, type Config, type Limits } from './config.js';
import { MemoryEventBus } from './infra/events/memory-event-bus.js';
import { openSqliteRepository } from './infra/db/sqlite-repository.js';
import { Access } from './services/access.js';
import { BoardService } from './services/board-service.js';
import { MessageService } from './services/message-service.js';
import {
  systemClock,
  type AuthProvider,
  type Clock,
  type EventBus,
  type Repository,
} from './services/ports.js';
import { ReplyTokens } from './services/reply-tokens.js';
import { RoomService } from './services/room-service.js';
import { StageService } from './services/stage-service.js';
import { Thread } from './services/thread.js';
import { WaitCoordinator } from './services/wait-coordinator.js';
import { buildHttpServer } from './transports/http/server.js';

export interface Services {
  repo: Repository;
  bus: EventBus;
  access: Access;
  rooms: RoomService;
  messages: MessageService;
  board: BoardService;
  stages: StageService;
  thread: Thread;
  waits: WaitCoordinator;
}

export interface ServiceOptions {
  dbPath: string;
  waitMaxSeconds: number;
  heartbeatSeconds: number;
  /** Override the 30-minute idle pause (tests). */
  idlePauseMs?: number;
  limits?: Partial<Limits>;
}

export function createServices(config: ServiceOptions, clock: Clock = systemClock): Services {
  const repo = openSqliteRepository(config.dbPath);
  const bus = new MemoryEventBus();
  const thread = new Thread(repo, bus, clock);
  const tokens = new ReplyTokens(repo, clock);
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  const waits = new WaitCoordinator(bus, config.heartbeatSeconds * 1000, limits);
  const access = new Access(repo, bus, clock);
  const board = new BoardService(repo, access, thread, clock);
  const stages = new StageService(repo, access, thread, clock, config.idlePauseMs);
  const rooms = new RoomService(repo, bus, access, thread, tokens, board, clock);
  const messages = new MessageService(
    repo,
    access,
    stages,
    thread,
    tokens,
    waits,
    config.waitMaxSeconds,
  );
  return { repo, bus, access, rooms, messages, board, stages, thread, waits };
}

export interface Hub {
  services: Services;
  http: FastifyInstance;
  /** Starts listening; resolves with the bound port. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createHub(config: Config, auth: AuthProvider): Hub {
  const services = createServices(config);
  const http = buildHttpServer(services, auth, {
    webRoot: config.webRoot,
    limits: config.limits,
  });
  const janitor = setInterval(() => {
    services.stages.pauseIdleRooms().catch((err) => console.error('[janitor]', err));
  }, 60_000);
  janitor.unref();
  return {
    services,
    http,
    async listen() {
      await http.listen({ port: config.port, host: config.bind });
      const addr = http.server.address();
      return typeof addr === 'object' && addr ? addr.port : config.port;
    },
    async close() {
      clearInterval(janitor);
      services.waits.dispose();
      await http.close();
      await services.repo.close();
    },
  };
}
