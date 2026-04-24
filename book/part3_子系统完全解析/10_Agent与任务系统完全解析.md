# Agent 与任务系统完全解析

Agent 与任务系统是 Claude Code 的并行计算架构——当 Claude 需要"分身"时，它会创建真正独立的 AI 实例。从单个子 Agent 的生命周期管理、到 Coordinator 模式下的多 Worker 编排、到异步后台任务的进度追踪，这套系统让一个 AI 对话变成了分布式工作系统（"分布式"即把一个大任务拆成多个小任务，分配给多个独立的工作者同时执行——就像一个大公司把项目拆给不同部门并行推进）。本章将解析 Agent 创建与运行的完整链路、三种隔离模型、约 250 行 Coordinator 系统提示词、以及 DreamTask 的记忆整理机制。

> **源码位置**：`src/tasks/`、`src/tools/AgentTool/`（14 个文件）、`src/buddy/`

> 💡 **通俗理解**：Agent 任务系统就像物流调度中心——本地快递是 LocalAgent（同城配送，共享仓库），跨城物流是 RemoteAgent（独立仓库，完全隔离），夜间盘点是 DreamTask（趁没人时整理记忆档案）。调度中心（Coordinator）决定哪些包裹并行配送、哪些必须串行处理。

### 🌍 行业背景：AI 编程工具的多 Agent 编排

多 Agent 协作是 2024-2026 年 AI 工具领域演进最快的竞争前沿。2026 年，行业已全面跃迁至智能体集群（Agent Swarm）范式，各家方案差异显著：

- **Kimi Code**：率先在产品中主打 **Agent Swarm** 概念——协调器可动态创建（"实例化"）并发子智能体。具体并发数上限、隔离强度、以及"业界首个"这类定性判断应以 Moonshot 官方文档和 release notes 为准，本书未独立核实具体参数（常见社区引用为"最多 100 个并发子智能体"，出处以官方公告为准）。这是与 Claude Code Coordinator 在理念上最接近的竞品方案之一。
- **Codex（OpenAI）**：v0.118.0 版本引入**并行多 Agent 异步通信**和邮箱通信机制（Mailbox），支持 CI/CD 事件流的无人值守修复。底层 Rust 重写（具体比例以官方为准）带来极高的并发性能。
- **Cursor**：推出 **Background Agents（后台智能体）**，在云端 VM 中并行执行重构，最终以 PR 形式合并。开发者可同时监控 5 个并发子任务——从单 Agent 串行全面转型为云端多 Agent 并行。
- **Devin**：推出 **Manage Devins**——主智能体拆解任务后实例化部署在各个独立隔离 VM 中的子智能体（Managed Devins），配合 Human-in-the-loop 精细管控。
- **Aider**：核心仍为单 Agent 架构，但 **Architect 模式**基于 AST 级 Repo Map 实现推理/编辑分离。社区 AiderDesk 为其赋予并线 Agent 能力及 MCP 生态挂载。
- **GitHub Copilot**：Agent Mode 已全面 GA，内置 **Explore、Plan、Task** 专职智能体，能自主解读问题意图并迭代修复代码。企业级 MCP 注册表支撑异步任务流集成。
- **LangGraph（LangChain）**：提供图结构的 Agent 编排框架，支持条件分支、并行扇出、状态共享。Claude Code 的 Coordinator 提示词中的 Research→Synthesis→Implementation→Verification 四阶段可以直接映射为 LangGraph 的有向图。
- **AutoGen（Microsoft）**：多 Agent 对话框架，强调 Agent 间的消息传递，支持角色分工。与 Claude Code 的 `<task-notification>` 消息回传机制有相似之处。

Claude Code 的 Coordinator 模式在工程实现上较为成熟——`getCoordinatorSystemPrompt()` 函数（`coordinatorMode.ts:111-369`）通过约 250 行模板字符串定义了详细的编排规则（包括 Continue vs. Spawn 决策矩阵），这在业界属于"重提示词"路线。相比之下，LangGraph/AutoGen 等框架更偏"重代码"路线（编排逻辑写在代码中而非 prompt 中）。

---

## 概述

当 Claude 需要"分身"时，它不是在内心分出一个线程——而是真的创建一个独立的 AI 实例。Agent 与任务系统是 Claude Code 的**并行计算架构**：从单个子 Agent 的生命周期管理、到 Coordinator 模式下的多 Worker 编排、到异步后台任务的进度追踪——它让一个 AI 对话变成了一个分布式工作系统。核心是一份约 250 行的 Coordinator 系统提示词和一套精心设计的隔离模型。

---

> **[图表预留 3.10-A]**：Agent 生命周期图 — 从 AgentTool.call() 到 runAgent() 的完整链路

> **[图表预留 3.10-B]**：Coordinator 工作流 — Research→Synthesis→Implementation→Verification 四阶段

---

## 1. Agent 创建与运行

### 1.1 AgentTool 入口

`AgentTool.tsx` 是所有子 Agent 的入口。模型调用它时提供：

```typescript
// AgentTool.tsx:82-88 · baseInputSchema（所有模式通用的 5 个字段）
const baseInputSchema = z.object({
  description: z.string(),      // 3-5 词简述
  prompt: z.string(),           // 完整任务描述
  subagent_type: z.string().optional(),    // 专用 Agent 类型
  model: z.enum(['sonnet','opus','haiku']).optional(),  // 模型覆盖
  run_in_background: z.boolean().optional(),  // 后台运行
});

// AgentTool.tsx:92-103 · fullInputSchema（上面 5 个 + 以下扩展）
const fullInputSchema = baseInputSchema
  .merge(z.object({                          // 多 Agent 模式字段（3 个）
    name: z.string().optional(),
    team_name: z.string().optional(),
    mode: permissionModeSchema().optional(),
  }))
  .extend({                                  // 附加字段（2 个）
    isolation: z.enum(['worktree', ...]).optional(),   // 'remote' 仅 ant
    cwd: z.string().optional(),              // 工作目录覆盖（KAIROS feature gate）
  });
```

> **⚠ SoT 核实**：`name / team_name / mode / isolation / cwd` **不在** `baseInputSchema` 里，而是 `fullInputSchema`（通过 `.merge()` 和 `.extend()` 扩展）。原书早期版本用注释 `// 多 Agent 模式额外参数: name, team_name, mode` 标注在 baseInputSchema 代码块内部，易被读者误解为 baseInputSchema 的字段——改为上方分两段独立展示，边界更清晰。

### 1.2 runAgent 核心循环

`runAgent()`（`runAgent.ts` 中的主执行函数，具体行号随版本浮动——查找时请使用 `grep -n 'export.*function runAgent' src/tools/AgentTool/runAgent.ts`）是一个 **AsyncGenerator**（异步生成器——一种"边做边汇报"的编程模式，子 Agent 每完成一步就立刻把结果传回给父 Agent，而不是全部做完才一次性返回）：

```
AgentTool.call() → runAgent()
  → createAgentId()                    — 唯一标识
  → initializeAgentMcpServers()        — 连接 Agent 专属 MCP
  → Promise.all([getUserContext(), getSystemContext()])  — 并行获取上下文
  → createSubagentContext()            — 构建隔离的 ToolUseContext
  → for await (message of query())     — 运行 AI 主循环
      → yield message                  — 流式传回父 Agent
  → cleanup: MCP 连接、worktree、Perfetto trace
```

### 1.3 Agent MCP 服务器

`initializeAgentMcpServers()`（`runAgent.ts:95-218`）处理 Agent 专属的 MCP 服务器，有两种引用方式：

- **字符串引用**（`"server-name"`）：查找已有配置，共享父连接（`connectToServer` 的 memoized 结果）
- **内联定义**（`{ name: config }`）：创建新连接，Agent 结束时清理

**关键安全检查——`strictPluginOnlyCustomization`**（`runAgent.ts:117-127`）：当企业管理员启用 `strictPluginOnlyCustomization` 锁定 MCP 时，系统区分两类 Agent：

- **admin-trusted Agent**（来源为 plugin、built-in、policySettings）：允许使用 MCP，因为它们的 frontmatter MCP 配置属于管理员审批过的安全表面。
- **user-defined Agent**：被完全跳过，无法连接任何 MCP 服务器。

源码注释解释了为什么不是一律拒绝：

> Plugin, built-in, and policySettings agents are admin-trusted — their frontmatter MCP is part of the admin-approved surface. Blocking them breaks plugin agents that legitimately need MCP.

这个设计的影响值得深思：它意味着在企业锁定环境中，用户自定义 Agent 的能力边界被严格收窄——无法访问外部 API、数据库、或任何通过 MCP 暴露的服务。这是一个显式的信任分层模型：管理员信任的 Agent 可以触达外部世界，用户创建的 Agent 只能使用内置工具。这种设计在安全性和灵活性之间选择了安全性，对企业部署场景至关重要——它防止了未经审批的 Agent 通过 MCP 服务器外泄代码或执行未授权操作。

## 2. 隔离模型

### 2.1 三种隔离级别

> 💡 **为什么需要隔离？** 如果两个子 Agent 同时修改同一个文件，就会互相覆盖对方的工作——就像两个人同时在同一块白板上画画。隔离的目的是给每个子 Agent 一个独立的"工作间"。

| 模式 | 机制 | 文件系统 | 网络 | 通俗理解 |
|------|------|---------|------|---------|
| 默认 | 共享工作目录 | 共享 | 共享 | 同一间办公室里的同事，共用所有文件 |
| `worktree` | 独立 git worktree | 隔离分支 | 共享 | 各自有独立办公室，但共用同一个网络（worktree 是 Git 提供的"平行工作目录"，让多人在同一个仓库的不同分支上同时工作） |
| `remote`（ant-only）| CCR 远程环境 | 完全隔离 | 隔离 | 在不同城市的分公司工作（仅 Anthropic 内部可用） |

### 2.2 上下文隔离

`createSubagentContext()`（`forkedAgent.ts`）构建子 Agent 的执行上下文：

- **`setAppState` → no-op**：子 Agent 不能修改父进程的 UI 状态
- **`setAppStateForTasks`**：绕过 no-op 的特例——用于任务注册等"全局基础设施"操作
- **`cloneFileStateCache`**：子 Agent 获得独立的文件状态缓存副本
- **独立对话历史**：子 Agent 不继承父 Agent 的消息历史（除非通过 `forkContextMessages`）

### 2.3 omitClaudeMd 优化

Explore、Plan 类型的 Agent 设置 `omitClaudeMd: true`——它们的系统上下文中不包含 CLAUDE.md 内容。注释透露了规模数据：

> 省去这部分可以节省约 **较大规模**（每周 50-150 亿 token）

💡 **这个数字有多大？** 一个普通用户和 Claude 聊一次大约消耗几千到几万 token。50-150 亿 token 相当于几十万到上百万次普通对话的消耗量——这个数字揭示了 Anthropic 运营 Claude Code 的天量计算成本，也解释了为什么这类"能省则省"的优化如此重要。

## 3. 任务类型

### 3.1 七种 TaskType

```typescript
type TaskType =
  | 'local_bash'           // Bash 工具启动的子进程
  | 'local_agent'          // 本地子 Agent（默认路径）
  | 'remote_agent'         // CCR 远程环境中的 Agent
  | 'in_process_teammate'  // 同进程 teammate（swarm 模式）
  | 'local_workflow'       // 工作流任务
  | 'monitor_mcp'          // MCP 监控任务
  | 'dream'                // 后台记忆整理任务（详见第 6 节 DreamTask）
```

### 3.2 自动后台化

`getAutoBackgroundMs()`（`AgentTool.tsx:72-77`）：

```typescript
function getAutoBackgroundMs(): number {
  if (isEnvTruthy(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) 
      || getFeatureValue_CACHED_MAY_BE_STALE('tengu_auto_background_agents', false)) {
    return 120_000;  // 120 秒后自动后台化
  }
  return 0;
}
```

**仅当环境变量 `CLAUDE_AUTO_BACKGROUND_TASKS` 为真值 或 feature gate `tengu_auto_background_agents` 开启时**，前台 Agent 运行超过 2 分钟后才会自动转入后台（未开启时 `getAutoBackgroundMs()` 返回 0，前台 Agent 一直在前台运行直到完成）——用户不需要等待长时间任务。这个特性在大多数默认部署中处于关闭状态。

## 4. Coordinator 模式

### 4.1 启用条件

`isCoordinatorMode()`（`coordinatorMode.ts:36-41`）：需要 `COORDINATOR_MODE` feature gate + `CLAUDE_CODE_COORDINATOR_MODE` 环境变量。Session resume 时通过 `matchSessionMode()` 自动匹配之前的模式。

### 4.2 Coordinator 系统提示词

`getCoordinatorSystemPrompt()`（`coordinatorMode.ts:111-369`）是一个 259 行的 TypeScript 函数，其中包含约 250 行的模板字符串——这就是 Coordinator 的**完整编排手册**。注意：这 259 行是 TypeScript 代码（包括变量插值 `${AGENT_TOOL_NAME}` 等、条件逻辑和字符串拼接），最终输出给模型的纯文本行数略少于代码行数。

> 📚 **课程关联（分布式系统/操作系统）**：Coordinator 模式采用经典的**Master-Worker 架构**——Coordinator 扮演调度器（Scheduler），Workers 扮演执行器（Executor）。四阶段工作流（Research→Synthesis→Implementation→Verification）本质上是软件工程中标准的"调研→设计→实现→验证"流程，在 Coordinator 的上下文中被结构化为并行任务编排。"只读任务自由并行、写任务同文件串行"的并发管理规则，在概念上类似数据库中的**读写锁**（Readers-Writer Lock）——但需要注意关键区别：数据库读写锁是代码层面的确定性互斥保证，而 Coordinator 的并发控制完全依赖提示词指令，是概率性的（取决于 LLM 是否遵守指令）。这种"软约束"是提示词路线的固有特征。

该函数返回的编排手册定义了：

**角色定义**（Section 1）：
> You are a **coordinator**. Your job is to help the user achieve their goal, direct workers, synthesize results, and communicate with the user. Answer questions directly when possible — don't delegate work that you can handle without tools.

**可用工具**（Section 2）：
- `Agent` — 创建新 Worker
- `SendMessage` — 继续已有 Worker
- `TaskStop` — 停止 Worker

**Worker 结果格式**（Section 2）：Worker 的输出以 `<task-notification>` XML 格式作为**用户消息**回传给 Coordinator：

```xml
<task-notification>
  <task-id>{agentId}</task-id>
  <status>completed|failed|killed</status>
  <summary>{状态摘要}</summary>
  <result>{Agent 最终文本}</result>
  <usage>
    <total_tokens>N</total_tokens>
    <tool_uses>N</tool_uses>
    <duration_ms>N</duration_ms>
  </usage>
</task-notification>
```

**并发与隔离规则**（Section 3）：Coordinator 提示词中这一部分规定了 Workers 之间的协作边界——只读任务（搜索、查看文件）可自由并行、写任务（编辑同一文件）必须串行；Workers 不能直接通信，只能通过 Coordinator 中转结果；每个 Worker 启动时会继承 Coordinator 的工作目录但各自独立持有上下文；写冲突由 Coordinator 在 Synthesis 阶段识别并在 Implementation 阶段拆单避免。本节具体条款以 `getCoordinatorSystemPrompt()` 源码（`coordinatorMode.ts:111-369`）为准。

**四阶段工作流**（Section 4）：

| 阶段 | 执行者 | 目的 |
|------|--------|------|
| Research | Workers（并行）| 调查代码库、理解问题 |
| Synthesis | **Coordinator** | 阅读发现、理解问题、编写实现规范 |
| Implementation | Workers | 按规范做精确修改 |
| Verification | Workers | 验证修改有效 |

**并发管理规则**：
- 只读任务（研究）→ 自由并行
- 写任务（实现）→ 同一文件集串行
- 验证 → 可与不同文件区域的实现并行

### 4.3 "Never write 'based on your findings'"

提示词中最引人注目的规则（`coordinatorMode.ts:259`）：

> Never write "based on your findings" or "based on the research." These phrases delegate understanding to the worker instead of doing it yourself. You never hand off understanding to another worker.

这是针对 LLM 的一个已知弱点：**懒惰委托**。模型在需要综合理解的地方容易用一句"基于你的发现"来回避真正的思考。这条规则强迫 Coordinator 自己理解 Worker 的发现，再给下一步 Worker 精确的实现规范。

### 4.4 Continue vs. Spawn 决策矩阵

提示词提供了一个详细的决策矩阵（`coordinatorMode.ts:284-293`）：

| 场景 | 选择 | 原因 |
|------|------|------|
| 研究恰好覆盖了需要编辑的文件 | Continue | Worker 已有文件上下文 |
| 研究范围广但实现范围窄 | Spawn | 避免探索噪音 |
| 修正失败或扩展近期工作 | Continue | Worker 有错误上下文 |
| 验证另一个 Worker 写的代码 | Spawn | 验证者需要新鲜视角 |
| 首次实现用了错误方法 | Spawn | 避免锚定效应 |

**"锚定效应规避"——最精妙的 LLM 工程洞察**

决策矩阵中最后一行——"首次实现用了错误方法→Spawn→避免锚定效应"——是全章最有原创性的设计洞察，值得展开。

在认知心理学中，**锚定效应**（Anchoring Effect）是指人在决策时会过度依赖最先接触到的信息。LLM 有类似的行为：在 context window 中看到之前的错误尝试后，模型的 attention 分布会偏向已有的代码模式，即使那个模式是错误的。这导致"修补"往往沿着错误路径继续走，而不是从根本上换一种方法。

源码原文（`coordinatorMode.ts:290`）的描述是：
> Wrong-approach context pollutes the retry; clean slate avoids anchoring on the failed path

通过 Spawn 一个新 Worker，Coordinator 实质上是在**工程层面对抗 LLM 的 attention bias**：新 Worker 的 context window 是干净的，不会被之前的错误尝试"污染"。这揭示了一个反直觉的 LLM 工程原则：**有时候遗忘上下文比保留上下文更好**。在传统软件工程中，上下文总是越多越好；但在 LLM Agent 系统中，错误的上下文可能比没有上下文更有害。

这个原则对所有多 Agent 框架的设计者都有参考价值——它暗示了 context management 不仅是"保留什么"的问题，更是"丢弃什么"的问题。

### 4.5 Scratchpad：跨 Worker 间接通信机制

`getCoordinatorUserContext()`（`coordinatorMode.ts:80-108`）：当 `tengu_scratch` gate 启用时，Coordinator 和 Workers 共享一个 scratchpad 目录——用于跨 Worker 的持久知识共享：

> Workers can read and write here without permission prompts. Use this for durable cross-worker knowledge — structure files however fits the work.

在 Claude Code 的架构中，Worker 之间不能直接通信——所有信息必须经过 Coordinator 中转（星型拓扑）。这保证了可控性，但也引入了瓶颈：Coordinator 的 context window 成为信息传递的唯一通道。

Scratchpad 打开了一条**绕过 Coordinator 的间接通信路径**。通过共享文件系统，Worker A 可以把研究发现写入 scratchpad 文件，Worker B 在实现时直接读取——不需要 Coordinator 转述，也不占用 Coordinator 的 context window。

> 💡 **通俗理解**：想象一个项目团队，所有沟通必须经过项目经理转发。Scratchpad 就像办公室的公共白板——团队成员可以把信息写在白板上，其他人直接去看，不用每次都让项目经理传话。

这在分布式系统中对应经典的 **shared filesystem 作为 IPC 机制**的模式。提示词刻意不规定文件组织方式（"structure files however fits the work"），把命名约定和内容格式留给 LLM 自主决定——这又是一个"重提示词"路线的特征：连 IPC 协议都是 LLM 即兴制定的。

值得注意的是，这种设计引入了一个开放问题：如果两个 Worker 同时写同一个 scratchpad 文件会怎样？提示词没有给出冲突解决策略，而文件系统层面的 last-write-wins 语义可能导致信息丢失。在实践中，由于 Coordinator 通常会错开写任务的调度，这个问题可能很少触发——但它揭示了"软约束"并发控制的固有风险。

## 5. 可观测性集成

### 5.1 Perfetto Trace

每个 Agent 在 `isPerfettoTracingEnabled()` 为 true 时注册到 Perfetto 追踪系统，结束时反注册。这让 Agent 的层级关系可以在 Chrome 的 tracing 工具中可视化。

### 5.2 Analytics

Agent 生命周期的关键事件都会 `logEvent()`：
- `tengu_coordinator_mode_switched` — 模式切换
- Agent 创建、完成、失败等生命周期事件

### 5.3 Proactive 集成

`AgentTool.tsx:59` 揭示了一个有趣的集成：

```typescript
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') 
  ? require('../../proactive/index.js') : null;
```

PROACTIVE 和 KAIROS feature gates 控制着某种主动行为系统——可能是 Agent 的自主任务发现能力。

## 6. DreamTask：睡眠中的记忆整理师

DreamTask 是任务系统中最特殊的类型——它**不执行用户请求**，而是在后台自动整理 AI 的记忆。

### 6.1 什么是 DreamTask

> 📚 **课程关联（操作系统）**：DreamTask 的触发机制（时间门槛 + 会话门槛 + 锁）与操作系统中的**垃圾回收器**（GC）调度策略高度相似——GC 也是在满足特定条件（内存压力、空闲周期）时触发后台整理。文件锁 + mtime 作为分布式协调机制，则类似于简化版的**分布式互斥锁**（如 Redlock 算法的文件系统版）。

🏙 **城市比喻**：如果其他任务类型是白天工作的市政部门，DreamTask 就是**夜间档案整理员**——在你不知道的时候，把多次对话积累的零散笔记整理成有条理的知识库。

**源码**：`src/tasks/DreamTask/DreamTask.ts`（157 行）+ `src/services/autoDream/autoDream.ts`

### 6.2 触发机制：三道门槛

DreamTask 不是随时运行的。它有严格的触发条件，按成本从低到高依次检查（`autoDream.ts`）：

| 门槛 | 条件 | 为什么 |
|------|------|--------|
| 时间门 | 距上次整理 ≥ 24 小时 | 避免频繁触发浪费 API 调用 |
| 会话门 | 上次整理后 ≥ 5 个新会话 | 确保有足够新信息值得整理 |
| 锁门 | 没有其他进程正在整理 | 防止并发冲突 |

还有扫描节流（`SESSION_SCAN_INTERVAL_MS = 10分钟`）：即使时间门已过但会话门未达标，10 分钟内不会重复扫描。

### 6.3 运行过程

1. 通过 `runForkedAgent()` 启动一个**隔离的子 AI**，使用专门的 `/dream` 提示词
2. 子 AI 按四阶段执行：定向(orient) → 收集(gather) → 整合(consolidate) → 清理(prune)
3. DreamTask 状态从 `starting` → `updating`（当检测到第一次文件编辑时）
4. UI 通过 `addDreamTurn()` 实时显示进展，最多保留最近 30 轮（`MAX_TURNS = 30`）
5. 完成后在聊天中插入系统消息通知用户

### 6.4 安全设计

- **锁机制**：`consolidationLock.ts` 使用文件 mtime 作为分布式锁，kill 时回滚 mtime 让下次会话可以重试
- **当前会话排除**：扫描时过滤掉当前会话 ID，避免"整理正在进行的工作"
- **KAIROS/Remote 禁用**：在 KAIROS 模式和远程模式下不运行，因为这些场景有自己的记忆管理

### 6.5 为什么这很重要

DreamTask 解决了一个根本问题：**AI 的记忆是碎片化的**。每次对话产生的记忆只是零散的文件（memory/*.md），时间一长就混乱了。DreamTask 定期把这些碎片合并、去重、整理成连贯的知识——就像人类在睡眠中整理白天的记忆一样。

## 7. 编排范式之争：重提示词 vs. 重代码

Claude Code 的 Coordinator 选择了一条在多 Agent 编排领域颇为少见的路线：**把几乎所有编排逻辑放进提示词，而不是写在代码里**。整个四阶段工作流、Continue vs. Spawn 决策矩阵、并发管理规则、Worker prompt 写作规范——全部以自然语言定义在一个模板字符串中。代码层面几乎没有硬编码的编排逻辑（没有状态机、没有有向图、没有显式的阶段转移条件）。

> 💡 **通俗理解**：想象两种管理公司的方式。"重代码"路线像制定详细的规章制度手册——每个流程都有明确的审批节点、条件分支、异常处理。"重提示词"路线更像是给一个能力很强的项目经理一份详细的工作备忘录——告诉他原则和案例，具体怎么调度让他自己判断。

**两种路线的对比**：

| 维度 | 重提示词（Claude Code） | 重代码（LangGraph/AutoGen） |
|------|------------------------|---------------------------|
| 编排定义 | 自然语言提示词 | 代码中的图结构/状态机 |
| 灵活性 | 极高——LLM 可根据运行时上下文自适应调整编排策略 | 中等——图结构是静态的，条件分支需提前定义 |
| 可测试性 | 低——提示词的行为取决于 LLM，难以写确定性测试 | 高——代码路径可用单元测试覆盖 |
| 可追溯性 | 低——编排决策发生在 LLM 内部，难以审计"为什么选了 Continue 而不是 Spawn" | 高——每个状态转移都有代码记录 |
| 版本控制 | 提示词变更的 diff 是自然语言——reviewer 难以判断影响面 | 代码变更的 diff 有明确的语义 |
| Context 成本 | 约 250 行提示词占用 context window；在密集编排场景下，Coordinator 的上下文会被 `<task-notification>` 迅速填满 | 编排逻辑不占用 context window |
| 自适应能力 | LLM 可根据任务复杂度即兴调整策略（如跳过 Research 直接 Implement） | 需要提前在代码中定义所有可能的路径 |

**为什么 Claude Code 选择了这条路**？这个选择背后有几个关键约束：

1. **迭代速度**：提示词修改不需要重新编译和部署。Anthropic 的 Coordinator 团队可以通过调整一段自然语言来改变编排行为——这对于一个快速迭代的产品来说至关重要。
2. **LLM 能力依赖**：Claude Code 2.1.88 的默认模型是 Claude 4.x 系列（Opus 4.6 / Sonnet 4.6 / Haiku 4.5——详见 Part 2 第 10 章「Token 经济学」的价格表），这些模型具备足够强的指令遵循能力，使得"用自然语言定义编排规则"成为可行方案。如果底层模型的指令遵循能力较弱，这条路线就不可行。
3. **任务多样性**：编程任务的复杂度跨度极大——从"改一个 typo"到"重构整个模块"。用代码定义的有向图很难覆盖所有可能的任务模式，而 LLM 可以根据任务的具体特征即兴调整编排策略。

**混合方案的可能性**：这两种路线并非非此即彼。一个理论上更优的方案是用**代码处理确定性的调度逻辑**（如并发控制——同一文件集不能同时有两个 Worker 写入），用**提示词处理需要判断力的决策**（如 Continue vs. Spawn）。目前 Claude Code 把两者都放在了提示词里——包括本应是确定性的并发控制规则。这意味着系统的正确性在一定程度上取决于 LLM 对指令的遵守程度，这是一个值得关注的风险点。

---

## 8. 设计取舍与评价

**优秀**：
1. AsyncGenerator 模式让 Agent 输出**流式可观察**——父 Agent 能实时看到子 Agent 的进展
2. Coordinator 提示词的"Never hand off understanding"规则是针对 LLM 已知弱点的有效对策——类似的反懒惰委托设计在 AutoGen 等框架中也有体现（如 "GroupChatManager" 要求总结者自己理解而非转述）
3. `<task-notification>` XML **以 "user message" 角色注入**到 Coordinator 的消息历史中（因为 Anthropic Messages API 的消息角色只有 user/assistant 两种，没有专门的"system notification"角色）——这是一种 Claude Code 特有的协议约定：Coordinator 的提示词明确告知它这类带 `<task-notification>` XML 包装的"user"消息来自 Worker 而非人类用户，让模型正确解读。统一了输入格式同时支持多 Agent 通信
4. Continue vs. Spawn 决策矩阵给模型提供了清晰的分支判断依据
5. `omitClaudeMd` 对只读 Agent 的优化说明团队在系统级关注 token 经济性
6. 三层隔离模型（共享→worktree→remote）覆盖了从简单到安全的所有场景

**代价**：
1. 约 250 行提示词本质上是"架构逻辑放在了 prompt 里"——难以测试、难以追踪变更原因（详细分析见第 7 节）
2. `setAppState` no-op + `setAppStateForTasks` 绕行是一种**受控泄漏**——需要审查每个使用点
3. Worker 不能看到 Coordinator 的对话意味着每次 spawn 都需要完整的上下文重建
4. `dream` TaskType 的四阶段结构完全由提示词控制——代码层面只区分 `starting` 和 `updating` 两个粗粒度阶段
5. Auto-background 120 秒阈值是硬编码的——不同任务类型可能需要不同的阈值

---

*质量自检：*
- [x] 覆盖：Agent 生命周期 + 隔离模型 + 7 种 TaskType + Coordinator 系统提示词 + 可观测性
- [x] 忠实：Coordinator 提示词的引用完全来自 coordinatorMode.ts 的实际内容
- [x] 深度："反懒惰委托"规则的 LLM 弱点分析、Continue vs. Spawn 决策矩阵
- [x] 批判：指出提示词作为架构的脆弱性、auto-background 硬编码阈值
