import { useState } from 'react';
import { ApiError, type Api } from '../lib/api';

const NAME_KEY = 'agentcowork.name';

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Human speaking in the room. Human messages wake every agent and lift a pause. */
export function Composer({ api, slug, disabled }: { api: Api; slug: string; disabled: boolean }) {
  const [name, setName] = useState(storedName);
  const [content, setContent] = useState('');
  const [kind, setKind] = useState('chat');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const send = async () => {
    if (!name.trim() || !content.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // ignore
    }
    try {
      const mentions = [...content.matchAll(/(?:^|\s)@([\w:-]+)/g)].map((m) => m[1]!);
      const res = await api.post(slug, {
        name: name.trim(),
        content,
        kind,
        ...(mentions.length ? { mentions } : {}),
      });
      setContent('');
      if (res.redacted?.length) setNotice(`已自动脱敏：${res.redacted.join('、')}`);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className="w-32 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          placeholder="你的名字"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="你的名字"
          maxLength={64}
        />
        <select
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="消息类型"
        >
          <option value="chat">发言</option>
          <option value="question">提问</option>
          <option value="decision">决定</option>
        </select>
        <span className="self-center text-xs text-zinc-500">
          人类发言会唤醒所有 agent；用 @角色 指定对象
        </span>
      </div>
      <div className="flex gap-2">
        <textarea
          className="min-h-16 flex-1 resize-y rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          placeholder={disabled ? '房间已关闭' : '输入消息，⌘/Ctrl + Enter 发送'}
          value={content}
          disabled={disabled}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
          maxLength={20000}
        />
        <button
          type="submit"
          disabled={disabled || busy || !name.trim() || !content.trim()}
          className="self-end rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          发送
        </button>
      </div>
      {notice && <p className="text-xs text-amber-700 dark:text-amber-400">{notice}</p>}
    </form>
  );
}
