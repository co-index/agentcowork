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
  kind: MessageKind;
  content: string;
  mentions: string[];
  replyToSeq: number | null;
  evidence: Evidence[];
  ready: boolean;
  createdAt: number;
}

export type NewMessage = Omit<Message, 'seq'>;

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

/** True if `message` mentions the participant directly or by role. */
export function mentions(message: Message, participant: Participant): boolean {
  return message.mentions.includes(participant.id) || message.mentions.includes(participant.role);
}
