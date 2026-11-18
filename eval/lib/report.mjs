// Writes report.md for one run.
const GROUP_LABELS = { T: '关键约束', R: '排查结论', E: '工程落地', Q: '文档质量' };

export function renderReport({ scenario, meta, roomStats, agents, verdict, durationSeconds }) {
  const agentDesc = [meta.runner ? `${meta.runner}:` : '', meta.model ?? '默认']
    .filter(Boolean)
    .join('');
  const judgeDesc = [meta.judgeRunner ? `${meta.judgeRunner}:` : '', meta.judgeModel ?? '默认']
    .filter(Boolean)
    .join('');
  const lines = [
    `# 评测报告：${scenario.title}`,
    '',
    `- 场景：\`${scenario.id}\`，房间 \`${scenario.room}\``,
    `- 开始：${meta.started}，用时 ${Math.round(durationSeconds / 60)} 分钟`,
    `- agent 模型：${agentDesc}，思考强度：${meta.effort ?? '默认'}；评审模型：${judgeDesc}`,
    `- 最终阶段：\`${roomStats.final_stage}\`，房间状态：\`${roomStats.room_status}\``,
    ...(meta.note ? [`- **注意**：${meta.note}`] : []),
    '',
  ];

  if (verdict) {
    const pct = Math.round((verdict.total / verdict.max) * 100);
    lines.push(`## 得分：${verdict.total} / ${verdict.max}（${pct}%）`, '');
    for (const [g, s] of Object.entries(verdict.groups)) {
      lines.push(`- ${GROUP_LABELS[g] ?? g}：${s.score} / ${s.max}`);
    }
    lines.push('', '| 编号 | 得分 | 理由 |', '|---|---|---|');
    for (const i of verdict.items) {
      lines.push(
        `| ${i.id} | ${i.score} | ${String(i.reason ?? '')
          .replace(/\|/g, '\\|')
          .replace(/\n/g, ' ')} |`,
      );
    }
    lines.push('', '### 总评', '', verdict.summary ?? '', '');
    section(lines, '做得好的地方', verdict.strengths);
    section(lines, '主要不足', verdict.gaps);
    section(lines, '命中的加分项', verdict.bonus);
  } else {
    lines.push('## 得分：未评审', '');
  }

  lines.push(
    '## 过程指标',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    `| 消息总数 / agent 发言 | ${roomStats.messages} / ${roomStats.agent_posts} |`,
    `| 阶段推进次数 | ${roomStats.stage_changes} |`,
    `| 带 reply_to_seq 的发言比例 | ${pct(roomStats.reply_to_ratio)} |`,
    `| 带代码出处的发言比例 | ${pct(roomStats.evidence_ratio)} |`,
    `| 结束时仍待回答的问题 | ${roomStats.pending_questions} |`,
    `| 重连 / 暂停次数 | ${roomStats.reconnects} / ${roomStats.pauses} |`,
    `| 结论板分区数 | ${roomStats.board_sections} |`,
    '',
    '## 各 agent',
    '',
    '| agent | 结果 | 轮数 | 花费（美元） | 发言调用 | 等待调用 | 写结论板 | 错误 |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const [name, a] of Object.entries(agents)) {
    const errors =
      Object.entries(a.errors)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ') || '—';
    lines.push(
      `| ${name} | ${a.result ?? '被中断'} | ${a.turns ?? '—'} | ${a.cost?.toFixed(2) ?? '—'} | ${a.tools.msg_post ?? 0} | ${a.tools.msg_wait ?? 0} | ${a.tools.board_update ?? 0} | ${errors} |`,
    );
  }
  lines.push(
    '',
    '## 文件',
    '',
    '- `output/`：按角色导出的结论板文档',
    '- `room.json`、`messages.json`：房间和完整讨论记录',
    '- `<agent>.jsonl`：各 agent 的完整会话日志；`progress.log`：运行过程',
    '- `verdict.json`：评审原始结果',
    '',
  );
  return lines.join('\n');
}

function section(lines, title, items) {
  if (!items?.length) return;
  lines.push(`### ${title}`, '', ...items.map((i) => `- ${i}`), '');
}

const pct = (r) => `${Math.round(r * 100)}%`;
