import type { MessageView } from '@agentcowork/shared';
import { useCallback, useEffect, useState } from 'react';
import { Board } from '../components/Board';
import { Composer } from '../components/Composer';
import { Members } from '../components/Members';
import { StageBar } from '../components/StageBar';
import { Thread } from '../components/Thread';
import { ApiError, type Api, type RoomDetail } from '../lib/api';
import { mergeMessages } from '../lib/format';

const PAGE = 100;

export function RoomPage({ api, slug }: { api: Api; slug: string }) {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDetail = useCallback(
    () =>
      api
        .room(slug)
        .then(setDetail)
        .catch((e: Error) =>
          setError(e instanceof ApiError && e.status === 404 ? '房间不存在' : e.message),
        ),
    [api, slug],
  );

  useEffect(() => {
    void refreshDetail();
    void api.messages(slug, { limit: PAGE }).then((res) => {
      setMessages((cur) => mergeMessages(cur, res.messages));
      setHasOlder(res.has_more);
    });

    const ac = new AbortController();
    void api.subscribe(
      slug,
      {
        onOpen: () => setLive(true),
        onMessage: (m) => {
          setMessages((cur) => mergeMessages(cur, [m]));
          // System messages announce joins, stage changes, board edits and pauses.
          if (m.sender_type === 'system') void refreshDetail();
        },
        onMembers: () => void refreshDetail(),
      },
      ac.signal,
    );
    return () => {
      ac.abort();
      setLive(false);
    };
  }, [api, slug, refreshDetail]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const res = await api.messages(slug, { before_seq: first.seq, limit: PAGE });
    setMessages((cur) => mergeMessages(cur, res.messages));
    setHasOlder(res.has_more);
  };

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <a href="#/" className="text-sm text-zinc-500 hover:underline">
          ← 所有房间
        </a>
        <p className="mt-4 text-rose-600">{error}</p>
      </main>
    );
  }
  if (!detail) return <p className="p-8 text-sm text-zinc-500">加载中…</p>;

  const { room } = detail;
  return (
    <div className="flex h-dvh flex-col">
      <header className="space-y-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href="#/" className="text-sm text-zinc-500 hover:underline">
            ← 房间
          </a>
          <span className="font-mono text-sm text-zinc-500">{room.slug}</span>
          <h1 className="text-lg font-semibold">{room.title}</h1>
          <span className="text-xs text-zinc-500">
            {room.type === 'bug' ? 'Bug 排查' : '需求讨论'}
          </span>
          <span
            className={`ml-auto flex items-center gap-1.5 text-xs ${live ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}`}
          >
            <span className={`size-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            {live ? '实时' : '连接中'}
          </span>
        </div>
        <StageBar stages={detail.stages} current={room.stage} />
        {room.status === 'paused' && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            房间已暂停：{detail.pause_reason ?? '等待人来处理'}。在下方发言即可恢复讨论。
          </p>
        )}
        <Members members={detail.members} hostId={room.host?.participant_id} />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[3fr_2fr] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-1">
        <div className="flex min-h-0 min-w-0 flex-col border-b border-zinc-200 lg:border-r lg:border-b-0 dark:border-zinc-800">
          <Thread
            messages={messages}
            members={detail.members}
            hasOlder={hasOlder}
            onLoadOlder={() => void loadOlder()}
          />
          <Composer api={api} slug={slug} disabled={room.status === 'closed'} />
        </div>
        <Board api={api} slug={slug} sections={detail.board} />
      </div>
    </div>
  );
}
