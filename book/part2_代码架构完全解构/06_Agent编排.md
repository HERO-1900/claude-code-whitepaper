# 分身术：Agent 编排与多实例协调

当单个 Claude 实例无法胜任时，系统可以"分身"出子 Agent 并行工作。本章从两个正交维度解析 Agent 系统：(a) **任务类型（TaskType）**——`local_agent` / `remote_agent` / `in_process_teammate` 等 7 种执行模型（§1）；(b) **编排模式**——普通子 Agent（`runAgent()`）、Fork 子 Agent（`runForkedAgent()` 复用父对话上下文）、Coordinator 模式（主 Agent 作为调度器）三种调用路径（§3）。两个维度是独立的：任何编排模式都可以选任意隔离级别。本章解析创建机制、资源隔离策略和 Scratchpad 通信模式，揭示分布式 AI 协作的工程挑战。

---

## 引子：从单人工作室到公司

一个人开餐厅，从买菜到做饭到上菜到收银全靠自己——效率低但简单。生意好了，你雇了厨师、服务员、收银员——效率高了但需要**管理**：谁做什么、怎么协调、出了问题找谁。

Claude Code 一开始也是"一个人干所有事"。但很快 Anthropic 的团队发现，有些任务太大了、太慢了、或者太独立了，让一个 AI 实例全部包揽不合理。于是他们引入了**多 Agent 架构**——一个 Claude 可以"分身"出多个 Claude 来并行工作。

但"分身"带来了所有分布式系统的经典难题：资源隔离、任务通信、失败处理、生命周期管理。Claude Code 如何解决这些问题？答案是一套精心设计的**Agent 编排系统**。

> 🌍 **行业背景：多 Agent 编排的 2025-2026 格局**
>
> 多 Agent 协作本身不是新概念——它在学术界已有数十年历史（从 1980 年代的分布式 AI 到 2000 年代的 MAS 研究）。2026 年，随着大语言模型能力突破临界点，多 Agent 框架已从实验性落地全面进入"智能体集群（Agent Swarm）"的生产级部署：
>
> | 框架/产品 | 编排模式 | 核心设计理念 |
> |-----------|---------|-------------|
> | **CrewAI** | 角色分工模式（Role-Based） | 每个 Agent 有角色、目标、背景故事；Agent 之间通过定义好的"工作流"顺序协作 |
> | **AutoGen**（微软） | 对话模式（Conversation-Based） | Agent 之间通过多轮对话达成协作；强调"可编程对话"范式 |
> | **OpenAI Swarm** | 交接模式（Handoff-Based） | 轻量级框架，Agent 之间通过 `handoff()` 函数显式转移控制权；强调简单和可预测 |
> | **Cursor Agent** | Background Agents（后台智能体） | 云端 VM 克隆代码库，多个 Agent 并行执行重构并以 PR 形式合并；具体并发上限随版本变化，以官方 release notes 为准 |
> | **Kimi Code** | Agent Swarm（智能体集群） | 协调器可动态实例化并发子智能体，强调高并行度；具体模型规格和并发上限以 Moonshot 官方文档为准，本书未独立核实 |
> | **Codex（OpenAI）** | 并行多 Agent 异步通信 | 引入邮箱通信机制（Mailbox），多后台进程异步交互；底层大部分由 Rust 重写（具体版本号与重写比例以 OpenAI 官方 release notes 为准）|
> | **Devin** | Manage Devins（多层级管理） | 抛弃纯自主路线，主智能体拆解任务后实例化多个隔离 VM 子智能体，配合 Human-in-the-loop 精细管控 |
> | **GLM（Z.ai）** | Z Code 平台（复杂系统工程引擎） | 以大规模 MoE 模型为底座，面向国产算力集群训练；内置本地化知识库检索引擎，面向受限网络环境私有化部署（具体参数量、芯片型号以 Z.ai 官方公告为准，本书未独立核实）|
> | **Claude Code** | Coordinator-Worker 模式 | 主 Agent 分解任务→Worker 并行执行→结果汇总；三级隔离保证安全 |
>
> Claude Code 的独特之处**不在于发明了多 Agent 编排**——CrewAI 和 AutoGen 更早地系统化了这个范式。它的贡献在于两点：
> 1. **隔离级别的精细度**：三种隔离模式（in_process / local_agent / remote_agent）提供了从"共享内存"到"完全隔离"的完整谱系，这在同类产品中罕见
> 2. **深度集成到开发工具链**：不是一个通用的 Agent 框架，而是为"代码开发"这个具体场景量身优化（Agent 专业化、worktree 隔离、MCP 连接共享等）
>
> 简单说：CrewAI 和 AutoGen 是通用的多 Agent "操作系统"，Claude Code 则是一个深度垂直的多 Agent "应用"。

> **🔑 OS 类比：** Agent 系统就像公司的**项目管理**。Agent = 员工，Coordinator = 项目经理，Scratchpad = 团队共享文档（如飞书文档），Task Notification = 工作群消息通知。
>
> 💡 **通俗理解**：Agent 编排就像**外卖平台的调度系统**——主 Claude 是调度中心，每个 Agent 是一个骑手，各自独立送不同订单。Coordinator 模式就是调度中心升级成"站长"——自己不送餐，只负责分配订单、追踪进度、汇总反馈。Scratchpad 是骑手们共用的留言板，互相通报路况信息。

---

## 1. 七种"进程"类型

`Task.ts` 定义了七种任务类型——每种对应一种不同的执行模型：

| 类型 | 含义 | 隔离级别 | 执行位置 |
|------|------|---------|---------|
| `local_agent` | 本地子 Agent | 独立消息历史 + 共享进程 | 本机 |
| `local_bash` | Bash 子进程 | 独立进程 | 本机 |
| `remote_agent` | 远程 Agent | 完全隔离 | 远程机器 |
| `in_process_teammate` | 同进程 Teammate | 共享进程 + 独立消息 | 本机 |
| `local_workflow` | 本地工作流 | — | 本机 |
| `monitor_mcp` | MCP 监控 | — | 本机 |
| `dream` | 梦境模式 | — | 未确认 |

**三种隔离模式**：

```
┌─── 最轻隔离：in_process_teammate ──────────────┐
│  共享进程内存                                    │
│  共享 MCP 连接                                   │
│  独立的消息历史                                   │
│  通过 Task Notification 通信                      │
└─────────────────────────────────────────────────┘

┌─── 中等隔离：local_agent ──────────────────────┐
│  独立的消息历史                                   │
│  独立的权限上下文                                 │
│  共享进程（可选独立 worktree）                     │
│  可选的 CLAUDE.md 加载                            │
└─────────────────────────────────────────────────┘

┌─── 完全隔离：remote_agent ─────────────────────┐
│  独立进程                                        │
│  独立机器                                        │
│  通过 Bridge 协议通信                             │
└─────────────────────────────────────────────────┘
```

> **🔑 OS 类比：** `in_process_teammate` 像同一间办公室的同事（共享桌面和文件柜），`local_agent` 像同一栋楼的不同部门（各有自己的办公室但共用大楼设施），`remote_agent` 像外包公司（完全独立的办公地点）。

> 📚 **课程桥接：** 三种隔离级别精确对应容器化技术的三个层次：`in_process_teammate` = **线程级隔离**（共享地址空间，如同一进程内的多线程）；`local_agent` = **namespace 级隔离**（Docker 容器——独立文件系统和权限，但共享内核）；`remote_agent` = **VM 级隔离**（完全独立的虚拟机，通过网络协议通信）。隔离越强，安全性越高，但通信开销也越大——这就是分布式系统的经典 trade-off。

---

## 2. Agent 的生命周期

### 2.1 创建（fork）

当 AI 调用 `Agent` 工具时：

```
AgentTool.call()
  → 解析参数（prompt, model, isolation, cwd）
  → 初始化 MCP 服务器（共享已有的 + 创建新的）
  → 构建子 Agent 的 queryLoop 参数
  → 启动 AsyncGenerator（子循环开始跳动）
  → 父 Agent 继续工作（不阻塞）
```

**关键参数**：

| 参数 | 作用 | 默认值 |
|------|------|--------|
| `prompt` | 子 Agent 的任务描述 | 必填 |
| `model` | 使用的模型 | 继承父 Agent |
| `isolation` | 隔离模式（`worktree`）| 无（共享工作目录）|
| `cwd` | 工作目录 | 继承父 Agent |
| `subagent_type` | Agent 类型（Explore/Plan/verification/claude-code-guide/statusline-setup/general-purpose）| general-purpose |

### 2.2 `omitClaudeMd`：为只读 Agent 省钱

`Explore`（代码搜索）和 `Plan`（方案设计）类型的 Agent 都是只读的——它们不修改文件。对于这两种 Agent，系统都设置 `omitClaudeMd=true`，跳过 CLAUDE.md 的加载。

**为什么**：CLAUDE.md 可能有几千 token。如果一个任务需要并行启动 5 个只读 Agent，每个都加载 CLAUDE.md 就是 5 倍的 token 浪费。团队估算这个优化**节省规模较大（以源码注释为准 · loadAgentsDir.ts / forkedAgent.ts）**（此数字来源于源码注释，反映 Anthropic 内部在全球用户规模下的估算）。Plan Agent 的注释补充说明了理由："Plan is read-only and can Read CLAUDE.md directly if it needs conventions"——它不需要预加载规范，但在必要时仍可手动读取。

**比喻**：派快递员去送信时，不需要给他一本完整的公司手册。只需要告诉他地址就够了。

> 📚 **课程桥接：** `omitClaudeMd` 优化的本质与编译器中的**链接时优化（Link-Time Optimization, LTO）**异曲同工。LTO 的核心思想是：不是每个编译单元都需要全部符号表，链接器在最终阶段裁剪掉未使用的代码。同理，`omitClaudeMd` 在 Agent 启动时裁剪掉"该 Agent 不需要的上下文"——Explore Agent 不修改文件，所以 CLAUDE.md 中的代码规范、提交约定等指令对它毫无用处。这是一种 **prompt-level dead code elimination**。

### 2.3 执行中的通信

Agent 运行过程中如何和父 Agent 通信？

**向下通信**（父→子）：通过 `SendMessage` 工具发送后续指令。

**向上通信**（子→父）：通过 Task Notification XML 格式：

```xml
<task-notification task-id="abc123" status="completed">
  子 Agent 完成了任务。结果如下：
  ...
</task-notification>
```

这段 XML 作为"用户消息"注入到父 Agent 的消息历史中——从父 Agent 的视角看，"用户告诉我子 Agent 完成了"。

**平行通信**（子←→子）：通过 **Scratchpad**（`tengu_scratch`）——一个共享文件，所有 Agent 都可以读写。这是 **Coordinator 模式**下 Agent 之间**显式设计的共享状态通道**。严格来说还有其他隐式共享机制（如共享进程内的 MCP 连接、共享的文件系统状态），但那些不是为 Agent 间通信设计的——Scratchpad 是唯一一条"写给另一个 Agent 看"的显式通道。

### 2.4 自动后台化

`getAutoBackgroundMs()` **并非无条件启用**。只有当环境变量 `CLAUDE_AUTO_BACKGROUND_TASKS` 为真值，或者 GrowthBook feature gate `tengu_auto_background_agents` 开启时，才返回 120,000ms（2 分钟）——超时后子 Agent 自动转为后台执行，不阻塞父 Agent。否则返回 0（禁用自动后台化）。这意味着该特性在大多数用户环境中可能处于关闭状态，需要显式启用。

### 2.5 终止

Agent 可以被以下方式终止：
- 自然完成（queryLoop 返回 `stop`）
- 父 Agent 调用 `TaskStop`
- 达到 `max_turns` 限制
- 用户 Ctrl+C 中断

---

## 3. Coordinator 模式：集群调度器

当设置 `CLAUDE_CODE_COORDINATOR_MODE=1` 时，主 Claude 实例变为 **Coordinator**——它不直接做任务，而是把任务分配给 **Worker**（子 Agent），然后综合 Worker 的结果。

> 📚 **课程桥接：** Coordinator-Worker 模式本质上就是操作系统中的**进程调度器 + IPC（进程间通信）**。Coordinator 是调度器——决定哪个 Worker 执行什么任务、何时启动、何时终止；Worker 之间通过 Task Notification（类似信号/管道）和 Scratchpad（类似共享内存）进行通信。如果你学过 OS 课程中的 `fork()` + `wait()` + `pipe()` 组合，Coordinator 模式就是它的 AI 版本。

### 3.1 Coordinator 的 ~250 行系统提示词

`coordinatorMode.ts` 整个文件 369 行（含 import/export/辅助函数），其中 `getCoordinatorSystemPrompt()` 函数体约 250 行，是一段由 TypeScript 模板字符串拼接的系统提示词，定义了 Coordinator 的行为规范。其中最有趣的几条规则：

**反懒惰委托规则**：
> "Never write 'based on your findings, fix the bug' or 'based on the research, implement it.' Those phrases push synthesis onto the agent instead of doing it yourself."

这告诉 Coordinator：你是管理者，不是甩手掌柜。不能把"理解问题"的工作推给 Worker——你自己要理解，然后给出精确的指令。

**Continue vs Spawn 决策矩阵**：

| 场景 | 选择 | 原因 |
|------|------|------|
| 需要上一次结果的基础上继续 | Continue（SendMessage）| 复用已有上下文 |
| 全新的独立子任务 | Spawn（Agent）| 独立上下文，避免污染 |
| 多个独立子任务需要并行 | Spawn × N | 利用并发 |
| 一个任务失败需要重试 | Spawn（新的）| 清洁的重试，避免错误上下文影响 |

**四阶段工作流**（源码 Section 4 "Task Workflow" 原文定义）：
1. **Research（研究）**：Worker 并行探索代码库，调查问题，收集信息
2. **Synthesis（综合）**：**Coordinator 自己**阅读 Worker 发现，理解问题，制定具体实施规格
3. **Implementation（实施）**：Worker 按照 Coordinator 给出的精确规格执行修改、提交
4. **Verification（验证）**：Worker 验证修改是否正确——运行测试、类型检查、对抗性探测

### 3.2 Scratchpad：共享白板

Coordinator 和 Worker 之间有一个共享文件（Scratchpad），用于记录：
- 全局上下文（项目背景、已知约束）
- 各 Worker 的任务分配和进度
- 需要跨 Worker 共享的发现

> **🔑 OS 类比：** Scratchpad 就像团队的**共享白板**——所有成员都可以在上面写字、读取别人写的内容，信息实时可见。

> 📚 **课程桥接：** Scratchpad 本质上是一个**没有锁的共享内存段**。在分布式系统课程中，这对应"共享状态一致性"问题。Claude Code 选择了最简单的方案：单个文件 + 读写都是全量操作（无增量更新）。这意味着它**在行为上表现为"最后写入者胜出"**（Last-Writer-Wins）——但这是文件系统 `write(2)` 的自然语义，并不是源码里显式实现了 LWW 冲突解决协议。把它类比为 CRDT 中的 LWW-Register 只是行为层面的类比，不是实现层面的同构（CRDT 需要带时间戳或版本号的合并函数，Scratchpad 没有）。好处是零协调开销；代价是并发写入时可能丢失中间状态。对于 AI Agent 的协作场景（写入频率低、冲突概率小），这个 trade-off 是合理的。

---

## 4. Swarm 模式：真正的集群

Swarm 模式比 Coordinator 更进一步——多个 Claude Code **实例**在不同终端中运行，通过 Teammate 机制协调。

### 4.1 三种后端

| 后端 | 实现 | 适用场景 |
|------|------|---------|
| tmux | 每个 Teammate 一个 tmux pane | Linux/macOS 终端 |
| iTerm2 | 每个 Teammate 一个 iTerm2 tab | macOS |
| in-process | 所有 Teammate 在同一进程内 | 性能敏感场景 |

### 4.2 真实的 Bug：292 个 Teammate

代码注释记录了一个真实事件：某次测试中 292 个 Teammate（一个名为 `9a990de8` 的"鲸鱼会话"）在 2 分钟内启动，总 RSS 达到 36.8GB，导致系统崩溃。因此引入了 `TEAMMATE_MESSAGES_UI_CAP=50` 限制。**源码出处**：`src/tasks/InProcessTeammateTask/types.ts` 第 114-121 行的 BQ 分析注释（"BQ analysis (round 9, 2026-03-20)..."）记录了完整的调查过程——详见 Part 4 第 5 章"可观测性是产品功能"中的完整案例分析。

**这个 Bug 说明了什么**：多 Agent 系统的资源管理不是事后优化——它是核心设计问题。一个没有限制的 `fork()` 循环（fork bomb）可以把任何操作系统打挂。

---

## 5. Agent 专业化

不是所有 Agent 都一样。系统预定义了几种专业化的 Agent 类型：

| 类型 | 工具集控制方式 | 用途 |
|------|--------|------|
| `general-purpose` | 全部工具 | 通用任务 |
| `Explore` | `disallowedTools` 黑名单：禁用 Agent/ExitPlanMode/FileEdit/FileWrite/NotebookEdit | 代码搜索和研究 |
| `Plan` | `disallowedTools` 黑名单：同 Explore（禁止所有写入类工具）| 设计方案 |
| `verification` | `disallowedTools` 黑名单：禁用 Agent/ExitPlanMode/FileEdit/FileWrite/NotebookEdit | 对抗性验证——"try to break it, not confirm it works" |
| `statusline-setup` | `tools` 白名单：Read + Edit | 配置状态栏 |
| `claude-code-guide` | `tools` 白名单：Glob/Grep/Read/WebFetch/WebSearch | 回答 Claude Code 使用问题 |

**两种工具集控制方式**：系统支持 `tools`（白名单——只允许列出的工具）和 `disallowedTools`（黑名单——禁止列出的工具，其余可用）。Explore/Plan/verification 使用黑名单排除写入类工具，claude-code-guide/statusline-setup 使用白名单只暴露必要工具。黑名单模式的好处是：当系统新增工具时，Agent 自动获得权限，不需要逐一添加。

**为什么要专业化**：
1. **安全**：Explore Agent 不能修改文件——即使 AI "想"修改，FileEdit/FileWrite 在 `disallowedTools` 黑名单中，调用会被拒绝
2. **性能**：工具集越小，system prompt 中的工具 schema 越少，token 越省
3. **提示词精度**：专业化 Agent 的系统提示词可以更精准——"你是一个只负责搜索的 Agent"比"你什么都能做"更容易让 AI 表现好
4. **对抗性设计**：verification Agent 的系统提示词长达 ~130 行，专门对抗 LLM 的"验证回避"倾向——明确列出常见的偷懒借口（"The code looks correct based on my reading"），要求每个检查必须有实际的命令执行输出，仅凭阅读代码不算 PASS

> **🔑 OS 类比：** 就像公司的**门禁卡权限**——不是给每个员工万能钥匙，而是精确授予他需要的权限：财务能进财务室，工程师能进机房，访客只能进大堂。最小权限原则。

### 5.1 深入：Verification Agent 的 130 行对抗性提示词

> 💡 **通俗理解**：如果说其他 Agent 像公司里的"工程师"——负责把事情做出来，那 Verification Agent 更像"质检员"——专门负责找茬。而且是那种**会识破你偷懒的质检员**。

Verification Agent 的系统提示词（`verificationAgent.ts`）是整个 Claude Code 中最独特的提示词设计之一。它不是简单地说"请验证代码是否正确"，而是一套完整的**反偷懒工程**——因为 LLM 天然倾向于通过"阅读代码后说一切正常"来回避真正的验证。

**开场定调——角色是"破坏者"，不是"确认者"：**

> *"Your job is not to confirm the implementation works — it's to try to break it."*

**两种已知的失败模式**（Anthropic 从实际使用中总结的 LLM 行为模式）：

> *"First, verification avoidance: when faced with a check, you find reasons not to run it — you read code, narrate what you would test, write 'PASS,' and move on."*

> *"Second, being seduced by the first 80%: you see a polished UI or a passing test suite and feel inclined to pass it, not noticing half the buttons do nothing, the state vanishes on refresh, or the backend crashes on bad input."*

**6 条"偷懒借口"识别清单**——让 AI 识别自己的合理化倾向：

| 借口 | 原文 | 正确做法 |
|------|------|---------|
| "代码看起来对" | *"The code looks correct based on my reading"* | 阅读不是验证。运行它。 |
| "测试已经过了" | *"The implementer's tests already pass"* | 实现者也是 LLM。独立验证。 |
| "应该没问题" | *"This is probably fine"* | "应该"不是"已验证"。运行它。 |
| "我先看看代码" | *"Let me start the server and check the code"* | 不。启动服务器然后访问端点。 |
| "我没有浏览器" | *"I don't have a browser"* | 你检查了 mcp 浏览器工具吗？ |
| "这会太久" | *"This would take too long"* | 不是你该做的判断。 |

**按变更类型的验证策略**——涵盖 11 种场景（前端 / 后端 / CLI / 基础设施 / 库 / Bug 修复 / 移动端 / 数据管线 / 数据库迁移 / 重构 / 其他），每种都有具体的验证步骤。完整 11 条的全文请参考源码 `verificationAgent.ts` 第 60-140 行；本章出于篇幅只展开最有代表性的两条：

- **前端变更**：*"Start dev server → check your tools for browser automation → curl a sample of page subresources (image-optimizer URLs) since HTML can serve 200 while everything it references fails"*
- **Bug 修复**：*"Reproduce the original bug → verify fix → run regression tests → check related functionality for side effects"*

**对抗性探测清单**：

> *"Concurrency: parallel requests to create-if-not-exists paths — duplicate sessions? lost writes?"*
> *"Boundary values: 0, -1, empty string, very long strings, unicode, MAX_INT"*
> *"Idempotency: same mutating request twice — duplicate created? error? correct no-op?"*

**输出格式的强制结构**——每个检查必须包含实际执行的命令和输出，不接受"我阅读了代码"式的 PASS：

```
### Check: [what you're verifying]
**Command run:**     [exact command executed]
**Output observed:** [actual terminal output — copy-paste, not paraphrased]
**Result: PASS** (or FAIL — with Expected vs Actual)
```

提示词末尾用一行可被程序解析的固定格式结束：`VERDICT: PASS` 或 `VERDICT: FAIL` 或 `VERDICT: PARTIAL`。

这套设计的工程价值在于：**它不是告诉 AI "要仔细"——而是告诉 AI "你会怎么偷懒，以及为什么那样做是错的"**。这是一种"元认知提示词工程"——让 AI 对自己的认知偏差有明确认识。

---

## 6. MCP 服务器的 Agent 间共享

`runAgent.ts:95-218` 处理 Agent 启动时的 MCP 服务器初始化。规则是：

```
父 Agent 的 MCP 客户端
  ├── 已建立连接的客户端 → 子 Agent 直接复用（共享连接）
  └── 需要新建的客户端 → 子 Agent 独立创建
```

**共享 MCP 连接**避免了每个子 Agent 都重新建立连接的开销。但也意味着子 Agent 的 MCP 操作可能影响父 Agent 的连接状态。

**`strictPluginOnlyCustomization` 检查**（lines 117-127）：如果企业策略启用了严格插件控制，子 Agent 只能使用策略允许的 MCP 服务器——即使父 Agent 有更多的 MCP 连接。

---

## 7. 竞品对比：Agent 编排模型

多 Agent 编排不是 Claude Code 的发明，而是 2025 年 AI 工程的共同方向。以下对比聚焦于**编排模型本身的设计差异**：

| 维度 | Claude Code (Coordinator-Worker) | CrewAI (角色分工) | AutoGen (对话模式) | OpenAI Swarm (交接模式) |
|------|------|------|------|------|
| **调度方式** | 中心化：Coordinator 分配任务 | 中心化：流程定义执行顺序 | 去中心化：Agent 自主对话 | 半中心化：Agent 显式 handoff |
| **Agent 特化** | 工具集级别的硬隔离（六种内置类型：Explore/Plan/verification/claude-code-guide/statusline-setup/general-purpose） | 角色描述级别的软隔离（靠提示词区分） | 无内置特化机制 | 无内置特化机制 |
| **资源隔离** | 三级隔离（进程内/本地/远程） | 无隔离（同一进程） | 无隔离（同一进程） | 无隔离（同一进程） |
| **通信机制** | Task Notification + Scratchpad 文件 | 任务输出作为下一 Agent 输入 | 多轮消息传递 | 函数返回值 + 上下文变量 |
| **并发支持** | 原生支持（多 Worker 并行） | 有限（Sequential/Hierarchical） | 有限（主要是串行对话） | 无原生并发 |
| **防护机制** | 反懒惰委托规则、资源上限、权限隔离 | 依赖用户定义 | 依赖用户定义 | 极简设计，无内置防护 |

**关键洞察**：

- **Claude Code 的核心优势是隔离精细度**。CrewAI、AutoGen、Swarm 的 Agent 都运行在同一进程中，没有真正的资源隔离。Claude Code 的三级隔离设计（尤其是 worktree 级别的文件系统隔离）在已知开源 Agent 框架中实现了更细粒度的资源隔离
- **Claude Code 的核心劣势是通用性**。它是一个为"代码开发"深度优化的系统，不是一个通用 Agent 框架。你不能用它来编排客服 Agent 或数据分析 Agent——而 CrewAI 和 AutoGen 可以
- **Swarm 走了另一个极端**。OpenAI 的 Swarm 刻意追求极简（单文件、无状态管理、无并发），它更像一个教学示例而非生产系统。Claude Code 和 Swarm 代表了 Agent 编排的两个极端：最大灵活性 vs 最大简单性

---

## 8. 设计取舍

### 优秀

需要说明：以下评价是相对于 Claude Code 自身的设计目标（一个多 Agent 编码助手），而非宣称这些是行业首创。

1. **七种任务类型**覆盖了从轻量（in_process_teammate）到重量（remote_agent）的完整谱系——不是"一刀切"。在同类编码工具中，这种隔离粒度的精细程度罕见
2. **Coordinator 的 ~250 行提示词**证明 Anthropic 把 multi-agent 当作一等公民来设计——不是简单地"调用 API 创建子实例"
3. **反懒惰委托规则**是 LLM 工程的实践发现——AI 管理者和人类管理者有同样的"甩锅"倾向，需要在提示词中明确禁止。这个经验对所有多 Agent 框架的开发者都有参考价值
4. **`omitClaudeMd` 节省规模较大（以源码注释为准）**——该优化的节省规模来自 Anthropic 基于生产 Agent 调用量的内部估算（源码注释中标注为"estimate"），可理解为"有数据依据的量级估算"而非严格的 benchmark 实测
5. **Agent 专业化**（Explore/Plan/verification/general-purpose 等六种）实现了最小权限原则——每个 Agent 只有它需要的能力
6. **CacheSafeParams 机制**确保子 Agent 与父 Agent 共享 prompt cache——通过传递相同的 systemPrompt、userContext、systemContext、toolUseContext 和父对话上下文（`forkContextMessages`），使子 Agent 的 API 请求能命中父 Agent 的缓存，大幅降低重复 token 消费
7. **fork 子 Agent 继承父 Agent 完整对话上下文**——`initialMessages` 由 `forkContextMessages`（父对话历史）+ `promptMessages`（新任务）拼接而成，子 Agent 不是从零开始，而是站在父 Agent 已有知识的基础上工作
8. **120 秒自动后台化**（需环境变量或 feature gate 启用）平衡了"等待结果"和"不被阻塞"——大部分子任务 2 分钟内完成，超时的自动后台

### 代价与局限

然而，多 Agent 架构的复杂性也带来了显著的风险：

1. **七种任务类型的复杂度**——开发者需要理解每种类型的隔离语义、通信方式和资源限制
2. **Scratchpad 是一个没有锁的共享文件**——并发写入可能产生数据丢失（虽然在实践中概率很低）
3. **Coordinator 提示词依赖 AI 的遵守**——"不要懒惰委托"是一个*建议*，不是一个*执行*机制
4. **292 个 Teammate 的 Bug**说明系统缺少全局资源限制——注意 `TEAMMATE_MESSAGES_UI_CAP=50` 的真实含义是"每个 Teammate 的 `task.messages` 数组只保留最近 50 条消息给 UI 显示"（目的是压缩内存占用，因为每个 Teammate 原本持有全量消息拷贝——见 Part 4 第 5 章"鲸鱼会话"案例），它**不是**限制可同时运行的 Teammate 进程数。目前系统没有一个"最多能同时跑 N 个 Teammate"的全局 cap
5. **MCP 连接共享**增加了子 Agent 对父 Agent 的隐式依赖——父 Agent 先退出可能导致子 Agent 的 MCP 调用失败
6. **单用户边界**——CC 的多 Agent 编排设计完全围绕单用户场景，Agent 的上下文和产出不能在团队成员之间共享。社区已经开始填补这个空白：@jiayuan_jy 的 Multica 项目（在 Twitter/X 上获得较高关注度，具体点赞/浏览数随时间变化不再给出精确数字）让 Agent 成为团队任务看板中的"一等公民"——把 issue 像分配给同事一样分配给 Agent，所有人实时可见执行状态。这指向了多 Agent 架构从"单人分身"到"团队协作基础设施"的自然演进方向

---

## 9. 代码落点

以下是本章关键概念在源码中的精确位置：

| 概念 | 文件 | 行号 | 说明 |
|------|------|------|------|
| 七种 TaskType | `src/Task.ts` | :6-13 | `local_bash`、`local_agent`、`remote_agent`、`in_process_teammate`、`local_workflow`、`monitor_mcp`、`dream` |
| Task ID 生成 | `src/Task.ts` | :78-106 | 前缀 + 8 位 36 进制随机 ID（`36^8 ≈ 2.8 万亿`），防暴力攻击 |
| 子 Agent 运行器 | `src/utils/forkedAgent.ts` | :489 | `runForkedAgent()`——构建 CacheSafeParams 确保子 Agent 与父 Agent 共享 prompt cache |
| 子 Agent 上下文隔离 | `src/utils/forkedAgent.ts` | :345 | `createSubagentContext()`——克隆 readFileState、denialTrackingState，隔离可变状态 |
| Coordinator 系统提示词 | `src/coordinator/coordinatorMode.ts` | :111-369 | `getCoordinatorSystemPrompt()`——文件共 369 行，函数体约 250 行系统提示词（含 TypeScript 拼接逻辑） |
| Coordinator Worker 上下文 | `src/coordinator/coordinatorMode.ts` | :80-108 | `getCoordinatorUserContext()`——注入 Worker 可用工具列表和 Scratchpad 路径 |
| Verification Agent | `src/tools/AgentTool/built-in/verificationAgent.ts` | 全文 | ~130 行对抗性验证提示词，含失败模式识别、借口清单、VERDICT 输出格式 |
| CacheSafeParams | `src/utils/forkedAgent.ts` | :57-68 | 子 Agent 共享父 Agent prompt cache 的关键参数集（systemPrompt/userContext/systemContext/toolUseContext/forkContextMessages） |
| 自动后台化条件 | `src/tools/AgentTool/AgentTool.tsx` | :72-77 | `getAutoBackgroundMs()`——仅在环境变量或 feature gate 启用时返回 120000 |

---

> **[图表预留 2.6-A]**：七种任务类型的隔离级别谱系图 — 从 in_process_teammate 到 remote_agent
> **[图表预留 2.6-B]**：Coordinator 四阶段工作流时序图 — Research→Synthesis→Implementation→Verification
> **[图表预留 2.6-C]**：Agent 通信拓扑图 — 向下/向上/平行三种通信路径
> **[图表预留 2.6-D]**：Agent 专业化工具集矩阵 — 每种 Agent 类型可用的工具
