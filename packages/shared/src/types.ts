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

export interface SyncContext {
  current_seq: number;
  reply_token: string;
}

export interface JoinResult {
  participant_id: string;
  room: RoomView;
  members: MemberView[];
  recent_messages: MessageView[];
  sync: SyncContext;
  rules: string;
}

export interface WaitResult {
  messages: MessageView[];
  has_more: boolean;
  timed_out: boolean;
  sync: SyncContext;
  stage: Stage;
  room_status: RoomStatus;
  members_status: Pick<MemberView, 'participant_id' | 'role' | 'display_name' | 'status'>[];
  hint?: string;
}

export interface PostResult {
  seq: number;
  sync: SyncContext;
}

export interface ListResult {
  messages: MessageView[];
  has_more: boolean;
}
