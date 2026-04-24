# 用户能在 Claude 的生命周期里插多少个钩子？

Claude Code 的 Hooks 系统是其可扩展性的核心——它允许你在工具调用、会话启动/结束、权限判断、AI 轮次完成等几乎所有关键节点插入自定义逻辑。从简单的 shell 脚本到完整的多轮 AI Agent，Hooks 的能力远超大多数人的想象。本章完整梳理 27 个事件节点、4 种执行方式和退出码语义。

> 💡 **通俗理解**：就像快递柜的通知设置——快递到了发短信，被签收了发短信，你还可以自定义通知方式。

### 🌍 行业背景

Hook/插件系统是开发工具可扩展性的基石，AI 编码工具也在逐步构建自己的生命周期钩子体系：

- **Cursor**：通过 VS Code 的扩展 API 间接支持自定义行为（如 `onDidSaveTextDocument` 等事件），但这些是 IDE 层面的钩子，不是 AI Agent 生命周期的钩子。Cursor 没有提供 AI 轮次完成、权限请求等 AI 特有节点的钩子。
- **Aider**：不提供 hook 系统。用户可以通过 `--auto-commits`、`--lint-cmd` 等命令行参数配置提交和 lint 行为，但这是预定义行为而非可编程的钩子。
- **Windsurf**：同样基于 VS Code 扩展体系，无独立的 AI 生命周期 hook 系统。
- **Codex（OpenAI）**：v0.118.0 支持通过配置文件定义工具调用前后的行为约束，其开源技能库（Figma/Linear 原生集成）代表了"预定义能力扩展"路线。但不提供用户可编程的 shell 钩子或 Agent 类型钩子。
- **LangChain / LangGraph（Callbacks）**：提供了丰富的回调系统——`on_llm_start`、`on_tool_start`、`on_tool_end`、`on_chain_error` 等，这是 Agent 框架级别的钩子。LangChain 的回调机制在概念上与 Claude Code 的 Hooks 最相似，但它面向的是开发者构建 Agent 应用，而非终端用户自定义工作流。
- **Git Hooks**：Claude Code 的 hook 系统在设计哲学上明显借鉴了 Git 的 hook 机制——通过 shell 脚本在特定事件节点执行自定义逻辑，用退出码控制流程（Git 的 `pre-commit` hook 返回非零值时阻止提交，与 Claude Code 的 `exit 2` 阻断语义同源）。

Claude Code 的 27 个事件节点 + 4 种执行方式（command / prompt / agent / http）据本文截至 2026-04 的梳理，是 AI 编码工具中覆盖面非常广的 hook 系统（上述竞品断言基于公开文档与社区讨论，未穷举所有闭源实现）。特别是 `type: "agent"` 类型的 hook（启动独立 AI 来验证结果）在主流开源/商用工具的公开文档中尚未见到直接对应物。但需要认识到，丰富的 hook 系统也意味着更高的学习成本和调试复杂度。

---

## 问题

Claude Code 有一个"hooks"系统，你可以在 `settings.json` 里配置。但这个系统到底有多深？你真正能做到什么？

---

## 答案：27 个事件节点，4 种执行方式

### 4 种执行方式速查

| `type` | 用途 | 典型场景 |
|--------|------|---------|
| `command` | 执行 shell 命令（默认） | 跑 lint、调 CLI、写日志 |
| `prompt` | 把 hook 配置里的文本作为一次 `/slash` 风格的提示直接注入到主对话 | 自动追加"请再确认"/"不要提交密钥"这种静态提醒 |
| `agent` | 启动独立的多轮 AI Agent（最多 50 轮，由 `MAX_AGENT_TURNS` 常量限制） | Stop 验证、安全审查、需要读 transcript 的判断 |
| `http` | 向指定 endpoint 发 HTTP 请求并处理响应 | 调用企业审批 API、接入外部告警系统 |

`command` 和 `agent` 是日常最常用的两种；`prompt` 和 `http` 面向更高级的工作流集成。


> **[图表预留 2.10-A]**：Claude 生命周期图——完整展示 27 个事件节点在会话时间轴上的分布位置，按工具/权限/AI轮次/Session/Swarm等类别着色

完整的 hook 事件列表比大多数人意识到的要多得多。

### 工具生命周期的三个节点

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo 'about to run bash'" }] }],
    "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "eslint $CLAUDE_FILE_PATHS" }] }],
    "PostToolUseFailure": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "notify_failure.sh" }] }]
  }
}
```

`PostToolUse` 是最常用的——编辑完文件后自动跑 lint，这比让 AI 每次手动跑要可靠得多。

注意 `PostToolUseFailure` 的语义：工具**已经失败**再触发，这时 hook 返回非零退出码（包括 `exit 2`）并不会"阻断原工具调用"（已经失败了），实际效果更接近"额外记录/通知"，不要把它当普通拦截点用。

**`matcher` 字段匹配语义**（源码 `matchesPattern()`，`utils/hooks.ts:1346`）：

1. 空字符串 / `*` → 匹配所有
2. 简单标识符（仅字母、数字、下划线）→ 精确等值匹配（如 `"Bash"` 只匹配 `Bash`）
3. 竖线分隔 → 多个精确值的 OR（如 `"Write|Edit"` 匹配 `Write` 或 `Edit`）
4. 其他 → 当正则解析（如 `"^Write.*"`），支持 JavaScript RegExp 完整语法；无效正则会降级为"不匹配"

注意它**不是 glob**，想要模糊匹配必须写正则。

### 整个 session 的进出口

```
SessionStart  — session 启动时（区分 startup/resume/clear/compact）
SessionEnd    — session 结束时（1500ms 超时，比工具超时短得多）
```

`SessionEnd` 的 1500ms 超时是有意设计的：Claude Code 在退出时不能无限等待用户的 teardown 脚本。但如果你的脚本需要更多时间，可以用环境变量覆盖：

```bash
CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000
```

### 权限流程的两个插入点

```
PermissionDenied  — auto 模式分类器拒绝了一个工具调用
PermissionRequest — 权限对话框即将显示
```

`PermissionRequest` 这个节点特别有用：你可以返回一个 `hookSpecificOutput`，完全替代用户的手动确认：

```json
{ "hookSpecificOutput": { "decision": "allow" } }
```

这让企业用户可以通过自己的审批系统来管理权限，而不是依赖 Claude 内置的弹窗。

### AI 轮次的守门员

```
Stop        — Claude 即将结束本轮回答（exit 2 = 阻断，让 Claude 继续）
StopFailure — API 错误结束轮次（fire-and-forget，忽略输出）
```

`Stop` hook 是"验证 AI 完成了任务"的理想场所。但如果用普通 shell 命令还不够，你可以用 **agent** 类型的 hook：

```json
{
  "Stop": [{
    "hooks": [{
      "type": "agent",
      "prompt": "验证所有测试都通过了，所有 TODO 注释都已解决。$ARGUMENTS"
    }]
  }]
}
```

这会启动一个完整的多轮 AI Agent（最多 50 轮，对应 `MAX_AGENT_TURNS = 50`，定义于 `src/utils/hooks/execAgentHook.ts:119`），读取 transcript、检查代码库，然后返回 `{ ok: true/false, reason: "..." }`。如果 `ok: false`，Claude 会收到失败原因并继续工作。

其中 `$ARGUMENTS` 会被替换为该事件的 JSON 输入体（通过 `addArgumentsToPrompt()`，`execAgentHook.ts:60`）。对 `Stop` 事件来说，输入里包含 session 元数据、transcript path、stop hook 特有字段（是否因错误结束等），不是"用户最后一条消息"。

---

## 退出码的语义：双轨制

> **[图表预留 2.10-B]**：退出码语义对照表——行：退出码（0/2/其他非零），列：不同 Hook 事件，格子内容：对应效果（允许/阻断给模型/阻断给用户/忽略）

> 📚 **课程关联**：退出码语义设计对应《操作系统》课程中的**进程间通信**（IPC）和**信号机制**章节。在 Unix/POSIX 系统中，进程退出码（0-255）是父子进程间最基本的通信方式——`wait()` 系统调用通过 `WEXITSTATUS` 宏获取子进程退出码。POSIX 只规定了 `exit 0`（成功）和非零（失败）；Bash 手册将 exit 2 定义为"shell 命令用法错误"（misuse of shell builtins），但这不是一个通用约定。Claude Code 选择 exit 2 作为"阻断"语义，主要是因为需要一个不与 exit 1（通用错误）冲突的小整数——这是一种务实的工程约定，而非对某个 Unix 传统的直接继承。

最反直觉的设计：**退出码 2 和其他非零退出码意思完全不同**。

| 退出码 | 效果 |
|--------|------|
| 0 | 成功；stdout 可能传给 Claude |
| **2** | **阻断** — stderr 展示给 Claude，操作被中止 |
| 1, 3, 4... | 非阻断错误 — stderr 只展示给用户 |

这个设计的核心思路是区分两种不同性质的失败：exit 1 表示"hook 脚本自身出了问题"（不应影响 Claude 的行为），而 exit 2 表示"hook 有意阻断这个操作"（错误信息需要传递给 AI 模型）。选择 2 是尊重 Unix/POSIX 的常见传统——shell 用 exit 1 表示通用失败，exit 2 在 Bash 手册里被标注为"shell 命令误用"（misuse of shell builtins）；Claude Code 借用这个"已经有'特殊语义'气味的次小整数"来承载"有意阻断"，是工程约定而非 POSIX 强制规定。

具体例子（`PreToolUse`）：
- `exit 0`：hook 跑完，工具继续执行；若 hook 返回了 `hookSpecificOutput`（JSON stdout）或 `additionalContext`，Claude 会看到对应字段，否则普通 stdout 不额外注入对话
- `exit 2`：stderr 传给 Claude，Claude 看到错误信息，工具调用被阻断
- `exit 1`：stderr 只显示给用户，工具继续执行（Claude 不知道发生了什么）

注意 `exit 0` 的 stdout 在不同事件下语义不同：`UserPromptSubmit` / `SessionStart` 的 stdout 会作为 additional context 追加到对话；`PreToolUse` 普通 stdout 默认不会注入，必须走结构化 `hookSpecificOutput` JSON。

---

## 安全：所有 hooks 都需要工作区信任

有一段注释说清楚了背后的故事：

```typescript
// ALL hooks require workspace trust because they execute arbitrary commands
// from .claude/settings.json.
//
// Historical vulnerabilities that prompted this check:
// - SessionEnd hooks executing when user declines trust dialog
// - SubagentStop hooks executing when subagent completes before trust
```

这是一个真实的漏洞历史——有人发现 SessionEnd hook 可以在用户拒绝信任对话框时仍然执行。现在的设计是铁板一块：无论什么 hook，无论什么时机，都需要 `hasTrustDialogAccepted() === true`。

---

## 一个不在文档里的节点：FileChanged

```json
{
  "FileChanged": [{
    "matcher": ".envrc|.env",
    "hooks": [{ "type": "command", "command": "direnv allow && direnv exec . env > $CLAUDE_ENV_FILE" }]
  }]
}
```

这个 hook 允许你监视文件变化，并通过 `CLAUDE_ENV_FILE` 修改 Claude 后续 Bash 命令的环境变量。当 `.envrc` 文件改变时，自动更新 Claude 能看到的环境变量——这基本上是 direnv 的 Claude Code 版本。

**`$CLAUDE_ENV_FILE` 来自哪里**：由 hook 运行时在 `SessionStart` / `Setup` / `CwdChanged` / `FileChanged` 这四类事件下**由 Claude Code 主进程设置**（源码 `utils/hooks.ts:917-925`），指向一个临时 `.sh` 文件路径。hook 脚本按 bash `export FOO=bar` 语法写进该文件，主进程在后续运行 BashTool 命令前将其内容拼接进去。PowerShell hook 不会被设置这个变量（因为语法不兼容）。

---

## 27 个事件的完整分布

```
工具层      PreToolUse, PostToolUse, PostToolUseFailure
权限层      PermissionDenied, PermissionRequest
用户输入    UserPromptSubmit
通知层      Notification（Claude 要向用户发通知时触发；分类依据是"由 Claude 侧主动触达用户"，而非"用户输入"）
Session     SessionStart, SessionEnd
AI 轮次     Stop, StopFailure
子 Agent    SubagentStart, SubagentStop
压缩        PreCompact, PostCompact
配置        Setup, ConfigChange, InstructionsLoaded
团队协作    TeammateIdle, TaskCreated, TaskCompleted
MCP 交互    Elicitation, ElicitationResult
文件系统    WorktreeCreate, WorktreeRemove, CwdChanged, FileChanged
```

几乎每个有意义的系统节点都有对应的 hook。从代码提交历史来看，hook 事件节点是随功能迭代逐步增加的（早期版本仅有工具层和 Session 层的钩子），但整体架构从一开始就为扩展预留了统一的注册和分发机制。

---

## 局限性与批判

- **退出码语义反直觉**：`exit 2` 表示阻断（给模型看）而非零退出码表示非阻断错误（只给用户看），这种约定容易让不熟悉的用户写出行为相反的 hook 脚本
- **Agent 类型 hook 成本不透明**：一个 `type: "agent"` 的 Stop hook 最多运行 50 轮 AI 推理，但用户在配置时很难预估这会带来多少额外 token 消耗
- **信任模型过于二元**：所有 hook 都依赖 `hasTrustDialogAccepted()` 的全局信任状态，没有更细粒度的"信任这个 hook 但不信任那个"的机制

---

## 代码落点

- `src/hooks/` — Hooks 系统顶层目录
- `src/services/hooks/` — Hooks 服务层实现
- `src/utils/hooks.ts`，第 330-350 行：`HookResult` 类型（四种 outcome）
- `src/utils/hooks/hooksConfigManager.ts`，第 26-265 行：`getHookEventMetadata()`（所有事件的描述和匹配器）
- `src/utils/hooks/execAgentHook.ts`，第 36 行：`execAgentHook()`（多轮 AI hook 的完整实现）
- `src/utils/hooks.ts`，第 286-296 行：`shouldSkipHookDueToTrust()`（信任检查）
- `src/utils/hooks.ts`，第 167-182 行：`getSessionEndHookTimeoutMs()`（SessionEnd 超时）
