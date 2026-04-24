# assistant = viewer：远端会话的本地观察模式

当你在终端输入 `claude assistant` 时，直觉上你会以为："这大概是启动了一个更强的 Claude Agent 模式吧？" 不是。它做的事情和你想的完全不同——**它不是在本地启动一个新 Agent，而是 attach 到远端会话**，以观察者身份观看和轻交互。

> 💡 **"远端会话"指什么？** 特指**远端 CCR（Claude Code Runtime）上已经在跑的一个 Agent session**——可能是你之前从 claude.ai web 端发起的任务、也可能是另一台设备上启动的长时任务、也可能是 Anthropic 基础设施代跑的后台工作。总之它不在你当前这台电脑上。

> **源码位置**：`src/main.tsx`（命令解析）、`src/hooks/useAssistantHistory.ts`（历史页消费）、`src/hooks/useRemoteSession.ts`（live 增量消费）、`src/hooks/useReplBridge.tsx`（bridge 生命周期）

> **🔑 OS 类比：** `claude assistant` 就像 `ssh -t user@server tmux attach`——你没有启动一个新 shell，而是 attach 到了一个已经运行中的 tmux session。你看到的是远端的屏幕，你的输入被转发到远端。

> 🌍 **行业定位**：在本书对比过的主流 AI Agent 产品里（Cursor Background Agents、Aider、Copilot Workspace），Claude Code 是**少数把 tmux attach 工作流原生化为 AI Agent 操作模式**的设计。Cursor 的 Background Agents 是"派遣模式"（send-and-forget），Aider 是纯本地模式，Copilot Workspace 有远程 sandbox 但没有本地 viewer attach。"attach 到一个正在跑的远端 Agent 并在它还在跑的时候实时观察/轻交互"这件事，是 `claude assistant` 独一份的设计。

> 💡 **通俗理解**：想象你在客厅看投影——投影机（远端 CCR 会话）在工作，你坐在沙发上看（viewer）。你可以按遥控器暂停或快进（轻交互），但你不是导演也不是摄像师——电影本身在远端运行。

---

## 1. 命令入口：从 argv 到 viewerOnly

`main.tsx` 将 `assistant` 作为子命令解析。解析完成后，系统构造一个特殊的配置：

```
RemoteSessionConfig {
  viewerOnly: true,
  sessionId: <远端 session ID>,
  ...
}
```

然后进入 `launchRepl()`——和普通 REPL 用的是**同一个入口**，但 `viewerOnly: true` 改变了整个运行时的行为语义。

---

## 2. KAIROS：assistant 模式的 feature gate

`KAIROS` 是 Claude Code 内部对 assistant 模式的代号——**源码中有约 190 行匹配、分布在约 61 个文件里**（数据来源：Claude Code 2.1.88 源码包 `cc-recovered-main/src/` 目录下 `grep -rn "KAIROS"` 的匹配行数，`grep -rl "KAIROS"` 的涉及文件数，大小写敏感；这是匹配行数而非符号出现次数——单行多次出现只计一次；核心判断位于 `useReplBridge.tsx:155-170`）。它不是局部的偶尔出现，而是**遍布整个 codebase 的顶级 feature flag**。

当 `feature('KAIROS')` 启用且 `isAssistantMode()` 为 true 时：
- Bridge 进入 **perpetual 模式**（`perpetual = true`）
- `worker_type` 变为 `claude_code_assistant`
- 每日记忆模式切换为 KAIROS 日志模式（详见 Part 3「记忆系统完全解析」§6.2）

**Perpetual 的含义**：普通 bridge 在任务完成后执行完整 teardown（发送 result、stopWork、关闭 transport）。Perpetual bridge **不这样做**——它只停轮询、清 flush gate、刷新 pointer，但不关闭 transport 连接。这让 assistant 模式的 bridge 可以**跨多次 query 持续存在**，实现真正的"长驻观察"。

> 💡 **术语快速解释**（这一段塞了 6 个技术词，逐个解释）：
> - **teardown**：拆除/收场——任务结束后把所有临时建立的东西清理掉（类似演唱会结束后拆台）
> - **发送 result**：向远端报告"这次任务的最终结果"
> - **stopWork**：通知远端"这边已经没活干了，你可以释放资源"
> - **transport**：底层传输连接（WebSocket / HTTP 通道），类比"电话线"
> - **flush gate**：刷新闸门——暂存待发送事件的缓冲区，清空它意味着"所有未发的事件要么发出去要么丢弃"
> - **pointer**：bridge-pointer.json 文件（详见 Ch12 §9），crash 恢复用的"书签"
>
> 普通 bridge 结束时是"关门、结账、拆台、送客"一整套；perpetual bridge 是"暂停营业但门不锁、桌椅不拆"——等下一次 query 来了直接复用。

---

## 3. 三条宿主链

当前源码中，远端会话的观察/操控有三条不同的宿主链：

| 宿主链 | 入口类型 | viewerOnly | 生命周期 | 用途 |
|--------|---------|-----------|---------|------|
| `claude assistant` | 用户命令 | ✅ yes | perpetual（跨 query 持续） | 长驻观察 + 轻交互 |
| `/remote-control` | 用户命令 | ❌ no（完整控制端） | per-query（每次 query 独立） | 从 web 操控本地 CLI |
| `runBridgeHeadless()` | 代码函数入口 | ❌ no | headless（无 UI 无人值守） | CI/CD 等自动化场景 |

三条链共享同一个 bridge 基础设施（`replBridge.ts`），但在以下维度上有差异：

- **viewer 权限**：assistant 模式关掉 interrupt/watchdog/title ownership；remote-control 保留完整控制
- **数据源**：assistant 用 `useAssistantHistory()` + `useRemoteSession()` **双数据源**（历史页 + live 增量）；remote-control 只用实时流
- **生命周期**：assistant 是 perpetual（跨 query 持续）；remote-control 跟随 bridge session

[图表预留 24-A]

---

## 4. viewerOnly 的精确语义

`viewerOnly` 不是"只读"——它是**角色重定义**。

### 关掉了什么
- **interrupt**：不能中断远端正在执行的工具
- **watchdog**：不负责监控远端健康
- **title ownership**：不能改变远端会话的标题/名称

### 保留了什么
- **消息收发**：可以向远端发送消息和请求
- **权限处理**：远端弹出的权限请求会穿越到 viewer 端让用户确认
- **tool_result 渲染**：通过 `convertToolResults: true`，远端的工具执行结果被转换成本地可渲染的消息（详见 Part 3 Ch25「Brief 通信家族与 Viewer 结构化通道完全解析」）
- **反馈操作**：点赞/点踩等轻交互

### 双数据源

viewerOnly 模式依赖两条不同的数据流：
1. **`useAssistantHistory()`**：拉取远端会话的历史消息（类似翻阅聊天记录）
2. **`useRemoteSession()`**：接收 live 增量事件（类似实时聊天推送）

两者必须协调——历史页提供上下文，live 增量提供实时更新。如果只有历史没有增量，你看到的是"录像"；如果只有增量没有历史，你看到的是"从中间开始的直播"。

> 💡 **为什么两者必须同时存在？** 因为 `claude assistant` 可能在任意时刻 attach——你可能在远端会话已经跑了 30 分钟后才连上去。如果只订阅 live 增量，你会错过 attach 之前发生的所有事情（上下文完全空白，就像从电视剧第 8 集开始看，前 7 集在讲什么你不知道）。如果只拉历史不订阅增量，你只能看到 attach 那一刻的快照（像打开一张静止的照片，之后远端继续跑你看不到）。两者合起来才能让你"既看到过去发生了什么，又看到现在正在发生什么"——这和 git 一样：你不能只看今天的 commit 不看历史，也不能只看历史不看新提交。

> 💡 **通俗理解**：viewerOnly 像电影院的列席观众——不能走上台去（interrupt），不能改剧本（watchdog/title），但可以鼓掌（反馈）、可以举手提问（发消息）、演员需要观众确认时会转向你（权限穿越）。

---

## 5. perpetual 对 bridge 基础设施的影响

§4 讲的是 viewerOnly 在**用户体验层**的语义（关掉什么、保留什么）。但 viewerOnly + perpetual 这对组合还会**反向影响下层 bridge 基础设施**的运行方式——这就是本节要讲的内容：bridge 自身在 perpetual 模式下的行为差异。

Perpetual 模式与非 perpetual 模式在 bridge 层面的差异：

| 维度 | 普通 bridge | perpetual bridge（KAIROS） |
|------|------------|--------------------------|
| teardown 时 | 发 result → stopWork → 关 transport | 不发 result → 不 stopWork → **不关 transport** |
| pointer 处理 | clean shutdown 清除 pointer | teardown 后**刷新** pointer（保留） |
| 与 v2 的兼容 | 支持 env-less bridge (v2) | **不支持**（`initReplBridge.ts:410` 互斥） |
| 重连策略 | fresh session（新建会话） | reconnect-in-place（尝试接回同一个会话） |

**为什么 perpetual 不支持 v2？** 当前代码中 `if (isEnvLessBridgeEnabled() && !perpetual)` 明确把 perpetual 排除在 v2 之外。源码注释（`initReplBridge.ts:407-410`）给出了直接解释："perpetual（assistant-mode session continuity via bridge-pointer.json）is env-coupled and **not yet implemented here** — fall back to env-based when set so KAIROS users don't silently lose cross-restart continuity."

所以这**不是**架构性的语义冲突，而是**实现滞后**——perpetual 模式依赖 env-coupled 的 bridge pointer 机制，而 v2 的 env-less 路径还没把这部分迁移过来。源码作者明确标注了 TODO 意图：宁可 KAIROS 用户回退到老路径也要保证"跨重启连续性不会静默丢失"。这是一个典型的"向后兼容优先级高于激进简化"的工程取舍。

---

## 6. assistant 模式如何反向影响记忆系统

为什么 assistant 模式会反向影响记忆系统？

> 💡 **先说一下 autoDream 是什么**：autoDream 是 Claude Code 记忆系统的**自动后台整理功能**，就像"你周末整理本周的笔记"——默认情况下系统会定期自动把散乱的会话笔记整合成主题文件（详见 Part3 记忆系统完全解析的 §6.2 节）。

因为"长驻观察"的语义和"后台自动整理"在触发时机上天然冲突——autoDream 假设会话有明确的结束点（以此为契机做整理），而 perpetual 模式下会话没有结束点（你会一直 attach 着看）。所以 Claude Code 的设计选择是：

当 KAIROS 模式激活时，记忆系统的行为会改变：
- **`autoDream` 整合被完全禁用**。autoDream 的原设计是"后台定时把散乱的会话笔记整合成主题文件"，但 KAIROS 模式下会话不结束，整合时机会与实时更新冲突
- **记忆写入切换到 append-only 日志模式**（"只追加日志"模式）。
  > 💡 **append-only 是什么？** 数据库/日志系统的经典模式——**只追加，从不修改已有记录**。相对的是 "update-in-place"（原地修改）。比喻：流水账日记 vs 整理后的摘要。KAIROS 模式下每天看到什么就追加什么，不做二次加工
- **topic-based（主题归类）整理**被 append-only 取代。Auto Memory 原本把记忆按主题分文件存（比如"重构 auth 模块"、"数据库迁移"各一个主题文件），KAIROS 模式下改成按日期追加日志
- 手动 `/dream` 技能仍然可用（用户可以在需要时手动触发一次离线整合，相当于"周末整理一次流水账"）

详见 Part3 Ch（记忆系统完全解析）§6.2。

---

## 批判性分析

### 优点

1. **共享基础设施**：assistant、remote-control、headless 三条链复用同一个 bridge 基础设施，避免了三套独立实现的维护负担
2. **角色重定义而非功能开关**：viewerOnly 不是简单的 `readonly: true`，而是精细地划分了"控制端行为"和"观察端行为"的边界
3. **perpetual 模式**让 assistant 可以跨 query 持续存在，真正实现了"长驻观察"——这是常规 bridge 的 per-query 生命周期做不到的

### 代价

1. **perpetual 与 v2 互斥**是一个已知的技术债——当 v2 成为主力通道后，assistant 模式需要适配
2. **双数据源**（history + live）增加了状态同步的复杂度——两条流的消息可能重叠，需要去重
3. **KAIROS 这个代号**在源码中密度极高（190 次出现、61 文件），虽然说明它是顶级 feature flag，但也增加了 grep 时的噪声——它同时被用作启动模式门控、记忆模式门控、perpetual 触发条件等多种语义，边界不够清晰

---

### 下一章看什么？

本章讲的是"`claude assistant` 如何让你像看投影一样观察远端会话"——**这是对 Bridge 子系统的一种特殊使用方式**。但当 Web 端真的要往本地传数据（文件、消息、工具结果）时，数据本身用什么格式、走哪条通道？这就是下一章 **Part3 Ch25 Brief 通信家族与 Viewer 结构化通道**要解决的问题。如果说 Ch12 讲的是"管道怎么建"、本章讲的是"怎么 attach 到远端会话"，那么 Ch25 讲的就是"管道里跑什么格式的货物"。

---

> **交叉引用**：
> - Bridge 状态双轨 → Part3 Ch12 §8
> - Perpetual Bridge → Part3 Ch12 §10
> - KAIROS 记忆模式 → Part3 Ch（记忆系统完全解析）§6.2
> - tool_use_result 渲染 → Part3 Ch25（Brief 通信家族与 Viewer 结构化通道完全解析）
