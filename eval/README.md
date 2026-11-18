# 效果评测

用固定场景衡量 AgentCowork 的产品效果：几个 coding agent（Claude Code 或 Antigravity）各自代表一个模拟仓库，在一个隔离的 Hub 里协作，最后由一个独立的模型按评分标准给产出打分。改协议、改行为规范、换模型之前和之后都跑一遍，用分数而不是感觉做决定。

## 前提

- 已经 `pnpm build`（评测用构建产物启动 Hub）
- 本机装了 `claude`（Claude Code）或 `agy`（Antigravity CLI）并且已登录
- 评测不会改动仓库，也不碰 `~/.agentcowork` 或 `~/.gemini/config` 里的数据：每次运行用新的临时目录、随机端口和随机 token

## 运行

```bash
pnpm build
node eval/run.mjs partial-refund                                       # 默认用 claude (opus)
node eval/run.mjs order-date-bug                                       # 跨端 Bug 排查
node eval/run.mjs partial-refund --model sonnet --effort high          # 换 Claude 模型
node eval/run.mjs order-date-bug --runner agy                          # 用 Antigravity (agy) 运行并评审
node eval/run.mjs --judge-only /tmp/acw-eval/<运行目录> --judge-runner agy  # 对已有结果重新评审
```

默认 `claude` 用 `opus`（`effort=max`），`agy` 用 `gemini-4-carbon-medium`。结果写到 `/tmp/acw-eval/<场景>-<时间>/`（`--out` 可改）：

| 文件 | 内容 |
|---|---|
| `report.md` | 得分、逐项理由、总评、过程指标、各 agent 统计 |
| `output/` | 按角色导出的结论板文档 |
| `room.json`、`messages.json` | 房间和完整讨论记录 |
| `<agent>.jsonl` | 各 agent 的完整会话日志 |
| `verdict.json` | 评审原始结果 |
| `progress.log`、`hub.log` | 运行过程 |

## 场景

| 场景 | 内容 | 考察点 |
|---|---|---|
| `partial-refund` | 产品、后端、管理后台、App 四方，从 PRD 产出接口契约和各端计划；中途杀掉 App 的 agent 再重启 | 能否发现只有一方知道的约束（老版本 App 崩溃、渠道 5 次上限、异步回调等）、解决存量兼容与隐藏代码缺陷；文档能否直接开发；断线后能否接回 |
| `order-date-bug` | 四方排查"按日期查订单漏单 / 串单" | 能否找到两个分布在不同端的根因（后端按 UTC 算日期范围、App 用 UTC 日期）、定位回归提交、不冤枉没问题的一端、兼顾日报影响与老版本兼容、给出可直接实施的方案 |

## 评分

每个场景的 `rubric.md` 写明标准答案和逐项满分 / 扣分条件，agent 看不到。评分项每项 0～2 分：

- `T`（关键约束）/ `R`（排查结论）：有没有找对并覆盖边界
- `E`（工程落地）：隐藏缺陷、存量兼容、故障补偿等真实开发阻塞点
- `Q`（文档质量）：契约完整度、文件级指引、跨分区一致性、待办确认、无编造

评审只看结论板和讨论记录里实际写了什么；结论板是最终产出，只在讨论里提到的内容最多给 1 分；缺漏满分条件中的任意必选子项最多给 1 分。同一份产出两次评审的分数可能差 1～2 分，比较方案时统一使用同一评审模型。

## 新增场景

在 `eval/scenarios/<场景名>/` 下放：

- `scenario.json`：房间 slug、各 agent 的仓库和第一句话（`{room}` 会替换成房间 slug），主持人标 `"host": true`；可选 `disruption`（在某个阶段之后杀掉某个 agent 再重启）和 `timeLimitMinutes`
- `repos/<仓库名>/`：仓库初始内容，作为第一次提交（2026-10-10）
- `commits/<仓库名>/<NN>/`：之后的提交，按目录名顺序叠加；`COMMIT` 文件写 `date:`、`author:`、`message:`，其余文件覆盖到仓库里。用来制造回归、让 agent 能从 `git log` 里查到线索
- `rubric.md`：标准答案和评分项（`- **X1 名称**` 格式）

设计场景时，把关键信息分散在不同仓库里，每条只有一方知道，这样才能考察跨端协作，而不是单个 agent 的能力。
