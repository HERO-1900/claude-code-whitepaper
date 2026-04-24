# 子 Agent 是怎么被创建和管理的？

子 Agent 不是简单的 API 调用重用——它是一个完整的 Claude 实例，有独立的消息历史、工具集和权限上下文。本节从源码层面拆解子 Agent 的创建、通信和生命周期管理。

### 🌍 行业背景：多 Agent 架构在 AI 编程工具中的演进

多 Agent 协作是 2024-2026 年 AI 工程领域演进最快的方向。2026 年，行业已从"单 Agent 串行"全面跃迁至"智能体集群（Agent Swarm）与并行编排"范式，各家方案路线差异显著：

- **Cursor**：已从早期的单机串行架构全面转型，推出 **Background Agents（后台智能体）**。面对繁重任务，Cursor 在云端创建与本地代码库状态一致的虚拟机克隆，多个云端 Agent 并行执行重构、运行测试并自动排查错误，最终以 Pull Request 形式将修改合并至本地。具体并发数以 Cursor 官方面板说明为准。
- **Kimi Code**：引入了 **Agent Swarm（智能体集群）** 架构，以协调器（Orchestrator）面对复杂任务动态实例化多个隔离的并发子智能体，分别独立处理文件生成、浏览器检索及本地计算。具体并发上限、底层模型版本等细节以 Moonshot 官方公告为准（本文撰写时公开资料未给出稳定的统一数字）。
- **Codex（OpenAI）**：v0.118.0 版本已从单线程响应转变为"**多智能体并行任务处理（Parallel Agent Workflows）**"。引入邮箱通信机制（Mailbox），允许不同后台进程进行异步交互。底层 codex-rs 已用 Rust 彻底重写（Rust 重写（具体比例以 OpenAI 官方 release notes 为准））。
- **Devin**：已抛弃不切实际的"人类完全脱手"理想主义，推出核心级功能 **Manage Devins**——主智能体接收宏观业务诉求并拆解，实例化部署在各个独立隔离 VM 中的子智能体（Managed Devins），配合深度的 **Human-in-the-loop（人在回路）** 精细管控。
- **Aider**：核心仍为单 Agent 架构，但通过新增的 **Architect 模式**实现了职责解耦——由擅长推理的 Architect 模型负责制定高阶重构方案，再由低成本 Editor 模型负责执行文件读写。社区主导的 AiderDesk 为 Aider 赋予了并行 Agent 能力及 MCP 生态挂载。
- **Cline**：v3.58 引入**原生子智能体机制**，在 Act 模式下表现出惊人的自主性，能跨文件树穿梭、读写文件并运行环境脚本。
- **OpenClaw（原 Clawdbot）**：完全开源（MIT），采用"感知-规划-行动-观察"无缝闭环架构，以 WhatsApp/Telegram 作为主要交互入口，支持跨地域设备唤醒与远程执行。
- **GLM（Z.ai）**：GLM-5.1 拥有 超大规模参数（具体以 Z.ai 官方公告为准），全量训练在国产 国产算力集群上完成。Z Code 平台内置深度本地化知识库检索引擎，是受限网络环境中企业构建私有化 AI 编程底座的首选。
- **LangChain / LangGraph**：提供了通用的多 Agent 框架（`AgentExecutor`、`StateGraph`），支持 supervisor-worker 模式。Claude Code 的 Coordinator 模式与 LangGraph 的 supervisor 模式在概念上相似，但实现方式不同——LangGraph 用图状态机，Claude Code 用 prompt 驱动。
- **AutoGen（微软）**：专门为多 Agent 对话设计的框架，Agent 之间通过消息传递协作。与 Claude Code 的区别是 AutoGen 的 Agent 间通信是显式的消息队列，而 Claude Code 是 generator 链式传播。

Claude Code 的子 Agent 设计——**每个子任务是完整的 AI 推理循环实例，而非简化的单次 API 调用**——在多 Agent 实现方案中走了一条独特的"重量级实例+轻量级通信"路线。与 Kimi Code 的并发 Agent Swarm 或 Cursor 的云端 VM 克隆相比，Claude Code 更侧重于每个子 Agent 的推理深度和工具完整性，而非极致并发度。其 Coordinator 模式与学术界的 multi-agent 研究（如 CAMEL、MetaGPT）有相似的设计意图，但更偏工程实用。

---

## 问题

Claude Code 里的"子 Agent"不只是一个比喻。当 AI 用 AgentTool 派发一个子任务，背后实际发生了什么？它和父 AI 实例的关系是怎样的？

> 💡 **通俗理解**：子 Agent 就像**外卖调度中心派出的骑手**——主 Claude 是调度中心，每个子 Agent 是一个独立的骑手。骑手有自己的导航（消息历史）、自己的电动车（工具集），独立送自己的单（子任务）。送完后回到调度中心汇报结果。骑手之间通过共享留言板（Scratchpad，本书沿用源码术语指代"共享于多个 Agent 的工作区消息/状态"，详见 Part3 · 记忆系统）互通信息。

---

## 你可能以为……

你可能以为子 Agent 只是一个更简单的 API 调用——用不同的提示词发起一个新的对话，等结果回来。或者你可能以为父 Agent 和子 Agent 之间有某种复杂的消息队列协议。

实际情况比这更有趣。

---

## 实际上是这样的

### 子 Agent 是完整的 AI 主循环实例

每个子 Agent 通过 `runAgent()` 函数启动，这个函数本身也是一个 **AsyncGenerator**——和 `query()` 一样的设计。它会：

1. 生成一个唯一的 **AgentId**（不是 session ID）
2. 创建独立的**文件状态缓存**（防止父子之间的文件读取状态干扰）
3. 根据 Agent 定义，决定是否连接专属的 **MCP 服务器**（每个 Agent 定义可以在 frontmatter 里声明自己需要的 MCP 工具）
4. 构建独立的 **ToolUseContext**（工具执行上下文），但其中的 `setAppState` 被设计为 **no-op**——子 Agent 不能直接修改父 Agent 的 UI 状态（父/子仍在同一 Node.js 进程内，这里"隔离"体现在应用层状态而非 OS 进程层面）
5. 调用 `query()` 运行完整的 AI 主循环

也就是说，子 Agent 拥有完整的工具调用能力，完整的上下文压缩机制，完整的权限系统——它不是一个"简化版"，而是一个完整的 AI 推理循环。

> 📚 **课程关联 · 操作系统**：子 Agent 的创建过程与 OS 课程中的 `fork()` 系统调用高度类似——父进程创建子进程，子进程继承父进程的环境（文件描述符、环境变量），但拥有独立的地址空间和执行上下文。对应到这里：子 Agent 继承父 Agent 的工具集和权限上下文，但拥有独立的消息历史（地址空间）和文件状态缓存（防止互相干扰）。`setAppState` 被设为 no-op 的设计，则类似于子进程不能直接修改父进程内存——需要通过 IPC（进程间通信）机制。这里的 generator `yield` 链就是 IPC 的实现。

### 父子之间的通信：流式消息

子 Agent 产出的每条消息（包括中间的 streaming 事件），都通过 `yield` 传递给调用它的工具，再传递给父 Agent 的主循环。这是纯粹的 **generator 链**——没有消息队列，没有额外的进程，父 Agent 以流式方式实时看到子 Agent 的进展。

### 子 Agent 的隔离级别

子 Agent 在文件系统层面有三种隔离选项：

**默认（共享文件系统）：** 子 Agent 和父 Agent 在同一个工作目录操作，文件修改对双方可见。适合普通任务。

**worktree 隔离：** 在派生子 Agent 之前，系统会创建一个独立的 git worktree 分支。子 Agent 的所有文件修改都在这个分支里，不影响主分支。子 Agent 完成后，可以选择合并或丢弃。适合"试验性"任务（比如"尝试实现这个特性"）。

**remote（ant-only，内部标识 "ant-only" 意为仅在 Anthropic 内部 / dogfood 分支中可用）：** 在远程 CCR（Claude Code Remote，Anthropic 云端容器化运行时）环境中运行，完全网络隔离。

### omitClaudeMd：一项针对只读 Agent 的 token 节省优化

只读型 Agent（比如 Explore、Plan 类型）设置了 `omitClaudeMd: true`，它们的系统提示词中不包含 CLAUDE.md 的内容——因为提交规范、lint 规则对于"只是去读读代码"的 Agent 完全没用。

这个优化节省了约 较大规模节省（以源码注释为准 · loadAgentsDir.ts / forkedAgent.ts）。这个数字反映了一个事实：系统每天要创建数以千万计的 Explore/Plan 子 Agent，哪怕每个只省几百 token，累积起来也是巨大的成本节省。

---

## Coordinator 模式：AI 作为项目经理

Coordinator 模式是子 Agent 系统的更高层抽象。当 `CLAUDE_CODE_COORDINATOR_MODE=1` 时，主 Claude 实例的 system prompt 被替换为一份约 260 行（`coordinatorMode.ts` 第 111-369 行，跨度 259 行）的"项目经理行为规范"。

在这个模式下，主 AI 的工具箱是：
- `AgentTool` — 派生新 Worker
- `SendMessageTool` — 向正在运行的 Worker 发续篇
- `TaskStopTool` — 终止走错方向的 Worker

> 📚 **课程关联 · 分布式系统**：Coordinator 模式是经典的 **Master-Worker 架构**（分布式系统课程核心内容）。Master（Coordinator）负责任务分解和调度，Worker 独立执行并汇报结果。`TaskStopTool` 对应分布式系统中的任务取消机制，`<task-notification>` 的消息回传对应 Worker 的心跳/结果上报。这种模式在 MapReduce、Spark 的 Driver-Executor 模型中都有体现。

Worker 完成任务后，结果以 `<task-notification>` XML 的格式伪装成"用户消息"回传。Coordinator AI 看到这条消息，解析出结果，综合理解后再决定下一步。

### 为什么结果要伪装成"用户消息"？

因为 Anthropic API 的消息格式只有 `system`、`assistant`、`user` 三种角色。没有专门的"工具回调"角色。把 Worker 结果包装成带特殊 XML 标签的 user 消息，是在现有 API 约束下实现"异步 Agent 通信"的最小化方案。

### Coordinator 提示词里最有意思的一条规则

提示词里有一条专门的禁止模式：

> "Never write 'based on your findings' or 'based on the research.' These phrases delegate understanding to the worker instead of doing it yourself."

这条规则针对的是 LLM 的一个已知弱点——模型喜欢用模糊的"根据xxx"把理解责任推给别人，而不是真正综合信息做出判断。这条规则强迫 Coordinator AI 自己完成综合，再给 Worker 写包含具体文件路径和行号的精确实现规范。

---

## 这个设计背后的取舍

**优势：** 子 Agent 的隔离让并行执行变得安全（各自有独立的文件状态缓存，不会相互干扰）；generator 链的设计让流式输出天然传播；Coordinator 的 prompt 驱动方式让协调策略可以不修改代码就能调整。

**代价：** 
- `setAppState` 是 no-op 的设计增加了复杂性（有个 `setAppStateForTasks` 绕过用于"全局基础设施"操作，需要仔细管理使用场景）
- Coordinator 行为依赖约 260 行提示词，本质上是"把架构约束写进了提示词"，随着系统演进很难维护
- `<task-notification>` 的伪装方案虽然简单，但让消息历史的语义变得模糊：不是所有"用户消息"都是真实用户

---

## 从这里能学到什么

**当你在 AI 应用里需要并行、隔离地执行多个任务时，"每个任务是完整的 AI 主循环"比"每个任务是简化的 API 调用"有更好的可扩展性。**

前者允许子 Agent 有自己的工具调用、自己的上下文管理、自己的多轮推理；后者把子任务限定为单次问答，无法完成需要多步决策的工作。

Claude Code 选择了前者，接受了其带来的复杂性（隔离、状态管理、消息路由），换来了子 Agent 能独立完成任意复杂任务的能力。这是一个在 AI 工程里很重要的架构选择。

---

## 代码落点

- `src/tools/AgentTool/runAgent.ts`，第 248-400 行：`runAgent()` 的完整签名和初始化逻辑
- `src/tools/AgentTool/AgentTool.tsx`，第 80-99 行：AgentTool 的输入 schema 定义（包含所有参数）
- `src/coordinator/coordinatorMode.ts`，第 111-369 行：Coordinator 模式的完整 system prompt
- `src/Task.ts`：Task 类型定义
- `src/tools/AgentTool/runAgent.ts`，第 388-396 行：`omitClaudeMd` 优化逻辑

---

## 核心代码片段

子 Agent 创建的关键入口是 `runAgent()`，它是一个 AsyncGenerator，接收完整的上下文参数后启动独立的查询循环：

```typescript
// src/tools/AgentTool/runAgent.ts — 子 Agent 启动签名（简化）
export async function* runAgent({
 agentDefinition,   // Agent 定义（名称、描述、system prompt）
 promptMessages,    // 初始消息（父 Agent 传入的任务指令）
 toolUseContext,    // 工具上下文（继承父 Agent 的工具集）
 canUseTool,      // 权限检查函数
 isAsync,       // 是否异步执行
 forkContextMessages, // 父 Agent 的消息历史（用于 prompt cache 共享）
 querySource,     // 来源标识（区分主 Agent / 子 Agent）
 availableTools,    // 预计算的工具池（避免循环依赖）
 allowedTools,     // 显式授权的工具列表
 maxTurns,       // 最大轮次限制
 // ...
}: RunAgentParams): AsyncGenerator<Message> {
 // 1. 创建独立的 AbortController（子 Agent 可被单独取消）
 // 2. 克隆 fileStateCache（隔离文件状态，防止父子互相干扰）
 // 3. 创建独立的 denialTrackingState（权限拒绝计数独立）
 // 4. 调用 query() 启动独立的查询循环
 // 5. yield 每条消息回父 Agent
}
```

关键设计：子 Agent 通过 `forkContextMessages` 共享父 Agent 的消息前缀，从而尽可能命中已有的 prompt cache 前缀——当新增的子任务追加内容未打破前缀时可直接复用，降低重复编码成本（但如果子 Agent 的 system prompt 或 frontmatter 改动使前缀不同，仍会产生新的缓存写入）。

---

## 还可以追问的方向

- Worker 完成任务后，Coordinator 如何决定是"继续同一个 Worker"还是"派生新 Worker"？（→ 参见 Coordinator 提示词的第 5 节"Writing Worker Prompts"）
- 多个 Worker 并行写同一个文件时，系统如何处理冲突？（→ 参见工具系统的并发安全设计）
- `dream` TaskType 是什么？（→ 开放问题，待深入分析）

---

*质量自检：*
- [x] 覆盖：runAgent、AgentTool、Coordinator、Task 类型已覆盖（`dream` TaskType 语义仍标记为开放问题，见"还可以追问的方向"）
- [x] 忠实：关键结论有代码位置和数据支撑
- [x] 可读：从"子 Agent 是什么"出发，逐步建立完整图景
- [x] 一致：与 global_map.md 一致
- [x] 批判：指出了 setAppState no-op 的复杂性和提示词维护难题
- [x] 可复用：关联章节已列出
