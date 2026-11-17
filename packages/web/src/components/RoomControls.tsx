import type { AbsentMemberView } from '@agentcowork/shared';
import { useState } from 'react';
import { ApiError, type Api } from '../lib/api';
import { absentConfirmText, STAGE_LABELS } from '../lib/format';

/** The user declined a confirmation; not an error to report. */
class Cancelled extends Error {}

const NAME_KEY = 'agentcowork.name';

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function RoomControls({
  api,
  slug,
  stages,
  currentStage,
  status,
  onChanged,
}: {
  api: Api;
  slug: string;
  stages: string[];
  currentStage: string;
  status: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState(storedName);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
      await action();
      setNotice(success);
      onChanged();
    } catch (err) {
      if (err instanceof Cancelled) setNotice('已取消');
      else setNotice(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /** Moving forward past offline members needs an explicit confirmation (design 9.2). */
  const setStage = async (stage: string) => {
    const who = name.trim() || 'Human';
    try {
      await api.setStage(slug, stage, who);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'MEMBERS_OFFLINE')) throw err;
      const offline = (err.data.offline ?? []) as AbsentMemberView[];
      if (!window.confirm(absentConfirmText(stage, offline))) throw new Cancelled();
      await api.setStage(slug, stage, who, true);
    }
  };

  if (status === 'closed') return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <span className="text-xs font-medium text-zinc-500">主持操作</span>
      <input
        className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="你的名字"
        aria-label="主持人名字"
        maxLength={64}
      />
      <select
        className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
        value={currentStage}
        disabled={busy}
        onChange={(e) => void run(() => setStage(e.target.value), '阶段已更新')}
        aria-label="房间阶段"
      >
        {stages.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage] ?? stage}
          </option>
        ))}
      </select>
      {status === 'paused' ? (
        <button
          className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
          disabled={busy}
          onClick={() => void run(() => api.resumeRoom(slug, name.trim() || 'Human'), '房间已恢复')}
        >
          恢复房间
        </button>
      ) : (
        <button
          className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950"
          disabled={busy}
          onClick={() => void run(() => api.pauseRoom(slug, name.trim() || 'Human'), '房间已暂停')}
        >
          暂停房间
        </button>
      )}
      <button
        className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
        disabled={busy}
        onClick={() => {
          if (window.confirm('确定关闭这个房间吗？关闭后 agent 不能继续发言。'))
            void run(() => api.closeRoom(slug, name.trim() || 'Human'), '房间已关闭');
        }}
      >
        关闭房间
      </button>
      {notice && <span className="text-xs text-amber-700 dark:text-amber-400">{notice}</span>}
    </div>
  );
}
