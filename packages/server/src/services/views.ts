import type { MemberView, MessageView, RoomView } from '@agentcowork/shared';
import type { Message, Participant, Room } from '../domain/models.js';

export function toMessageView(message: Message, names: Map<string, string>): MessageView {
  const sender =
    message.senderType === 'system'
      ? 'system'
      : message.participantId
        ? (names.get(message.participantId) ?? message.participantId)
        : (message.userId ?? message.senderType);
  return {
    seq: message.seq,
    sender_type: message.senderType,
    participant_id: message.participantId,
    sender,
    kind: message.kind,
    content: message.content,
    mentions: message.mentions,
    reply_to_seq: message.replyToSeq,
    evidence: message.evidence,
    ready: message.ready,
    created_at: new Date(message.createdAt).toISOString(),
  };
}

export function toMemberView(p: Participant): MemberView {
  return {
    participant_id: p.id,
    role: p.role,
    display_name: p.displayName,
    status: p.status,
    repo: p.repo,
    client: p.client,
  };
}

export function toMemberStatus(p: Participant) {
  return { participant_id: p.id, role: p.role, display_name: p.displayName, status: p.status };
}

export function toRoomView(room: Room, members: Participant[]): RoomView {
  const host = members.find((p) => p.id === room.hostParticipantId);
  return {
    id: room.id,
    slug: room.slug,
    title: room.title,
    type: room.type,
    stage: room.stage,
    status: room.status,
    host: host ? { participant_id: host.id, display_name: host.displayName } : null,
  };
}

export function nameIndex(members: Participant[]): Map<string, string> {
  return new Map(members.map((p) => [p.id, p.displayName]));
}
