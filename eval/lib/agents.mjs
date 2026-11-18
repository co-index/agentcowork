// Launches headless coding agents (Claude Code `claude` or Antigravity `agy`) for an evaluation run.
import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read-only tools plus the room: Claude Code agents investigate but never change the mock repos. */
const ALLOWED_TOOLS = [
  'mcp__agentcowork',
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git diff:*)',
  'Bash(git blame:*)',
  'Bash(git rev-parse:*)',
  'Bash(git remote:*)',
  'Bash(git status:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(bash .claude/skills/agentcowork/scripts/repo-info.sh:*)',
  'Bash(.claude/skills/agentcowork/scripts/repo-info.sh:*)',
];

/** Per-session variables of a parent Claude Code session must not leak into child agents. */
const SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS',
  'CLAUDE_CODE_ARTIFACT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
];

export function cleanEnv() {
  const env = { ...process.env };
  for (const name of SESSION_VARS) delete env[name];
  const noProxy = new Set((env.NO_PROXY ?? env.no_proxy ?? '').split(',').filter(Boolean));
  noProxy.add('127.0.0.1');
  noProxy.add('localhost');
  env.NO_PROXY = [...noProxy].join(',');
  return env;
}

/**
 * Starts one agent in its repo, logging stream-json to `<logName>.jsonl`.
 * Supports `runner`: `'claude'` (default) or `'agy'`.
 */
export function launchAgent({
  runner = 'claude',
  workDir,
  repo,
  prompt,
  logName,
  model,
  effort,
  mcpConfig,
}) {
  const out = openSync(join(workDir, `${logName}.jsonl`), 'w');
  const err = openSync(join(workDir, `${logName}.err`), 'w');
  const cwd = join(workDir, 'repos', repo);
  let bin;
  let args;
  if (runner === 'agy') {
    bin = 'agy';
    const readonlyPrompt = `${prompt}\n\n注意：房间讨论期间只做只读代码调研（读文件、搜索、git log）和调用 agentcowork 房间工具，不要修改、创建或删除本仓库中的任何文件。`;
    args = [
      '-p',
      readonlyPrompt,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : []),
    ];
  } else {
    bin = 'claude';
    args = [
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--allowedTools',
      ...ALLOWED_TOOLS,
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : []),
    ];
  }
  const child = spawn(bin, args, {
    cwd,
    env: cleanEnv(),
    stdio: ['ignore', out, err],
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited };
}

/** One-shot `claude -p` with the prompt on stdin and no tools; resolves with the result text. */
export function askClaude(prompt, { model, effort, cwd }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--strict-mcp-config', '--tools', '', '--output-format', 'json'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    const child = spawn('claude', args, { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => {
      try {
        const res = JSON.parse(stdout);
        if (res.is_error) return reject(new Error(`judge failed: ${res.result ?? stderr}`));
        resolve({ text: res.result, cost: res.total_cost_usd });
      } catch {
        reject(new Error(`judge exited ${code}: ${stderr.slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** One-shot `agy -p` judge call; writes large prompts to a file in `cwd` if needed. */
export function askAgy(prompt, { model, effort, cwd }) {
  return new Promise((resolve, reject) => {
    let argPrompt = prompt;
    const args = ['--disable-slash-commands', '--output-format', 'json'];
    if (Buffer.byteLength(prompt, 'utf8') > 200_000) {
      const file = join(cwd, 'judge-prompt.md');
      writeFileSync(file, prompt);
      argPrompt =
        'Read judge-prompt.md in full from line 1 to the end, evaluate strictly according to its instructions, and output ONLY the single raw JSON object requested at the end.';
      args.push('--dangerously-skip-permissions');
    }
    args.unshift('-p', argPrompt);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    const child = spawn('agy', args, { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => {
      try {
        const res = JSON.parse(stdout);
        if (res.status && res.status !== 'SUCCESS') {
          return reject(new Error(`agy judge failed (${res.status}): ${stderr.slice(0, 500)}`));
        }
        resolve({ text: res.response, cost: null });
      } catch {
        reject(new Error(`agy judge exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
    });
  });
}

export function askJudge(prompt, { runner = 'claude', model, effort, cwd }) {
  return runner === 'agy'
    ? askAgy(prompt, { model, effort, cwd })
    : askClaude(prompt, { model, effort, cwd });
}
