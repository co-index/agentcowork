import type {
  ClientInfo,
  Evidence,
  MessageKind,
  ParticipantStatus,
  RepoInfo,
  Role,
  RoomStatus,
  RoomType,
  SenderType,
  Stage,
} from '@agentcowork/shared';

/** Internal entities (camelCase, epoch-ms timestamps). Wire shapes live in services/views.ts. */

export interface Room {
  id: string;
  slug: string;
  title: string;
  type: RoomType;
  stage: Stage;
  status: RoomStatus;
  hostParticipantId: string | null;
  createdBy: string;
  settings: Record<string, unknown>;
  stageStartedSeq: number;
  budgetStartSeq: number;
  lastMessageAt: number;
  createdAt: number;
  closedAt: number | null;
}

export interface Participant {
  id: string;
  roomId: string;
  userId: string;
  role: Role;
  displayName: string;
  repo: RepoInfo | null;
  client: ClientInfo | null;
  status: ParticipantStatus;
  lastSeenAt: number;
  lastSeenSeq: number;
  joinedAt: number;
  leftAt: number | null;
  leaveSummary: string | null;
}

export interface Message {
  id: string;
  roomId: string;
  seq: number;
  senderType: SenderType;
  participantId: string | null;
  userId: string | null;
  senderName: string | null;
  kind: MessageKind;
  content: string;
  mentions: string[];
  replyToSeq: number | null;
  evidence: Evidence[];
  ready: boolean;
  createdAt: number;
}

export type NewMessage = Omit<Message, 'seq'>;

export interface BoardSection {
  roomId: string;
  key: string;
  content: string;
  version: number;
  /** participant_id of an agent, or "human:<name>". */
  updatedBy: string;
  updatedAt: number;
}

export interface ReplyToken {
  tokenHash: string;
  participantId: string;
  roomId: string;
  issuedAtSeq: number;
  expiresAt: number;
  consumedAt: number | null;
}

/** Who is calling: resolved from the Bearer token by an AuthProvider. */
export interface Principal {
  userId: string;
  name: string;
  scope: 'host' | 'personal';
}

/** client.name of the seat a human gets when creating a room in the Web UI (no agent behind it). */
export const WEB_CLIENT = 'web';

/** Mention that addresses every participant. */
export const BROADCAST = '@all';

/** The creator's seat of a Web-created room: a human at a browser, no agent behind it. */
export function isWebSeat(participant: Pick<Participant, 'client'>): boolean {
  return participant.client?.name === WEB_CLIENT;
}

/** Same checkout: worktree when both know it, else repository name, else both unspecified. */
export function sameRepo(a: RepoInfo | null, b: RepoInfo | null): boolean {
  if (!a || !b) return !a && !b;
  if (a.worktree && b.worktree) return a.worktree === b.worktree;
  return a.name === b.name;
}

/** "@backend" -> "backend", "all" / "@all" -> "@all"; trims and drops duplicates. */
export function normalizeMentions(mentions: readonly string[]): string[] {
  const out = mentions
    .map((m) => m.trim())
    .map((m) => (m === BROADCAST || m === 'all' ? BROADCAST : m.replace(/^@+/, '')))
    .filter((m) => m.length > 0);
  return [...new Set(out)];
}

/**
 * An informational system message (join, leave, board update): not addressed to "@all".
 * It neither makes a post stale nor wakes waiting agents (design 8.2).
 */
export function isNotice(message: Pick<Message, 'senderType' | 'mentions'>): boolean {
  return message.senderType === 'system' && !message.mentions.includes(BROADCAST);
}

/** True if `message` mentions the participant directly, by role, or via "@all". */
export function mentions(message: Message, participant: Participant): boolean {
  return message.mentions.some(
    (m) => m === participant.id || m === participant.role || m === BROADCAST,
  );
}

/** Who performs a write: an agent through its participant, or a human through the Web UI. */
export type Actor =
  | { kind: 'agent'; principal: Principal; participant: Participant }
  | { kind: 'human'; principal: Principal; name: string };

export function actorLabel(actor: Actor): string {
  return actor.kind === 'agent' ? actor.participant.displayName : `${actor.name} (human)`;
}

export function actorRef(actor: Actor): string {
  return actor.kind === 'agent' ? actor.participant.id : `human:${actor.name}`;
}
