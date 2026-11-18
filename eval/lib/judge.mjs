// Scores a run against the scenario rubric with an independent model.
import { askJudge } from './agents.mjs';

/** Item ids declared in the rubric, e.g. "T1", "R3", "Q2" (bold "**T1 ...**" bullets). */
export function rubricItems(rubric) {
  return [...rubric.matchAll(/^- \*\*([A-Z]\d+)\s/gm)].map((m) => m[1]);
}

function transcript(messages) {
  return messages
    .filter(
      (m) =>
        m.sender_type !== 'system' || /^(Stage changed|Room paused|All online)/.test(m.content),
    )
    .map((m) => {
      const meta = [
        m.kind,
        m.reply_to_seq ? `reply_to=${m.reply_to_seq}` : '',
        m.mentions.length ? `@${m.mentions.join(',')}` : '',
        m.evidence.length
          ? `evidence=${m.evidence.map((e) => `${e.path}${e.lines ? `#${e.lines}` : ''}`).join(';')}`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `### seq ${m.seq} · ${m.sender} · ${meta}\n${m.content}`;
    })
    .join('\n\n');
}

function boardText(board) {
  return Object.values(board)
    .map((s) => `## [${s.key}] v${s.version}（${s.updated_by}）\n${s.content}`)
    .join('\n\n');
}

export function judgePrompt({ scenario, rubric, room, messages }) {
  return `你是一名严格、公正的技术评审。下面是一次 AgentCowork 模拟的完整产出：多个 coding agent 各自代表一个仓库，在协作房间里讨论，产出写在结论板（Board）上。

场景：${scenario.title}

请按照评分标准逐项打分。要求：
- 只根据结论板和讨论记录里**实际写了什么**打分，不要替 agent 补全，也不要因为你自己知道答案就给分
- 结论板是最终产出，权重更高；只在讨论里提到、没有落到结论板的内容，最多给 1 分
- 评分标准里列有具体的「满分条件 / 扣分条件」时，必须逐条核对：缺漏任意一条必选要求最多给 1 分，不要给「差不多的满分」
- 结论错误或互相矛盾时给 0 分；理由要具体，引用结论板分区名或消息 seq

# 评分标准

${rubric}

# 结论板（最终版本）

${boardText(room.board)}

# 讨论记录（agent 和人的发言，以及阶段变更）

${transcript(messages)}

# 输出格式

只输出一个 JSON 对象，不要输出任何其他文字或代码块标记：
{"items":[{"id":"评分项编号","score":0,"reason":"简短理由"}],"bonus":["命中的加分项"],"strengths":["做得最好的地方"],"gaps":["最重要的不足，按严重程度排序"],"summary":"一段话总评"}
items 必须覆盖评分标准里的每一个评分项，score 只能是 0、1、2。`;
}

export async function judge({
  scenario,
  rubric,
  room,
  messages,
  runner = 'claude',
  model,
  effort,
  cwd,
}) {
  const ids = rubricItems(rubric);
  const { text, cost } = await askJudge(judgePrompt({ scenario, rubric, room, messages }), {
    runner,
    model,
    effort,
    cwd,
  });
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const verdict = JSON.parse(json);
  const byId = new Map(verdict.items.map((i) => [i.id, i]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`judge skipped rubric items: ${missing.join(', ')}`);
  const items = ids.map((id) => ({ ...byId.get(id), score: clamp(byId.get(id).score) }));
  const total = items.reduce((s, i) => s + i.score, 0);
  const groups = {};
  for (const i of items) {
    const g = (groups[i.id[0]] ??= { score: 0, max: 0 });
    g.score += i.score;
    g.max += 2;
  }
  return { ...verdict, items, total, max: ids.length * 2, groups, cost, raw: text };
}

const clamp = (n) => Math.max(0, Math.min(2, Math.round(Number(n) || 0)));
