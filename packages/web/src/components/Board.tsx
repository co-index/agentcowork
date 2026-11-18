import type { BoardSectionView } from '@agentcowork/shared';
import { useState } from 'react';
import { ApiError, type Api } from '../lib/api';
import { relativeTime, sortBoardKeys } from '../lib/format';
import { Markdown } from './Markdown';

export function Board({
  api,
  slug,
  sections,
  onChanged,
}: {
  api: Api;
  slug: string;
  sections: Record<string, BoardSectionView>;
  onChanged: () => void;
}) {
  const keys = sortBoardKeys(Object.keys(sections));
  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">结论板</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {keys.length === 0 && (
          <p className="text-sm text-zinc-500">还没有内容。可以新建一个 Board section。</p>
        )}
        {keys.map((key) => (
          <Section key={key} api={api} slug={slug} section={sections[key]!} onChanged={onChanged} />
        ))}
        <NewSection api={api} slug={slug} onChanged={onChanged} />
      </div>
    </section>
  );
}

function Section({
  api,
  slug,
  section,
  onChanged,
}: {
  api: Api;
  slug: string;
  section: BoardSectionView;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  /** Edit draft: copied from the section when editing starts, with the version it is based on. */
  const [draft, setDraft] = useState<{ content: string; baseVersion: number } | null>(null);
  /** Newer content written by someone else while editing (VERSION_CONFLICT). */
  const [conflict, setConflict] = useState<BoardSectionView | null>(null);
  const editing = draft !== null;
  const [history, setHistory] = useState<BoardSectionView[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startEdit = () => {
    setDraft({ content: section.content, baseVersion: section.version });
    setConflict(null);
    setNotice(null);
  };
  const cancelEdit = () => {
    setDraft(null);
    setConflict(null);
    setNotice(null);
  };

  const save = async () => {
    if (!draft) return;
    try {
      // Based on the version the draft was copied from, so newer edits are never overwritten.
      await api.updateBoard(slug, section.key, {
        content: draft.content,
        base_version: draft.baseVersion,
      });
      cancelEdit();
      onChanged();
    } catch (err) {
      const current = err instanceof ApiError ? (err.data.current as BoardSectionView) : undefined;
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT' && current) {
        setConflict(current);
        setDraft({ content: draft.content, baseVersion: current.version });
        setNotice(
          `编辑期间 ${current.updated_by} 已改到 v${current.version}。请对照下方最新内容合并后再保存`,
        );
        onChanged();
      } else {
        setNotice(err instanceof ApiError ? err.message : '保存失败');
      }
    }
  };

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
        <button
          onClick={() => (editing ? cancelEdit() : startEdit())}
          className="text-zinc-500 hover:underline"
        >
          {editing ? '取消' : '编辑'}
        </button>
        {section.version > 1 && (
          <button onClick={() => void toggleHistory()} className="text-zinc-500 hover:underline">
            {history ? '收起历史' : '历史'}
          </button>
        )}
      </header>
      {open && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {editing ? (
            <>
              <textarea
                className="min-h-32 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                maxLength={50000}
                aria-label={`${section.key} 内容`}
              />
              {conflict && (
                <details
                  open
                  className="mt-2 rounded border border-amber-300 p-2 text-sm dark:border-amber-800"
                >
                  <summary className="cursor-pointer text-xs text-amber-800 dark:text-amber-300">
                    最新内容 v{conflict.version}（{conflict.updated_by}）
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                    {conflict.content}
                  </pre>
                </details>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => void save()}
                  className="rounded bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  保存
                </button>
                {notice && <span className="text-xs text-rose-600">{notice}</span>}
              </div>
            </>
          ) : (
            <Markdown text={section.content} />
          )}
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

function NewSection({ api, slug, onChanged }: { api: Api; slug: string; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    try {
      await api.updateBoard(slug, key.trim(), { content, base_version: 0 });
      setKey('');
      setContent('');
      setOpen(false);
      setNotice(null);
      onChanged();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '保存失败');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-left text-sm text-zinc-500 hover:underline"
      >
        + 新建 Board section
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <input
        className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm font-mono dark:border-zinc-700"
        placeholder="例如 contract 或 plan.frontend"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        aria-label="Board section key"
      />
      <textarea
        className="min-h-24 w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        placeholder="Markdown 内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={50000}
        aria-label="新 Board section 内容"
      />
      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          disabled={!key.trim()}
          className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          创建
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:underline">
          取消
        </button>
        {notice && <span className="text-xs text-rose-600">{notice}</span>}
      </div>
    </div>
  );
}
