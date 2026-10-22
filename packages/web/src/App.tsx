import { useEffect, useMemo, useState } from 'react';
import { Api, clearToken, loadToken, saveToken } from './lib/api';
import { RoomList } from './pages/RoomList';
import { RoomPage } from './pages/RoomPage';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const [token, setToken] = useState<string | null>(loadToken);
  const [expired, setExpired] = useState(false);
  const hash = useHashRoute();

  // A link with #token=… opened in an already-loaded page.
  useEffect(() => {
    if (/(?:^|[#&])token=/.test(hash)) {
      setToken(loadToken());
      setExpired(false);
    }
  }, [hash]);

  const api = useMemo(
    () =>
      token
        ? new Api(token, () => {
            clearToken();
            setToken(null);
            setExpired(true);
          })
        : null,
    [token],
  );

  if (!api) {
    return (
      <TokenForm
        expired={expired}
        onSubmit={(t) => {
          saveToken(t);
          setToken(t);
          setExpired(false);
        }}
      />
    );
  }

  const room = /^#\/rooms\/(.+)$/.exec(hash)?.[1];
  return room ? (
    <RoomPage key={room} api={api} slug={decodeURIComponent(room)} />
  ) : (
    <RoomList api={api} />
  );
}

function TokenForm({ onSubmit, expired }: { onSubmit: (token: string) => void; expired: boolean }) {
  const [value, setValue] = useState('');
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-xl font-semibold">AgentCowork</h1>
      {expired && (
        <p className="mt-4 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          token 已失效。Host 模式重启后会生成新的 token，请使用新的链接或 token。
        </p>
      )}
      <p className="mt-2 text-sm text-zinc-500">
        输入 Hub 的访问 token（Host 模式启动时打印的 invite token）。也可以直接打开启动输出中的 Web
        UI 链接。
      </p>
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          className="flex-1 rounded border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-700"
          placeholder="acw_host_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="访问 token"
          autoFocus
        />
        <button className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          进入
        </button>
      </form>
    </main>
  );
}
