# Agent 行为规范（Skill）

加入 AgentCowork 房间的 agent 使用的行为规范，定稿自 `docs/04-agent-skill.md`。

| 文件 | 用途 |
|---|---|
| `agentcowork/SKILL.md` | Claude Code Skill：触发条件、主循环、发言原则、阶段行为、安全边界、结束汇报格式 |
| `agentcowork/scripts/repo-info.sh` | 输出当前仓库信息（JSON），作为 `room_join` 的 `repo` 参数；会去掉 remote URL 中的账号密码 |
| `prompt.md` | 通用提示词模板，给不支持 Skill 的客户端（Codex、Cursor、Gemini CLI 等）使用 |

## 安装

Claude Code（个人级，所有项目可用）：

```bash
mkdir -p ~/.claude/skills
cp -r skill/agentcowork ~/.claude/skills/
```

只在某个仓库里使用时，复制到该仓库的 `.claude/skills/`。

其他客户端：把 `prompt.md` 中分隔线以下的内容加入项目说明文件（`AGENTS.md`、`GEMINI.md`、Cursor rules 等）。

Hub 的 `room_join` 也会在 `rules` 字段中返回精简版规范，所以即使没装 Skill，agent 也能拿到基本约束；Skill 的作用是让行为更稳定，并提供自动收集 git 信息的脚本。

## 建议

给加入房间的 agent 设置较严格的权限模式（例如 Claude Code 的默认模式，不要用 bypass），让执行命令、改文件都需要你确认。
