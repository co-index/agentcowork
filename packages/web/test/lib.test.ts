import type { MessageView } from '@agentcowork/shared';
import { describe, expect, it } from 'vitest';
import {
  absentConfirmText,
  mergeMessages,
  offlineFor,
  relativeTime,
  sortBoardKeys,
  stageProgress,
  targetLabel,
} from '../src/lib/format';
import { stripToken } from '../src/lib/api';
import { SseParser } from '../src/lib/sse';

const msg = (seq: number, content = `m${seq}`) => ({ seq, content }) as MessageView;

describe('SseParser', () => {
  it('parses events split across chunks and skips comments', () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\n\nevent: mess')).toEqual([]);
    expect(p.push('age\ndata: {"seq":1}\n\nevent: members\ndata: {}\n')).toEqual([
      { event: 'message', data: '{"seq":1}' },
    ]);
    expect(p.push('\n')).toEqual([{ event: 'members', data: '{}' }]);
  });

  it('joins multi-line data and handles CRLF', () => {
    const p = new SseParser();
    expect(p.push('data: a\r\ndata: b\r\n\r\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

describe('format helpers', () => {
  it('mergeMessages dedupes by seq and keeps order', () => {
    const merged = mergeMessages([msg(1), msg(3)], [msg(2), msg(3, 'new')]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(merged[2]!.content).toBe('new');
  });

  it('stageProgress locates the current stage', () => {
    expect(stageProgress(['a', 'b', 'done'], 'b')).toEqual({ index: 1, total: 3, done: false });
    expect(stageProgress(['a', 'done'], 'done').done).toBe(true);
  });

  it('sortBoardKeys follows the design order', () => {
    expect(
      sortBoardKeys([
        'todos',
        'plan.frontend',
        'contract',
        'requirement',
        'zzz',
        'context.backend',
      ]),
    ).toEqual(['requirement', 'context.backend', 'contract', 'plan.frontend', 'todos', 'zzz']);
  });

  it('relativeTime', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(relativeTime('2026-10-22T11:59:40Z', now)).toBe('刚刚');
    expect(relativeTime('2026-10-22T11:45:00Z', now)).toBe('15 分钟前');
    expect(relativeTime('2026-10-22T09:00:00Z', now)).toBe('3 小时前');
    expect(relativeTime(null, now)).toBe('—');
  });
});

describe('offline helpers', () => {
  const now = Date.parse('2026-11-17T10:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('formats how long a member has been offline', () => {
    expect(offlineFor(ago(10_000), now)).toBe('离线 1 分钟');
    expect(offlineFor(ago(12 * 60_000), now)).toBe('离线 12 分钟');
    expect(offlineFor(ago(3 * 3_600_000 + 5), now)).toBe('离线 3 小时');
    expect(offlineFor(ago(50 * 3_600_000), now)).toBe('离线 2 天');
  });

  it('labels mention targets by display name, keeping roles', () => {
    const members = [{ participant_id: 'p_1', display_name: 'frontend·bob' }];
    expect(targetLabel('p_1', members)).toBe('frontend·bob');
    expect(targetLabel('backend', members)).toBe('backend');
  });

  it('lists absent members and their unanswered questions before advancing', () => {
    const text = absentConfirmText(
      'align',
      [
        {
          participant_id: 'p_1',
          display_name: 'frontend·bob',
          role: 'frontend',
          last_seen_at: ago(20 * 60_000),
          pending_question_seqs: [12, 15],
        },
        {
          participant_id: 'p_2',
          display_name: 'app·carol',
          role: 'app',
          last_seen_at: ago(5 * 60_000),
          pending_question_seqs: [],
        },
      ],
      now,
    );
    expect(text).toContain(
      'frontend·bob（frontend）离线 20 分钟，还有 2 个点名的问题没回答（#12、#15）',
    );
    expect(text).toContain('app·carol（app）离线 5 分钟\n');
    expect(text).toMatch(/仍要推进吗/);
  });
});

describe('stripToken', () => {
  it('keeps the route and drops the token', () => {
    expect(stripToken('#token=abc')).toBe('');
    expect(stripToken('#token=abc&/rooms/REQ-1')).toBe('#/rooms/REQ-1');
    expect(stripToken('#/rooms/REQ-1&token=abc')).toBe('#/rooms/REQ-1');
    expect(stripToken('#/rooms/REQ-1')).toBe('#/rooms/REQ-1');
  });
});
