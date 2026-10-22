import type { MessageView } from '@agentcowork/shared';
import { describe, expect, it } from 'vitest';
import { mergeMessages, relativeTime, sortBoardKeys, stageProgress } from '../src/lib/format';
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

describe('stripToken', () => {
  it('keeps the route and drops the token', () => {
    expect(stripToken('#token=abc')).toBe('');
    expect(stripToken('#token=abc&/rooms/REQ-1')).toBe('#/rooms/REQ-1');
    expect(stripToken('#/rooms/REQ-1&token=abc')).toBe('#/rooms/REQ-1');
    expect(stripToken('#/rooms/REQ-1')).toBe('#/rooms/REQ-1');
  });
});
