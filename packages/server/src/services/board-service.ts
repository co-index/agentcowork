import type {
  BoardGetInput,
  BoardSectionView,
  BoardUpdateInput,
  BoardUpdateResult,
} from '@agentcowork/shared';
import { AppError } from '../domain/errors.js';
import {
  actorLabel,
  actorRef,
  type Actor,
  type BoardSection,
  type Principal,
  type Room,
} from '../domain/models.js';
import { redact } from '../security/redact.js';
import type { Access } from './access.js';
import type { Clock, Repository } from './ports.js';
import type { Thread } from './thread.js';
import { nameIndex } from './views.js';

const EXCERPT_CHARS = 160;

export class BoardService {
  constructor(
    private readonly repo: Repository,
    private readonly access: Access,
    private readonly thread: Thread,
    private readonly clock: Clock,
  ) {}

  async get(input: BoardGetInput): Promise<{ sections: Record<string, BoardSectionView> }> {
    const room = await this.access.requireRoom(input.room);
    const sections = await this.repo.listBoard(room.id, input.keys);
    const names = nameIndex(await this.repo.listParticipants(room.id));
    return {
      sections: Object.fromEntries(sections.map((s) => [s.key, toSectionView(s, names)])),
    };
  }

  async history(roomRef: string, key: string): Promise<{ versions: BoardSectionView[] }> {
    const room = await this.access.requireRoom(roomRef);
    const versions = await this.repo.listBoardHistory(room.id, key);
    const names = nameIndex(await this.repo.listParticipants(room.id));
    return { versions: versions.map((s) => toSectionView(s, names)) };
  }

  /** Optimistic update: fails with VERSION_CONFLICT (carrying the current section) if stale. */
  async update(
    actor: Actor,
    roomId: string,
    input: { key: string; content: string; base_version: number },
    opts: { announce?: boolean } = {},
  ): Promise<BoardUpdateResult> {
    const { text, kinds } = redact(input.content);
    const result = await this.repo.writeBoardSection(
      {
        roomId,
        key: input.key,
        content: text,
        updatedBy: actorRef(actor),
        updatedAt: this.clock.now(),
      },
      input.base_version,
    );
    if (!result.ok) {
      const names = nameIndex(await this.repo.listParticipants(roomId));
      throw new AppError(
        'VERSION_CONFLICT',
        `Section "${input.key}" is at version ${result.current?.version ?? 0}, not ${input.base_version}. ` +
          'Merge your change into the current content and retry with its version.',
        { current: result.current ? toSectionView(result.current, names) : null },
      );
    }
    if (opts.announce === false) {
      return {
        key: input.key,
        version: result.section.version,
        ...(kinds.length ? { redacted: kinds } : {}),
      };
    }
    await this.thread.system(
      roomId,
      `${actorLabel(actor)} updated board section "${input.key}" (v${result.section.version}).`,
    );
    return {
      key: input.key,
      version: result.section.version,
      ...(kinds.length ? { redacted: kinds } : {}),
    };
  }

  async updateByAgent(principal: Principal, input: BoardUpdateInput): Promise<BoardUpdateResult> {
    const { room, participant } = await this.access.requireParticipant(
      principal,
      input.room,
      input.participant_id,
    );
    assertWritable(room);
    return this.update({ kind: 'agent', principal, participant }, room.id, input);
  }

  async updateByHuman(
    principal: Principal,
    roomRef: string,
    name: string,
    input: { key: string; content: string; base_version: number },
  ): Promise<BoardUpdateResult> {
    const room = await this.access.requireRoom(roomRef);
    assertWritable(room);
    return this.update({ kind: 'human', principal, name }, room.id, input);
  }

  /** Version and first characters of every section, for room_join. */
  async summary(roomId: string): Promise<Record<string, { version: number; excerpt: string }>> {
    const sections = await this.repo.listBoard(roomId);
    return Object.fromEntries(
      sections.map((s) => [
        s.key,
        {
          version: s.version,
          excerpt:
            s.content.length > EXCERPT_CHARS ? `${s.content.slice(0, EXCERPT_CHARS)}…` : s.content,
        },
      ]),
    );
  }
}

function assertWritable(room: Room) {
  if (room.status === 'closed' || room.status === 'archived') {
    throw new AppError('ROOM_CLOSED', `Room is ${room.status}`);
  }
}

function toSectionView(s: BoardSection, names: Map<string, string>): BoardSectionView {
  const updatedBy = s.updatedBy.startsWith('human:')
    ? `${s.updatedBy.slice('human:'.length)} (human)`
    : (names.get(s.updatedBy) ?? s.updatedBy);
  return {
    key: s.key,
    content: s.content,
    version: s.version,
    updated_by: updatedBy,
    updated_at: new Date(s.updatedAt).toISOString(),
  };
}
