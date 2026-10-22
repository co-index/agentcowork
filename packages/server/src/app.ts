import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { MemoryEventBus } from './infra/events/memory-event-bus.js';
import { openSqliteRepository } from './infra/db/sqlite-repository.js';
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
import { Thread } from './services/thread.js';
import { WaitCoordinator } from './services/wait-coordinator.js';
import { buildHttpServer } from './transports/http/server.js';

export interface Services {
  repo: Repository;
  bus: EventBus;
  rooms: RoomService;
  messages: MessageService;
  waits: WaitCoordinator;
}

export function createServices(
  config: Pick<Config, 'dbPath' | 'waitMaxSeconds' | 'heartbeatSeconds'>,
  clock: Clock = systemClock,
): Services {
  const repo = openSqliteRepository(config.dbPath);
  const bus = new MemoryEventBus();
  const thread = new Thread(repo, bus, clock);
  const tokens = new ReplyTokens(repo, clock);
  const waits = new WaitCoordinator(bus, config.heartbeatSeconds * 1000);
  const rooms = new RoomService(repo, bus, thread, tokens, clock);
  const messages = new MessageService(repo, rooms, thread, tokens, waits, config.waitMaxSeconds);
  return { repo, bus, rooms, messages, waits };
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
  const http = buildHttpServer(services, auth);
  return {
    services,
    http,
    async listen() {
      await http.listen({ port: config.port, host: config.bind });
      const addr = http.server.address();
      return typeof addr === 'object' && addr ? addr.port : config.port;
    },
    async close() {
      services.waits.dispose();
      await http.close();
      await services.repo.close();
    },
  };
}
