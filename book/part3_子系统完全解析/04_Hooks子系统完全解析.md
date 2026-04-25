# Hooks 子系统完全解析

你用过快递通知吗？"包裹到了自动发短信"、"签收前需要验证身份"、"配送失败自动转寄"——这就是 Hooks 做的事，只不过它管的不是快递，而是 Claude 的每一个动作。

Hooks（钩子）让你可以在 Claude Code 的 **27 个关键时刻**插入自定义逻辑——工具调用前拦截、权限决策自动化、AI 完成任务前检查"你真的做完了吗？"——全部通过编辑一个配置文件实现，不需要改源码。本章将完整枚举这 27 个事件、4 种执行类型、以及退出码的双轨语义设计。

> **源码位置**：`src/hooks/`（104 个文件）、`src/services/hooks/`

> 💡 **通俗理解**：把 Hooks 想象成快递柜的通知设置：
> - "包裹到达时自动短信通知" → `PostToolUse`（工具用完后通知）
> - "签收前需要验证身份" → `PreToolUse` + exit 2（工具执行前拦截）
> - "配送失败时自动转寄" → `StopFailure`（失败时触发备用方案）
> - 通知方式可选：短信（command）、AI 判断（prompt/agent）、系统对接（http）

了解了这个类比，下面我们来看 Hooks 在行业中的位置。

> 🌍 **行业背景**：生命周期钩子（Lifecycle Hooks）是软件工程中的成熟设计模式。**Git** 本身就有 pre-commit/post-commit hooks，Claude Code 在 Pre/Post 命名惯例上借鉴了 Git；但退出码语义是 Claude Code 自定义的——Git hooks 只区分 0 vs 非 0，Claude Code 进一步细分出 0 / 2 / 其他非零 的三档含义（详见第 3 节）。同类 AI 工具中：**Cursor** 通过 `.cursorrules` 注入项目指令但没有事件钩子；**Aider** 的 `--lint-cmd`/`--test-cmd` 相当于 Claude Code 两个 hook 的特化版；**LangChain** 的 Callbacks 概念最接近但是代码 API 而非配置驱动。Claude Code 的 27 个事件 + 4 种执行类型 + exit 2 阻断语义的组合，在上述几家竞品中覆盖面较广，但学习曲线也最陡。

---

## 概述

Hooks 是 Claude Code 的**生命周期注入点系统**——用户可以在系统的 27 个预定义事件上注册自定义逻辑（shell 命令、AI 提示词、HTTP 请求或多轮 Agent），在不修改 Claude Code 源码的情况下改变其行为。从工具调用前的拦截、到权限决策的自动化、到子 Agent 的停止条件验证，Hooks 几乎可以介入系统的每一个关键决策点。

---

> **[图表预留 3.4-A]**：生命周期图 — 27 个事件在 Session/Query/Tool/Agent 四层生命周期中的位置

> **[图表预留 3.4-B]**：退出码决策表 — exit 0/2/其他 在不同事件类型中的不同语义

---

## 1. 27 个事件的完整分类

### 1.1 工具生命周期（3 个）

| 事件 | 触发时机 | 可阻断？ | stdout 用途 |
|------|---------|---------|------------|
| `PreToolUse` | 工具调用之前 | ✅ exit 2 阻断（见下方说明） | stderr 展示给模型 |
| `PostToolUse` | 工具调用之后 | ❌ | stdout 注入给模型 |
| `PostToolUseFailure` | 工具调用失败时 | ❌ | fire-and-forget（"发射后不管"——只通知，不等回应） |

> 💡 **退出码（exit code）是什么？** 每个程序运行结束时都会返回一个数字，告诉系统"我执行得怎么样"。**exit 0** = "一切正常，放行"；**exit 2** = "我要拦截这个操作，不许执行"；**其他数字** = "我出错了，但别影响正常流程"。这就像交通信号灯：绿灯放行、红灯拦停、黄灯闪烁（异常但不阻断）。

`PreToolUse` 是最强大的 hook——它可以在任何工具执行前拦截。典型用例：CI 环境中禁止 Claude 修改特定目录、或者在执行危险命令前发送通知。

### 1.2 权限相关（2 个）

| 事件 | 触发时机 | 特殊能力 |
|------|---------|---------|
| `PermissionDenied` | auto 分类器拒绝后 | exit 2 可要求模型重试 |
| `PermissionRequest` | 权限弹窗显示时 | `hookSpecificOutput` 可替代用户决策 |

`PermissionRequest` hook 可以**自动回答权限弹窗**——这意味着你可以编写一个脚本，根据自定义规则自动审批或拒绝 Claude 的工具调用请求，实现完全无人值守的自动化流水线。

> **权限决策的合并逻辑：deny > ask > allow**
>
> 当同一事件上注册了多个 Hook 时，它们的权限决策按**最严格优先**的规则合并：
> - 任何一个 Hook 返回 `deny` → 最终决策为 **deny**
> - 没有 deny，但有 Hook 返回 `ask` → 最终决策为 **ask**（需要用户确认）
> - 所有 Hook 都返回 `allow` → 最终决策为 **allow**
>
> **两套短路规则的作用域**：
> - **权限决策合并**（上述）作用于**权限类事件**（`PermissionRequest` / `PreToolUse` 等返回结构化 decision 的场景），按"所有 Hook 结果收上来再合并"的方式执行——没有短路。
> - **exit 2 串行短路**（见第 1.x 节"串行执行模型"）作用于**同一事件上的多个 Hook 串行执行**：如果第一个 Hook 返回 exit 2 阻断，后续 Hook 不再执行。这个短路作用于执行链路，不作用于 decision 合并——因为它直接阻断操作，不需要再合并结果。
>
> 这个设计有一个重要的**安全不变量**（security invariant，指系统在任何状态下都必须保持为真的安全属性）：**Hook 只能收紧权限，不能放松权限**。也就是说，如果配置文件中已经 deny 了某个操作，Hook 返回 allow 也无法覆盖这个 deny。这防止了恶意或配置错误的 Hook 通过返回 allow 来绕过安全策略。

> ⚠️ **安全威胁模型**：`PermissionRequest` 本质上是**绕过权限系统的官方接口**，其安全含义需要严肃对待：
>
> **供应链攻击向量**：供应链攻击（supply chain attack）是指攻击者不直接攻击你，而是在你信任的"上游"资源中埋下陷阱——就像在超市的食品供应链中投毒。具体到这里：如果攻击者在一个开源仓库的 `.claude/settings.json` 中注入了一个 `PermissionRequest` hook（返回 `{ decision: "allow" }`），任何下载（克隆）该仓库并信任其工作区的用户都会自动批准所有危险操作——包括删除所有文件、任意网络请求、或修改系统文件。这与恶意 npm 包（JavaScript 生态中的第三方库）的攻击模式类似，但影响更直接。
>
> **唯一防线**：当前系统依赖 `hasTrustDialogAccepted()` 的二元信任模型——用户在首次使用时确认信任工作区后，该工作区内的所有 hooks 都获得执行权限。没有更细粒度的"信任这个 hook 但不信任那个"的机制。这意味着信任决策是全有或全无的：一旦信任了工作区，就信任了其中所有 hooks。
>
> **缺失的防御层**：以下三条均为源码审阅结论（不是推测）——在 `src/hooks/`、`src/schemas/hooks.ts`、`src/utils/hooks/execCommandHook.ts` 中，**没有** 签名验证逻辑、没有 spawn 子进程前的沙箱 setup、也没有把 hook 执行写入独立审计 sink 的代码路径。对于企业部署场景，建议：(1) 代码审查所有 `.claude/settings.json` 变更；(2) 使用 `localSettings`（位于 `.claude/settings.local.json`，默认被 gitignore 忽略、仅当前开发者本地可见）而非 `projectSettings`（`.claude/settings.json`，提交到版本库、团队所有人共享）配置敏感 hooks——这样即使仓库被篡改，你本地的 hooks 也不会被 PR 覆盖；(3) 考虑搭配 `PreToolUse` hook 做二次验证。

> **OpenClaw 引用说明**：本章第 6.x 节提到 OpenClaw 作为对比参考，该项目是社区内对"可观测性优先的 Agent 框架"的代表性讨论对象。由于它未形成单一官方 spec，这里的对比基于公开讨论和源码观察，不附权威文献链接——读者在严格场景下应自行交叉验证。

### 1.3 Session 生命周期（2 个）

| 事件 | 触发时机 | 子类型 |
|------|---------|--------|
| `SessionStart` | 新 session 开始时 | startup/resume/clear/compact |
| `SessionEnd` | session 结束时 | clear/logout/prompt_input_exit/other |

### 1.4 AI 轮次（2 个）

| 事件 | 触发时机 | 可阻断？ |
|------|---------|---------|
| `Stop` | Claude 即将结束本轮回答 | ✅ exit 2 阻止结束，继续工作 |
| `StopFailure` | 因 API 错误结束 | ❌ fire-and-forget |

`Stop` hook 是实现"验证循环"的关键——你可以在 Claude 认为任务完成时运行测试，如果测试失败则 exit 2 让 Claude 继续修复。

### 1.5 用户交互（2 个）

| 事件 | 触发时机 | 能力 |
|------|---------|------|
| `UserPromptSubmit` | 用户提交 prompt | 可修改或阻断 prompt |
| `Notification` | 发送通知 | 自定义通知通道 |

`UserPromptSubmit` 可以**修改用户输入**——比如自动添加上下文、替换缩写、或在特定条件下拒绝提交。

### 1.6 子 Agent（2 个）

| 事件 | 触发时机 | 可阻断？ |
|------|---------|---------|
| `SubagentStart` | Agent 工具调用开始 | ❌（stdout 传给子 Agent） |
| `SubagentStop` | 子 Agent 即将结束 | ✅ exit 2 阻止结束 |

### 1.7 上下文压缩（2 个）

| 事件 | 触发时机 | 能力 |
|------|---------|------|
| `PreCompact` | 压缩之前 | stdout 作为自定义压缩指令；exit 2 阻断 |
| `PostCompact` | 压缩之后 | 观察 |

### 1.8 配置与指令（3 个）

| 事件 | 触发时机 | 能力 |
|------|---------|------|
| `Setup` | 初始化/维护 | init/maintenance 子类型 |
| `ConfigChange` | 配置文件变化 | exit 2 阻断变化应用 |
| `InstructionsLoaded` | CLAUDE.md 加载 | 仅观察 |

### 1.9 团队协作（3 个）

| 事件 | 触发时机 | 可阻断？ |
|------|---------|---------|
| `TeammateIdle` | Teammate 即将空闲 | ✅ exit 2 阻止 |
| `TaskCreated` | 任务被创建 | ✅ exit 2 阻止 |
| `TaskCompleted` | 任务标记完成 | ✅ exit 2 阻止 |

### 1.10 MCP 交互（2 个）

| 事件 | 触发时机 | 能力 |
|------|---------|------|
| `Elicitation` | MCP 请求用户输入 | 可自动响应 |
| `ElicitationResult` | 用户响应后 | 可覆盖响应 |

### 1.11 文件系统（4 个）

| 事件 | 触发时机 | 特殊能力 |
|------|---------|---------|
| `WorktreeCreate` | 创建 worktree | stdout = worktree 路径 |
| `WorktreeRemove` | 删除 worktree | — |
| `CwdChanged` | 工作目录变化 | CLAUDE_ENV_FILE 修改环境变量 |
| `FileChanged` | 文件变化 | 动态调整监视路径 |

### 事件粒度的设计分析：为什么是 27 个？

27 这个数字不是一次性设计的结果，而是随功能迭代逐步增长的产物。但观察事件分布可以发现设计者在粒度选择上的思考模式：

**不对称的粒度选择**：工具层有 3 个事件（Pre/Post/PostFailure），但 Session 层只有 2 个（Start/End）。为什么没有 `PreSessionEnd`？因为工具调用是可阻断的（用户可能想在工具执行前拦截），但 Session 结束通常是用户主动发起，拦截的价值不大。这体现了一个设计原则：**事件粒度跟随阻断价值，而非机械对称**。

**为什么 Stop 和 StopFailure 分开？** 这是 `fire-and-forget` 模式的体现。`StopFailure`（API 错误导致的停止）不支持阻断，因为此时 API 连接已经断开，阻断没有意义——你不能让一个已经失败的 API 调用"继续"。这与 `PostToolUseFailure` 的设计逻辑一致：失败事件是通知性质，不是决策点。

**配置驱动 vs 代码驱动的根本选择**：Claude Code 通过 `settings.json` 配置 hooks，而非像 LangChain 那样通过代码 API（`handler.on_tool_start()`）注册。这个选择决定了整个系统的性格：(a) 非开发者也可以配置 hooks——只需编辑 JSON；(b) 复杂逻辑必须外化为 shell 脚本，调试链条变长（JSON -> shell -> 实际逻辑）；(c) hooks 无法在运行时动态注册或注销（LangChain 的 Callbacks 可以）。这是"可配置性"与"可编程性"之间的取舍——Claude Code 选择了前者，降低了入门门槛但牺牲了灵活性。

**串行执行模型**：同一事件上注册的多个 hooks 按配置顺序串行执行。如果第一个 hook 返回 exit 2（阻断），后续 hooks 不再执行。这意味着 hook 的**配置顺序即优先级**——最先配置的 hook 有"一票否决权"。这是一个简单但有限的模型：如果需要"所有 hooks 都同意才放行"的语义，当前架构无法直接支持。

---

## 2. 四种执行类型

### 2.1 Command（shell 命令）

最基础的 hook 类型。spawn 一个子进程执行 shell 命令：

```json
{
  "hooks": {
    "PreToolUse": [{
      "type": "command",
      "command": "echo 'Tool about to run: $TOOL_NAME'"
    }]
  }
}
```

- 超时：`TOOL_HOOK_EXECUTION_TIMEOUT_MS = 600,000`（10 分钟）
- 默认 shell：由 `DEFAULT_HOOK_SHELL` 决定
- Windows 支持：PowerShell / Git Bash

### 2.2 Prompt（AI 提示词）

构建一个 AI 请求：

```json
{
  "hooks": {
    "Stop": [{
      "type": "prompt",
      "prompt": "Check if the task is truly complete. If not, explain what's missing."
    }]
  }
}
```

### 2.3 Agent（多轮 AI 代理）

创建一个完整的多轮 AI Agent 来验证条件：

```json
{
  "hooks": {
    "Stop": [{
      "type": "agent",
      "prompt": "Run the test suite and verify all tests pass."
    }]
  }
}
```

- 使用 `dontAsk` 权限模式——源码中的精确语义是"Don't prompt for permissions, deny if not pre-approved"，即**不弹窗询问，未预授权的操作直接拒绝**。这不等于"不受权限约束"：Agent hook 仍然受到 `alwaysAllowRules` 白名单的约束，只是把需要用户交互确认的操作从"弹窗询问"降级为"直接拒绝"。但源码中还额外添加了对 transcript 文件的 `Read` 权限（`session: [...existingSessionRules, 'Read(/${transcriptPath})']`），这意味着 Agent hook 可以读取完整的对话记录
- `MAX_AGENT_TURNS = 50`——如果 Agent hook 未在 50 轮内完成，系统 abort 并返回 `cancelled`，不会阻断主流程
- 通过 `SyntheticOutputTool` 返回结构化输出：`{ ok: true/false, reason: string }`
- `querySource: 'hook_agent'`
- 默认使用 `getSmallFastModel()`（通常是 Haiku），可通过 `model` 字段覆盖

> **成本警告**：一个配置不当的 Agent hook（比如挂在 `Stop` 事件上）可能在每轮对话结束时消耗数千 token。假设每次验证平均 10 轮、每轮 2000 token，一个小时高频交互可能产生数十万 token 的额外消耗。源码中没有成本预算或频率限制机制——这完全依赖用户自行控制。

### 2.4 HTTP（远程端点）

```json
{
  "hooks": {
    "PostToolUse": [{
      "type": "http",
      "url": "https://my-server.com/hook",
      "method": "POST"
    }]
  }
}
```

### 执行类型的设计空间分析

四种类型的存在反映了一个有趣的设计问题：**hook 逻辑应该运行在哪里？**

| 类型 | 逻辑位置 | 延迟 | 能力上限 | 适用场景 |
|------|---------|------|---------|---------|
| command | 本地进程 | 毫秒级 | 任意 shell 能做的事 | lint、测试、通知 |
| prompt | 远程 API（单轮） | 秒级 | 自然语言推理 | 条件判断、内容审查 |
| agent | 远程 API（多轮） | 十秒到分钟级 | 完整 Agent 能力 | 复杂验证、自动修复 |
| http | 远程服务 | 取决于网络 | 由远程服务决定 | 企业审批系统、日志收集 |

**为什么 prompt 和 agent 是两种不同类型？** 表面上看，prompt 可以视为"只运行 1 轮的 agent"。但源码中二者的实现完全不同：`execPromptHook` 构建单次 API 请求并解析 JSON 输出；`execAgentHook` 启动完整的 `query()` 循环，创建独立的 `hookAgentId`、注册工具集、管理多轮对话。分离这两种类型是成本-能力权衡的体现——prompt 类型调用 Haiku 模型做一次推理，成本几乎可以忽略；agent 类型可能消耗数千 token。用户需要根据验证复杂度选择合适的类型。

**为什么没有 WebSocket（长连接）类型？** HTTP hook 是无状态的请求-响应模型，每次事件触发都是独立请求。如果需要维护状态（比如累计某个事件的发生次数），只能在远程服务端实现。这限制了 hook 系统在实时监控场景的表达能力，但也避免了长连接管理带来的复杂性（断线重连、心跳维护等）。

**Agent hook 的递归问题**：Agent hook 内部使用完整的工具集（过滤掉了 `ALL_AGENT_DISALLOWED_TOOLS`），这些工具调用会触发 `PreToolUse`/`PostToolUse` hooks。但 Agent hook 本身不会递归触发 Agent hooks，因为它的工具集排除了会导致子 Agent 生成的工具。这是一种"有限递归"的设计——hook 可以触发其他 hooks，但不会产生无限递归。

---

## 3. 退出码语义——双轨制

退出码是 Hooks 系统最核心的设计决策——Claude 怎么知道你的脚本是"放行"还是"拦截"？答案就是一个数字：

> 💡 **通俗理解**：退出码就像交通信号灯。你的 hook 脚本跑完后，返回一个数字告诉 Claude 怎么办：**绿灯（0）= 放行**，**红灯（2）= 拦截**，**黄灯闪烁（其他数字）= 脚本自己出了问题，但别影响正常流程**。

| 退出码 | 含义 |
|--------|------|
| **0** | 成功。stdout 可能传递给模型（取决于事件类型） |
| **2** | **阻断**。stderr 展示给模型，操作被阻止 |
| **其他非零** | 非阻断错误。stderr 只展示给用户（不影响模型） |

**为什么偏偏选了数字 2？** 简单说：需要一个不与 exit 1（通用错误）冲突的小整数值。exit 1 表示"脚本自身出错了"（不应影响 Claude 行为），exit 2 表示"我有意阻断这个操作"。这是一种实用主义的约定，而非对某个 Unix 传统的继承。

> <details><summary>📚 <b>技术深潜：退出码与操作系统 IPC</b>（点击展开）</summary>
>
> 退出码的双轨制设计是操作系统课程中"进程间通信（IPC）"的实际应用。Unix 进程通过 `waitpid()` 获取子进程退出码——这是最简单的 IPC 机制，单个 8-bit 整数（0-255）传递语义。Claude Code 在其中定义了三个语义区间（0/2/其他），类似 HTTP 状态码的分区设计（2xx/4xx/5xx）。
>
> 8-bit 整数无法传递结构化信息，因此 Claude Code 用 exit code + stdout/stderr + `hookSpecificOutput`（JSON）的组合来弥补：exit code 传递"动作语义"，stdout/stderr 传递"内容"，JSON 传递"结构化决策"。这是在原始 IPC 机制上构建高层协议的经典模式。
>
> 关于 exit 2 的来历：POSIX 只规定了 `exit 0`（成功）和 `exit 1`（错误）；Bash 手册中 exit 2 是"shell 用法错误"；BSD `sysexits.h` 中 `EX_USAGE=64`。Git hooks 只区分零/非零，不区分 1 和 2。Claude Code 的选择更接近自定义协议。
>
> </details>

例外情况：
- `StopFailure`、`PostToolUseFailure`：fire-and-forget，输出被忽略
- `Notification`：仅通知性质，无阻断语义

## 4. 环境变量注入

每个 hook 执行时都可以访问丰富的环境变量：

| 变量 | 值 |
|------|---|
| `CLAUDE_SESSION_ID` | 当前会话 ID |
| `CLAUDE_CWD` | 当前工作目录 |
| `TOOL_NAME` | 工具名称（工具类事件） |
| `TOOL_INPUT` | 工具输入 JSON（工具类事件） |
| `TOOL_OUTPUT` | 工具输出（PostToolUse） |
| `HOOK_EVENT` | 事件名称 |
| `HOOK_SUBTYPE` | 事件子类型 |

## 5. 可观测性

每个 hook 执行至少产生两个分析事件，失败路径上还会额外产生一个 `hook_error`：

1. **hook_start**：执行开始（所有 hook 都发）
2. **hook_end**：执行结束（所有 hook 都发，含 exit code、duration）
3. **hook_error**：**仅在失败时**发送（含错误类型、message）——正常结束（exit 0 / exit 2）不触发此事件

这也是 Part 4 "可观测性是产品功能"一章的核心论据之一。

## 6. 设计取舍与评价

### 为什么 10 分钟 vs 1.5 秒？

工具 hook 的默认超时是 `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 600,000`（10 分钟），而 `SessionEnd` hook 超时仅 1500ms——相差 400 倍。这不是随意设定：

- **10 分钟**：工具 hook（特别是 `PreToolUse`、`Stop`）可能需要运行完整的测试套件。一个大型项目的 `npm test` 可能需要数分钟。10 分钟是"覆盖绝大多数 CI 操作"的上界。但如果 hook 卡了 9 分钟，用户体验会非常糟糕——Claude 在这段时间内完全无响应，且没有进度提示。
- **1.5 秒**：`SessionEnd` 在用户关闭终端时触发。如果此时执行一个长时间 hook，用户会看到终端"卡住"无法退出。1500ms 是"用户能接受的最大退出延迟"的经验值，可通过 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` 环境变量覆盖（该环境变量的读取逻辑位于 `src/utils/hooks.ts` 的 `getSessionEndHookTimeoutMs()` 函数——先读 env 覆盖值、缺失时回退到 1500ms 默认常量）。

**优秀**：
1. 27 个事件覆盖了系统的每一个关键决策点
2. exit 2 双轨制让错误和阻断有明确的语义区分
3. Agent 类型 hook 可以用 AI 来验证 AI 的输出——形成自我校正循环
4. 四种执行类型满足从简单脚本到复杂自动化的所有场景
5. `PermissionRequest` hook 实现了完全无人值守的自动化

**代价**：
1. 27 个事件的命名和语义需要用户记忆——学习曲线陡峭
2. Agent hook 使用 `dontAsk` 模式——准确说是"未预授权的操作直接拒绝"，不会弹窗但也不会自动批准一切。但 Agent hook 仍然拥有近乎完整的工具集（仅过滤掉 `ALL_AGENT_DISALLOWED_TOOLS` 中的子 Agent 生成类工具，具体名单见该常量定义），可以读写文件、执行 Bash 命令等
3. exit 2 的约定是"魔法数字"——如果用户不了解这个约定，可能意外阻断操作
4. 10 分钟超时意味着一个有 bug 的 hook 脚本可以让 Claude 卡住很久，且源码中没有用户可触发的中途取消机制

### 能力边界：Hook 不等于治理

> 💡 **通俗理解**：把 Hook 比作快递柜的取件通知——你可以在"包裹到达"这个**单一事件**上做拦截或转发，但你管不了整个物流系统的调度、路由规划和仓库库存管理。Hook 解决的是**局部动作约束**，治理解决的是**全链路状态一致性**。

这个区分至关重要。Hooks 可以拦截单个工具调用、注入单条消息、自动回答权限弹窗。但它**不能**：

1. **观测 Agent 的思考过程**：Hooks 只挂载在工具调用和会话事件上。Claude 在调用工具前的内部推理（thinking 块）对 Hook 是不可见的。你可以拦截 `Bash("rm -rf /")` 这个工具调用，但无法看到 Claude 是基于什么推理做出这个决策的。这限制了 Hook 在"意图审计"场景的能力。
2. **保证跨会话的策略一致性**：Hook 配置是静态文件，没有版本化的策略演进机制。如果团队的安全策略需要从"允许 rm"逐步收紧到"禁止所有删除操作"，Hook 无法表达这种渐进式策略变更。
3. **处理分布式场景的协调**：在 Coordinator + Worker 多 Agent 模式下，每个 Worker 独立执行 Hook。没有机制让 Hook 感知其他 Worker 的状态或全局任务进度。

> 🌍 **行业对比**：**OpenClaw**（开源 AI Agent 框架）采用了完全不同的 Hooks 哲学——围绕**事件流构建观测扩展系统**，而非 Claude Code 的"围绕工具调用构建权限决策系统"。Claude Code 的 PreToolUse + deny 可以 **100% 可靠地**阻止危险操作（系统级强制拦截），而 OpenClaw 通过消息注入"提醒"Agent 不要执行，Agent 有可能忽略。但 OpenClaw 可以观测到完整的消息处理流水线（包括 `message:preprocessed` 等中间步骤），而 Claude Code 的 Hook 只能在特定锚点介入。两种设计分别为安全关键场景和灵活观测场景优化，没有绝对优劣。

### 三个实战场景：Hook 能做什么 vs 不能做什么

| 场景 | 实现方式 | 可靠性 | 说明 |
|------|---------|--------|------|
| **阻止 `rm -rf /`** | `PreToolUse` + Command Hook 检测命令 → exit 2 | ✅ 高可靠（hook 正常运行时 100%，hook 本身崩溃时 fail-open——见第 7 节） | 系统级强制拦截，AI 无法绕过；但若 hook 脚本因 OOM/segfault 等异常退出，系统默认 fail-open 放行，所以安全关键 hook 应在脚本内部 fail-closed 兜底（任何异常路径都显式 `exit 2`） |
| **每次编辑后自动跑测试** | `PostToolUse`（filter: `FileEdit`）+ `asyncRewake: true` + exit 2 唤醒 | ✅ 可靠 | `asyncRewake` 是 Hook 配置字段：设为 true 时 hook 异步执行不阻塞主流程，脚本完成后若 exit 2 会触发 Agent 重新唤醒处理结果 |
| **启动时注入项目规范** | `SessionStart` + Command Hook `echo "项目规范：..."` | ⚠️ 需外部脚本 | 对简单场景配置偏重——需要独立的 shell 脚本读取规范文件并输出 |

## 7. 错误传播与 Fail-Open 策略

Hooks 系统的一个关键但容易被忽略的设计决策是其**错误传播模型**：

| 退出码 | 语义 | 对主流程的影响 |
|--------|------|--------------|
| 0 | 成功 | 继续 |
| 2 | 有意阻断 | 阻止操作 |
| 1, 3, 4... | hook 自身出错 | **继续**（非阻断） |
| hook 进程崩溃 | 意外错误 | **继续**（非阻断） |
| Agent hook 超时 | 50 轮未完成 | **继续**（返回 cancelled） |

这是一种 **fail-open** 策略——hook 自身的故障不会阻断主流程。这个选择在可用性和安全性之间做了明确的取舍：

**有利的一面**：用户不必担心一个有 bug 的 hook 脚本导致 Claude 完全不可用。如果你的 lint hook 因为依赖未安装而报错（exit 1），Claude 仍然可以继续工作。

**危险的一面**：如果你部署了一个安全审计 hook（比如阻止 Claude 访问 `/etc/passwd`），攻击者可以通过故意让这个 hook 崩溃（OOM、segfault）来绕过安全检查——因为崩溃的 hook 会被静默忽略。源码中对此有一个微妙的处理：`python3 <missing>.py` 会返回 exit 2（Python 找不到文件时的退出码），这会被误解为"有意阻断"，因此源码中对 plugin hooks 做了路径预检查（`if (!(await pathExists(pluginRoot)))`），但用户自定义的 command hooks 没有这种保护。

**设计启示**：如果你的 hook 承担安全职责（而非便利功能），应该在 hook 脚本内部实现 fail-closed 逻辑——在任何异常情况下都 `exit 2`，而非依赖系统默认的 fail-open 行为。

---

