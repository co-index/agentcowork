// Process metrics for one run, from the exported room and the agents' stream-json logs.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ERROR_CODES =
  /STALE_CONTEXT|TOKEN_INVALID|LIMIT_REACHED|MEMBERS_OFFLINE|VERSION_CONFLICT|NOT_A_PARTICIPANT|ROOM_PAUSED|INVALID_ARGUMENT|FORBIDDEN|ROOM_CLOSED/;

export function agentStats(workDir) {
  const stats = {};
  for (const file of readdirSync(workDir).filter((f) => f.endsWith('.jsonl'))) {
    const name = file.slice(0, -'.jsonl'.length);
    const s = { cost: null, turns: null, result: null, tools: {}, errors: {} };
    let agySteps = 0;
    for (const line of readFileSync(join(workDir, file), 'utf8').split('\n')) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      // Claude Code stream-json
      if (e.type === 'result') {
        s.cost = e.total_cost_usd ?? null;
        s.turns = e.num_turns ?? null;
        s.result = e.subtype ?? null;
      }
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use') {
            const tool = c.name.replace('mcp__agentcowork__', '');
            s.tools[tool] = (s.tools[tool] ?? 0) + 1;
          }
          if (c?.type === 'tool_result' && c.is_error) {
            const code = ERROR_CODES.exec(JSON.stringify(c.content))?.[0] ?? 'other';
            s.errors[code] = (s.errors[code] ?? 0) + 1;
          }
        }
      }
      // Antigravity (`agy`) stream-json
      if (
        e.event === 'step_update' &&
        (e.step_update?.state === 'DONE' || e.step_update?.state === 'ERROR')
      ) {
        const su = e.step_update;
        if (su.step_type === 'agent_response') agySteps++;
        if (su.step_type === 'tool') {
          const tool =
            su.tool_name === 'call_mcp_tool'
              ? (su.tool_info?.parameters?.ToolName ?? 'call_mcp_tool')
              : su.tool_name;
          s.tools[tool] = (s.tools[tool] ?? 0) + 1;
          if (su.state === 'ERROR' || su.tool_info?.error) {
            const raw = JSON.stringify(su.tool_info?.error ?? su.tool_info?.output ?? '');
            const code = ERROR_CODES.exec(raw)?.[0] ?? 'other';
            s.errors[code] = (s.errors[code] ?? 0) + 1;
          }
        }
      }
      if (e.event === 'result' && e.result) {
        s.result = e.result.status?.toLowerCase() ?? null;
        s.turns = agySteps || e.result.num_turns || null;
      }
    }
    stats[name] = s;
  }
  return stats;
}

export function roomStats(room, messages) {
  const agent = messages.filter((m) => m.sender_type === 'agent');
  const system = messages.filter((m) => m.sender_type === 'system');
  return {
    final_stage: room.room.stage,
    room_status: room.room.status,
    messages: messages.length,
    agent_posts: agent.length,
    stage_changes: system.filter((m) => m.content.startsWith('Stage changed')).length,
    reply_to_ratio: ratio(agent.filter((m) => m.reply_to_seq).length, agent.length),
    evidence_ratio: ratio(agent.filter((m) => m.evidence.length > 0).length, agent.length),
    pending_questions: room.pending_questions.length,
    reconnects: system.filter((m) => /reconnected|rejoined/.test(m.content)).length,
    pauses: system.filter((m) => m.content.startsWith('Room paused')).length,
    board_sections: Object.keys(room.board).length,
  };
}

const ratio = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100) / 100);
