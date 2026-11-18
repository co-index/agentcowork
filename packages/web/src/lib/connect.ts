/** Text for the "connect your agent" page: MCP config, behaviour rules and the first instruction. */

export type ClientKind = 'claude' | 'codex' | 'antigravity';

export const CONNECT_ROLES = [
  { value: 'product', label: '产品' },
  { value: 'frontend', label: '前端' },
  { value: 'backend', label: '后端' },
  { value: 'app', label: 'App' },
  { value: 'ui', label: 'UI' },
  { value: 'qa', label: '测试' },
] as const;

function base(origin: string): string {
  return origin.replace(/\/+$/, '');
}

export function mcpUrl(origin: string): string {
  return `${base(origin)}/mcp`;
}

/** Registers the hub for every project of this user (`--scope user`). */
export function claudeMcpCommand(origin: string, token: string): string {
  return (
    `claude mcp add --transport http --scope user agentcowork ${mcpUrl(origin)} \\\n` +
    `  --header "Authorization: Bearer ${token}"`
  );
}

/** Downloads the Claude Code skill (rules + repo-info script) from the hub. */
export function claudeSkillCommand(origin: string): string {
  const dir = '~/.claude/skills/agentcowork';
  const src = `${base(origin)}/skill/agentcowork`;
  return [
    `mkdir -p ${dir}/scripts`,
    `curl -fsSL ${src}/SKILL.md -o ${dir}/SKILL.md`,
    `curl -fsSL ${src}/scripts/repo-info.sh -o ${dir}/scripts/repo-info.sh`,
    `chmod +x ${dir}/scripts/repo-info.sh`,
  ].join(' && \\\n');
}

/** Lets Claude Code call the room tools and the skill's repo-info script without asking every time. */
export const CLAUDE_PERMISSIONS = `{
  "permissions": {
    "allow": [
      "mcp__agentcowork",
      "Bash(bash ~/.claude/skills/agentcowork/scripts/repo-info.sh:*)",
      "Bash(~/.claude/skills/agentcowork/scripts/repo-info.sh:*)"
    ]
  }
}`;

/** Block for ~/.codex/config.toml. Codex rejects unapproved MCP calls in non-interactive runs. */
export function codexConfig(origin: string, token: string): string {
  return [
    '[mcp_servers.agentcowork]',
    `url = "${mcpUrl(origin)}"`,
    `http_headers = { Authorization = "Bearer ${token}" }`,
    'default_tools_approval_mode = "approve"',
    'tool_timeout_sec = 300',
  ].join('\n');
}

/** Text the rules start with; used to skip appending them to AGENTS.md a second time. */
export const PROMPT_MARKER = 'AgentCowork room';

/**
 * Appends the condensed rules (the part of prompt.md after the first `---`) to AGENTS.md,
 * unless they are already there, so running it twice does not duplicate them.
 */
export function codexPromptCommand(origin: string): string {
  return (
    `grep -qs '${PROMPT_MARKER}' AGENTS.md || ` +
    `curl -fsSL ${base(origin)}/skill/prompt.md | sed '1,/^---$/d' >> AGENTS.md`
  );
}

/** Registers the hub globally for Antigravity CLI (`agy`) and Antigravity IDE. */
export function antigravityMcpCommand(origin: string, token: string): string {
  return `agy mcp add --header "Authorization: Bearer ${token}" agentcowork ${mcpUrl(origin)}`;
}

/** Installs the AgentCowork skill into Antigravity's global skills directory. */
export function antigravitySkillCommand(origin: string): string {
  const dir = '~/.gemini/config/skills/agentcowork';
  const src = `${base(origin)}/skill/agentcowork`;
  return [
    `mkdir -p ${dir}/scripts`,
    `curl -fsSL ${src}/SKILL.md -o ${dir}/SKILL.md`,
    `curl -fsSL ${src}/scripts/repo-info.sh -o ${dir}/scripts/repo-info.sh`,
    `chmod +x ${dir}/scripts/repo-info.sh`,
  ].join(' && \\\n');
}

export interface InstructionInput {
  client: ClientKind;
  role: string;
  /** Join this room; when empty the agent opens a new room and hosts it. */
  room?: string;
}

/** The sentence the user types to their agent to get it into the room. */
export function agentInstruction({ client, role, room }: InstructionInput): string {
  const lead = client === 'codex' ? '按 AGENTS.md 中 AgentCowork 的说明' : '使用 agentcowork skill';
  const slug = room?.trim();
  if (slug) {
    return (
      `${lead}，加入房间 ${slug}，角色 ${role}。` +
      '先调研本仓库与需求相关的代码，再参与讨论，负责本端的方案；' +
      '一直参与到房间进入 done，然后向我汇报结论。'
    );
  }
  return (
    `${lead}，开一个需求房间，标题“<需求标题>”，需求原文：<粘贴需求>。` +
    `我是 ${role} 角色并担任主持人：等其他角色加入后再推进阶段，` +
    '一直主持到 done，让结论板产出 contract、各端 plan、decisions 和 todos，然后向我汇报结论。'
  );
}

/** Replaces the token with dots for display; copying still uses the real text. */
export function maskToken(text: string, token: string): string {
  return token ? text.split(token).join('•'.repeat(12)) : text;
}
