import type { ClientInfo, Evidence, RepoInfo } from '@agentcowork/shared';
import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// Board tables (board_sections, board_history) arrive in M2; users / access_tokens / room_members in M3.

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  stage: text('stage').notNull(),
  status: text('status').notNull(),
  hostParticipantId: text('host_participant_id'),
  createdBy: text('created_by').notNull(),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at').notNull(),
  closedAt: integer('closed_at'),
});

export const participants = sqliteTable(
  'participants',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    displayName: text('display_name').notNull(),
    repo: text('repo', { mode: 'json' }).$type<RepoInfo>(),
    client: text('client', { mode: 'json' }).$type<ClientInfo>(),
    status: text('status').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    joinedAt: integer('joined_at').notNull(),
    leftAt: integer('left_at'),
    leaveSummary: text('leave_summary'),
  },
  (t) => [index('participants_room_idx').on(t.roomId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    seq: integer('seq').notNull(),
    senderType: text('sender_type').notNull(),
    participantId: text('participant_id'),
    userId: text('user_id'),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    mentions: text('mentions', { mode: 'json' }).$type<string[]>().notNull(),
    replyToSeq: integer('reply_to_seq'),
    evidence: text('evidence', { mode: 'json' }).$type<Evidence[]>().notNull(),
    ready: integer('ready', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [unique('messages_room_seq_uq').on(t.roomId, t.seq)],
);

export const replyTokens = sqliteTable(
  'reply_tokens',
  {
    tokenHash: text('token_hash').notNull(),
    participantId: text('participant_id').notNull(),
    roomId: text('room_id').notNull(),
    issuedAtSeq: integer('issued_at_seq').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (t) => [primaryKey({ columns: [t.tokenHash] }), index('reply_tokens_expiry_idx').on(t.expiresAt)],
);
