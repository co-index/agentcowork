import type { SyncContext } from '@agentcowork/shared';
import type { Participant, ReplyToken } from '../domain/models.js';
import { randomToken, sha256 } from './ids.js';
import type { Clock, Repository } from './ports.js';

export const REPLY_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Issues and redeems the single-use tokens that enforce strict sync (design 8.2). */
export class ReplyTokens {
  constructor(
    private readonly repo: Repository,
    private readonly clock: Clock,
  ) {}

  async issue(participant: Participant, seenSeq: number): Promise<SyncContext> {
    const now = this.clock.now();
    const token = `rt_${randomToken(20)}`;
    await this.repo.deleteExpiredReplyTokens(now);
    await this.repo.insertReplyToken({
      tokenHash: sha256(token),
      participantId: participant.id,
      roomId: participant.roomId,
      issuedAtSeq: seenSeq,
      expiresAt: now + REPLY_TOKEN_TTL_MS,
      consumedAt: null,
    });
    // Handing out a sync means the participant has now been shown everything up to seenSeq.
    await this.repo.bumpLastSeenSeq(participant.id, seenSeq);
    return { current_seq: seenSeq, reply_token: token };
  }

  /** Consumes the token; returns it only if it belongs to this participant and is unexpired. */
  async redeem(participant: Participant, token: string): Promise<ReplyToken | undefined> {
    const now = this.clock.now();
    const row = await this.repo.consumeReplyToken(sha256(token), now);
    if (!row) return undefined;
    if (row.participantId !== participant.id || row.roomId !== participant.roomId) return undefined;
    if (row.expiresAt <= now) return undefined;
    return row;
  }
}
