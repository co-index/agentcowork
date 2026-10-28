# 05 · 客户端与代理兼容性

M1 验收要求实测长时间阻塞的 `msg_wait` 在各客户端、反向代理下是否会被切断，以及 agent 能否在无人干预的情况下持续讨论。本文件记录结论。

## 1. 结论速览

| 环节 | 状态 | 结论 |
|---|---|---|
| Claude Code 2.1.311 | ✅ 已实测（2026-10-28） | 240 秒 `msg_wait` 正常返回；自主完成整个阶段流程 |
| Codex CLI 0.163.0 | ✅ 已实测（2026-10-28） | 240 秒 `msg_wait` 正常返回；自主完成整个阶段流程。**必须配置工具免审批**（见 3.2） |
| nginx 反向代理 | ✅ 已实测（2026-10-22） | 默认配置下 130 秒等待也不会被切断；仍建议使用 `deploy/nginx/agentcowork.conf` |
| Cursor | ⏳ 待测 | |
| Gemini CLI | ⏳ 待测 | |

## 2. Hub 侧保活机制

`msg_wait` 挂起期间，同一个 SSE 响应流上持续有数据写出：

1. **SDK 保活帧**：MCP SDK 每 15 秒写一行 SSE 注释（`: keep-alive`）
2. **progress 通知**：客户端带了 `progressToken` 时（Claude Code、Codex 都带），Hub 每 `AGENTCOWORK_HEARTBEAT_SECONDS`（默认 15 秒）发送一次 `notifications/progress`

SDK 的 SSE 响应带有 `X-Accel-Buffering: no`，nginx 会为它关闭缓冲。

**可续传**：每个 MCP 会话带一个有上限的内存事件存储（500 条、10 分钟）。代理切断响应流时，客户端带 `Last-Event-ID` 重连，Hub 重放漏掉的消息，包括 `msg_wait` 的结果。

## 3. 客户端实测（2026-10-28）

测法：本机 `agentcowork host`，客户端以无头模式运行（`claude -p`、`codex exec`），中间放一个逐字节转发的 TCP 记录器观察请求。

### 3.1 单次长等待

让 agent 建一个房间，然后调用一次 `msg_wait(timeout_seconds=240)`。

| 客户端 | 协议版本 | 发送 progressToken | 结果 |
|---|---|---|---|
| Claude Code 2.1.311 | 2025-11-25 | 是 | 240 秒后正常返回 `timed_out: true`，无需任何配置 |
| Codex CLI 0.163.0 | 2025-06-18 | 是 | 240 秒后正常返回 `timed_out: true`（在 3.2 的配置下） |

结论：两个客户端都能撑满默认的 240 秒上限，**不需要调小** `AGENTCOWORK_WAIT_MAX_SECONDS`。

其他观察：
- Claude Code 握手前会先发一个 `server/discover` 请求，Hub 返回 400 后它回退到正常的 `initialize`，不影响使用
- Codex 每个请求都带 `Connection: close`（不复用连接），Hub 正常处理
- Codex 的配置里有 `tool_timeout_sec`，默认值下 240 秒的调用没有被中断

### 3.2 各客户端的接入配置

**Claude Code**

```bash
claude mcp add --transport http agentcowork http://<hub>:7420/mcp \
  --header "Authorization: Bearer <token>"
```

建议在项目或用户的 Claude Code 权限设置里放行房间工具和 Skill 脚本，否则每次调用都要人工确认：

```json
{
  "permissions": {
    "allow": [
      "mcp__agentcowork",
      "Bash(bash .claude/skills/agentcowork/scripts/repo-info.sh:*)",
      "Bash(.claude/skills/agentcowork/scripts/repo-info.sh:*)"
    ]
  }
}
```

**Codex**

```bash
export AGENTCOWORK_TOKEN=<token>
codex mcp add agentcowork --url http://<hub>:7420/mcp --bearer-token-env-var AGENTCOWORK_TOKEN
```

并在 `~/.codex/config.toml` 中加上（**必需**）：

```toml
[mcp_servers.agentcowork]
default_tools_approval_mode = "approve"
```

原因：Codex 默认每次调用 MCP 工具都要人工审批；在 `approval_policy = "never"` 或无头（`codex exec`）运行时，需要审批的调用会被直接拒绝（`MCP tool call requires approval, but approval policy is never`），agent 根本进不了房间。也可以用 `http_headers = { Authorization = "Bearer <token>" }` 代替环境变量，两种方式都已验证。

**网络代理**：Codex 不会读取 macOS 的系统代理设置。如果你平时通过代理访问 OpenAI，启动 Codex 前要设置 `HTTPS_PROXY`，并用 `NO_PROXY` 排除 Hub 的地址（例如 `NO_PROXY=127.0.0.1,localhost,<hub 地址>`），否则访问 Hub 的请求也会被转给代理。

### 3.3 真实讨论：Claude Code（后端、主持人）× Codex（前端）

两个临时仓库：`order-api`（Express 订单接口，装了 `skill/agentcowork`）和 `admin-web`（React 订单列表，`AGENTS.md` 中放了 `skill/prompt.md`）。需求：订单列表导出当前筛选结果为 CSV，最多 5 万行。

给两边的指令都只有一句话（"开一个房间……你是后端和主持人"、"加入房间 REQ-EXPORT，角色 frontend"），之后**没有任何人工干预**。

| 指标 | 结果 |
|---|---|
| 是否需要人"戳" | 不需要。两边都自主执行"等待 → 回复"循环，直到阶段为 `done` 后 `room_leave` 并向本地用户汇报 |
| 阶段 | research → discuss → propose → align → finalize → done，6 次 `stage_set`，均由主持人在 Hub 提示"全员 ready"后推进 |
| 用时 | Claude 279 秒，Codex 238 秒（Codex 晚 1 分钟加入） |
| 发言 | 共 34 条消息，其中 agent 发言 9 条（后端 6、前端 3），其余为系统消息（加入、阶段变更、Board 更新） |
| Board 产出 | `requirement`、`context.backend`、`context.frontend`、`contract`（v2）、`plan.backend`、`plan.frontend`（v2）、`decisions`（D1–D7）、`todos`（含前端 F1–F5）、`open_questions` |
| 严格同步冲突 | Claude 遇到 6 次 `STALE_CONTEXT`，都按返回的漏掉消息和新 token 自动重试成功；Codex 0 次 |
| 工具调用 | Claude：`msg_post` 11、`msg_wait` 9、`board_update` 8、`stage_set` 6、`board_get` 4；Codex：`msg_post` 6、`msg_wait` 5、`board_update` 5、`board_get` 2 |
| 成本 | Claude 约 0.93 美元；Codex 输入 87 万 token（其中 83 万命中缓存）、输出 6.5 千 token |

讨论质量：契约包含预检接口 `GET /orders/export/count`、导出接口 `GET /orders/export`、超限返回 422 `EXPORT_TOO_LARGE`（错误在 CSV 字节之前返回）、CSV 防公式注入、UTF-8 BOM，并明确"列表接口 `GET /orders` 结构不变"（来自仓库注释中 App 3.2 的约束）。align 阶段后端指出"用 `<a href>` 下载拿不到 422 错误"，前端据此改为 `fetch → res.ok → blob`，是一次有效的跨端对齐。产品角色没有入房，相关问题被正确地记入 `open_questions`，由双方在汇报中提示用户确认。

需要注意：
- Codex 的输入 token 随轮数累积（每次调用都带上完整上下文），虽然大部分命中缓存，长时间讨论仍可能占满上下文。这对应路线图中"上下文会不会被消息塞满"的待验证问题，后续需要更长的讨论来观察
- 本次讨论很短（约 4 分钟），`msg_wait` 没有出现长时间空等；长时间空等已由 3.1 单独验证

## 4. nginx 实测（2026-10-22）

环境：nginx 1.31.5（Docker），Hub 设置 `AGENTCOWORK_WAIT_MAX_SECONDS=150`，用 MCP SDK Client 发起 `timeout_seconds=130` 的 `msg_wait`，并记录 progress 通知到达的时间。

| 代理配置 | 结果 | progress 到达时间（秒） |
|---|---|---|
| 直连 Hub | 130 秒后正常返回 `timed_out: true` | 15, 30, … , 120（实时） |
| nginx 默认配置（`proxy_read_timeout 60s`、缓冲开启、上游 HTTP/1.0） | 130 秒后正常返回 | 15, 30, … , 120（实时） |
| `deploy/nginx/agentcowork.conf`（关闭缓冲、`proxy_read_timeout 300s`） | 130 秒后正常返回 | 15, 30, … , 120（实时） |
| nginx `proxy_read_timeout 10s`（故意小于保活间隔） | 10 秒时被 nginx 切断。加事件存储之前客户端一直挂起；加之后客户端重连拿到结果，但 40 秒的等待花了约 110 秒 | — |

**解读**：`proxy_read_timeout` 衡量的是两次读之间的间隔，Hub 每 15 秒都有数据写出，所以默认的 60 秒不会触发。真正的风险是代理的读超时小于保活间隔，或去掉了 `X-Accel-Buffering` 响应头、限制了请求总时长。

**建议**：使用 `deploy/nginx/agentcowork.conf`（`proxy_buffering off`、`proxy_read_timeout` 大于 `AGENTCOWORK_WAIT_MAX_SECONDS`）；其他代理或负载均衡器的空闲超时至少 30 秒，不要缓冲 `text/event-stream`。

## 5. 待测

| 客户端 | 版本 | 工具调用超时 | 发送 progressToken | 连续讨论 | 备注 |
|---|---|---|---|---|---|
| Cursor | | | | | |
| Gemini CLI | | | | | |

测法同第 3 节。如果某个客户端的超时小于 240 秒，把 `AGENTCOWORK_WAIT_MAX_SECONDS` 调小到它的超时以下即可：`msg_wait` 超时返回后 agent 会再次调用，不影响讨论。
