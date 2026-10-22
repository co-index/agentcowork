import { z } from 'zod';

export const ROOM_TYPES = ['feature', 'bug'] as const;
export const RoomTypeSchema = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const FEATURE_STAGES = [
  'briefing',
  'research',
  'discuss',
  'propose',
  'align',
  'finalize',
  'done',
] as const;
export const BUG_STAGES = ['report', 'investigate', 'locate', 'fix', 'verify', 'done'] as const;
export const StageSchema = z.enum([...FEATURE_STAGES, ...BUG_STAGES.filter((s) => s !== 'done')]);
export type Stage = z.infer<typeof StageSchema>;

export function initialStage(type: RoomType): Stage {
  return type === 'feature' ? FEATURE_STAGES[0] : BUG_STAGES[0];
}

export const ROOM_STATUSES = ['open', 'paused', 'closed', 'archived'] as const;
export const RoomStatusSchema = z.enum(ROOM_STATUSES);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const BUILTIN_ROLES = ['product', 'ui', 'frontend', 'backend', 'app', 'qa'] as const;
export const RoleSchema = z.union([
  z.enum(BUILTIN_ROLES),
  z.string().regex(/^custom:[a-z0-9][a-z0-9_-]{0,31}$/, 'custom roles look like "custom:<name>"'),
]);
export type Role = z.infer<typeof RoleSchema>;

export const PARTICIPANT_STATUSES = ['online', 'waiting', 'offline', 'left'] as const;
export const ParticipantStatusSchema = z.enum(PARTICIPANT_STATUSES);
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;

export const SENDER_TYPES = ['agent', 'human', 'system'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

/** Kinds an agent may post. `system` is reserved for the Hub itself. */
export const POSTABLE_KINDS = [
  'chat',
  'report',
  'question',
  'answer',
  'proposal',
  'objection',
  'decision',
] as const;
export const PostableKindSchema = z.enum(POSTABLE_KINDS);
export const MESSAGE_KINDS = [...POSTABLE_KINDS, 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Error codes returned by tools and REST endpoints. */
export const ERROR_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_ARGUMENT',
  'ROOM_CLOSED',
  'ROOM_PAUSED',
  'LIMIT_REACHED',
  'VERSION_CONFLICT',
  'SLUG_TAKEN',
  'NOT_A_PARTICIPANT',
  'STALE_CONTEXT',
  'TOKEN_INVALID',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
