import type {
  MessageKind,
  ParticipantStatus,
  Role,
  RoomStatus,
  RoomType,
  SenderType,
  Stage,
} from './enums.js';
import type { ClientInfo, Evidence, RepoInfo } from './schemas.js';

/** Wire-level shapes returned to agents and browsers (snake_case, ISO timestamps). */

export interface MessageView {
  seq: number;
  sender_type: SenderType;
  participant_id: string | null;
  sender: string;
  kind: MessageKind;
  content: string;
  mentions: string[];
  reply_to_seq: number | null;
  evidence: Evidence[];
  ready: boolean;
  created_at: string;
}

export interface MemberView {
  participant_id: string;
  role: Role;
  display_name: string;
  status: ParticipantStatus;
  repo: RepoInfo | null;
  client: ClientInfo | null;
}

export interface RoomView {
  id: string;
  slug: string;
  title: string;
  type: RoomType;
  stage: Stage;
  status: RoomStatus;
  host: { participant_id: string; display_name: string } | null;
}

export interface BoardSectionView {
  key: string;
  content: string;
  version: number;
  updated_by: string;
  updated_at: string;
}

export interface RoomSummaryView extends RoomView {
  member_count: number;
  last_message_at: string | null;
  created_at: string;
}

export type MemberStatusView = Pick<
  MemberView,
  'participant_id' | 'role' | 'display_name' | 'status'
> & {
  /** Posted ready=true during the current stage. */
  ready: boolean;
};

export interface SyncContext {
  current_seq: number;
  reply_token: string;
}

export interface JoinResult {
  participant_id: string;
  room: RoomView;
  members: MemberView[];
  board_summary: Record<string, { version: number; excerpt: string }>;
  recent_messages: MessageView[];
  sync: SyncContext;
  rules: string;
  /** Present when room_join resumed an existing participant instead of creating one. */
  resumed?: {
    /** Messages from others since this participant was last synced. */
    missed_count: number;
    /** Seqs among them that mention this participant (or its role / @all). */
    mentioned_seqs: number[];
    /** Last seq the participant had seen before going away. */
    since_seq: number;
    hint: string;
  };
}

export interface WaitResult {
  messages: MessageView[];
  has_more: boolean;
  timed_out: boolean;
  sync: SyncContext;
  stage: Stage;
  room_status: RoomStatus;
  members_status: MemberStatusView[];
  hint?: string;
}

export interface PostResult {
  seq: number;
  sync: SyncContext;
  /** Kinds of secrets that were masked before storing, if any. */
  redacted?: string[];
  /** Heads-up about the message, e.g. mentioned members that are offline. */
  notice?: string;
}

export interface BoardUpdateResult {
  key: string;
  version: number;
  redacted?: string[];
}

export interface ListResult {
  messages: MessageView[];
  has_more: boolean;
}
