#!/usr/bin/env node
// Runs one evaluation scenario end to end. See eval/README.md.
//
//   node eval/run.mjs <scenario> [--runner claude|agy] [--model opus] [--effort max] [--out /tmp/acw-eval] [--skip-judge]
//   node eval/run.mjs --judge-only <run-dir> [--judge-runner claude|agy] [--judge-model ...]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchAgent } from './lib/agents.mjs';
import { buildRepos, installAgyMcp } from './lib/fixtures.mjs';
import { allMessages, sleep, startHub } from './lib/hub.mjs';
import { judge } from './lib/judge.mjs';
import { agentStats, roomStats } from './lib/metrics.mjs';
import { renderReport } from './lib/report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = 15_000;
const LAUNCH_GAP_MS = 20_000;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runner: { type: 'string', default: 'claude' },
    model: { type: 'string' },
    effort: { type: 'string' },
    'judge-runner': { type: 'string' },
    'judge-model': { type: 'string' },
    'judge-effort': { type: 'string' },
    out: { type: 'string', default: '/tmp/acw-eval' },
    'skip-judge': { type: 'boolean', default: false },
    'judge-only': { type: 'string' },
  },
});

const runner = opts.runner;
const judgeRunner = opts['judge-runner'] ?? runner;
const agentModel = opts.model ?? (runner === 'agy' ? 'gemini-4-carbon-medium' : 'opus');
const agentEffort = opts.effort ?? (runner === 'agy' ? undefined : 'max');
const judgeModel =
  opts['judge-model'] ?? (judgeRunner === 'agy' ? 'gemini-4-carbon-medium' : 'opus');
const judgeEffort = opts['judge-effort'] ?? (judgeRunner === 'agy' ? undefined : 'max');

async function main() {
  if (opts['judge-only']) return judgeOnly(resolve(opts['judge-only']));
  const id = positionals[0];
  if (!id) throw new Error('usage: node eval/run.mjs <scenario> (see eval/scenarios/)');
  const scenarioDir = join(ROOT, 'eval/scenarios', id);
  const scenario = JSON.parse(readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'));
  for (const built of ['packages/server/dist/cli.js', 'packages/shared/dist/index.js']) {
    if (!existsSync(join(ROOT, built))) throw new Error(`${built} missing: run "pnpm build" first`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const workDir = join(resolve(opts.out), `${id}-${stamp}`);
  mkdirSync(workDir, { recursive: true });
  const log = (line) => {
    const text = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    console.log(text);
    appendFileSync(join(workDir, 'progress.log'), `${text}\n`);
  };
  const meta = {
    scenario: id,
    runner,
    model: agentModel,
    effort: agentEffort,
    judgeRunner,
    judgeModel,
    started: new Date().toISOString(),
  };
  writeFileSync(join(workDir, 'meta.json'), JSON.stringify(meta, null, 2));
  log(`run ${id} (${runner}:${agentModel}) in ${workDir}`);

  const repos = buildRepos(scenarioDir, workDir, join(ROOT, 'skill/agentcowork'));
  const hub = await startHub(ROOT, workDir);
  installAgyMcp(workDir, repos, hub);
  const mcpConfig = join(workDir, 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        agentcowork: {
          type: 'http',
          url: `${hub.base}/mcp`,
          headers: { Authorization: `Bearer ${hub.token}` },
        },
      },
    }),
    { mode: 0o600 },
  );
  log(`hub ${hub.base}`);

  const started = Date.now();
  const running = new Map();
  const fill = (text) => text.replaceAll('{room}', scenario.room);
  const launch = (agent, prompt, logName = agent.name) => {
    const proc = launchAgent({
      runner,
      workDir,
      repo: agent.repo,
      prompt: fill(prompt),
      logName,
      model: agentModel,
      effort: agentEffort,
      mcpConfig,
    });
    running.set(agent.name, proc);
    proc.exited.then((code) => {
      if (running.get(agent.name) === proc) running.delete(agent.name);
      log(`${logName} exited (${code})`);
    });
    log(`launched ${logName}`);
  };

  try {
    const [host, ...others] = [...scenario.agents].sort(
      (a, b) => Number(!!b.host) - Number(!!a.host),
    );
    launch(host, host.prompt);
    if (!(await waitForRoom(hub, scenario.room, 300_000)))
      throw new Error('host never created the room');
    log('room created');
    for (const agent of others) {
      await sleep(LAUNCH_GAP_MS);
      launch(agent, agent.prompt);
    }

    let disrupted = !scenario.disruption;
    const limitMs = (scenario.timeLimitMinutes ?? 60) * 60_000;
    let last = '';
    while (running.size > 0) {
      await sleep(POLL_MS);
      const detail = await hub.api(`/rooms/${scenario.room}`).catch(() => null);
      if (detail) {
        const status = `stage=${detail.room.stage} status=${detail.room.status} pending_q=${detail.pending_questions.length} | ${detail.members.map((m) => `${m.role}:${m.status}${m.ready ? '+R' : ''}`).join(' ')}`;
        if (status !== last) log(status);
        last = status;
        if (!disrupted && (await shouldDisrupt(hub, scenario, detail))) {
          disrupted = true;
          const d = scenario.disruption;
          const agent = scenario.agents.find((a) => a.name === d.agent);
          log(`DISRUPTION: killing ${agent.name}`);
          const proc = running.get(agent.name);
          running.delete(agent.name);
          proc?.child.kill('SIGTERM');
          await sleep((d.pauseSeconds ?? 40) * 1000);
          launch(agent, d.restartPrompt, `${agent.name}-restarted`);
        }
      }
      if (Date.now() - started > limitMs) {
        log('time limit reached; stopping agents');
        for (const proc of running.values()) proc.child.kill('SIGTERM');
        break;
      }
    }
    log('all agents finished');
    await finish({
      workDir,
      scenarioDir,
      scenario,
      meta,
      hub,
      durationSeconds: (Date.now() - started) / 1000,
      log,
    });
  } finally {
    for (const proc of running.values()) proc.child.kill('SIGTERM');
    hub.stop();
  }
}

async function waitForRoom(hub, room, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (
      await hub.api(`/rooms/${room}`).then(
        () => true,
        () => false,
      )
    )
      return true;
    await sleep(5000);
  }
  return false;
}

/** Disrupt once the room reached `afterStage` and the agent has posted at least once. */
async function shouldDisrupt(hub, scenario, detail) {
  const d = scenario.disruption;
  if (detail.stages.indexOf(detail.room.stage) < detail.stages.indexOf(d.afterStage)) return false;
  const agent = scenario.agents.find((a) => a.name === d.agent);
  const role = agent?.role ?? agent?.name;
  const ids = new Set(detail.members.filter((m) => m.role === role).map((m) => m.participant_id));
  const page = await hub.api(`/rooms/${scenario.room}/messages?limit=200`);
  return page.messages.some((m) => m.sender_type === 'agent' && ids.has(m.participant_id));
}

async function finish({ workDir, scenarioDir, scenario, meta, hub, durationSeconds, log }) {
  const room = await hub.api(`/rooms/${scenario.room}`);
  const messages = await allMessages(hub, scenario.room);
  writeFileSync(join(workDir, 'room.json'), JSON.stringify(room, null, 2));
  writeFileSync(join(workDir, 'messages.json'), JSON.stringify(messages, null, 2));
  exportBoard(workDir, room.board);
  writeFileSync(join(workDir, 'meta.json'), JSON.stringify({ ...meta, durationSeconds }, null, 2));
  await score({
    workDir,
    scenarioDir,
    scenario,
    meta: { ...meta, durationSeconds },
    room,
    messages,
    log,
  });
}

async function score({ workDir, scenarioDir, scenario, meta, room, messages, log }) {
  let verdict = null;
  if (!opts['skip-judge']) {
    log('judging…');
    const rubric = readFileSync(join(scenarioDir, 'rubric.md'), 'utf8');
    verdict = await judge({
      scenario,
      rubric,
      room,
      messages,
      runner: meta.judgeRunner ?? judgeRunner,
      model: meta.judgeModel ?? judgeModel,
      effort: judgeEffort,
      cwd: workDir,
    });
    writeFileSync(join(workDir, 'verdict.json'), JSON.stringify(verdict, null, 2));
  }
  const report = renderReport({
    scenario,
    meta,
    roomStats: roomStats(room, messages),
    agents: agentStats(workDir),
    verdict,
    durationSeconds: meta.durationSeconds ?? 0,
  });
  writeFileSync(join(workDir, 'report.md'), report);
  log(verdict ? `score ${verdict.total}/${verdict.max}` : 'not judged');
  log(`report: ${join(workDir, 'report.md')}`);
}

async function judgeOnly(workDir) {
  // Re-judging uses the judge runner/model given now, so results judged together stay comparable.
  const meta = {
    ...JSON.parse(readFileSync(join(workDir, 'meta.json'), 'utf8')),
    judgeRunner,
    judgeModel,
  };
  writeFileSync(join(workDir, 'meta.json'), JSON.stringify(meta, null, 2));
  const scenarioDir = join(ROOT, 'eval/scenarios', meta.scenario);
  const scenario = JSON.parse(readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'));
  const room = JSON.parse(readFileSync(join(workDir, 'room.json'), 'utf8'));
  const messages = JSON.parse(readFileSync(join(workDir, 'messages.json'), 'utf8'));
  await score({ workDir, scenarioDir, scenario, meta, room, messages, log: console.log });
}

/** One markdown file per role (context.<role> + plan.<role>), shared sections in one file. */
function exportBoard(workDir, board) {
  const dir = join(workDir, 'output');
  mkdirSync(dir, { recursive: true });
  const groups = {};
  for (const s of Object.values(board)) {
    const role = /^(?:context|plan)\.(.+)$/.exec(s.key)?.[1] ?? '00-shared';
    (groups[role] ??= []).push(
      `<!-- ${s.key} v${s.version} by ${s.updated_by} -->\n\n${s.content.trim()}\n`,
    );
  }
  for (const [role, parts] of Object.entries(groups)) {
    writeFileSync(join(dir, `${role}.md`), parts.join('\n---\n\n'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
