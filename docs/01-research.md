# 01 · 市场调研

调研时间：2026-10-22。星数和更新时间来自 GitHub API，部分产品主页无法打开，功能描述来自搜索摘要与官网首页。

## 结论

**没有完全符合需求的成熟产品。** 我们的核心诉求有四个：

1. 多人各自带自己的 agent 接入
2. agent 带着自己的 worktree / 仓库上下文
3. agent 之间实时讨论、收敛出方案
4. 私有化部署（公司使用私有 GitLab）

现有方案最多覆盖其中两项。SaaS 产品形态最完整，但不支持私有化部署；开源项目都处于早期。

## 现有方案对比

| 项目 | 类型 | 和需求的相似度 | 成熟度 | 主要差距 |
|---|---|---|---|---|
| [AgentChatBus](https://github.com/Killea/AgentChatBus) | 开源 MIT | 讨论机制最像：MCP 聊天总线，agent 之间互相讨论、辩论 | 60★，2026-08 有更新 | 单机定位；没有角色、仓库上下文、结论板、团队登录 |
| [Agent2Agent](https://github.com/BajaXX/Agent2Agent) | 开源 MIT | 定位最像：跨项目异步协作中枢，有消息、任务、文档、记忆，支持 Docker | 4★，2026-09 有更新 | 使用 HTTP REST 而非 MCP；偏异步邮箱，不支持实时讨论 |
| [Agent-MCP](https://github.com/rinadelph/Agent-MCP) | 开源 | 用 MCP 协调前后端等专业 agent | 1305★，但 2026-03 后停更 | 单人单项目内调度多个 agent，不支持多人多仓库 |
| [Kith-space](https://github.com/CKang-J/Kith-space) | 开源 Apache-2.0 | 本地多 agent 工作空间，有频道、任务、记忆，原生 MCP | 100★ | 定位个人工具 |
| [Shepherd](https://github.com/Korso-AI/Shepherd) | 开源 | 中心 Hub 加本地 MCP 的协调层 | 9★ | 非常早期 |
| [Agent Room](https://www.agent-room.com/) | SaaS | 房间、任务板、共享记忆，多台机器接入 | 有免费版和 Pro | 未找到私有化部署方案 |
| [AgentsMCP](https://agentsmcp.ai/) | SaaS（beta） | 共享工作区和任务交接，远程 MCP 加 OAuth | 免费 beta | 不支持私有化部署 |
| [GitHub Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) | 商业 | 统一调度多家 coding agent | 成熟 | 每个任务对应一个 agent，agent 之间不讨论；绑定 GitHub |
| [Linear Agents](https://linear.app/agents) | 商业 | issue 指派给 Cursor、Codex、Devin | 成熟 | 任务派发模式，不支持多 agent 协商 |
| MetaGPT / ChatDev / AgentVerse | 开源 | 一个系统内模拟多个角色 | 较成熟 | 方向不同：不是每人接入自己的 agent，也不接真实仓库 |

## AgentChatBus 源码分析

> 由 omp 只读分析，关键结论已人工抽查；分析完成后已删除临时克隆。

### 概况

- TypeScript / Node 20+、Fastify、官方 MCP SDK、SQLite（`node:sqlite`），MIT 协议
- 传输方式：stdio、Streamable HTTP、旧版 SSE（为兼容保留）；另有 Web 控制台、VS Code 插件
- 定位为单机消息总线，README 写明"只用 SQLite，不需要 Redis、Kafka、Docker"
- 代码耦合较重：`memoryStore.ts` 5129 行，HTTP server 3145 行，MCP tools 2178 行；同时维护 Python 旧后端

### 值得借鉴的设计 ✅

1. **`msg_wait` 阻塞等待**：服务端挂起请求，有新消息时唤醒，默认超时 5 分钟，服务端记录哪些 agent 正在等待。这解决了"agent 是一问一答的，不会自己听消息"的问题
2. **`seq` + 一次性 `reply_token` 严格同步**：`msg_post` 必须带 `expected_last_seq` 和未使用过的 `reply_token`。有人插话、token 过期或已用过时，发言会被拒绝，agent 需要重新等待、读取新消息后再发言。可以防止抢话和基于过期上下文回复
3. **讨论生命周期**：`discuss → implement → review → done → closed`，发言可附带 `stop_reason`（convergence / impasse / complete 等）
4. **`handoff_target` 定向交接**，配合 `msg_wait(for_agent)`
5. **`bus_connect`**：一步完成注册和加入，接入成本低
6. **空闲超时自动关闭、心跳、协调者 / 管理员接管**

### 不适合直接 fork 的原因 ❌

- 认证只有 agent token 和管理员 token，没有用户、团队、OAuth
- 只能单机部署（SQLite 加进程内 Map 保存会话），不支持多副本
- 没有仓库、worktree 的概念（只有一个本地目录路径 `workspace`），没有结论板
- 核心文件过大，业务和协议耦合，改造成本高于重写

**结论：参考它的设计重写，不 fork。**
