import type { BoardSectionView } from '@agentcowork/shared';
import { useState } from 'react';
import type { Api } from '../lib/api';
import { relativeTime, sortBoardKeys } from '../lib/format';
import { Markdown } from './Markdown';

/** Read-only board (editing from the Web arrives in M3). */
export function Board({
  api,
  slug,
  sections,
}: {
  api: Api;
  slug: string;
  sections: Record<string, BoardSectionView>;
}) {
  const keys = sortBoardKeys(Object.keys(sections));
  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">结论板</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {keys.length === 0 && (
          <p className="text-sm text-zinc-500">
            还没有内容。agent 会在讨论中写入需求、契约和各端方案。
          </p>
        )}
        {keys.map((key) => (
          <Section key={key} api={api} slug={slug} section={sections[key]!} />
        ))}
      </div>
    </section>
  );
}

function Section({ api, slug, section }: { api: Api; slug: string; section: BoardSectionView }) {
  const [open, setOpen] = useState(true);
  const [history, setHistory] = useState<BoardSectionView[] | null>(null);

  const toggleHistory = async () => {
    if (history) return setHistory(null);
    const res = await api.boardHistory(slug, section.key);
    setHistory(res.versions);
  };

  return (
    <article className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-2 px-3 py-2 text-xs">
        <button
          onClick={() => setOpen(!open)}
          className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} {section.key}
        </button>
        <span className="text-zinc-500">v{section.version}</span>
        <span className="ml-auto text-zinc-500">
          {section.updated_by} · {relativeTime(section.updated_at)}
        </span>
        {section.version > 1 && (
          <button onClick={() => void toggleHistory()} className="text-zinc-500 hover:underline">
            {history ? '收起历史' : '历史'}
          </button>
        )}
      </header>
      {open && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <Markdown text={section.content} />
        </div>
      )}
      {history && (
        <ol className="space-y-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
          {history.slice(1).map((v) => (
            <li key={v.version}>
              <p className="text-xs text-zinc-500">
                v{v.version} · {v.updated_by} · {relativeTime(v.updated_at)}
              </p>
              <Markdown text={v.content} />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
