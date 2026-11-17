import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupSqliteDatabase, openSqliteRepository } from '../src/infra/db/sqlite-repository.js';
import type { Room } from '../src/domain/models.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('SQLite backup', () => {
  it('copies a consistent database while the source is open', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentcowork-backup-'));
    directories.push(directory);
    const sourcePath = join(directory, 'source.db');
    const backupPath = join(directory, 'backup', 'snapshot.db');
    const source = openSqliteRepository(sourcePath);
    const room: Room = {
      id: 'r_backup',
      slug: 'REQ-BACKUP',
      title: 'Backup test',
      type: 'feature',
      stage: 'briefing',
      status: 'open',
      hostParticipantId: null,
      createdBy: 'u_test',
      settings: {},
      stageStartedSeq: 0,
      budgetStartSeq: 0,
      lastMessageAt: 1,
      createdAt: 1,
      closedAt: null,
    };
    await source.createRoom(room);

    await backupSqliteDatabase(sourcePath, backupPath);
    const restored = openSqliteRepository(backupPath);
    expect(await restored.findRoom('REQ-BACKUP')).toMatchObject({ title: 'Backup test' });

    await restored.close();
    await source.close();
  });

  it('rejects in-memory databases and overwriting the source', async () => {
    await expect(backupSqliteDatabase(':memory:', '/tmp/agentcowork-test.db')).rejects.toThrow(
      'in-memory',
    );
    await expect(
      backupSqliteDatabase('/tmp/agentcowork-test.db', '/tmp/agentcowork-test.db'),
    ).rejects.toThrow('differ');
  });
});
