// Builds a scenario's mock repositories as real git repos, including scripted history.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DATE = '2026-10-10T10:00:00+08:00';
const DEFAULT_AUTHOR = 'dev <dev@example.com>';

/**
 * Copies `<scenario>/repos/<repo>` into `<workDir>/repos/<repo>`, commits it, then replays
 * `<scenario>/commits/<repo>/<NN>/` overlays as later commits (a `COMMIT` file holds
 * date / author / message). The agent skill is installed untracked under `.claude/skills`
 * and `.agents/skills`.
 */
export function buildRepos(scenarioDir, workDir, skillDir) {
  const repos = readdirSync(join(scenarioDir, 'repos')).filter((n) =>
    statSync(join(scenarioDir, 'repos', n)).isDirectory(),
  );
  for (const repo of repos) {
    const dir = join(workDir, 'repos', repo);
    cpSync(join(scenarioDir, 'repos', repo), dir, { recursive: true });
    const git = (args, env = {}) =>
      execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    git(['remote', 'add', 'origin', `https://gitlab.example.com/shop/${repo}.git`]);
    commit(git, { date: DEFAULT_DATE, author: DEFAULT_AUTHOR, message: 'Initial import' });

    const overlays = join(scenarioDir, 'commits', repo);
    if (existsSync(overlays)) {
      for (const step of readdirSync(overlays).sort()) {
        const stepDir = join(overlays, step);
        const meta = parseCommitFile(readFileSync(join(stepDir, 'COMMIT'), 'utf8'));
        cpSync(stepDir, dir, {
          recursive: true,
          filter: (src) => !src.endsWith('/COMMIT'),
        });
        commit(git, meta);
      }
    }

    // The skill is the agent's tooling, not part of the project history.
    cpSync(skillDir, join(dir, '.claude', 'skills', 'agentcowork'), { recursive: true });
    cpSync(skillDir, join(dir, '.agents', 'skills', 'agentcowork'), { recursive: true });
    appendFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/\n.agents/\n');
  }
  return repos;
}

/** Wires the isolated Hub MCP config into each repo's `.agents/plugins/agentcowork` for `agy`. */
export function installAgyMcp(workDir, repos, hub) {
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        agentcowork: {
          url: `${hub.base}/mcp`,
          headers: { Authorization: `Bearer ${hub.token}` },
        },
      },
    },
    null,
    2,
  );
  for (const repo of repos) {
    const pluginDir = join(workDir, 'repos', repo, '.agents', 'plugins', 'agentcowork');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'agentcowork' }, null, 2));
    writeFileSync(join(pluginDir, 'mcp_config.json'), mcpConfig, { mode: 0o600 });
  }
}

function commit(git, { date, author, message }) {
  const [, name, email] = /^(.*?)\s*<(.*)>$/.exec(author) ?? [null, author, 'dev@example.com'];
  git(['add', '-A']);
  git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

function parseCommitFile(text) {
  const meta = { date: DEFAULT_DATE, author: DEFAULT_AUTHOR, message: 'Update' };
  for (const line of text.split('\n')) {
    const m = /^(date|author|message):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2];
  }
  return meta;
}
