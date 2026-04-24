# 多个 Claude 实例是怎么协同工作的？

深入解析 Claude Code 的 Swarm（蜂群）多实例协作模式——Leader 如何分配任务、Teammate 如何独立执行、Mailbox 消息系统如何实现跨实例通信，以及权限审批如何汇聚到统一入口。

---

### 🌍 行业背景

多 AI Agent 协作是 2024-2026 年 AI 工程领域演进最快的方向。2026 年，多实例协同已从实验性框架全面进入生产级部署。据公开报道，**Kimi Code** 基于 K2.5 1T MoE 模型支持大规模并发子智能体的 Agent Swarm，是目前公开的高并发生产级实现之一（具体并发上限以官方发布为准）。**Codex（OpenAI）** v0.118.0 引入邮箱通信机制（Mailbox），允许不同后台进程异步交互——与 Claude Code 的 Mailbox 文件系统通信在概念上相似，但 Codex 的 Mailbox 更偏向进程间异步消息队列。**Devin** 的 Manage Devins 功能将多实例部署在各个独立隔离 VM 中，配合 Human-in-the-loop 精细管控——与 Claude Code 的 Swarm 模式相比，Devin 走的是"云端 VM 隔离"路线，而 Claude Code 是"本地进程/终端隔离"路线。**OpenAI 的 Swarm 框架**（2024 年开源）提出了"handoff"（移交）的对等编排模式，但它是纯内存的概念验证，没有持久化和多进程支持。**LangGraph** 用有向图定义 Agent 工作流，支持状态持久化和条件分支，但协作模式是预定义的图结构而非动态的消息传递。**AutoGen**（微软）采用集中式的 GroupChat 管理器而非星型拓扑。**OpenClaw（原 Clawdbot）** 以通信应用（WhatsApp/Telegram）为交互入口，采用"感知-规划-行动-观察"闭环，支持跨地域设备唤醒与远程执行——代表了一种截然不同的"去终端化"多实例协作范式。

Claude Code 的 Swarm 模式在工程深度上有独到之处——它真正解决了多进程隔离（三种 backend）、文件系统级通信（Mailbox）、跨实例权限同步等生产级问题。与 Kimi Code 的大规模并发 Swarm 或 Devin 的云端 VM 集群相比，Claude Code 的 Swarm 更侧重于本地终端环境的深度集成和权限精细管控。但其星型拓扑（所有权限回到 Leader）在 Agent 数量增长时可能成为瓶颈，这也是所有集中式协调架构的已知限制。

---

## 问题

Claude Code 有一个"Swarm"（蜂群）模式，可以让多个 Claude 实例同时工作。这些实例是怎么协调的？它们怎么通信？权限怎么管理？一个 1,552 行的 `inProcessRunner.ts` 是怎么驱动整个系统的？

> 💡 **通俗理解**：Swarm 模式就像**远程遥控多架无人机**——Leader（遥控器/地面站）负责总指挥和审批，每个 Teammate（无人机）各自独立执行任务，通过信号链路（Mailbox 消息系统）保持通信。所有重要决策（权限审批）都汇聚到地面站，确保安全可控。

---

> **[图表预留 2.14-A]**：Swarm 拓扑图——Leader 居中，Teammates（A/B/C）分布四周，标注：通信箭头（Mailbox消息）、权限汇聚箭头（LeaderPermissionBridge）、Backend 类型标注（tmux/in-process/iTerm2）

## 城市比喻

Swarm 系统是城市的**项目管理部**——把大工程拆分给多个施工队同时进行。Leader 是项目总指挥，坐在指挥中心（主终端）；Teammates 是各个施工队，有的在同一栋办公楼里（in-process），有的在独立的工棚里（tmux 窗格），有的在隔壁的高级写字楼（iTerm2 原生分屏）。无论在哪里，所有施工队都通过同一套**邮件系统**（Mailbox）收发指令，所有安全审批都必须回到总指挥那里盖章（LeaderPermissionBridge）。

---

## 核心概念：Leader + Teammates

Swarm 模式有一个主导者（Leader，即主 Claude 实例）和若干 Teammates（工作者）。这是一个经典的星型拓扑——所有协调和权限决策都通过 Leader 汇聚。

> 📚 **课程关联**：星型拓扑是**计算机网络**课程中的基础网络拓扑之一。Leader 作为中心节点类似于交换机——在 Claude Code 的 Swarm 里，"所有通信和决策都经过它"是对**权限审批**这一条路径的描述（见后文 Leader Permission Bridge），**不是**对全部通信的描述：Teammate 之间仍可通过 Mailbox 直接互发消息、通过 SendMessageTool 跨会话互发（见本章结尾"三条协作通道"）。星型拓扑的管理简单、故障隔离好（一个 Teammate 崩溃不影响其他），代价是权限审批这条链路上 Leader 会成为单点故障和性能瓶颈。在**分布式系统**课程中，这对应"集中式协调器"模式（如 ZooKeeper 的 Leader 选举），与去中心化的对等网络（P2P）形成对比。

**Identity 格式**：`researcher@my-team`
- `researcher`：Teammate 的名称（角色标识）
- `my-team`：团队名称

这个格式由 `formatAgentId()` 生成，在整个系统中作为唯一标识符使用。`sanitizeAgentName()` 会把名称中的 `@` 替换为 `-`，防止与分隔符冲突。

### 团队文件（Team File）

每个团队在磁盘上有一个持久化的配置文件，存储在 `~/.claude/teams/{teamName}/config.json`：

```typescript
// teamHelpers.ts
type TeamFile = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string          // Leader 的 session UUID
  hiddenPaneIds?: string[]        // 当前隐藏的窗格
  teamAllowedPaths?: TeamAllowedPath[]  // 团队级别的路径权限
  members: Array<{
    agentId: string
    name: string
    model?: string
    prompt?: string
    color?: string
    planModeRequired?: boolean
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string          // 可选的 git worktree 路径
    backendType?: BackendType      // 'tmux' | 'iterm2' | 'in-process'
    isActive?: boolean             // false=空闲, true/undefined=活跃
    mode?: PermissionMode
  }>
}
```

注意 `teamAllowedPaths` 字段：团队可以配置全局的路径权限，所有 Teammate 在启动时自动继承这些规则，无需逐个审批。这是"信任传播"的机制——Leader 说"这个目录大家都可以编辑"，所有施工队就自动获得了这个权限。

### 每个 Teammate 的 AppState 表示

每个 Teammate 在 AppState 里有一个 `InProcessTeammateTaskState`，这是一个信息量极大的结构体（`types.ts`，共 121 行）：

```typescript
type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'
  identity: TeammateIdentity         // agentId, agentName, teamName, color, planModeRequired
  prompt: string                     // 初始指令
  model?: string                     // 可选的模型覆盖

  // 双重 AbortController 设计
  abortController?: AbortController         // 杀死整个 Teammate（生命周期级别）
  currentWorkAbortController?: AbortController  // 只中止当前轮次（Escape 键）

  // 权限和计划模式
  awaitingPlanApproval: boolean
  permissionMode: PermissionMode     // 可通过 Shift+Tab 独立切换

  // 消息和进度
  messages?: Message[]               // UI 显示用，有上限
  inProgressToolUseIDs?: Set<string> // 正在执行的工具调用（用于动画）
  pendingUserMessages: string[]      // 用户通过 UI 发送的待处理消息

  // 生命周期
  isIdle: boolean
  shutdownRequested: boolean
  onIdleCallbacks?: Array<() => void>  // 空闲时通知等待者
}
```

**双重 AbortController 的设计意图**：这解决了一个真实的交互问题。用户按 Escape 键时，只想停止 Teammate 当前正在做的事情（比如一个长时间运行的 bash 命令），而不是杀死整个 Teammate。`currentWorkAbortController` 让 Escape 只取消当前轮次；`abortController` 才是真正的"生死开关"。代码中（`inProcessRunner.ts` 第 1057 行）可以清楚看到这个区分：

```typescript
// Create a per-turn abort controller for this iteration.
// This allows Escape to stop current work without killing the whole teammate.
const currentWorkAbortController = createAbortController()
```

---

## 三种执行后端

Teammates 可以用三种方式运行。Backend 的选择由 `registry.ts` 中的检测逻辑自动决定，优先级如下：

1. 如果在 tmux 内部，始终使用 tmux（即使在 iTerm2 中）
2. 如果在 iTerm2 中且 `it2` CLI 可用，使用 iTerm2 后端
3. 如果在 iTerm2 中但 `it2` 不可用，提示安装
4. 如果 tmux 可用（但不在里面），创建外部 tmux session
5. 如果以上都不行，回退到 in-process 模式

### in-process（同进程执行）

这是最重要的后端，也是唯一不需要外部终端的模式。Teammate 在同一个 Node.js 进程里运行，使用 `AsyncLocalStorage` 隔离上下文。

```typescript
// spawnInProcess.ts
export async function spawnInProcessTeammate(
  config: InProcessSpawnConfig,
  context: SpawnContext,
): Promise<InProcessSpawnOutput> {
  // 1. 生成确定性 Agent ID
  const agentId = formatAgentId(name, teamName)
  // 2. 创建独立的 AbortController（不与 Leader 联动）
  const abortController = createAbortController()
  // 3. 创建 AsyncLocalStorage 上下文
  const teammateContext = createTeammateContext({...})
  // 4. 注册 Perfetto 追踪
  if (isPerfettoTracingEnabled()) {
    registerPerfettoAgent(agentId, name, parentSessionId)
  }
  // 5. 在 AppState 中注册任务
  registerTask(taskState, setAppState)
}
```

注意第 2 步：Teammate 的 AbortController 是**独立于 Leader** 的。代码注释明确说明了原因：`Teammates should not be aborted when the leader's query is interrupted`。Leader 按 Escape 中断自己的查询时，不应该连锁杀掉所有 Teammate。

**优点**：启动快（毫秒级）、通信低延迟、可以共享 API 客户端和 MCP 连接、不需要安装 tmux

**缺点**：如果一个 Teammate 崩溃，可能影响整个进程；内存竞争

**关键细节**：当 InProcessBackend 启动 Teammate 时，它会**清空 Leader 的对话消息**再传递给 Teammate：

```typescript
// InProcessBackend.ts 第 122-123 行
// Strip messages: the teammate never reads toolUseContext.messages
// Passing the parent's conversation would pin it for the teammate's lifetime.
toolUseContext: { ...this.context, messages: [] },
```

这个看似奇怪的操作有充分理由：如果把 Leader 的完整对话传给 Teammate，那 Teammate 存活期间 JavaScript 的垃圾回收器就无法释放 Leader 的旧消息——因为 Teammate 持有引用。对于长时间运行的 Teammate，这会造成严重的内存泄漏。

### tmux（多终端面板）

每个 Teammate 在 tmux 窗格里运行独立的 Claude 进程。TmuxBackend 有两种模式：

**在 tmux 内部运行**（Leader 自己就在 tmux 里）：
- 直接分割当前窗口
- Leader 占左边 30%，Teammates 占右边 70%
- 使用用户自己的 tmux session

**在 tmux 外部运行**（普通终端）：
- 创建一个名为 `claude-swarm` 的独立 tmux session
- 使用独立的 socket（`claude-swarm-{PID}`），隔离与用户 tmux 的冲突
- 所有 Teammates 平等分布（没有 Leader 窗格）

```typescript
// constants.ts
SWARM_SESSION_NAME = 'claude-swarm'
SWARM_VIEW_WINDOW_NAME = 'swarm-view'

// 独立 socket 包含 PID 避免多实例冲突
function getSwarmSocketName(): string {
  return `claude-swarm-${process.pid}`
}
```

TmuxBackend 有一个精巧的**窗格创建锁**（`acquirePaneCreationLock()`），防止并行创建多个 Teammate 时出现竞态条件。创建窗格后还有 200ms 的等待期（`PANE_SHELL_INIT_DELAY_MS = 200`，定义于 `backends/TmuxBackend.ts:33`），让 shell 完成初始化（加载 `.bashrc`、starship prompt 等）。

### iTerm2（原生分屏）

类似 tmux 但使用 iTerm2 的原生分屏功能。检测方式是看三个环境变量中的任意一个：

```typescript
// detection.ts
const termProgram = process.env.TERM_PROGRAM     // 'iTerm.app'
const hasItermSessionId = !!process.env.ITERM_SESSION_ID
const terminalIsITerm = env.terminal === 'iTerm.app'
```

iTerm2 后端使用 AppleScript（`osascript`）控制 iTerm2，这是 macOS 内建的，不需要额外安装。但 `it2` CLI 需要单独安装配置，如果检测到 iTerm2 但 `it2` 不可用，系统会弹出设置引导（`It2SetupPrompt.tsx`，379 行的 React 组件——可见这个引导流程本身就很复杂）。

---

## 统一的 Backend 抽象

三种 backend 通过两层接口抽象：

**PaneBackend**（低层——终端窗格操作）：

```typescript
type PaneBackend = {
  readonly type: BackendType
  readonly displayName: string
  readonly supportsHideShow: boolean    // tmux 支持，iTerm2 不一定
  isAvailable(): Promise<boolean>
  createTeammatePaneInSwarmView(name, color): Promise<CreatePaneResult>
  sendCommandToPane(paneId, command): Promise<void>
  setPaneBorderColor(paneId, color): Promise<void>
  setPaneTitle(paneId, name, color): Promise<void>
  rebalancePanes(windowTarget, hasLeader): Promise<void>
  killPane(paneId): Promise<boolean>
  hidePane(paneId): Promise<boolean>     // 隐藏但不杀死
  showPane(paneId, target): Promise<boolean>
}
```

**TeammateExecutor**（高层——Teammate 生命周期）：

```typescript
type TeammateExecutor = {
  readonly type: BackendType
  isAvailable(): Promise<boolean>
  spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>
  sendMessage(agentId: string, message: TeammateMessage): Promise<void>
  terminate(agentId: string, reason?: string): Promise<boolean>  // 优雅关闭
  kill(agentId: string): Promise<boolean>                        // 强制终止
  isActive(agentId: string): Promise<boolean>
}
```

这让 Leader 不需要知道 Teammate 是在 tmux 里、iTerm2 里还是同进程里——接口完全相同。`PaneBackendExecutor`（354 行的 `PaneBackendExecutor.ts`）把 PaneBackend 适配成 TeammateExecutor 接口，是经典的适配器模式。

注意 `terminate` 和 `kill` 的区别：`terminate` 是"请你停下来"（发送 shutdown request 到邮箱，Teammate 可以拒绝），`kill` 是"立刻停下来"（直接 abort AbortController 或 kill-pane）。

---

## 通信：邮箱系统

Teammates 之间通过基于文件系统的邮箱（Mailbox）通信——无论是同进程、tmux 还是 iTerm2 后端：

```typescript
type TeammateMessage = {
  text: string
  from: string         // 发送者名称
  color?: string       // 发送者颜色
  timestamp?: string
  summary?: string     // 5-10 字摘要，显示在 UI 预览中
}
```

### 邮箱的轮询机制

Teammate 空闲时进入一个 500ms 间隔的轮询循环（`waitForNextPromptOrShutdown()`），检查三个消息来源：

1. **内存中的 pendingUserMessages**：用户在 UI 中直接发送给 Teammate 的消息
2. **文件系统邮箱**：其他 Teammate 或 Leader 发来的消息
3. **任务列表**：团队共享的任务列表中有没有未认领的任务

轮询的优先级设计很有意思（`inProcessRunner.ts` 第 806-818 行）：

```
Shutdown 请求 > Leader 消息 > 其他 Teammate 消息 > 任务列表
```

这个优先级确保了：
- Leader 的关闭指令不会被大量 Teammate 间消息淹没
- Leader 的工作指令优先于 Teammate 间的聊天
- 如果没有直接消息，Teammate 会主动从任务列表中认领工作

### 任务认领机制

Teammate 不仅被动等待消息，还会主动从共享任务列表中认领工作：

```typescript
// inProcessRunner.ts
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )
  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
}
```

`claimTask()` 使用原子操作确保同一个任务不会被两个 Teammate 同时认领。认领后立即把状态设为 `in_progress`，让 UI 实时反映。

> 📚 **课程关联**：任务认领的原子性问题是**操作系统**课程中经典的临界区（critical section）问题——多个 Teammate 并发检查同一个任务列表时，必须保证"检查+认领"是原子操作，否则会出现两个 Teammate 同时认领同一任务的竞态条件。`blockedBy` 字段实现的依赖关系则类似**编译原理**中的拓扑排序——只有依赖项全部完成，任务才可以被执行。

---

## InProcessRunner：1,552 行的核心引擎

`inProcessRunner.ts` 是整个 Swarm 系统的心脏，驱动同进程 Teammate 的完整生命周期。它的核心是一个 `while` 循环（第 1048 行开始），结构如下：

```
while (!aborted && !shouldExit) {
  1. 创建 per-turn AbortController（Escape 只停当前轮）
  2. 检查是否需要上下文压缩（auto-compact）
  3. 在 teammateContext 中运行 runAgent()
  4. 收集消息、更新进度
  5. 标记为 idle，发送空闲通知
  6. 等待下一个消息或关闭请求
  7. 根据消息类型设置下一轮的 prompt
}
```

### 上下文压缩

Teammate 是长期运行的——它不像普通 subagent 那样完成一个任务就退出。这意味着对话历史会不断增长。系统在每轮开始前检查 token 数量，超过阈值时执行上下文压缩：

```typescript
const tokenCount = tokenCountWithEstimation(allMessages)
if (tokenCount > getAutoCompactThreshold(toolUseContext.options.mainLoopModel)) {
  // 创建隔离的 toolUseContext，避免干扰主 session 的 UI
  const isolatedContext = {
    ...toolUseContext,
    readFileState: cloneFileStateCache(toolUseContext.readFileState),
    onCompactProgress: undefined,   // 不触发 Leader 的压缩进度 UI
    setStreamMode: undefined,
  }
  const compactedSummary = await compactConversation(allMessages, isolatedContext, ...)
}
```

注意 `cloneFileStateCache()` 调用：压缩操作需要读取文件状态，但不能污染 Leader 的文件状态缓存。这是同进程运行模式带来的隔离挑战——两个"人"共用一个办公室时，必须各自有各自的文件柜。

### 消息格式化

从 Leader 或其他 Teammate 发来的消息会被包装成 XML 格式，确保模型能正确识别消息来源：

```typescript
function formatAsTeammateMessage(from, content, color?, summary?): string {
  return `<teammate-message teammate_id="${from}" color="${color}" summary="${summary}">
${content}
</teammate-message>`
}
```

这与 tmux Teammate 接收消息的格式完全一致，确保不管 Teammate 运行在哪种 backend 里，收到的消息格式都一样。

### System Prompt 构建

Teammate 的 system prompt 有三种模式（`inProcessRunner.ts` 第 923-969 行）：

1. **default**：完整的主 agent system prompt + teammate 附加说明 + 自定义 agent 指令
2. **replace**：完全替换为自定义 prompt
3. **append**：完整的主 prompt + teammate 附加说明 + 附加的自定义 prompt

无论哪种模式，系统都会确保 Teammate 拥有团队协作必需的工具：

```typescript
tools: agentDefinition?.tools
  ? [...new Set([
      ...agentDefinition.tools,
      SEND_MESSAGE_TOOL_NAME,    // 必须能发消息
      TEAM_CREATE_TOOL_NAME,     // 必须能创建子团队
      TEAM_DELETE_TOOL_NAME,
      TASK_CREATE_TOOL_NAME,     // 必须能操作任务列表
      TASK_GET_TOOL_NAME,
      TASK_LIST_TOOL_NAME,
      TASK_UPDATE_TOOL_NAME,
    ])]
  : ['*'],  // 如果没指定工具列表，给全部工具
```

这个设计确保了即使自定义 agent 只声明了几个工具，它仍然能够响应关闭请求、发送消息和协调任务。**注入逻辑是 append + dedupe**（通过 `new Set(...)` 去重），即：用户自定义的 `agentDefinition.tools` 原样保留，只是再追加 7 个协作必需工具（SEND_MESSAGE、TEAM_CREATE、TEAM_DELETE、TASK_CREATE、TASK_GET、TASK_LIST、TASK_UPDATE），重复的会合并——所以最终工具数 = 用户列表条数 + 这 7 个中尚未出现在用户列表里的条数。

---

## Teammate 的 System Prompt 附加说明

`teammatePromptAddendum.ts` 只有 18 行，但每一行都至关重要：

```typescript
export const TEAMMATE_SYSTEM_PROMPT_ADDENDUM = `
# Agent Teammate Communication

IMPORTANT: You are running as an agent in a team. To communicate with anyone on your team:
- Use the SendMessage tool with \`to: "<name>"\` to send messages to specific teammates
- Use the SendMessage tool with \`to: "*"\` sparingly for team-wide broadcasts

Just writing a response in text is not visible to others on your team -
you MUST use the SendMessage tool.

The user interacts primarily with the team lead. Your work is coordinated
through the task system and teammate messaging.
`
```

这段话解决了一个根本性的问题：LLM 的"自然本能"是直接输出文本作为回复，但在 Swarm 模式下，**Teammate 的文本输出默认不会被其他 Teammate 或 Leader 看到**——它只存在于 Teammate 自己的 transcript 和 UI 窗格里。如果用户切到对应的 tmux/iTerm2 窗格，或在 Leader UI 里主动展开这个 Teammate 的详情面板，仍然能看到这段文本；换言之，"不会被任何人看到"是对"团队协作语义"而言的（别人的 AI 回路接收不到），不是物理不可见。Teammate 必须使用 SendMessage 工具才能真正与团队内其他 AI 通信。这类似于远程办公者习惯了面对面说话，需要被明确告知"你必须用 Slack 发消息，别人才能看到"——文字在你自己的记事本上也存在，但同事的收件箱不会自动收到。

---

## Teammate 的模型选择

`teammateModel.ts` 只有 10 行，但揭示了一个重要的默认配置：

```typescript
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}
```

当用户没有显式配置 Teammate 模型时，默认使用 Claude Opus 4.6。注意 `getAPIProvider()` 调用——这确保了使用 Bedrock、Vertex 或 Foundry 的企业用户也能获得正确的模型 ID。代码注释用 `@[MODEL LAUNCH]` 标记提醒工程师：每当新模型发布时，需要更新这个 fallback。

---

## 权限同步：Leader 是唯一的权限中心

这是 Swarm 架构中最复杂的子系统之一，涉及两个文件的协作：`leaderPermissionBridge.ts`（54 行的精简桥接）和 `permissionSync.ts`（928 行的完整同步机制）。

### 基本原则

在 Swarm 模式下，Teammate 不能独立弹出权限确认框。原因有二：
1. tmux/iTerm2 Teammate 运行在独立终端里，用户可能根本没在看那个窗格
2. in-process Teammate 和 Leader 共享同一个 UI 线程，权限弹窗会冲突

所有权限决策都路由回 Leader，这是"单一控制面"设计。

### Leader Permission Bridge

`leaderPermissionBridge.ts` 用模块级变量实现了一个极简的桥接：

```typescript
let registeredSetter: SetToolUseConfirmQueueFn | null = null
let registeredPermissionContextSetter: SetToolPermissionContextFn | null = null

// REPL 启动时注册
export function registerLeaderToolUseConfirmQueue(setter): void {
  registeredSetter = setter
}

// Teammate 需要权限时调用
export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return registeredSetter
}
```

为什么用模块级变量而不是更"正式"的架构？因为 Leader 的 REPL 是 React 组件（Ink），而 in-process Teammate 的 Runner 是纯 TypeScript 函数。React 的 state setter 无法通过常规 DI 传递到非 React 代码中。这个 bridge 就是 React 世界和普通 TypeScript 世界之间的桥梁。

### 权限请求的两条路径

`createInProcessCanUseTool()`（`inProcessRunner.ts` 第 128-451 行，闭区间共 324 行的单个函数！）实现了 Teammate 权限检查的完整逻辑：

**路径 1：Leader UI 桥接可用**（in-process Teammate 的标准路径）

```
Teammate 需要权限
  → 检查 hasPermissionsToUseTool()：如果 allow/deny，直接返回
  → 如果是 'ask'，且是 bash 命令，先尝试 classifier 自动审批
  → 仍需要人工审批 → 通过 Bridge 把请求加入 Leader 的 ToolUseConfirm 队列
  → Leader UI 弹出权限对话框（带 workerBadge 标识是哪个 Teammate）
  → 用户操作 → 通过 Promise resolve 返回给 Teammate
```

权限弹窗中的 `workerBadge` 显示 Teammate 的名称和颜色，让用户知道这个权限请求来自哪个"施工队"：

```typescript
workerBadge: identity.color
  ? { name: identity.agentName, color: identity.color }
  : undefined,
```

**路径 2：邮箱回退**（tmux/iTerm2 Teammate 或 Bridge 不可用时）

```
Teammate 需要权限
  → 创建 SwarmPermissionRequest（带 zod schema 验证）
  → 写入 Leader 的文件系统邮箱
  → 每 500ms 轮询自己的邮箱等待响应
  → Leader 检测到请求 → 用户在 Leader UI 操作
  → Leader 写入 Teammate 的邮箱
  → Teammate 读到响应 → 继续执行
```

### 文件系统权限存储

权限请求和响应都存在磁盘上，目录结构是：

```
~/.claude/teams/{teamName}/permissions/
  pending/             # 待处理的请求
    perm-1711234567-abc1234.json
  resolved/            # 已处理的请求
    perm-1711234567-abc1234.json
```

使用文件锁（`lockfile.lock()`）保证原子性。这个设计让权限请求即使在进程崩溃后也能恢复——因为状态在磁盘上，不在内存里。

### 权限更新的回写

当用户在 Leader UI 上选择了"Always allow"时，这个权限规则需要同步回 Teammate。但这里有一个微妙的问题（`inProcessRunner.ts` 第 275-279 行）：

```typescript
// Preserve the leader's mode to prevent workers'
// transformed 'acceptEdits' context from leaking back
// to the coordinator
setToolPermissionContext(updatedContext, { preserveMode: true })
```

Teammate 的权限模式可能和 Leader 不同（比如 Teammate 在 `acceptEdits` 模式）。回写权限规则时必须保留 Leader 自己的模式，否则 Teammate 的模式会"污染"Leader。`preserveMode: true` 的语义是：本次 setToolPermissionContext 调用**只同步规则列表**，不触碰目标上下文（Leader 侧）原有的 `permissionMode` 字段；换言之，把"规则"和"当前模式"两种状态解耦合同步，规则流向 Leader，模式留在各自的实例里。

---

## Teammate 初始化序列

`teammateInit.ts` 处理 Teammate 的启动设置，核心工作分三步：

### 第 1 步：继承团队级别的路径权限

```typescript
if (teamFile.teamAllowedPaths && teamFile.teamAllowedPaths.length > 0) {
  for (const allowedPath of teamFile.teamAllowedPaths) {
    const ruleContent = allowedPath.path.startsWith('/')
      ? `/${allowedPath.path}/**`    // 绝对路径 → //path/**（源码 teammateInit.ts:51 注释明确"prepend one / to create //path/** pattern"；这是 ignore 库对绝对路径的约定写法，不是字符串拼接 bug）
      : `${allowedPath.path}/**`     // 相对路径 → path/**
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
        type: 'addRules',
        rules: [{ toolName: allowedPath.toolName, ruleContent }],
        behavior: 'allow',
        destination: 'session',
      }),
    }))
  }
}
```

### 第 2 步：注册 Stop Hook（空闲通知）

当 Teammate 的 session 停止时（无论是正常完成还是被中断），它需要通知 Leader 自己已经空闲了：

```typescript
addFunctionHook(setAppState, sessionId, 'Stop', '', async (messages) => {
  // 标记自己为 inactive
  void setMemberActive(teamName, agentName, false)
  // 发送空闲通知到 Leader
  const notification = createIdleNotification(agentName, {
    idleReason: 'available',
    summary: getLastPeerDmSummary(messages),
  })
  await writeToMailbox(leadAgentName, {
    from: agentName,
    text: jsonStringify(notification),
    timestamp: new Date().toISOString(),
    color: getTeammateColor(),
  })
  return true  // 不阻塞 Stop 流程
})
```

Hook 的 timeout 是 10 秒——如果磁盘 I/O 太慢导致通知写入超时，就放弃，不阻塞关闭流程。

### 第 3 步：环境变量和 CLI 标志传播

当 Teammate 在 tmux 中作为独立进程运行时（不是 in-process），`spawnUtils.ts` 负责确保 Teammate 继承正确的配置：

```typescript
// 必须传播的环境变量
const TEAMMATE_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',      // API 提供商
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',           // 自定义 API 端点
  'CLAUDE_CONFIG_DIR',            // 配置目录
  'CLAUDE_CODE_REMOTE',           // CCR 模式标记
  'HTTPS_PROXY', 'https_proxy',   // 代理设置
  'SSL_CERT_FILE',                // TLS 证书
  // ...
]
```

如果忘记传播这些变量，Teammate 会默认使用 first-party API——这对使用 Bedrock 或 Vertex 的企业用户是灾难性的。这段"issue 事故"的描述来自源码注释里的 issue 编号引用（与提交历史里的修复 commit 对应），本章未在此处贴出 issue 链接以免造成"已验证具体内容"的错觉；感兴趣的读者可以在代码仓库注释里搜 `CLAUDE_CODE_USE_BEDROCK` 附近的历史变更。

CLI 标志的传播同样重要，但有一个安全约束：

```typescript
// Plan mode 优先于 bypass permissions
if (planModeRequired) {
  // 不继承 bypass permissions
} else if (permissionMode === 'bypassPermissions') {
  flags.push('--dangerously-skip-permissions')
}
```

如果 Leader 在 `--dangerously-skip-permissions` 模式下，但某个 Teammate 被标记为 `planModeRequired`，那这个 Teammate **不会**继承跳过权限的标志。计划模式的安全约束优先于便利性。

---

## 终端布局管理

`teammateLayoutManager.ts` 是 UI 层面的抽象，把布局操作委托给当前检测到的 backend：

```typescript
async function getBackend(): Promise<PaneBackend> {
  return (await detectAndGetBackend()).backend  // 自动缓存
}

export async function createTeammatePaneInSwarmView(
  teammateName: string,
  teammateColor: AgentColorName,
): Promise<{ paneId: string; isFirstTeammate: boolean }> {
  const backend = await getBackend()
  return backend.createTeammatePaneInSwarmView(teammateName, teammateColor)
}
```

### 颜色管理

每个 Teammate 分配一个唯一颜色，用轮询方式从调色板中选取：

```typescript
const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

export function assignTeammateColor(teammateId: string): AgentColorName {
  const existing = teammateColorAssignments.get(teammateId)
  if (existing) return existing  // 幂等：同一个 Teammate 始终同一个颜色
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!
  teammateColorAssignments.set(teammateId, color)
  colorIndex++
  return color
}
```

调色板是 8 色 (`AGENT_COLORS` 定义了 8 个颜色)，`colorIndex % AGENT_COLORS.length` 按轮询分配——因此严格意义上"每个 Teammate 唯一颜色"只在同时存活 Teammate 数 ≤ 8 时成立；第 9 个 Teammate 会和第 1 个共享颜色。`teammateColorAssignments` 做的是 "同一个 Teammate 始终同一个颜色"（幂等），不是"全体唯一"。这个颜色不仅用于 tmux 窗格边框，还传播到消息中（`TeammateMessage.color`）和权限弹窗（`workerBadge.color`），让用户在所有交互界面上都能通过颜色快速识别不同的 Teammate。

---

## 重连机制

`reconnection.ts` 处理两种场景：

### 首次启动

从 CLI 参数中读取团队信息（`getDynamicTeamContext()`），同步计算初始 teamContext：

```typescript
export function computeInitialTeamContext(): AppState['teamContext'] | undefined {
  const context = getDynamicTeamContext()  // CLI args → dynamicTeamContext
  if (!context?.teamName || !context?.agentName) return undefined

  // 从 context 解构出下文要用的字段
  const { teamName, agentName, agentId } = context

  const teamFile = readTeamFile(teamName)
  const teamFilePath = getTeamFilePath(teamName)
  const isLeader = !agentId  // 没有 agentId 的就是 Leader

  return {
    teamName, teamFilePath,
    leadAgentId: teamFile.leadAgentId,
    selfAgentId: agentId,
    selfAgentName: agentName,
    isLeader,
    teammates: {},
  }
}
```

这个函数被设计为**同步**的（注意 `readTeamFile` 是同步 IO），因为它在 `main.tsx` 中调用，必须在第一次 React 渲染**之前**完成。如果是异步的，第一帧渲染时 teamContext 会是 undefined，导致闪烁。

### 会话恢复

当用户恢复一个之前中断的 Teammate session 时，从 transcript 中存储的 teamName/agentName 重建上下文：

```typescript
export function initializeTeammateContextFromSession(
  setAppState, teamName, agentName
): void {
  const teamFile = readTeamFile(teamName)
  const member = teamFile.members.find(m => m.name === agentName)
  setAppState(prev => ({
    ...prev,
    teamContext: {
      teamName, teamFilePath,
      leadAgentId: teamFile.leadAgentId,
      selfAgentId: member?.agentId,
      selfAgentName: agentName,
      isLeader: false,
      teammates: {},
    },
  }))
}
```

如果成员已经从 team file 中移除了（比如 Leader 清理了团队），代码不会崩溃——只是记一条 debug 日志然后继续。

---

## 内存问题的真实案例

```typescript
// types.ts 注释
// BQ analysis (round 9, 2026-03-20) showed ~20MB RSS per agent at 500+ turn sessions
// and ~125MB per concurrent agent in swarm bursts.
// Whale session 9a990de8 launched 292 agents in 2 minutes and reached 36.8GB.
// The dominant cost is this array holding a second full copy of every message.
```

这就是为什么有 `TEAMMATE_MESSAGES_UI_CAP = 50`——UI 里只保留每个 Teammate 最新的 50 条消息。完整的对话历史存在 `allMessages` 局部变量中（inProcessRunner 的 while 循环内），磁盘上也有 transcript JSONL 文件作为持久备份。

数字解读：
- **20MB / agent**：500 轮对话时每个 agent 的驻留内存（RSS）
- **125MB / agent**：并发 swarm 爆发时每个 agent 的内存占用（更高，因为 GC 来不及回收）
- **292 agents**：有用户真的在 2 分钟内启动了这么多 agent
- **36.8GB**：峰值 RSS，足以把大多数开发机器的内存撑满

解决方案除了 UI cap（50 条）之外，还包括：
- 清空 Leader 对话再传给 Teammate（前面提到的 `messages: []`）
- 上下文压缩时重置 contentReplacementState
- 完成/失败时只保留最后一条消息：`messages: task.messages?.length ? [task.messages.at(-1)!] : undefined`

这是一个典型的"新功能带来的新规模问题"：没人预计用户会在 2 分钟内启动 292 个 Agent，但系统必须处理这种情况。

---

## 生命周期全景

把所有组件串起来，一个 in-process Teammate 的完整生命周期是：

```
1. Leader 调用 TeamCreateTool
   → registry.ts 检测可用 backend
   → InProcessBackend.spawn() 调用 spawnInProcessTeammate()
   → 创建 TeammateContext (AsyncLocalStorage)
   → 创建独立 AbortController
   → 注册到 AppState.tasks
   → 注册 Perfetto 追踪

2. InProcessBackend.spawn() 继续
   → startInProcessTeammate() 启动执行循环（fire-and-forget）
   → runInProcessTeammate() 进入 while 循环

3. 每轮循环：
   → 创建 per-turn AbortController
   → 检查是否需要上下文压缩
   → runWithTeammateContext() 隔离上下文
     → runWithAgentContext() 设置分析上下文
       → runAgent() 执行正常的 agent 循环
         → 需要权限时通过 createInProcessCanUseTool() 路由到 Leader
   → 更新进度、收集消息
   → 标记为 idle
   → 通过 createIdleNotification() + writeToMailbox() 通知 Leader
     （详见 teammateInit.ts:109-118，无独立的 sendIdleNotification 函数——它是两步组合，上一版本的叙述里把组合操作写成一个虚构函数名，这里修正）

4. 等待下一个指令：
   → waitForNextPromptOrShutdown() 轮询
     → 检查 pendingUserMessages
     → 检查文件系统邮箱（优先 shutdown > leader > peer）
     → 检查共享任务列表

5. 终止：
   → terminate(): 发送 shutdown request → Teammate 自行决定是否退出
   → kill(): 直接 abort AbortController → 更新状态为 'killed'
   → 正常完成: 循环退出 → 更新状态为 'completed'
   → 全部路径都会：清理 Perfetto、evict task、emit SDK event
```

---

## Plan 模式的跨实例支持

每个 Teammate 都可以独立配置 `planModeRequired`。设置后，这个 Teammate 必须先进入 Plan 模式（只读分析），得到 Leader 批准后才能开始实现。

```
PLAN_MODE_REQUIRED_ENV_VAR = 'CLAUDE_CODE_PLAN_MODE_REQUIRED'
```

这个变量在生成 Teammate 进程时设置，确保 Teammate 一启动就知道自己需要先经过 Plan 阶段。在 in-process 模式下，`planModeRequired` 直接存在 `TeammateIdentity` 中：

```typescript
permissionMode: planModeRequired ? 'plan' : 'default',
```

Plan 模式的 Teammate 即使 Leader 在 `bypassPermissions` 模式下也不会跳过权限检查——这是前面提到的"计划模式安全优先"设计。

---

## 代码落点

- `src/utils/swarm/inProcessRunner.ts`，1,552 行：Teammate 执行循环的核心引擎
  - 第 128-451 行：`createInProcessCanUseTool()`，323 行的权限检查逻辑
  - 第 883-1534 行：`runInProcessTeammate()`，主循环
  - 第 689-868 行：`waitForNextPromptOrShutdown()`，邮箱轮询
- `src/utils/swarm/spawnInProcess.ts`，328 行：Teammate 创建和销毁
- `src/utils/swarm/leaderPermissionBridge.ts`，54 行：React 与非 React 代码之间的权限桥接
- `src/utils/swarm/permissionSync.ts`，928 行：基于文件系统的权限请求/响应同步
- `src/utils/swarm/teammateLayoutManager.ts`，107 行：UI 布局抽象层
- `src/utils/swarm/backends/types.ts`，311 行：`PaneBackend` + `TeammateExecutor` 双层接口定义
- `src/utils/swarm/backends/InProcessBackend.ts`，339 行：in-process 后端的 TeammateExecutor 实现
- `src/utils/swarm/backends/TmuxBackend.ts`，764 行：tmux 窗格管理
- `src/utils/swarm/backends/registry.ts`，464 行：后端自动检测和缓存
- `src/utils/swarm/backends/detection.ts`，128 行：tmux/iTerm2 环境检测
- `src/utils/swarm/reconnection.ts`，119 行：会话重连上下文恢复
- `src/utils/swarm/teammateInit.ts`，129 行：Teammate 启动 Hook 注册
- `src/utils/swarm/teammateModel.ts`，10 行：默认模型选择（Opus 4.6）
- `src/utils/swarm/teammatePromptAddendum.ts`，18 行：Teammate 必须用 SendMessage 工具通信
- `src/utils/swarm/spawnUtils.ts`，146 行：CLI 标志和环境变量传播
- `src/utils/swarm/constants.ts`，33 行：Swarm 系统常量
- `src/utils/swarm/teamHelpers.ts`，团队文件读写和成员管理
- `src/tasks/InProcessTeammateTask/types.ts`，121 行：`InProcessTeammateTaskState` 完整定义 + `TEAMMATE_MESSAGES_UI_CAP = 50`

---

## 三条协作通道

多 Agent 协作的真正复杂度不在 spawn（创建子实例），而在**控制**——不同场景需要不同的通信语义。系统中存在三条本质不同的协作通道：

| 通道 | 语义 | 机制 | 场景 |
|------|------|------|------|
| **pendingUserMessages 实时注入** | "你还在跑，我给你追加指令" | 直接注入正在运行的 Agent 的消息队列（`InProcessTeammateTaskState.pendingUserMessages`） | Leader 给 running teammate 追加任务 |
| **Mailbox 停机后恢复** | "你停了，我等你回来时告诉你" | 写入文件系统的 `.mailbox/` 目录，teammate 下次 `waitForNextPromptOrShutdown()` 时读取 | Teammate 空闲时处理积压消息 |
| **SendMessageTool 跨会话** | "你不是我的 teammate，但我要给你传话" | 通过 `peerAddress.ts` 路由到 `uds:` 或 `bridge:` 执行宿主 | 独立 Claude 实例之间的跨会话通信（详见 Part3 第 23 章 Peer/Session 发现层，位于 `book/part3_子系统完全解析/23_Peer与Session发现层完全解析.md`） |

> 💡 **通俗理解**：第一条像面对面说话（实时）、第二条像留便签在桌上（异步）、第三条像跨部门发邮件（跨组织）。三者不能互相替代——你不会用邮件催正在面前的同事，也不会面对面跟隔壁公司的人传话。
