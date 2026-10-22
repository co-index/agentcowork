# 03 · 开发路线

原则：**先验证最大风险，再补功能**。最大风险是"agent 能不能通过阻塞等待持续讨论，并且在各家客户端里不被超时切断"，所以 M1 只做这件事。

## M0 · 项目骨架（约 0.5 天）

- [x] pnpm workspace：`packages/shared`、`packages/server`、`packages/web`（先放空壳）
- [x] TypeScript 7 strict（`tsc` 兼做静态检查，不用 ESLint）、Prettier、Vitest
- [x] `agentcowork` CLI 入口（`host` / `serve` 子命令占位）
- [x] GitHub Actions：格式检查、类型检查、test

## M1 · 讨论核心跑通（Host 模式）⭐ 关键里程碑

- [x] Drizzle schema：rooms、participants、messages、reply_tokens（Board 放到 M2）
- [x] Repository（SQLite）、内存 EventBus
- [x] RoomService、MessageService（seq 分配、严格同步校验）
- [x] WaitCoordinator（挂起、唤醒、超时、断开清理、progress 心跳）
- [x] MCP Streamable HTTP 端点，带 Bearer token 认证
- [x] 工具：`room_create`、`room_join`、`room_leave`、`msg_wait`、`msg_post`、`msg_list`
- [x] `agentcowork host`：生成 token，打印局域网地址和客户端配置
- [x] 单元测试：同步冲突、token 只能用一次、等待唤醒、超时
- [x] 端到端测试：用 MCP SDK Client 模拟 3 个 agent 并发讨论

**验收：**
1. 开两个 worktree，各起一个 Claude Code，加入同一个房间，针对一个真实的小需求连续讨论 10 轮以上，中途不需要人手动"戳"它们
2. 实测并记录各客户端的工具调用超时：Claude Code、Codex 必测，Cursor、Gemini CLI 尽量测。把结论写进 `docs/05-client-compat.md`
3. 在 nginx 反向代理后面，长时间等待不被切断

## M2 · 结论板、阶段与行为规范

- [x] Board：`board_get`、`board_update`（乐观锁）、board_history
- [x] 阶段机：`stage_set`、`ready` 统计、发言上限、房间总消息上限、空闲暂停
- [x] `room_list`
- [x] 防注入：给消息加边界包装，`room_join` 返回 rules
- [x] 脱敏：识别常见密钥格式
- [ ] `skill/`：Claude Code Skill 和通用提示词模板（根据 04-agent-skill.md 定稿），自动收集 git 信息
- [ ] Web v0：房间列表、房间页（Thread 加 Board 只读）、人类发言

**验收：** 用一个真实需求从 `briefing` 走到 `done`，Board 中产出可用的 `contract` 和 `plan.frontend`、`plan.backend`。

## M3 · Server 模式

- [ ] AuthProvider 接口；实现 GitLab OAuth（支持私有 GitLab 地址）
- [ ] users、access_tokens、room_members；"我的令牌"页面
- [ ] Dockerfile、`deploy/docker-compose.yml`、nginx 示例配置（HTTPS 加长连接）
- [ ] 备份脚本和文档
- [ ] Web：登录、权限、踢人、暂停或关闭房间、编辑 Board

**验收：** 在公司内网服务器上部署，3 个同事用 GitLab 账号登录，各自的 agent 接入同一个房间完成一次需求讨论。

## M4 · 打磨

- [ ] `export` / `import` 房间迁移
- [ ] agent 断线重连、Hub 重启后自动恢复会话
- [ ] bug 房间模板和流程
- [ ] 审计日志
- [ ] 文档站，提供中英文 README

## M5 · 生态（按需）

- GitLab Webhook、OpenAPI 导入
- 飞书、钉钉通知
- PostgreSQL 加 Redis
- Agent Runner
- 契约变更订阅

## 待验证的问题

| 问题 | 在哪个里程碑验证 |
|---|---|
| 各客户端对长时间工具调用的超时上限是多少？能否通过 progress 通知续期？ | M1 |
| agent 能否在没有人干预的情况下持续执行"等待 → 回复"循环，还是需要 Skill 强约束？ | M1 |
| 讨论几十轮后，agent 的上下文会不会被消息塞满？是否需要在 `msg_wait` 返回中只给摘要？ | M1/M2 |
| token 成本：一次完整的需求讨论大约消耗多少？ | M2 |
| 各端并发发言时，冲突重试是否会导致频繁"空转"？ | M1 |
