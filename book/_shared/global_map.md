# 系统全局地图 — Claude Code 2.1.88

> 阶段 0 产出。本文件是所有后续研究工作的地基，由主线程在读完入口及核心文件后写就。
> 最后更新：2026-04-10（Codex 融合后新增 5 章 + 事实修正）

---

## 一、主执行链路（叙述式）

一次用户交互从进入系统到产生响应，经历以下路径：

### 1. 程序启动（main.tsx）

程序入口是 `src/main.tsx`，它是整个系统最大的单文件（785KB），扮演的角色相当于"城市交通枢纽"——所有流量从这里分流。

**启动序列的第一件事（在所有 import 之前）：**
`main.tsx` 的文件顶部，在任何模块加载之前就顺序执行三行副作用：
1. `profileCheckpoint('main_tsx_entry')` — 记录启动时间戳，用于性能分析
2. `startMdmRawRead()` — 启动 MDM（Mobile Device Management）配置读取进程，与后续 ~135ms 的模块加载时间并行
3. `startKeychainPrefetch()` — 并行启动 macOS 钥匙串读取（OAuth token + API key），避免串行等待

这三行是刻意的"在模块加载时间内把副作用跑完"的性能技巧（推断：目的是让初始化过程中最慢的 I/O 操作与 JS 模块解析时间重叠）。

**模式分流（main() 函数内）：**

`main()` 函数根据 CLI 参数、环境变量、feature flag 把程序分流到不同路径：

| 场景 | 路径 |
|------|------|
| 交互式 REPL（默认） | `launchRepl()` → REPL 渲染循环 |
| 无交互（`-p/--print`）| `runHeadless()` → 单次 print 模式 |
| SDK 调用 | `QueryEngine.submitMessage()` 直接路径 |
| Coordinator 模式 | 设置 `CLAUDE_CODE_COORDINATOR_MODE=1` 后进入特殊提示词注入 |
| KAIROS/assistant 模式 | feature gate `KAIROS` 控制 |
| MCP serve 模式 | `mcp serve` 子命令 |
| SSH 远程模式 | feature gate `SSH_REMOTE` |
| DirectConnect 模式 | feature gate `DIRECT_CONNECT`，处理 `cc://` URL |

**迁移系统：**
启动时检查 `globalConfig.migrationVersion`，如果不等于当前版本（11），依次运行所有迁移函数（模型字符串迁移、配置格式迁移等），确保本地配置始终与当前版本兼容。

### 2. 初始化（entrypoints/init.ts）

`init()` 负责：
- 加载并应用 settings（支持多个来源：policy settings、项目级、用户级）
- 初始化 GrowthBook（feature flag 服务）
- 建立 telemetry（Statsig + OpenTelemetry）
- 加载 MCP 服务器配置，启动 MCP 客户端连接
- 加载权限配置（`initializeToolPermissionContext()`）
- 启动 LSP 服务器管理器

**延迟预取（startDeferredPrefetches()）：**
首次 REPL 渲染后，才启动一批后台预取（用户信息、git 状态、文件计数、模型能力缓存、change detector 等），这些工作被设计为在"用户还在打字"的窗口内完成，不阻塞首次渲染。

### 3. 查询引擎（QueryEngine.ts）

`QueryEngine` 是对话会话的状态容器——每个对话对应一个实例。它持有：
- `mutableMessages`：当前对话的消息历史
- `readFileState`：文件状态缓存（用于文件修改追踪）
- `totalUsage`：累计 token 用量
- `permissionDenials`：当前会话的权限拒绝记录
- `discoveredSkillNames`：本轮发现的 skill 名称（用于 telemetry）

每次用户提交输入，调用 `submitMessage(prompt)` 方法，该方法：
1. 调用 `fetchSystemPromptParts()` 获取当前 system prompt 各部分
2. 注入 coordinator 用户上下文（如果在 coordinator 模式下）
3. 注入 memdir 记忆机制提示（如果配置了记忆路径）
4. 处理 slash command（`processUserInput()`）
5. 调用核心查询循环（`query()` 函数）
6. 收集 SDK 消息流，更新会话状态

### 4. 主循环（query.ts → queryLoop）

`query()` 函数是 AI 推理的核心主循环，设计为 **AsyncGenerator**，持续 yield 事件流。内部的 `queryLoop()` 是真正的循环体，每次迭代代表一个 AI 对话轮次。

**每次循环迭代的步骤（顺序）：**

```
1. [内存预取] 启动相关 skill/memory 的并行预取
2. [上下文压缩前处理]
   a. applyToolResultBudget() — 按预算裁剪工具结果大小
   b. snipCompactIfNeeded()   — HISTORY_SNIP: 剪掉中间不重要片段
   c. microcompact()          — 微型压缩：消除冗余的 tool_result 内容
   d. applyCollapsesIfNeeded() — CONTEXT_COLLAPSE: 折叠旧对话段
   e. autocompact()           — 自动全文压缩（超阈值时触发）
3. [Token 预算检查] 如超出 blocking limit，直接返回错误
4. [调用模型] deps.callModel() — 向 Anthropic API 发起流式请求
5. [流式处理] for await (message of callModel) — 消费 streaming 响应：
   a. 遇到 tool_use block → 加入 toolUseBlocks，设 needsFollowUp=true
   b. 遇到 error → 判断是否可恢复（上下文过长、输出 token 超限等）
   c. 如果 StreamingToolExecutor 启用 → 工具可在流式阶段并行开始执行
6. [后采样 hooks] executePostSamplingHooks() — 用户定义的 post-sampling hooks
7. [工具执行] 如果 needsFollowUp：
   a. runTools() — 并行执行所有工具调用
   b. 每个工具经过 canUseTool() 权限检查（hooks 先行，必要时弹 UI 确认）
   c. 工具结果作为新的 UserMessage 追加到消息历史
8. [stop hooks] handleStopHooks() — 处理 stop sequence hooks
9. [判断是否继续] needsFollowUp ? continue : return { reason: 'stop' }
```

**退出条件（Terminal 类型）：**
- `'stop'` — 模型正常结束，没有更多工具调用
- `'max_turns'` — 达到最大轮次限制
- `'aborted_streaming'` — 用户中断
- `'blocking_limit'` — context window 满了，无法继续
- `'model_error'` — 模型调用错误
- `'image_error'` — 图片大小/处理错误

### 5. 工具执行（services/tools/）

工具调用路径：
```
QueryLoop 发现 tool_use block
→ canUseTool() 权限检查
  → hooks 检查（pre_tool_use hooks）
  → 如果 auto-approve 规则匹配 → 直接允许
  → 否则展示 UI 权限对话框（交互模式）或 auto-deny（非交互模式）
→ tool.call(args, context, canUseTool, parentMessage, onProgress)
→ 结果包装成 ToolResult<T>
→ 转换为 UserMessage（含 tool_result block）
→ 追加到消息历史，作为下一轮的上下文
```

---

## 二、各子系统及核心职责

| 子系统 | 核心职责 | 主要文件 |
|--------|----------|----------|
| **启动与入口** | 程序初始化、CLI 解析、模式分流 | `main.tsx`, `setup.ts`, `entrypoints/`, `bootstrap/state.ts` |
| **核心执行引擎** | 对话会话状态、主循环驱动 | `QueryEngine.ts`, `query.ts`, `query/` |
| **提示与上下文构建** | 构造发给 AI 的 system prompt 和用户上下文 | `context.ts`, `context/`, `utils/queryContext.ts` |
| **工具系统** | 工具注册、执行、结果处理 | `Tool.ts`, `tools.ts`, `tools/`, `services/tools/` |
| **命令系统** | Slash command 解析与执行 | `commands.ts`, `commands/` |
| **Agent 与任务系统** | 子 Agent 生命周期、任务调度与通信 | `Task.ts`, `tasks/`, `tools/AgentTool/`, `coordinator/` |
| **平台扩展层** | MCP 服务器接入、Skills、Plugins、远程会话 | `services/mcp/`, `skills/`, `plugins/`, `bridge/`, `remote/` |
| **UI 与终端交互** | Ink/React 终端 UI 渲染、键盘处理、流式输出 | `screens/`, `ink/`, `components/`, `keybindings/` |
| **状态与持久化** | 会话存储、历史记录、数据库迁移 | `state/`, `history.ts`, `migrations/` |
| **基础设施层** | 通用工具函数、类型定义、错误处理 | `utils/`, `types/`, `constants/`, `schemas/` |
| **特性簇** | 实验性功能：buddy、voice、vim、memdir | `buddy/`, `voice/`, `vim/`, `memdir/`, `moreright/` |
| **原生模块与桥接** | 原生能力封装（keychain、sandbox 等） | `vendor/`, `upstreamproxy/`, `native-ts/` |

---

## 三、核心抽象清单

### Tool（工具）
**定义：** 系统中可被 AI 调用的能力单元。每个工具是一个满足 `Tool<Input, Output>` 泛型接口的对象。  
**所在文件：** `src/Tool.ts`  
**关键字段：**
- `name: string` — 工具名，模型通过此名字调用
- `aliases?: string[]` — 别名（用于兼容重命名）
- `call(args, context, canUseTool, parentMessage, onProgress)` — 实际执行函数
- `description(input, options)` — 动态生成给模型看的工具描述（返回 Promise<string>）
- `inputSchema: z.ZodType` — 用 Zod 定义的输入类型（同时用于验证和 JSON Schema 生成）
- `renderResultForAssistant(data)` — 把工具结果转成给 AI 看的文本表示
- `isConcurrencySafe` — 标记工具是否可以并行执行
- `maxResultSizeChars` — 工具结果大小阈值（超出则持久化到 `~/.claude/tool-results/` 并以引用型预览呈现，非硬截断）

### ToolUseContext（工具执行上下文）
**定义：** 工具执行时能获取到的运行时上下文，贯穿整个系统。包含：当前会话的消息历史、权限上下文、AppState 读写接口、UI 回调函数、MCP 客户端列表、模型名称等。  
**所在文件：** `src/Tool.ts`（类型定义）

### QueryEngine（查询引擎）
**定义：** 一个对话会话的状态机容器。负责持有消息历史、驱动 query() 循环、追踪 token 用量和权限拒绝。一个对话 = 一个 QueryEngine 实例。  
**所在文件：** `src/QueryEngine.ts`

### Task（任务）
**定义：** 后台执行单元的抽象。有七种类型：`local_bash`（Bash 子进程）、`local_agent`（本地子 Agent）、`remote_agent`（远程 Agent）、`in_process_teammate`（同进程 teammate）、`local_workflow`（工作流）、`monitor_mcp`（MCP 监控）、`dream`（开放问题：用途尚未确认）。  
**所在文件：** `src/Task.ts`

### AppState（应用状态）
**定义：** 整个应用的全局可变状态，包含：当前权限模式、MCP 客户端状态、运行中的 Task 列表、UI 状态等。通过 `getAppState()/setAppState()` 读写，不可变更新模式（Redux 风格）。  
**所在文件：** `src/state/AppStateStore.ts`

### Command（命令）
**定义：** Slash command（斜杠命令）的抽象，是用户在交互界面输入 `/xxx` 时触发的功能。与 Tool 的区别在于：Command 是用户直接调用的，而 Tool 是 AI 模型调用的。  
**所在文件：** `src/commands.ts`（注册表），`src/commands/`（实现目录）

### SystemPrompt（系统提示词）
**定义：** 发给 AI 的 system 消息的类型包装。由多个部分组成：默认系统提示（权限说明、工具说明等）+ 用户自定义 + appendSystemPrompt。  
**所在文件：** `src/utils/systemPromptType.ts`

---

## 四、子系统依赖关系

```
main.tsx
  ├── entrypoints/init.ts        ← 初始化
  ├── bootstrap/state.ts         ← 全局会话状态（sessionId、model、cwd 等）
  ├── QueryEngine.ts             ← 会话状态容器
  │     ├── query.ts             ← 主循环（核心）
  │     │     ├── services/api/claude.ts  ← Anthropic API 调用
  │     │     ├── services/tools/         ← 工具编排与执行
  │     │     ├── services/compact/       ← 上下文压缩策略
  │     │     └── utils/hooks/            ← pre/post hooks 执行
  │     ├── context.ts           ← 系统上下文（git status、CLAUDE.md）
  │     └── utils/queryContext.ts ← system prompt 各部分组装
  ├── tools.ts                   ← 工具注册表（getTools()）
  ├── commands.ts                ← 命令注册表（getCommands()）
  ├── services/mcp/              ← MCP 服务器连接管理
  ├── state/                     ← AppState 管理
  ├── screens/                   ← 顶层 UI 组件（REPL、setup wizard 等）
  └── coordinator/               ← Coordinator 模式（多 worker 编排提示词）
```

**数据流向：**
- 用户输入 → `processUserInput()` 解析（slash command / 普通文本）
- 文本输入 → `QueryEngine.submitMessage()` → `query()` 循环
- query() 循环 → `callModel()` → Anthropic API → 流式响应
- 流式响应中 tool_use block → `runTools()` → 各工具 `.call()` → tool_result
- tool_result → 追加到消息历史 → 再次调用模型（新一轮循环）

---

## 五、各子系统规模与重要程度估计

| 子系统 | 文件量估计 | 重要程度 | 研究优先级 |
|--------|-----------|----------|-----------|
| 基础设施层（utils/） | 很大（300+ 文件） | 基础，不是核心故事线 | 中，分散到各子系统 |
| 工具系统（tools/） | 大（100+ 文件） | 极高，用户感知最强 | 高 |
| UI 与终端交互（screens/+ink/+components/） | 大（100+ 文件） | 高，用户体验核心 | 高 |
| 服务层（services/） | 大（100+ 文件） | 极高（API、MCP、compact） | 高 |
| 命令系统（commands/） | 中（60+ 文件） | 高（每个 slash command 一个目录） | 中高 |
| 状态与持久化（state/+migrations/） | 中 | 高 | 中高 |
| 核心执行引擎（QueryEngine+query+query/） | 中，但质量极高 | 极高，整个系统的心脏 | 极高（第一优先级） |
| Agent 与任务系统 | 中 | 高（多 Agent 是核心特性） | 高 |
| 平台扩展层 | 中 | 高（MCP 是扩展性核心） | 中高 |
| 特性簇（buddy/voice/vim/memdir） | 小 | 中（实验性功能） | 中 |
| 原生模块 | 小（4 个） | 中（底层能力） | 低 |
| 启动与入口 | 大（main.tsx 单文件就很大） | 高（理解整体结构必需） | 高（已完成基础分析） |

---

## 六、关键外部依赖与技术选型（来自 package.json）

| 依赖 | 用途 | 选型意义 |
|------|------|----------|
| `ink` + `react` | 终端 UI 框架 | 用 React 声明式模型渲染 CLI UI，而不是手动操控 ANSI 码 |
| `@anthropic-ai/sdk` | 主 LLM API 调用 | 官方 SDK，streaming 支持 |
| `@anthropic-ai/bedrock-sdk` / `@anthropic-ai/vertex-sdk` | AWS Bedrock / GCP Vertex 接入 | 企业部署路径 |
| `@anthropic-ai/claude-agent-sdk` | 子 Agent 能力 | 推断：用于 AgentTool 内部的 sub-agent 调用 |
| `@modelcontextprotocol/sdk` | MCP 协议实现 | 标准化工具扩展接口 |
| `zod` | 运行时类型验证 | 所有工具的输入 schema 定义，同时生成给 AI 的 JSON Schema |
| `@opentelemetry/*` | 可观测性（tracing/metrics/logs） | 全栈 telemetry |
| `@growthbook/growthbook` | Feature flag / A-B 测试 | `feature()` 函数的底层（`bun:bundle` 编译时树摇） |
| `execa` | 子进程执行 | Bash 工具的底层实现 |
| `chokidar` | 文件系统监听 | settings/skill change detector |
| `sharp` | 图片处理 | 上传图片时的大小调整和格式转换 |
| `marked` / `turndown` | Markdown 渲染与转换 | WebFetch 结果转 Markdown |
| `fuse.js` | 模糊搜索 | 推断：ToolSearch 工具的候选工具匹配 |
| `lru-cache` | LRU 缓存 | 文件状态缓存（FileStateCache）的底层实现 |

---

## 七、Feature Flag 系统

系统大量使用 `feature('FLAG_NAME')` 进行功能门控。这些 flag 由 `bun:bundle` 在构建时处理：
- `feature('COORDINATOR_MODE')` — 多 Worker 协调模式
- `feature('KAIROS')` — assistant 模式（内部代号）
- `feature('HISTORY_SNIP')` — 历史片段剪裁
- `feature('CONTEXT_COLLAPSE')` — 上下文折叠压缩
- `feature('REACTIVE_COMPACT')` — 响应式上下文压缩
- `feature('TOKEN_BUDGET')` — token 预算追踪
- `feature('AGENT_TRIGGERS')` — 定时/触发 Agent
- `feature('VOICE_MODE')` — 语音输入
- `feature('BRIDGE_MODE')` — 桥接模式（推断：IDE 集成）
- `feature('SSH_REMOTE')` — SSH 远程会话
- `feature('DIRECT_CONNECT')` — cc:// URL 直连

外部发布版（`"external"` build）中，Ant 内部 flag 下的代码会被树摇删除。

---

## 八、Coordinator 模式的特殊设计

当 `CLAUDE_CODE_COORDINATOR_MODE=1` 时，主 Claude 实例变为"协调者"，其行为被 `coordinator/coordinatorMode.ts` 中的特殊 system prompt 覆盖：
- 通过 `AgentTool` 派生多个 Worker（子 Agent）
- 通过 `SendMessageTool` 向已有 Worker 发送后续消息
- 通过 `TaskStopTool` 终止 Worker
- Worker 结果以 `<task-notification>` XML 格式作为"用户消息"回传给协调者
- 协调者负责综合 Worker 的结果后再与真实用户交互

这是一个把"让 AI 并行管理多个 AI"的能力抽象化的设计，是 Claude Code 的核心多 Agent 架构。

---

*本文档是阶段 0 的核心产出，后续所有研究都应以本文为出发点。*
