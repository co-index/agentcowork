import type { MessageView } from '@agentcowork/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomDetail } from '../lib/api';
import { relativeTime, roleColor } from '../lib/format';
import { Markdown } from './Markdown';

const KIND_LABELS: Record<string, string> = {
  report: '报告',
  question: '提问',
  answer: '回答',
  proposal: '方案',
  objection: '反对',
  decision: '决定',
};

interface Props {
  messages: MessageView[];
  members: RoomDetail['members'];
  hasOlder: boolean;
  onLoadOlder: () => void;
}

export function Thread({ messages, members, hasOlder, onLoadOlder }: Props) {
  const [role, setRole] = useState('');
  const roleOf = useMemo(() => new Map(members.map((m) => [m.participant_id, m.role])), [members]);
  const roles = useMemo(() => [...new Set(members.map((m) => m.role))], [members]);
  const visible = role
    ? messages.filter((m) => m.participant_id && roleOf.get(m.participant_id) === role)
    : messages;

  // Stick to the bottom while the reader is already there.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">讨论</h2>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          按角色筛选
          <select
            className="rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">全部</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {hasOlder && !role && (
          <button
            onClick={onLoadOlder}
            className="mx-auto block text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            加载更早的消息
          </button>
        )}
        {visible.map((m) => (
          <MessageItem
            key={m.seq}
            m={m}
            role={m.participant_id ? roleOf.get(m.participant_id) : undefined}
          />
        ))}
        {visible.length === 0 && <p className="text-center text-sm text-zinc-500">暂无消息</p>}
      </div>
    </section>
  );
}

function MessageItem({ m, role }: { m: MessageView; role?: string }) {
  if (m.sender_type === 'system') {
    return (
      <div className="flex gap-2 text-xs text-zinc-500">
        <span className="tabular-nums text-zinc-400">#{m.seq}</span>
        <div className="min-w-0 flex-1 whitespace-pre-wrap">{m.content}</div>
      </div>
    );
  }
  const human = m.sender_type === 'human';
  return (
    <article
      className={`rounded-lg border px-3 py-2 ${
        human
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
          : m.kind === 'objection'
            ? 'border-rose-200 bg-white dark:border-rose-900 dark:bg-zinc-900'
            : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
      }`}
    >
      <header className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="tabular-nums text-zinc-400">#{m.seq}</span>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{m.sender}</span>
        {human && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            人类
          </span>
        )}
        {role && <span className={`rounded px-1.5 py-0.5 ${roleColor(role)}`}>{role}</span>}
        {KIND_LABELS[m.kind] && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {KIND_LABELS[m.kind]}
          </span>
        )}
        {m.reply_to_seq && <span className="text-zinc-500">回复 #{m.reply_to_seq}</span>}
        {m.mentions.length > 0 && <span className="text-zinc-500">@{m.mentions.join(' @')}</span>}
        {m.ready && <span className="text-emerald-600 dark:text-emerald-400">✓ ready</span>}
        <time className="ml-auto text-zinc-400" dateTime={m.created_at} title={m.created_at}>
          {relativeTime(m.created_at)}
        </time>
      </header>
      <Markdown text={m.content} />
      {m.evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-zinc-100 pt-1.5 text-xs text-zinc-500 dark:border-zinc-800">
          {m.evidence.map((e, i) => (
            <li key={i} className="font-mono">
              {e.repo ? `${e.repo}:` : ''}
              {e.path}
              {e.lines ? `#${e.lines}` : ''}
              {e.commit ? ` @ ${e.commit.slice(0, 8)}` : ''}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
