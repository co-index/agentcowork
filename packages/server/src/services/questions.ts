import { BROADCAST, type Message, type Participant } from '../domain/models.js';
import type { Repository } from './ports.js';

export interface PendingQuestion {
  message: Message;
  /** Mention targets (participant id or role) that have not replied yet. */
  waitingOn: string[];
}

/**
 * Unanswered questions (design 9.2), derived from the message log: a kind=question message owes
 * one reply per mention target, and a target has replied once a participant matching it posts a
 * message with reply_to_seq pointing at the question, or citing it as "seq N" in the text (one
 * message often answers several questions). A human reply resolves the whole question.
 */
export class Questions {
  constructor(private readonly repo: Repository) {}

  async pending(roomId: string): Promise<PendingQuestion[]> {
    const questions = await this.repo.listQuestions(roomId);
    if (questions.length === 0) return [];
    const [later, members] = await Promise.all([
      this.repo.listMessages(roomId, { afterSeq: questions[0]!.seq, limit: 100_000 }),
      this.repo.listParticipants(roomId),
    ]);
    const replies = later.filter((m) => m.senderType !== 'system');
    const byId = new Map(members.map((m) => [m.id, m]));
    const out: PendingQuestion[] = [];
    for (const question of questions) {
      const thread = replies.filter(
        (r) => r.seq > question.seq && (r.replyToSeq === question.seq || cites(r, question.seq)),
      );
      if (thread.some((r) => r.senderType === 'human')) continue;
      const asker = question.participantId ? byId.get(question.participantId) : undefined;
      const repliers = thread
        .filter((r) => r.participantId)
        .map((r) => byId.get(r.participantId!))
        .filter((p): p is Participant => p !== undefined);
      const waitingOn = [...new Set(question.mentions)].filter(
        (target) =>
          target !== BROADCAST &&
          target !== asker?.id &&
          target !== asker?.role &&
          !repliers.some((p) => p.id === target || p.role === target),
      );
      if (waitingOn.length > 0) out.push({ message: question, waitingOn });
    }
    return out;
  }

  /** Pending questions that `participant` still owes an answer to (by id or role). */
  async owedBy(participant: Participant): Promise<Message[]> {
    return (await this.pending(participant.roomId))
      .filter((q) => owes(q, participant))
      .map((q) => q.message);
  }
}

export function owes(question: PendingQuestion, participant: Participant): boolean {
  return question.waitingOn.some((t) => t === participant.id || t === participant.role);
}

/** True if the message text cites `seq` as "seq N" (not "#N", which agents use for list items). */
function cites(message: Message, seq: number): boolean {
  for (const match of message.content.matchAll(/\bseq\s*(\d+)/gi)) {
    if (Number(match[1]) === seq) return true;
  }
  return false;
}
