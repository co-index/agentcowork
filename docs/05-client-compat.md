# 05 · 客户端与代理兼容性

M1 验收要求实测长时间阻塞的 `msg_wait` 在各客户端、反向代理下是否会被切断。本文件记录结论。

## 1. 结论速览

| 环节 | 状态 | 结论 |
|---|---|---|
| nginx 反向代理 | ✅ 已实测（2026-10-22） | 默认配置下 130 秒等待也不会被切断；仍建议使用 `deploy/nginx/agentcowork.conf` |
| Claude Code | ⏳ 待测 | |
| Codex | ⏳ 待测 | |
| Cursor | ⏳ 待测（尽量） | |
| Gemini CLI | ⏳ 待测（尽量） | |

## 2. Hub 侧保活机制

`msg_wait` 挂起期间，下面两种数据会在同一个 SSE 响应流上持续写出：

1. **SDK 保活帧**：MCP SDK 每 15 秒写一行 SSE 注释（`: keep-alive`），所有客户端都会收到
2. **progress 通知**：客户端请求里带了 `progressToken` 时，Hub 每 `AGENTCOWORK_HEARTBEAT_SECONDS`（默认 15 秒）发送一次 `notifications/progress`

另外，SDK 的 SSE 响应带有 `X-Accel-Buffering: no` 响应头，nginx 会为这个响应关闭缓冲。

**可续传**：每个 MCP 会话带一个有上限的内存事件存储（最多 500 条事件，保留 10 分钟）。如果代理切断了响应流，客户端会带着 `Last-Event-ID` 重连，Hub 重放漏掉的消息，包括 `msg_wait` 的最终结果。没有这一层时，结果会丢失，客户端会一直挂到自己的请求超时。

## 3. nginx 实测

环境：nginx 1.31.5（Docker），Hub 设置 `AGENTCOWORK_WAIT_MAX_SECONDS=150`，用 MCP SDK Client 发起 `timeout_seconds=130` 的 `msg_wait`，并记录 progress 通知到达的时间。

| 代理配置 | 结果 | progress 到达时间（秒） |
|---|---|---|
| 直连 Hub | 130 秒后正常返回 `timed_out: true` | 15, 30, … , 120（实时） |
| nginx 默认配置（`proxy_read_timeout 60s`、缓冲开启、上游 HTTP/1.0） | 130 秒后正常返回 | 15, 30, … , 120（实时） |
| `deploy/nginx/agentcowork.conf`（关闭缓冲、`proxy_read_timeout 300s`） | 130 秒后正常返回 | 15, 30, … , 120（实时） |
| nginx `proxy_read_timeout 10s`（故意小于保活间隔） | 10 秒时被 nginx 切断（`upstream timed out`）。**加事件存储之前**：客户端一直挂起；**加事件存储之后**：客户端重连并拿到结果，但 40 秒的等待花了约 110 秒（每次重连又被切断，客户端退避重试） | — |

**解读**

- `proxy_read_timeout` 衡量的是**两次读之间的间隔**，不是整个请求的时长。Hub 每 15 秒都有数据写出，所以默认的 60 秒不会触发
- 默认配置下 progress 也能实时到达，因为 SDK 的 `X-Accel-Buffering: no` 关掉了这个响应的缓冲
- 真正的风险是代理的读超时**小于保活间隔**，或者代理去掉了 `X-Accel-Buffering` 响应头、限制了请求总时长（一些负载均衡器和公司代理会这样做）。事件存储能兜底，但会明显变慢

**建议**

- 使用 `deploy/nginx/agentcowork.conf`：`proxy_buffering off`、`proxy_read_timeout` 大于 `AGENTCOWORK_WAIT_MAX_SECONDS`（默认 240 秒，示例配置为 300 秒）
- 其他代理或负载均衡器：空闲超时至少 30 秒（保活间隔的两倍），不要缓冲 `text/event-stream`
- Web 页面的 SSE（`/api/rooms/:room/events`）同样每 15 秒发保活帧，并带 `X-Accel-Buffering: no`

## 4. 客户端实测（待做）

每个客户端需要记录：

1. 单次工具调用的超时上限（让 `msg_wait` 用 `timeout_seconds=240` 跑满，看是否被客户端中断）
2. 客户端是否发送 `progressToken`，收到 progress 后是否会续期超时
3. 连续执行"等待 → 回复"循环 10 轮以上时，是否需要人工"戳"

测法：`pnpm build && pnpm host`，按启动输出把 Hub 加入客户端，然后让 agent 加入一个房间，在 Web 页面上观察成员状态（"在听"表示正在 `msg_wait`）。

| 客户端 | 版本 | 工具调用超时 | 发送 progressToken | progress 能否续期 | 连续 10 轮 | 备注 |
|---|---|---|---|---|---|---|
| Claude Code | | | | | | |
| Codex | | | | | | |
| Cursor | | | | | | |
| Gemini CLI | | | | | | |

如果某个客户端的超时小于 240 秒，把 `AGENTCOWORK_WAIT_MAX_SECONDS` 调小到它的超时以下即可：`msg_wait` 超时返回后 agent 会再次调用，不影响讨论。
