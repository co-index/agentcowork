import { networkInterfaces } from 'node:os';

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

export interface BannerInput {
  port: number;
  bind: string;
  token: string;
  publicUrl?: string;
  dbPath: string;
  hasWeb?: boolean;
}

/** Text printed by `agentcowork host`: addresses, invite token and ready-to-paste client config. */
export function hostBanner({ port, bind, token, publicUrl, dbPath, hasWeb }: BannerInput): string {
  const local = `http://127.0.0.1:${port}`;
  const lan = bind === '127.0.0.1' || bind === 'localhost' ? [] : lanAddresses();
  const shareBase = publicUrl ?? (lan[0] ? `http://${lan[0]}:${port}` : local);
  const mcpUrl = `${shareBase.replace(/\/$/, '')}/mcp`;

  const lines = [
    'AgentCowork host is running',
    `  Local:   ${local}`,
    ...lan.map((ip) => `  LAN:     http://${ip}:${port}`),
    `  Invite token: ${token}   (share with teammates; valid until this process exits)`,
    `  Database: ${dbPath}`,
    ...(hasWeb
      ? [`  Web UI:  ${shareBase.replace(/\/$/, '')}/#token=${token}`]
      : ['  Web UI:  not built (run `pnpm build` in the repository)']),
    '',
    'Add to Claude Code:',
    `  claude mcp add --transport http agentcowork ${mcpUrl} \\`,
    `    --header "Authorization: Bearer ${token}"`,
    '',
    'Add to Codex (the token is read from the environment when Codex starts):',
    `  export AGENTCOWORK_TOKEN=${token}`,
    `  codex mcp add agentcowork --url ${mcpUrl} --bearer-token-env-var AGENTCOWORK_TOKEN`,
    '  then allow its tools without a prompt per call, in ~/.codex/config.toml:',
    '    [mcp_servers.agentcowork]',
    '    default_tools_approval_mode = "approve"',
    '  (or skip `codex mcp add` and put url + http_headers there directly:',
    `    url = "${mcpUrl}"`,
    `    http_headers = { Authorization = "Bearer ${token}" })`,
    '',
    'Then tell your agent: "create a room for <requirement>, role backend" or "join room REQ-XXXX, role frontend".',
  ];
  if (lan.length > 0) {
    lines.push(
      '',
      'Note: the hub is reachable from your network. Use --bind 127.0.0.1 to restrict it to this machine.',
    );
  }
  return lines.join('\n');
}
