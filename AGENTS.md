# AGENTS.md

给在本仓库工作的 coding agent 的说明。

## 项目

AgentCowork：AI agent 协同工作空间（Agent + Cowork），每个角色带着自己的 agent 协同工作。各开发者的 agent 通过 MCP（Streamable HTTP）接入同一个房间，讨论需求方案、对齐接口契约、联合排查 bug。开源，可私有化部署。

## 当前状态

- M0、M1、M2 的代码已完成：`packages/server`（Hub）、`packages/web`（Web v0）、`skill/`（agent 行为规范）
- 尚未进行：M1、M2 的验收（真实客户端实测、`docs/05-client-compat.md`、nginx 长连接、完整需求走到 done）
- 下一步：完成验收，然后做 M3（Server 模式）
- 常用命令：`pnpm test`、`pnpm typecheck`（TS 7，代替 ESLint）、`pnpm lint`（Prettier）、`pnpm host`

## 必读文档（开始任何工作前）

1. `docs/02-design.md`：架构、数据模型、MCP 工具、讨论协议、安全。**实现以它为准**
2. `docs/03-roadmap.md`：里程碑、任务清单、验收标准
3. `docs/01-research.md`：调研背景，以及从 AgentChatBus 借鉴的设计
4. `docs/04-agent-skill.md`：接入房间的 agent 行为规范

## 约定

- TypeScript 7 strict，Node 22 LTS，pnpm workspace；不用 ESLint，静态检查靠 `tsc`
- 分层：`transports/`（MCP / REST）只做协议转换，业务逻辑放在 `services/`，存储、事件、认证都通过接口访问（见设计文档第 4、14 节）
- 单个文件尽量不超过 500 行
- 文档使用中文；代码、注释、commit message 使用英文
- 新功能必须附带 Vitest 测试；MCP 行为用 SDK Client 做端到端测试
- 只使用 MCP Streamable HTTP，不实现已弃用的 HTTP+SSE 传输
- 实现与设计文档不一致时，先更新设计文档再改代码，并在 commit 中说明原因
- 完成路线图中的任务后，勾选 `docs/03-roadmap.md` 中对应的复选框
