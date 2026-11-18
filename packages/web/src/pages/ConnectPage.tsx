import { useState } from 'react';
import {
  agentInstruction,
  antigravityMcpCommand,
  antigravitySkillCommand,
  CLAUDE_PERMISSIONS,
  claudeMcpCommand,
  claudeSkillCommand,
  codexConfig,
  codexPromptCommand,
  CONNECT_ROLES,
  maskToken,
  type ClientKind,
} from '../lib/connect';

/** Step-by-step setup for teammates: put their own Claude Code, Codex or Antigravity into a room. */
export function ConnectPage({ token, room: initialRoom }: { token: string; room?: string }) {
  const origin = window.location.origin;
  const [client, setClient] = useState<ClientKind>('claude');
  const [role, setRole] = useState<string>('frontend');
  const [room, setRoom] = useState(initialRoom ?? '');
  const [reveal, setReveal] = useState(false);
  const show = (text: string) => (reveal ? text : maskToken(text, token));

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <a
          href={room ? `#/rooms/${encodeURIComponent(room)}` : '#/'}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← {room ? '返回房间' : '所有房间'}
        </a>
        <h1 className="mt-2 text-xl font-semibold">接入你的 Agent</h1>
        <p className="mt-1 text-sm text-zinc-500">
          在你自己的仓库里启动 Claude Code、Codex 或
          Antigravity，按下面三步让它进入房间。代码不会上传，Hub 只保存讨论和结论。第 1、2
          步每台电脑只需做一次。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Segmented
          value={client}
          onChange={(v) => setClient(v as ClientKind)}
          options={[
            { value: 'claude', label: 'Claude Code' },
            { value: 'codex', label: 'Codex' },
            { value: 'antigravity', label: 'Antigravity' },
          ]}
        />
        <label className="flex items-center gap-2">
          角色
          <select
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="角色"
          >
            {CONNECT_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}（{r.value}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          房间
          <input
            className="w-36 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700"
            placeholder="留空则新开房间"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            aria-label="房间编号"
          />
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          显示令牌
        </label>
      </div>

      {client === 'claude' ? (
        <>
          <Step n={1} title="添加 MCP 服务（在终端执行）">
            <CopyBlock
              text={claudeMcpCommand(origin, token)}
              display={show(claudeMcpCommand(origin, token))}
            />
            <p className="text-sm text-zinc-500">
              建议在 <code className="font-mono">~/.claude/settings.json</code>{' '}
              里放行房间工具，避免每次调用都要确认：
            </p>
            <CopyBlock text={CLAUDE_PERMISSIONS} />
          </Step>
          <Step n={2} title="安装行为规范 Skill（在终端执行）">
            <CopyBlock text={claudeSkillCommand(origin)} />
          </Step>
        </>
      ) : client === 'antigravity' ? (
        <>
          <Step n={1} title="添加 MCP 服务（在终端执行，CLI 与 IDE 共用）">
            <CopyBlock
              text={antigravityMcpCommand(origin, token)}
              display={show(antigravityMcpCommand(origin, token))}
            />
            <p className="text-sm text-zinc-500">
              配置会写入 <code className="font-mono">~/.gemini/config/mcp_config.json</code>
              。如果你通过本机代理访问外网，启动前确保局域网或本机 Hub 地址在{' '}
              <code className="font-mono">NO_PROXY</code> 中。
            </p>
          </Step>
          <Step n={2} title="安装行为规范 Skill（在终端执行）">
            <CopyBlock text={antigravitySkillCommand(origin)} />
          </Step>
        </>
      ) : (
        <>
          <Step n={1} title="添加 MCP 服务：把下面内容加到 ~/.codex/config.toml">
            <CopyBlock
              text={codexConfig(origin, token)}
              display={show(codexConfig(origin, token))}
            />
            <p className="text-sm text-zinc-500">
              <code className="font-mono">default_tools_approval_mode = "approve"</code>{' '}
              必须保留，否则 Codex 会拒绝调用房间工具。已有{' '}
              <code className="font-mono">[mcp_servers.agentcowork]</code>{' '}
              时替换原来的段落。如果你通过代理访问网络，需要让 Codex 也能访问这个地址。
            </p>
          </Step>
          <Step n={2} title="安装行为规范（在仓库根目录执行，追加到 AGENTS.md）">
            <CopyBlock text={codexPromptCommand(origin)} />
          </Step>
        </>
      )}

      <Step
        n={3}
        title={
          room.trim()
            ? `启动 agent，对它说（加入 ${room.trim()}）`
            : '启动 agent，对它说（新开房间并主持）'
        }
      >
        <CopyBlock text={agentInstruction({ client, role, room })} />
        <p className="text-sm text-zinc-500">
          {room.trim()
            ? 'agent 会调研你的仓库、参与讨论，直到房间结束后向你汇报。讨论期间它只读代码，不会改动文件。'
            : '把尖括号里的内容换成真实需求。房间建好后，在房间页点“接入 Agent”把链接发给其他角色。'}
        </p>
      </Step>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-medium">
        <span className="flex size-6 items-center justify-center rounded-full bg-zinc-900 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CopyBlock({ text, display }: { text: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API needs HTTPS or localhost; the text is still selectable.
    }
  };
  return (
    <div className="relative">
      <pre className="rounded-lg bg-zinc-100 p-3 pr-16 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap dark:bg-zinc-800">
        {display ?? text}
      </pre>
      <button
        onClick={() => void copy()}
        className="absolute top-2 right-2 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900"
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 ${value === o.value ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
