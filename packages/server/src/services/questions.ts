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
 * message with reply_to_seq pointing at the question.
 */
export class Questions {
  constructor(private readonly repo: Repository) {}

  async pending(roomId: string): Promise<PendingQuestion[]> {
    const questions = await this.repo.listQuestions(roomId);
    if (questions.length === 0) return [];
    const [replies, members] = await Promise.all([
      this.repo.listReplies(
        roomId,
        questions.map((q) => q.seq),
      ),
      this.repo.listParticipants(roomId),
    ]);
    const byId = new Map(members.map((m) => [m.id, m]));
    const out: PendingQuestion[] = [];
    for (const question of questions) {
      const asker = question.participantId ? byId.get(question.participantId) : undefined;
      const repliers = replies
        .filter((r) => r.replyToSeq === question.seq && r.participantId)
        .map((r) => byId.get(r.participantId!))
        .filter((p): p is Participant => p !== undefined);
      const waitingOn = [...new Set(question.mentions)].filter(
        (target) =>
          target !== BROADCAST &&
          target !== asker?.id &&
          target !== asker?.role &&
          // A participant addressed by id who has left can never answer.
          byId.get(target)?.status !== 'left' &&
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
