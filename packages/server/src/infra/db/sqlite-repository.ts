import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { AppError } from '../../domain/errors.js';
import type { Message, NewMessage, Participant, ReplyToken, Room } from '../../domain/models.js';
import type { Repository } from '../../services/ports.js';
import * as schema from './schema.js';

// Same relative depth from src/infra/db and dist/infra/db.
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

type Db = BetterSQLite3Database<typeof schema>;

/** Opens (and migrates) a SQLite database. Use ':memory:' for tests. */
export function openSqliteRepository(path: string): SqliteRepository {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return new SqliteRepository(sqlite, db);
}

export class SqliteRepository implements Repository {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly db: Db,
  ) {}

  async createRoom(room: Room): Promise<void> {
    try {
      this.db.insert(schema.rooms).values(room).run();
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('SLUG_TAKEN', `Room slug "${room.slug}" is taken`);
      throw err;
    }
  }

  async findRoom(idOrSlug: string): Promise<Room | undefined> {
    const row = this.db
      .select()
      .from(schema.rooms)
      .where(or(eq(schema.rooms.id, idOrSlug), eq(schema.rooms.slug, idOrSlug)))
      .get();
    return row as Room | undefined;
  }

  async updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): Promise<void> {
    this.db.update(schema.rooms).set(patch).where(eq(schema.rooms.id, id)).run();
  }

  async createParticipant(participant: Participant): Promise<void> {
    this.db.insert(schema.participants).values(participant).run();
  }

  async findParticipant(id: string): Promise<Participant | undefined> {
    const row = this.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, id))
      .get();
    return row as Participant | undefined;
  }

  async listParticipants(roomId: string): Promise<Participant[]> {
    const rows = this.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.roomId, roomId))
      .orderBy(schema.participants.joinedAt)
      .all();
    return rows as Participant[];
  }

  async updateParticipant(
    id: string,
    patch: Partial<Omit<Participant, 'id' | 'roomId'>>,
  ): Promise<void> {
    this.db.update(schema.participants).set(patch).where(eq(schema.participants.id, id)).run();
  }

  async appendMessage(message: NewMessage): Promise<Message> {
    // better-sqlite3 transactions are synchronous, so seq allocation cannot interleave.
    return this.db.transaction((tx) => {
      const seq = this.maxSeq(tx, message.roomId) + 1;
      const row = { ...message, seq };
      tx.insert(schema.messages).values(row).run();
      return row;
    });
  }

  async currentSeq(roomId: string): Promise<number> {
    return this.maxSeq(this.db, roomId);
  }

  async listMessages(
    roomId: string,
    query: { afterSeq?: number; beforeSeq?: number; limit: number },
  ): Promise<Message[]> {
    const conds = [eq(schema.messages.roomId, roomId)];
    if (query.afterSeq !== undefined) conds.push(gt(schema.messages.seq, query.afterSeq));
    if (query.beforeSeq !== undefined) conds.push(lt(schema.messages.seq, query.beforeSeq));
    const newestFirst = query.afterSeq === undefined;
    const rows = this.db
      .select()
      .from(schema.messages)
      .where(and(...conds))
      .orderBy(newestFirst ? desc(schema.messages.seq) : schema.messages.seq)
      .limit(query.limit)
      .all() as Message[];
    return newestFirst ? rows.reverse() : rows;
  }

  async insertReplyToken(token: ReplyToken): Promise<void> {
    this.db.insert(schema.replyTokens).values(token).run();
  }

  async consumeReplyToken(tokenHash: string, now: number): Promise<ReplyToken | undefined> {
    const row = this.db
      .update(schema.replyTokens)
      .set({ consumedAt: now })
      .where(
        and(eq(schema.replyTokens.tokenHash, tokenHash), isNull(schema.replyTokens.consumedAt)),
      )
      .returning()
      .get();
    return row;
  }

  async deleteExpiredReplyTokens(now: number): Promise<void> {
    this.db.delete(schema.replyTokens).where(lt(schema.replyTokens.expiresAt, now)).run();
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }

  private maxSeq(db: Pick<Db, 'select'>, roomId: string): number {
    const row = db
      .select({ max: sql<number | null>`max(${schema.messages.seq})` })
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .get();
    return row?.max ?? 0;
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  return [code, causeCode].some((c) => c === 'SQLITE_CONSTRAINT_UNIQUE');
}
