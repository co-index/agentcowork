import { z } from 'zod';
import { PostableKindSchema, RoleSchema, RoomTypeSchema } from './enums.js';

export const LIMITS = {
  slugMax: 64,
  titleMax: 200,
  displayNameMax: 64,
  contentMax: 20_000,
  requirementMax: 50_000,
  mentionsMax: 20,
  evidenceMax: 20,
  listMax: 200,
} as const;

export const SlugSchema = z
  .string()
  .min(1)
  .max(LIMITS.slugMax)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'slug may contain letters, digits, ".", "_" and "-"');

export const RepoInfoSchema = z.object({
  name: z.string().min(1).max(200),
  remote_url: z.string().max(500).optional(),
  branch: z.string().max(200).optional(),
  worktree: z.string().max(500).optional(),
  head_commit: z.string().max(64).optional(),
});
export type RepoInfo = z.infer<typeof RepoInfoSchema>;

export const ClientInfoSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().max(50).optional(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const EvidenceSchema = z.object({
  repo: z.string().max(200).optional(),
  path: z.string().min(1).max(500),
  lines: z.string().max(50).optional(),
  commit: z.string().max(64).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Fields shared by room_create (creator auto-joins) and room_join. */
export const JoinFields = {
  role: RoleSchema.describe('Your role in the room, e.g. frontend / backend / custom:<name>'),
  display_name: z.string().min(1).max(LIMITS.displayNameMax).optional(),
  repo: RepoInfoSchema.optional().describe('The git repository / worktree you are working in'),
  client: ClientInfoSchema.optional().describe('Your agent client, e.g. { name: "claude-code" }'),
};

export const RoomCreateInput = z.object({
  title: z.string().min(1).max(LIMITS.titleMax),
  type: RoomTypeSchema.default('feature'),
  slug: SlugSchema.optional().describe('Human-friendly id such as REQ-123; generated if omitted'),
  requirement: z
    .string()
    .max(LIMITS.requirementMax)
    .optional()
    .describe('Requirement text or bug description; posted as the first message'),
  ...JoinFields,
});
export type RoomCreateInput = z.infer<typeof RoomCreateInput>;

export const RoomJoinInput = z.object({
  room: z.string().min(1).describe('Room slug or id'),
  ...JoinFields,
});
export type RoomJoinInput = z.infer<typeof RoomJoinInput>;

const ParticipantRef = {
  room: z.string().min(1).describe('Room slug or id'),
  participant_id: z.string().min(1).describe('Your participant_id returned by room_join'),
};

export const RoomLeaveInput = z.object({
  ...ParticipantRef,
  summary: z.string().max(LIMITS.contentMax).optional(),
});
export type RoomLeaveInput = z.infer<typeof RoomLeaveInput>;

export const MsgWaitInput = z.object({
  ...ParticipantRef,
  after_seq: z.number().int().min(0).describe('Return messages with seq greater than this'),
  timeout_seconds: z.number().int().min(1).optional(),
  only_when_mentioned: z
    .boolean()
    .optional()
    .describe('Only wake up when you (or your role) are mentioned or a human speaks'),
});
export type MsgWaitInput = z.infer<typeof MsgWaitInput>;

export const MsgPostInput = z.object({
  ...ParticipantRef,
  content: z.string().min(1).max(LIMITS.contentMax),
  kind: PostableKindSchema.default('chat'),
  mentions: z
    .array(z.string().min(1).max(64))
    .max(LIMITS.mentionsMax)
    .optional()
    .describe('participant_id or role values'),
  reply_to_seq: z.number().int().min(1).optional(),
  evidence: z.array(EvidenceSchema).max(LIMITS.evidenceMax).optional(),
  ready: z.boolean().optional(),
  expected_last_seq: z.number().int().min(0),
  reply_token: z.string().min(1),
});
export type MsgPostInput = z.infer<typeof MsgPostInput>;

export const MsgListInput = z.object({
  room: z.string().min(1).describe('Room slug or id'),
  after_seq: z.number().int().min(0).optional(),
  before_seq: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(LIMITS.listMax).optional(),
});
export type MsgListInput = z.infer<typeof MsgListInput>;
