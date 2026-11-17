import type { RoomSummaryView } from '@agentcowork/shared';
import { useEffect, useState } from 'react';
import type { Api } from '../lib/api';
import { relativeTime, STAGE_LABELS } from '../lib/format';

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  closed: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};
const STATUS_TEXT: Record<string, string> = { open: '进行中', paused: '已暂停', closed: '已关闭' };

export function RoomList({ api }: { api: Api }) {
  const [rooms, setRooms] = useState<RoomSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .rooms()
        .then((r) => setRooms(r.rooms))
        .catch((e: Error) => setError(e.message));
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [api]);

  const shown = (rooms ?? []).filter((r) => filter === 'all' || r.status !== 'closed');

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">房间</h1>
          <p className="mt-1 text-sm text-zinc-500">
            房间由 agent 通过 <code className="font-mono">room_create</code>{' '}
            创建；在这里旁观讨论、插话。
          </p>
        </div>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
          {(['active', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 ${filter === f ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400'}`}
            >
              {f === 'active' ? '进行中' : '全部'}
            </button>
          ))}
        </div>
        <a
          href="#/connect"
          className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700"
        >
          接入 Agent
        </a>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          新建房间
        </button>
      </div>
      {showCreate && <CreateRoom api={api} onCreated={() => setShowCreate(false)} />}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {rooms === null && !error && <p className="text-sm text-zinc-500">加载中…</p>}
      {rooms !== null && shown.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          还没有房间。点右上角“接入 Agent”配置好你的 agent，然后对它说：“开一个房间讨论
          &lt;需求&gt;，我是产品角色”。
        </div>
      )}
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {shown.map((r) => (
          <li key={r.id}>
            <a
              href={`#/rooms/${encodeURIComponent(r.slug)}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              <span className="font-mono text-sm text-zinc-500">{r.slug}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
              <span className="text-xs text-zinc-500">{r.type === 'bug' ? 'Bug' : '需求'}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {STAGE_LABELS[r.stage] ?? r.stage}
              </span>
              <span className="text-xs text-zinc-500">{r.member_count} 人</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? ''}`}>
                {STATUS_TEXT[r.status] ?? r.status}
              </span>
              <span className="w-20 text-right text-xs text-zinc-500">
                {relativeTime(r.last_message_at)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function CreateRoom({ api, onCreated }: { api: Api; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [requirement, setRequirement] = useState('');
  const [type, setType] = useState<'feature' | 'bug'>('feature');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.createRoom({
        title: title.trim(),
        requirement: requirement.trim() || undefined,
        type,
        role: 'product',
      });
      window.location.hash = `#/rooms/${encodeURIComponent(result.room.slug)}`;
      onCreated();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mb-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          placeholder="房间标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          aria-label="房间标题"
          autoFocus
        />
        <select
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          value={type}
          onChange={(e) => setType(e.target.value as 'feature' | 'bug')}
          aria-label="房间类型"
        >
          <option value="feature">需求</option>
          <option value="bug">Bug</option>
        </select>
      </div>
      <textarea
        className="min-h-20 w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        placeholder="需求或 Bug 描述（可选）"
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        maxLength={50000}
        aria-label="需求或 Bug 描述"
      />
      <div className="flex items-center gap-3">
        <button
          disabled={busy || !title.trim()}
          className="rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          创建并进入
        </button>
        {notice && <span className="text-sm text-rose-600">{notice}</span>}
      </div>
    </form>
  );
}
