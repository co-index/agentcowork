import { describe, expect, it } from 'vitest';
import {
  agentInstruction,
  claudeMcpCommand,
  claudeSkillCommand,
  codexConfig,
  codexPromptCommand,
  maskToken,
  mcpUrl,
} from '../src/lib/connect';

const origin = 'https://cowork.example.com/';
const token = 'acw_secret_123';

describe('connect page text', () => {
  it('builds the MCP url without a double slash', () => {
    expect(mcpUrl(origin)).toBe('https://cowork.example.com/mcp');
  });

  it('Claude command registers the hub for the user with a bearer header', () => {
    const cmd = claudeMcpCommand(origin, token);
    expect(cmd).toContain('claude mcp add --transport http --scope user agentcowork');
    expect(cmd).toContain('https://cowork.example.com/mcp');
    expect(cmd).toContain(`"Authorization: Bearer ${token}"`);
  });

  it('skill install downloads SKILL.md and the repo-info script from the hub', () => {
    const cmd = claudeSkillCommand(origin);
    expect(cmd).toContain('https://cowork.example.com/skill/agentcowork/SKILL.md');
    expect(cmd).toContain('https://cowork.example.com/skill/agentcowork/scripts/repo-info.sh');
    expect(cmd).toContain('chmod +x');
    expect(cmd).not.toContain(token);
  });

  it('Codex config approves tools and carries the token', () => {
    const toml = codexConfig(origin, token);
    expect(toml).toContain('[mcp_servers.agentcowork]');
    expect(toml).toContain('url = "https://cowork.example.com/mcp"');
    expect(toml).toContain(`Authorization = "Bearer ${token}"`);
    expect(toml).toContain('default_tools_approval_mode = "approve"');
  });

  it('Codex prompt command keeps only the rules after the separator', () => {
    expect(codexPromptCommand(origin)).toBe(
      "grep -qs 'AgentCowork room' AGENTS.md || " +
        "curl -fsSL https://cowork.example.com/skill/prompt.md | sed '1,/^---$/d' >> AGENTS.md",
    );
  });

  it('instruction joins a given room, or opens and hosts a new one', () => {
    const join = agentInstruction({ client: 'codex', role: 'frontend', room: ' REQ-1 ' });
    expect(join).toContain('加入房间 REQ-1，角色 frontend');
    expect(join).toContain('AGENTS.md');
    const host = agentInstruction({ client: 'claude', role: 'product' });
    expect(host).toContain('agentcowork skill');
    expect(host).toContain('开一个需求房间');
    expect(host).toContain('主持人');
  });

  it('masks the token for display only', () => {
    expect(maskToken(codexConfig(origin, token), token)).not.toContain(token);
    expect(maskToken('no token here', '')).toBe('no token here');
  });
});
