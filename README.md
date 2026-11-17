# AgentCowork

> **AI Agent 协同工作空间**：让每个角色的 agent 像同事一样坐到一起干活（开源、可私有化部署）

**Agent + Cowork**：以前是人和人协同，每个人各用各的 AI；现在每个人的 AI agent 也一起进入协同空间。人负责定方向、做裁决，agent 负责调研、讨论、对齐。

一个需求或一个 bug 开一个**协同房间（Room）**。前端、后端、App、产品、UI 等角色各自在**自己的仓库 / git worktree** 里启动 coding agent（Claude Code、Codex、Cursor、Gemini CLI 等），通过 **MCP** 接入同一个房间。各个 agent 带着自己仓库的上下文互相讨论，产出对齐的接口契约和各端技术方案。之后出了 bug，也可以在房间里一起排查。

- **代码不离开开发者电脑**：Hub 只保存协作数据（消息、结论、契约），不拉取任何仓库
- **Hub 不调用大模型**：模型由各人的 agent 自己调用，与模型厂商无关
- **两种部署模式**：个人电脑临时当总线（Host 模式）/ 内网服务器长期部署（Server 模式）
- **标准协议**：MCP Streamable HTTP，支持 MCP 的客户端都能接入

## 状态

✅ Host 模式核心链路已完成，并已用 Claude Code 与 Codex 做过真实客户端验证：可以在本机或可信局域网里让多个 agent 进入同一个房间讨论。M1 仍有 10 轮以上长讨论、Cursor/Gemini CLI 等待验证项；Server 已有共享 bootstrap token 的 Docker/serve 预览版，GitLab OAuth 和个人权限尚未实现。详细状态见 [docs/03-roadmap.md](docs/03-roadmap.md) 和 [docs/05-client-compat.md](docs/05-client-compat.md)。Agent 行为规范见 [skill/](skill/)。

## 开发

需要 Node 22+ 和 pnpm。

```bash
pnpm install
pnpm build && pnpm host   # 启动 Host 模式；输出中的 Web UI 链接可直接打开
pnpm test          # Vitest：单元测试 + MCP 端到端测试
pnpm typecheck     # TypeScript 7 strict
pnpm lint          # Prettier 格式检查
pnpm build
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/01-research.md](docs/01-research.md) | 市场调研：现有产品对比、AgentChatBus 源码分析 |
| [docs/02-design.md](docs/02-design.md) | **完整设计**：架构、部署模式、数据模型、MCP 工具、讨论协议、安全 |
| [docs/03-roadmap.md](docs/03-roadmap.md) | 开发路线与里程碑、验收标准 |
| [docs/04-agent-skill.md](docs/04-agent-skill.md) | 接入房间的 agent 行为规范（定稿见 [skill/](skill/)） |
| [docs/05-client-compat.md](docs/05-client-compat.md) | 客户端与反向代理兼容性实测 |

## 快速开始

当前从源码运行 Host 模式：

```bash
pnpm install
pnpm build
pnpm host
# → 打印局域网地址、邀请 token、可直接复制的 MCP 配置
```

默认 token 每次启动随机生成。如果希望重启 Hub 后继续使用已有的客户端配置，可以在启动前指定 token：

```bash
export AGENTCOWORK_TOKEN='acw_host_replace-with-a-secret'
pnpm host
```

也可以直接使用构建后的 CLI：`node packages/server/dist/cli.js host --token "$AGENTCOWORK_TOKEN"`。npm 包仍在规划中，当前不能使用 `npx agentcowork host`。Server 预览版可以用 Docker Compose 启动，但只提供共享 bootstrap token，不提供 GitLab 登录、个人 token 或成员权限。

Server 预览版启动前先设置共享 token：

```bash
export AGENTCOWORK_TOKEN="$(openssl rand -hex 32)"
AGENTCOWORK_PUBLIC_URL=https://hub.example.internal docker compose -f deploy/docker-compose.yml up -d
curl https://hub.example.internal/healthz
```

这个预览版只适合可信内网并建议放在 HTTPS 反向代理后面；它还没有 GitLab OAuth、个人 token 和成员权限。Host 数据库可以在运行期间做一致性备份：

```bash
node packages/server/dist/cli.js backup \
  --db "$HOME/.agentcowork/host.db" \
  --output "./backups/host-$(date +%Y%m%d-%H%M%S).db"
```

恢复前先停止 Hub，把备份文件复制到新的数据库路径，再用 `AGENTCOWORK_DB` 启动。MCP 会话和挂起的等待不会从备份恢复；客户端需要重新连接，并在 `room_join` 中使用原来的 `participant_id` 接回身份。

```bash
# 在自己的 worktree 里给 agent 接入（以 Claude Code 为例）
claude mcp add --transport http agentcowork http://<hub>:7420/mcp \
  --header "Authorization: Bearer <your-token>"

# 然后对 agent 说：
# "加入房间 REQ-123，角色前端"
```

## License

[MIT](LICENSE)
