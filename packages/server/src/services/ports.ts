import type {
  BoardSection,
  Message,
  NewMessage,
  Participant,
  Principal,
  ReplyToken,
  Room,
} from '../domain/models.js';

/**
 * Storage port. v1 is SQLite (infra/db); a PostgreSQL implementation can be dropped in later.
 * Methods are async so that network-backed stores fit the same interface.
 */
export interface Repository {
  /** Throws AppError('SLUG_TAKEN') if the slug already exists. */
  createRoom(room: Room): Promise<void>;
  findRoom(idOrSlug: string): Promise<Room | undefined>;
  updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): Promise<void>;
  /** Rooms with one of the given statuses, most recently active first. */
  listRooms(statuses: Room['status'][]): Promise<Room[]>;

  createParticipant(participant: Participant): Promise<void>;
  findParticipant(id: string): Promise<Participant | undefined>;
  listParticipants(roomId: string): Promise<Participant[]>;
  updateParticipant(id: string, patch: Partial<Omit<Participant, 'id' | 'roomId'>>): Promise<void>;

  /** Atomically allocates the next seq, stores the message and bumps room.lastMessageAt. */
  appendMessage(message: NewMessage): Promise<Message>;
  currentSeq(roomId: string): Promise<number>;
  /** Counts agent messages after `afterSeq`, optionally from a single participant. */
  countAgentMessages(roomId: string, afterSeq: number, participantId?: string): Promise<number>;
  /** Participants that posted a ready=true message after `afterSeq`. */
  readyParticipants(roomId: string, afterSeq: number): Promise<Set<string>>;
  /** Ascending by seq. `beforeSeq` with no `afterSeq` returns the latest `limit` messages before it. */
  listMessages(
    roomId: string,
    query: { afterSeq?: number; beforeSeq?: number; limit: number },
  ): Promise<Message[]>;

  listBoard(roomId: string, keys?: string[]): Promise<BoardSection[]>;
  /**
   * Optimistic write: succeeds only if the stored version equals `baseVersion` (0 = new section).
   * Appends to board history. Returns the stored section, or the current one on conflict.
   */
  writeBoardSection(
    section: Omit<BoardSection, 'version'>,
    baseVersion: number,
  ): Promise<
    { ok: true; section: BoardSection } | { ok: false; current: BoardSection | undefined }
  >;
  listBoardHistory(roomId: string, key: string): Promise<BoardSection[]>;

  insertReplyToken(token: ReplyToken): Promise<void>;
  /** Marks the token consumed and returns it, or undefined if missing / already consumed. */
  consumeReplyToken(tokenHash: string, now: number): Promise<ReplyToken | undefined>;
  deleteExpiredReplyTokens(now: number): Promise<void>;

  close(): Promise<void>;
}

export type HubEvent =
  | { type: 'message.created'; roomId: string; message: Message }
  | { type: 'participant.updated'; roomId: string; participantId: string };

/** Event broadcast port. v1 is in-process; Redis pub/sub later. */
export interface EventBus {
  publish(event: HubEvent): void;
  subscribe(handler: (event: HubEvent) => void): () => void;
}

/** Authentication port. v1: host invite token; M3: GitLab-backed personal tokens. */
export interface AuthProvider {
  authenticate(bearerToken: string): Promise<Principal | undefined>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
