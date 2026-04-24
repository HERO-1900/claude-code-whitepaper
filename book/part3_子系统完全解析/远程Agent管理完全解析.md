# 远程 Agent 管理完全解析

> **源码版本**：Claude Code 2.1.88（社区公开流传源码的源码级分析）
> **核心文件**：`src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`（855 行）
> **辅助模块**：`src/utils/teleport.tsx`、`src/utils/teleport/api.ts`、`src/utils/ultraplan/ccrSession.ts`

---

## 💡 通俗理解

> 想象你在经营一家**外卖连锁餐厅**。你（本地 CLI）坐在总部的调度中心，而厨师们（远程 Agent）分散在不同的云端厨房里做菜。
>
> - **下单（创建会话）**：你把菜谱（代码仓库）和顾客需求（用户提示）打包发给云端厨房，厨房收到后开始备菜。有两种送菜谱的方式——要么告诉厨房去 GitHub 仓库自己取（Git Clone 模式），要么你亲手把所有食材打包快递过去（Git Bundle 模式）。
> - **看进度（轮询监控）**：你每秒钟打电话问一次厨房："菜做到哪了？"——这就是 1 秒一次的 HTTP 轮询。厨房告诉你做了几个菜（TodoList 更新），还在忙还是已经闲下来了（session status）。
> - **处理结果（通知与完成）**：菜做好了，厨房把完成通知推到你的待处理队列里。部分类型（如 ultrareview 有 30 分钟 `REMOTE_REVIEW_TIMEOUT_MS` 上限）会在超时后标记失败；而 `remote-agent` 通用类型本身并不带硬超时，只靠 stable-idle 检测判定完成。
> - **断线恢复（`--resume`）**：你下班回家了（终端关闭），第二天回来发现厨房还在做——你翻开昨天的订单本（sidecar 元数据），逐个打电话确认哪些厨房还在干活，然后重新开始盯单。
> - **Ultraplan（高级审批流程）**：像米其林大厨做一道主菜前，先写一份完整菜单让你审批。你可以在浏览器里看菜单、修改、批准或打回。厨师不会动手做菜，直到你点了"批准"。

### 🌍 行业背景

远程/云端 Agent 执行是 AI 编程工具的新兴趋势，2025 年开始成为竞争焦点：

- **Devin（Cognition）**：最早的云端全自主编程 Agent，在云端容器中运行完整开发环境，支持小时级无监督执行。用户通过 Web UI 交互，没有本地 CLI 集成。Devin 的定位是全自主，而 Claude Code 的远程模式更强调本地-云端协作。
- **GitHub Copilot Coding Agent**：2025 年推出，通过 GitHub Actions 在云端执行编码任务。用户在 Issue 中 @copilot 触发，Agent 创建 PR 供审查。与 Claude Code 类似使用 Git 传递代码，但没有实时轮询——用户等待 PR 完成。
- **Cursor Background Agent**：2025 年推出的云端执行能力，可以在后台运行长时间任务。与 Claude Code 的架构类似（本地 CLI + 云端容器），但 Cursor 依赖 VS Code 的 Remote Development 协议，而 Claude Code 使用自建的 HTTP 轮询 + Git Bundle 方案。
- **Codex（OpenAI）**：v0.118.0 支持并行 Agent 工作流和 mailbox 通信机制，但主要面向本地执行环境，不支持 Claude Code 级别的云端远程 Agent。与此类比的另一种范式是**以即时通讯软件（如 WhatsApp/Telegram）为入口**的远程执行——支持跨设备唤醒、无需专用终端（相关产品名与版本请以各自官方资料为准）。
- **Aider**：纯本地执行，没有远程 Agent 能力。

Claude Code 的远程 Agent 方案在"代码传输"环节（GitHub Clone + Git Bundle 三级降级）和"断线恢复"环节（sidecar 元数据 + --resume）上做得比较完善。HTTP 轮询方案虽然在延迟上不如 WebSocket，但在容错性上有明显优势。

---

## 设计全景：三层控制底座

在深入技术细节之前，需要建立一个全局认知：teleport、UDS inbox、ultraplan、remote review 这些看似独立的功能，实际上共享**同一套三层控制底座**——

| 层次 | 职责 | 关键组件 |
|------|------|---------|
| **传输与恢复层** | 把工作送出去，crash 后接回来 | `teleport.tsx`（Git Bundle 打包+远端 session 创建）、`bridgePointer.ts`（pointer 恢复） |
| **调度与业务层** | 在传输层之上实现具体业务 | `ultraplan`（远端计划+审批）、`remote review`（bughunter 代码审查）、`autofix-pr`（PR 自动修复） |
| **呈现与托管层** | 把远端产出变成本地可观察+可操作的对象 | `RemoteAgentTask`（任务注册+状态保存+UI 展示）、XML 标签协议（输出解析）、footer pill + Shift+Down dialog |

这三层不是三个独立子系统，而是**同一底座的三种切面**。理解这一点后，后面所有技术细节都是对这三层的展开。

### 跨子系统协议字典：constants/xml.ts

一个常被忽视但极其关键的文件是 `src/constants/xml.ts`（87 行）——它定义了跨子系统通信的**全部 XML 标签协议**：

| 标签 | 用途 | 生产者 → 消费者 |
|------|------|----------------|
| `ULTRAPLAN_TAG` | ultraplan 远端计划结果 | CCR（Claude Code Remote，Anthropic 云端容器化运行时）session → RemoteAgentTask |
| `REMOTE_REVIEW_TAG` | bughunter 审查结果 | CCR session → RemoteAgentTask |
| `TASK_NOTIFICATION_TAG` | 任务状态通知 | 远端 → 本地 UI |
| `CROSS_SESSION_MESSAGE_TAG` | 跨会话消息 | SendMessageTool → UDS inbox |
| `TEAMMATE_MESSAGE_TAG` | Swarm teammate 消息 | teammate → inbox poller |
| `FORK_BOILERPLATE_TAG` | fork 子 Agent 样板 | AgentTool → forked agent |

这些字符串常量是跨子系统通信的**唯一契约**——改动一个标签会导致远端输出抽取、本地任务状态、UI 呈现三处同时断裂。把它们集中在一个文件中是"**协议即代码**"的设计理念。

### UDS Inbox 本地唤醒机制

UDS（Unix Domain Socket）inbox 是外部消息注入到本地主循环的底座。调用链：

```
setup.ts 启动 udsMessaging
  → systemInit.ts 注入 socket path（通过 system/init message）
  → 外部 CLI（如另一个 Claude 实例）向 socket 发消息
  → cli/print.ts 消息入队 → 触发 run()
  → useInboxPoller.ts 解析 CROSS_SESSION_MESSAGE_TAG 和 TEAMMATE_MESSAGE_TAG
```

> 💡 **通俗理解**：UDS inbox 就像公司的内部邮件系统——同事（其他 Claude 实例）把消息投进你的收件箱（socket），你在空闲时处理。teleport 负责把工作送出去（外发），UDS inbox 负责把结果收回来并唤醒本地（接收）——两者是远程协作的一出一入。

---

## 1. 架构总览

### 1.1 系统拓扑

```
┌──────────────────────────────────────┐        ┌─────────────────────────────┐
│         本地 CLI (Claude Code)         │        │    Anthropic Cloud (CCR)     │
│                                      │        │                             │
│  RemoteAgentTask                     │        │  Session Container          │
│   ├─ registerRemoteAgentTask()       │        │   ├─ Agent 执行             │
│   ├─ startRemoteSessionPolling()     │─HTTP──►│   ├─ 工具调用               │
│   │    └─ 每 1s 轮询事件 + 状态      │ GET    │   ├─ Git 操作               │
│   ├─ restoreRemoteAgentTasks()       │        │   └─ Hook (SessionStart)    │
│   └─ RemoteAgentTask.kill()          │        │                             │
│                                      │        │  Sessions API (/v1/)        │
│  teleportToRemote()                  │─POST──►│   ├─ CreateSession          │
│   ├─ Git Bundle 上传                 │        │   ├─ GetSession             │
│   └─ 环境选择                        │        │   ├─ ListEvents             │
│                                      │        │   ├─ SendEvent              │
│  Ultraplan Scanner                   │        │   └─ ArchiveSession         │
│   └─ ExitPlanModeScanner             │        │                             │
│                                      │        │  Environment API            │
│  Session Sidecar (磁盘)              │        │   ├─ ListEnvironments       │
│   └─ remote-agents/*.meta.json       │        │   └─ CreateEnvironment      │
└──────────────────────────────────────┘        └─────────────────────────────┘
```

**关键设计决策**：Claude Code 没有使用 WebSocket 或 SSE（Server-Sent Events）做实时推送，而是选择了 **HTTP 轮询**（每 1 秒 GET 一次事件列表）。这意味着：
- 通信是 **单向拉取** 而非双向推送或服务端推送
- 对网络中断的容忍度更高——一次轮询失败不会断开连接
- 代价是最多 1 秒的延迟，以及每秒一次的网络开销

**为什么不是 SSE？** 在 2025 年，SSE 是比 WebSocket 更公平的比较对象——SSE 同样基于 HTTP、同样是单向的（服务端→客户端）、同样有天然的断线自动重连机制（浏览器内置 `EventSource` 的 auto-reconnect），且延迟远低于 1 秒轮询（事件推送是即时的）。选择 HTTP 轮询而非 SSE 的可能原因包括：(1) CCR 基础设施可能不支持长连接（HTTP 轮询对服务端负载均衡器最友好）；(2) 实现最简单——不需要维护持久连接状态；(3) 对后台任务而言 1 秒延迟完全可接受。但这个选择并非没有代价——假设一个用户同时运行 5 个远程任务（如多个 autofix-pr），每个 1 秒轮询，一天就是 43.2 万次 HTTP 请求。对单用户"可控"，但在用户规模增长后，N 用户 × M 任务 × 86,400 秒的扇入量对 CCR 基础设施是否可控，需要服务端视角的评估。

### 1.2 远程任务类型体系

系统定义了五种远程任务类型（`src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` L60）：`remote-agent`（通用）、`ultraplan`（远程规划审批）、`ultrareview`（bughunter 代码审查）、`autofix-pr`（PR 自动修复长驻）、`background-pr`（后台 PR 处理）。

五种类型的核心差异在于**完成判定逻辑**：
- `remote-agent`：远端返回 `result` 事件即完成
- `ultraplan`：须等待 `ExitPlanMode` 工具被浏览器端批准
- `ultrareview`：须在 hook stdout 中找到 `<remote-review>` 标签
- `autofix-pr` / `background-pr`：使用注册的 `completionChecker` 回调，长期轮询

---

## 2. 远程会话的完整生命周期

### 2.1 会话创建（teleportToRemote）

创建远程会话是一个多步骤流程，核心函数是 `teleportToRemote()`（`src/utils/teleport.tsx` L730-1190），它接受多达 15 个参数，涵盖认证、仓库检测、环境选择和 API 调用。

#### 代码源选择梯队

远程容器需要获得用户的代码仓库。系统实现了一个三级降级策略：

```
GitHub Clone（最优）→ Git Bundle（降级）→ 空沙箱（最后手段）
```

**第一级：GitHub Clone**

```typescript
// src/utils/teleport.tsx 第945-952行
if (repoInfo && !forceBundle) {
  if (repoInfo.host === 'github.com') {
    // 预检：CCR 的 git-proxy 能否 clone 这个 repo？
    ghViable = await checkGithubAppInstalled(
      repoInfo.owner, repoInfo.name, signal
    );
    sourceReason = ghViable
      ? 'github_preflight_ok'
      : 'github_preflight_failed';
  } else {
    // GHES（企业版）：乐观通过，backend 验证
    ghViable = true;
    sourceReason = 'ghes_optimistic';
  }
}
```

这里有一个关键的**预检机制**：在发送 CreateSession 之前先调 `checkGithubAppInstalled()` 验证 GitHub App 是否已安装。注释说明了原因——"50% 的用户在安装 GitHub App 步骤放弃"，不做预检意味着大量容器 401 失败。

**第二级：Git Bundle**

当 GitHub 不可用时，`createAndUploadGitBundle()`（`src/utils/teleport/gitBundle.ts` L152）创建本地仓库打包并上传。Bundle 有三级降级：`--all`（完整仓库）→ `HEAD`（仅当前分支）→ `squashed-root`（无历史快照），每级在前一级超出大小限制（默认 100MB，feature flag 可调）时触发。未提交更改通过 `git stash create` → `refs/seed/stash` 自动捕获。

#### 环境选择逻辑

三种环境类型（`src/utils/teleport/environments.ts` L9）：`anthropic_cloud`、`byoc`、`bridge`。选择优先级：用户配置 → anthropic_cloud → 非 bridge → 第一个可用。标题和分支名由 Haiku 模型自动生成，分支固定以 `claude/` 开头（如 `claude/fix-mobile-login-button`）。

### 2.2 任务注册（registerRemoteAgentTask）

会话创建成功后，本地注册一个任务来跟踪它：

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第386-466行
export function registerRemoteAgentTask(options: {
  remoteTaskType: RemoteTaskType;
  session: { id: string; title: string };
  command: string;
  context: TaskContext;
  toolUseId?: string;
  isRemoteReview?: boolean;
  isUltraplan?: boolean;
  isLongRunning?: boolean;
  remoteTaskMetadata?: RemoteTaskMetadata;
}): { taskId: string; sessionId: string; cleanup: () => void } {
  const taskId = generateTaskId('remote_agent');
  // 在注册前创建输出文件——读者在任何输出到达前就可能访问
  void initTaskOutput(taskId);

  const taskState: RemoteAgentTaskState = {
    ...createTaskStateBase(taskId, 'remote_agent', session.title, toolUseId),
    type: 'remote_agent',
    remoteTaskType,
    status: 'running',
    sessionId: session.id,
    command,
    title: session.title,
    todoList: [],
    log: [],
    pollStartedAt: Date.now(),       // 超时从这里算起
    // ...其他标志
  };
  registerTask(taskState, context.setAppState);

  // 持久化到 sidecar，支持 --resume 重连
  void persistRemoteAgentMetadata({
    taskId, remoteTaskType, sessionId: session.id,
    title: session.title, command, spawnedAt: Date.now(),
    // ...
  });

  // 启动轮询循环
  const stopPolling = startRemoteSessionPolling(taskId, context);
  return { taskId, sessionId: session.id, cleanup: stopPolling };
}
```

### 2.3 轮询监控（startRemoteSessionPolling）

这是远程 Agent 管理的**核心循环**——每秒一次 HTTP 请求获取远端事件：

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第538-799行
function startRemoteSessionPolling(
  taskId: string, context: TaskContext
): () => void {
  let isRunning = true;
  const POLL_INTERVAL_MS = 1000;
  const REMOTE_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;  // 30分钟
  const STABLE_IDLE_POLLS = 5;  // 连续5次空闲才认为真的结束
  let consecutiveIdlePolls = 0;
  let lastEventId: string | null = null;
  let accumulatedLog: SDKMessage[] = [];
  let cachedReviewContent: string | null = null;

  const poll = async (): Promise<void> => {
    if (!isRunning) return;
    // ... 轮询逻辑
    if (isRunning) {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  void poll();
  return () => { isRunning = false; };
}
```

#### 稳定空闲检测

一个重要的工程决策：远程会话在工具调用之间会短暂进入 `idle` 状态。如果单次观测到 `idle` 就判定完成，100 次以上的快速工具调用中必然误判。解决方案是**连续 5 次轮询无日志增长且状态为 idle**：

> 📚 **课程关联**：`STABLE_IDLE_POLLS = 5` 的设计本质上是《数字电路》中的**去抖动（debouncing）**——对一个可能抖动的信号（idle/running 快速切换），通过连续多次采样确认稳态后才做状态转移。注意这与 TCP keepalive 有本质区别：keepalive 从**无响应**中推断故障（absence of signal → failure），而 stable idle 从**有响应**中推断完成（presence of idle signal → completion）。两者信号语义相反——一个检测"对端是否死了"，一个确认"对端是否真的闲了"。去抖动是更准确的类比。

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第544-546行
// Remote sessions flip to 'idle' between tool turns. With 100+ rapid
// turns, a 1s poll WILL catch a transient idle mid-run. Require stable
// idle (no log growth for N consecutive polls) before believing it.
const STABLE_IDLE_POLLS = 5;
```

```typescript
// 第661-666行
if (response.sessionStatus === 'idle' && !logGrew && hasAnyOutput) {
  consecutiveIdlePolls++;
} else {
  consecutiveIdlePolls = 0;
}
const stableIdle = consecutiveIdlePolls >= STABLE_IDLE_POLLS;
```

#### 事件流增量处理

轮询采用**基于游标的增量获取**（`src/utils/teleport.tsx` L633-715），通过 `after_id` 参数只获取新事件。安全上限为 50 页（`MAX_EVENT_PAGES`），防止游标卡住无限翻页。每次轮询同时获取会话元数据（分支、状态）。

#### 竞态条件防护

轮询循环必须处理与 `stopTask`（用户手动终止）之间的竞态：

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第694-720行
// Guard against terminal states — if stopTask raced while
// pollRemoteSessionEvents was in-flight (status set to 'killed',
// notified set to true), bail without overwriting status.
let raceTerminated = false;
updateTaskState<RemoteAgentTaskState>(taskId, context.setAppState,
  prevTask => {
    if (prevTask.status !== 'running') {
      raceTerminated = true;
      return prevTask;  // 不覆盖终态
    }
    // ...正常更新
  }
);
if (raceTerminated) return;
```

### 2.4 任务完成与通知

| 任务类型 | 完成信号 | 超时时间 |
|---------|---------|---------|
| `remote-agent` | `result` 事件 | 无 |
| `ultraplan` | `ExitPlanMode` 获得审批 | 可配置 |
| `ultrareview` | `<remote-review>` 标签 | 30 分钟 |
| `autofix-pr` | `completionChecker` 回调 | 无（长驻） |
| `background-pr` | `completionChecker` 回调（与 `autofix-pr` 共用长期轮询逻辑） | 无（长驻） |

通知以 XML `<task_notification>` 格式注入消息队列（L166-183）。`markTaskNotified()` 使用 `updateTaskState` 的原子更新保证**同一任务只发送一次通知**——即使轮询循环和 stopTask 同时触发完成逻辑。

### 2.5 会话终止（kill）

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第808-848行
export const RemoteAgentTask: Task = {
  name: 'RemoteAgentTask',
  type: 'remote_agent',
  async kill(taskId, setAppState) {
    // 1. 原子地更新状态为 killed + notified
    updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') return task;
      sessionId = task.sessionId;
      killed = true;
      return { ...task, status: 'killed', notified: true, endTime: Date.now() };
    });

    // 2. 通知 SDK 消费者
    if (killed) {
      emitTaskTerminatedSdk(taskId, 'stopped', { toolUseId, summary: description });
      // 3. 归档远程会话——释放云端资源
      if (sessionId) {
        void archiveRemoteSession(sessionId).catch(e =>
          logForDebugging(`RemoteAgentTask archive failed: ${String(e)}`)
        );
      }
    }
    // 4. 清理磁盘输出和元数据
    void evictTaskOutput(taskId);
    void removeRemoteAgentMetadata(taskId);
  }
};
```

归档操作（`archiveRemoteSession`）是 fire-and-forget 的：失败只记录日志，不影响本地终止。归档后远端拒绝新事件写入，Agent 在下一次写操作时自然停止。

**Fire-and-forget 的风险分析**：这个设计从本地用户体验来看是合理的——kill 操作应该立即返回，不应被远程 API 的网络延迟阻塞。但如果归档**持续失败**（网络不可达、CCR 5xx、认证过期等），会引发一个典型的"**客户端认为已终止、服务端仍在运行**"的分布式一致性问题：

- **云端资源泄漏**：未归档的容器不会被释放，持续消耗计算资源。如果 CCR 没有独立的超时回收机制（从源码无法确认），一个归档失败的容器可能无限运行。
- **远端 Agent 继续产生副作用**：最危险的场景是 Agent 仍在执行并推送代码到 GitHub——用户以为任务已经停止，但远端可能已经向 `claude/` 分支推送了多个 commit，甚至创建了 PR。
- **无重试机制**：代码中对归档失败只做 `logForDebugging`，没有重试队列、没有后台重试、没有下次启动时的补偿清理。对比之下，元数据持久化（`persistRemoteAgentMetadata`）同样是 fire-and-forget，但元数据丢失只影响 `--resume` 能力，归档失败则影响实际资源。

一个更健壮的设计可能是：将归档失败的 session ID 写入本地的"待归档队列"，在下次 Claude Code 启动时（或 `restoreRemoteAgentTasks` 中）补偿执行。当然，这增加了实现复杂度——Claude Code 团队可能判断 CCR 自身有超时回收机制，使得客户端的归档只是"加速释放"而非"唯一释放途径"。但这个假设值得在架构文档中明确标注。

---

## 3. 会话恢复（--resume）

用户关闭终端后重新启动 Claude Code，远程会话可能仍在云端运行。恢复流程：

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx 第477-532行
export async function restoreRemoteAgentTasks(
  context: TaskContext
): Promise<void> {
  const persisted = await listRemoteAgentMetadata();
  if (persisted.length === 0) return;

  for (const meta of persisted) {
    let remoteStatus: string;
    try {
      const session = await fetchSession(meta.sessionId);
      remoteStatus = session.session_status;
    } catch (e) {
      // 404 = 会话已消失 → 删除元数据
      // 401 = 认证失败 → 可通过 /login 恢复，跳过但保留
      if (e.message.startsWith('Session not found:')) {
        void removeRemoteAgentMetadata(meta.taskId);
      }
      continue;
    }

    if (remoteStatus === 'archived') {
      // 会话在离线期间结束了，不要复活
      void removeRemoteAgentMetadata(meta.taskId);
      continue;
    }

    // 重建任务状态并重启轮询
    const taskState: RemoteAgentTaskState = {
      ...createTaskStateBase(meta.taskId, 'remote_agent', meta.title),
      pollStartedAt: Date.now(),  // ← 关键：重置轮询起点
      // ...其他字段从元数据恢复
    };
    registerTask(taskState, context.setAppState);
    startRemoteSessionPolling(meta.taskId, context);
  }
}
```

**`pollStartedAt` 重置**：注意第 525 行，恢复时 `pollStartedAt` 被设为 `Date.now()` 而非 `meta.spawnedAt`。这意味着 30 分钟超时从恢复时刻重新计算——一个 20 分钟前创建的任务恢复后还有完整的 30 分钟。注释明确解释了这是有意设计："a restore doesn't immediately time out a task spawned >30min ago"。

> 📚 **课程关联**：会话恢复中"只持久化身份、不持久化状态"的设计，是《分布式系统》中**瘦客户端恢复（thin-client recovery）**的经典模式——本地只保存足以重建连接的最小信息（session ID），运行状态总是从权威源（CCR 云端）实时获取。需要注意，这**不是严格意义上的无状态恢复（stateless recovery）**——系统确实在本地持久化了状态（meta.json 文件中的 taskId、sessionId、spawnedAt 等），只是将运行时状态的"权威来源"放在了服务端。更准确地说，这是一种"**最小状态持久化 + 远程状态查询**"的混合恢复模式（identity-only persistence）。真正的无状态恢复是服务端完全不依赖客户端持久化（如 HTTP 无状态协议本身）。这个区分在工程实践中很重要——如果开发者误以为可以完全不做持久化，删除 meta.json 后将无法恢复任何远程会话。
>
> 与数据库中的 WAL（Write-Ahead Log）恢复相比：WAL 是"持久化完整操作日志以本地重放"，Claude Code 是"持久化连接标识以远程查询"。选择后者的前提是远程服务的可用性足够高——如果 CCR 不可达，本地持有的 session ID 就毫无用处。

### 元数据持久化

`RemoteAgentMetadata`（`src/utils/sessionStorage.ts` L305-318）存储在 `{projectDir}/{sessionId}/remote-agents/remote-agent-{taskId}.meta.json`，包含 `taskId`、`sessionId`、`remoteTaskType`、`title`、`command`、`spawnedAt` 等字段。关键设计：**只持久化身份信息，不持久化运行状态**——状态总是从 CCR 实时获取，避免本地缓存过期问题。

---

## 4. 前置条件检查系统

`checkBackgroundRemoteSessionEligibility()`（`src/utils/background/remote/remoteSession.ts` L45-98）在创建远程会话前执行分层检查：先查组织策略（阻断则直接返回），再并行检查登录、环境、仓库，最后根据 bundle 门控决定 GitHub App 是否必需。

六种前置条件失败类型：

| 失败类型 | 含义 | 用户行动 |
|---------|------|---------|
| `not_logged_in` | 未登录 Claude.ai | 运行 `/login` |
| `no_remote_environment` | 无可用云环境 | 在 claude.ai/code 设置 |
| `not_in_git_repo` | 当前目录不是 Git 仓库 | `git init` |
| `no_git_remote` | 没有 GitHub remote | `git remote add origin` |
| `github_app_not_installed` | Claude GitHub App 未安装 | 安装 App |
| `policy_blocked` | 组织策略禁止 | 联系管理员 |

**Git Bundle 的意义**：引入 bundle 机制后，前置条件从"必须有 GitHub remote + App 安装"降级为"只需要有 .git 目录"。相关源码注释以类似措辞描述了覆盖率的跃升（原注释给出"从具有 origin remote 的会话占比 → 具有 .git 目录的会话占比"的提升数字，精确值见源码注释本身；本文不复制具体百分比，以免与当前快照漂移）。

---

## 5. Ultraplan：远程规划审批流程

Ultraplan 是远程 Agent 的特殊模式——Agent 在云端生成执行计划，用户在浏览器中审批后才执行。

### 5.1 ExitPlanModeScanner：事件流状态机

```typescript
// src/utils/ultraplan/ccrSession.ts 第80-181行
export class ExitPlanModeScanner {
  private exitPlanCalls: string[] = [];      // ExitPlanMode 工具调用 ID 列表
  private results = new Map<string, ToolResultBlockParam>();  // 已收到的结果
  private rejectedIds = new Set<string>();   // 被拒绝的调用 ID
  private terminated: { subtype: string } | null = null;
  everSeenPending = false;

  ingest(newEvents: SDKMessage[]): ScanResult {
    for (const m of newEvents) {
      if (m.type === 'assistant') {
        // 收集 ExitPlanMode 工具调用
        for (const block of m.message.content) {
          if (block.name === EXIT_PLAN_MODE_V2_TOOL_NAME) {
            this.exitPlanCalls.push(block.id);
          }
        }
      } else if (m.type === 'user') {
        // 收集工具结果（浏览器批准/拒绝）
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.results.set(block.tool_use_id, block);
          }
        }
      } else if (m.type === 'result' && m.subtype !== 'success') {
        // 非 success 的 result 意味着会话崩溃
        this.terminated = { subtype: m.subtype };
      }
    }
    // ...判定逻辑
  }
}
```

### 5.2 状态转移图

```
                            ┌────────────────────────────┐
                            │                            ▼
running ──(turn ends, no ExitPlanMode)──► needs_input ──(user replies)──► running
   │                                                                        │
   └──(ExitPlanMode emitted)──► plan_ready ──(rejected)────────────────► running
                                    │
                                    ├──(approved)──► poll resolves, task removed
                                    └──(teleport)──► plan returned to local
```

三种用户操作的区分方式：
- **approved**：`tool_result.is_error === false`，内容包含 `## Approved Plan:` 标记
- **rejected**：`tool_result.is_error === true`，无 teleport 标记
- **teleport**（传回本地执行）：`tool_result.is_error === true`，包含 `__ULTRAPLAN_TELEPORT_LOCAL__` 标记

```typescript
// src/utils/ultraplan/ccrSession.ts 第48行
export const ULTRAPLAN_TELEPORT_SENTINEL = '__ULTRAPLAN_TELEPORT_LOCAL__'
```

### 5.3 轮询等待循环

```typescript
// src/utils/ultraplan/ccrSession.ts 第198-306行
export async function pollForApprovedExitPlanMode(
  sessionId: string,
  timeoutMs: number,
  onPhaseChange?: (phase: UltraplanPhase) => void,
  shouldStop?: () => boolean,
): Promise<PollResult> {
  const scanner = new ExitPlanModeScanner();
  const MAX_CONSECUTIVE_FAILURES = 5;
  // 600 次调用/30分钟——5xx 概率非零就会命中
  // 单次失败不终止，连续 5 次才放弃

  while (Date.now() < deadline) {
    if (shouldStop?.()) {
      throw new UltraplanPollError('poll stopped by caller', 'stopped', ...);
    }
    const resp = await pollRemoteSessionEvents(sessionId, cursor);
    const result = scanner.ingest(resp.newEvents);

    if (result.kind === 'approved') {
      return { plan: result.plan, executionTarget: 'remote' };
    }
    if (result.kind === 'teleport') {
      return { plan: result.plan, executionTarget: 'local' };
    }

    // Phase 推导：pending ExitPlanMode → plan_ready
    //             quiet idle → needs_input
    const phase = scanner.hasPendingPlan ? 'plan_ready'
                : quietIdle ? 'needs_input'
                : 'running';
    if (phase !== lastPhase) {
      onPhaseChange?.(phase);  // 驱动 UI pill 更新
    }
    await sleep(POLL_INTERVAL_MS);  // 3 秒
  }
}
```

---

## 6. Ultrareview：远程代码审查

远程审查有两条路径：**Bughunter 模式**（生产路径，通过 `SessionStart` Hook 运行 `run_hunt.sh`）和 **Prompt 模式**（开发/降级路径，普通 Assistant 对话）。

`extractReviewFromLog()`（L254-283）实现了四级降级提取：hook_progress 标签扫描 → assistant 消息标签扫描 → hook stdout 拼接后标签扫描（处理标签跨事件拆分） → 全文拼接。这种极度防御性的编程确保几乎不可能丢失审查结果。

---

## 7. Teleport API 层

### 7.1 重试与容错

`axiosGetWithRetry()`（`src/utils/teleport/api.ts` L47-81）实现指数退避重试（2s、4s、8s、16s），只对瞬态错误（网络错误 + 5xx）重试，4xx 直接抛出。

### 7.2 Sessions API 数据模型

会话状态四阶段：`requires_action` → `running` → `idle` → `archived`。`SessionResource` 包含 `session_context`（Git 源、push 目标、模型选择、bundle file ID 等）和环境 ID（L84-136）。

### 7.3 向远程会话发送消息

`sendEventToRemoteSession()`（L361-417）通过 POST `/v1/sessions/{id}/events` 发送用户事件，超时 30 秒（CCR worker 冷启动时间具体数值取决于当前容器编排状态，本文无可公开源码依据的精确值）。

---

## 8. UI 与权限传递

### Pill 标签

远程任务在 CLI 底部以"药片"形式显示（`src/tasks/pillLabel.ts` L39-56）：普通会话显示 `◇ 1 cloud session`，Ultraplan 则根据阶段显示 `◇ ultraplan` / `◇ ultraplan needs your input` / `◆ ultraplan ready`（◇ 空心=运行中，◆ 实心=待批准）。

### 权限模式注入：API 约束下的协议层 Hack

CreateSession API 没有 `permission_mode` 字段，系统通过**初始事件注入**绕过（`src/utils/teleport.tsx` L1122-1139）：在 `events` 数组中前置一个 `set_permission_mode` 类型的 `control_request`。该事件在容器连接前已写入 threadstore，确保第一个用户 turn 之前权限模式就已生效——没有时序竞态。

**这是整个远程 Agent 系统中最值得深入分析的工程决策之一。** 它揭示了一个常见但很少被明确讨论的架构约束：CCR（Claude Code Remote）的 Sessions API 设计**早于**权限模式功能的推出。当 Claude Code 团队需要让远程 Agent 尊重本地的权限设置（如 `plan` 模式要求用户审批每步操作）时，他们面临一个经典困境——**你的功能依赖一个你无法立即修改的上游 API**。

三种可能的解决路径：

1. **等待 API 升级**：在 CreateSession 中添加 `permission_mode` 字段。这是"正确"的做法，但需要 CCR 团队排期、开发、部署、兼容旧客户端——可能需要数周甚至数月。
2. **在容器启动后发送配置事件**：先创建会话，等容器就绪后再发送权限配置。问题是存在时序窗口——在配置到达之前，Agent 可能已经以默认权限执行了操作。
3. **在创建时的 events 数组中注入控制事件**（Claude Code 的实际选择）：利用 CreateSession API 已有的 `events` 字段（原本用于传递初始用户提示），夹带一个 `control_request` 类型的事件。因为 events 在容器启动前就写入了 threadstore，所以没有时序竞态。

Claude Code 团队选择了方案 3——这是一种**协议层的创造性复用（protocol-level piggyback）**。它在现有 API 的语义边界内（events 数组可以承载任意类型的事件）找到了一个合法的注入点，既不需要等上游 API 改动，也不引入时序风险。

这个决策回答了一个在实际工程中极其常见的问题：**当你的交付节奏快于上游依赖的演进速度时怎么办？** 答案是在协议层找到合法的扩展点（而非绕过或 monkey-patch），将新语义嫁接到现有传输机制上。代价是协议的语义变得隐式——未来维护者需要知道 `events` 数组不仅承载用户消息，还承载控制指令。如果 CCR API 日后原生支持了 `permission_mode` 字段，这个 hack 就应该被清理掉。

---

## 9. 批判性分析

### 9.1 设计优势

**HTTP 轮询的务实选择**：选择轮询看起来"低技术"，但在实际场景中有实用优势：
- 天然的断线容忍——一次轮询失败不影响下一次，不需要心跳维持或重连逻辑
- 对负载均衡器最友好——无状态请求可以打到任意后端节点
- 1 秒间隔对于后台任务是完全可接受的延迟
- 通过 `afterId` 游标实现增量获取

需要诚实地指出，SSE（Server-Sent Events）在大多数维度上优于 HTTP 轮询——同样基于 HTTP、同样单向、有原生断线重连，且延迟是即时的（毫秒级 vs 最多 1 秒）。HTTP 轮询相对 SSE 的唯一明确优势是实现简单和对基础设施要求最低（不需要长连接支持）。选择轮询更可能是一个**基础设施约束下的务实决策**（CCR 不支持长连接、或团队优先选择了最简实现快速上线），而非经过 SSE/WebSocket 对比后的最优方案。

对代价的量化：单用户 5 个并行任务，全天轮询约 43 万次 HTTP 请求。如果按请求计费（如 CloudFront 每百万请求 $0.01-$1），每用户每天成本约 $0.004-$0.43。对 CCR 后端而言，1 万活跃用户并行产生的 ~5 万 req/s 扇入量需要认真的容量规划。此外，笔记本电脑上每秒一次的 HTTP 请求对电池续航也有可度量的影响。

**三级 Bundle 降级**：`--all → HEAD → squashed-root` 的降级链有效地处理了从几百 KB 到几 GB 仓库的场景。这种渐进式降级策略在文件传输系统中是常见的工程模式（类似于视频流的自适应码率），100MB 上限由 feature flag 可调。

**元数据只存身份不存状态**：恢复时总是从 CCR 拉取实时状态，彻底消除了本地缓存一致性问题。

### 9.2 设计缺陷与隐患

**855 行的单文件**：`RemoteAgentTask.tsx` 把 5 种远程任务类型（remote-agent、ultraplan、ultrareview、autofix-pr、background-pr）的完成逻辑、通知逻辑、恢复逻辑全塞在一个文件里。`startRemoteSessionPolling` 函数内部的 `poll` 闭包长达 250+ 行，嵌套了 bughunter 检测、stable idle 计算、竞态防护、TodoList 提取等多种关切。这是典型的"积累式复杂度"——每新增一种远程任务就向 `poll` 函数追加分支。

**魔法常数散布**：
- `STABLE_IDLE_POLLS = 5`（连续空闲次数）
- `REMOTE_REVIEW_TIMEOUT_MS = 30 * 60 * 1000`（审查超时）
- `MAX_EVENT_PAGES = 50`（最大翻页数）
- `POLL_INTERVAL_MS = 1000`（轮询间隔，RemoteAgentTask）vs `3000`（ultraplan ccrSession）

这些常数没有统一管理或通过 feature flag 配置（只有 `REMOTE_REVIEW_TIMEOUT_MS` 这类超时值在少数地方可以被覆写，其他常数调整都需要改源码）。

**Stable Idle 的脆弱性**：bughunter 模式下远程会话"一直 idle"——Hook 在运行但会话状态是 idle。为此引入了 `hasSessionStartHook` 检测来区分 bughunter 和 prompt 模式。但注释自己承认这是 "theoretical" 防护，且对未来新增的 Hook 类型没有前瞻性。

**pollStartedAt 重置的时间窗口问题**：恢复时 `pollStartedAt = Date.now()` 意味着一个已运行 29 分钟的 ultrareview 恢复后还有完整的 30 分钟。虽然注释解释了避免"恢复即超时"的动机，但这也意味着一个未被服务端归档的故障任务理论上可以通过反复 resume 延长本地超时——前提是 CCR 侧尚未把 `remoteStatus` 置为 `archived`（`restoreRemoteAgentTasks` 会显式跳过 `archived` 会话，line 379）。

**completionChecker 的全局可变状态**：
```typescript
const completionCheckers = new Map<RemoteTaskType, RemoteTaskCompletionChecker>();
```
这是一个模块级全局 Map，`registerCompletionChecker` 是全局副作用注册。没有取消注册机制，没有注册顺序保证，也没有防止覆盖的保护。

### 9.3 成本模型：远程 Agent 不是免费的

远程 Agent 的一个重要但源码中几乎不涉及的维度是**成本**。云端容器运行消耗真金白银，理解成本模型有助于解释多个架构决策的深层动机。

**行业参照**：
- **Devin**：$500/月，包含 20 小时 ACU（Agent Compute Unit），超出按时计费。换算约 $25/ACU-hour。
- **GitHub Copilot Coding Agent**：包含在 Copilot Enterprise 订阅中（$39/用户/月），使用 GitHub Actions 分钟数。
- **Claude Code 远程执行**：截至源码版本，计费模型未在客户端代码中体现。但可以推断：Claude Max 订阅（$100-200/月）可能包含一定的远程执行配额，超出后限流或额外计费。

**成本如何驱动架构决策**：

1. **GitHub App 预检（50% 放弃率）的真实动机**：表面上是优化用户体验，深层是避免容器浪费。容器侧的具体单次成本属于 Anthropic 内部计费数据，源码中未公开；但从原理上可以判断：若 401 失败率接近一半，前置校验节省下来的容器编排开销足以覆盖预检自身的 ROI。

2. **Stable idle 检测的经济学意义**：连续 5 次空闲轮询（5 秒）后判定完成并触发归档——这不仅是正确性要求，也是成本控制。如果 idle 检测过于灵敏（1 次就判定完成），可能在 Agent 思考间隙错误终止，导致任务失败需要重跑（浪费更多）；如果过于迟钝（20 次才判定），容器空转 20 秒的成本虽小但在规模化后累积可观。

3. **Fire-and-forget 归档的成本隐患**：如前所述，**在 CCR 自身没有独立的超时回收机制这一前提下**，归档失败意味着容器不被释放；一个"僵尸容器"可能持续计费数小时甚至数天。（CCR 是否具备独立回收属于服务端实现，无法从当前客户端源码快照直接证实。）这使得归档可靠性从"nice to have"变为直接影响 Anthropic 运营成本的关键路径。

4. **HTTP 轮询 vs SSE 的服务端成本**：每秒一次的 HTTP 请求虽然对单用户成本极低，但在服务端产生的每次请求处理开销（TLS 握手、负载均衡、日志记录等）通常高于 SSE 长连接下的单次心跳处理成本——这是 HTTP 短连接 vs 长连接的常识性差异，本书未做定量实测，具体数量级取决于 Anthropic 的网关与日志栈配置。当活跃用户增长到万级，轮询产生的请求量级（~5 万 req/s）可能驱动 Anthropic 重新评估通信方案。

**对用户的实际影响**：远程 Agent 的使用不是"免费的后台任务"。用户在决定是否使用远程模式时，应考虑：(a) 远程执行是否计入订阅配额或产生额外费用；(b) 长时间运行的 autofix-pr/background-pr 任务的累计成本；(c) 在本地足以完成的任务上使用远程模式是否值得。源码中缺乏对这些问题的用户提示，这是产品层面可以改进的方向。

### 9.4 可改进方向

1. **拆分轮询策略**：将 `startRemoteSessionPolling` 中的任务类型特定逻辑拆分为策略类（如 `ReviewPollStrategy`、`UltraplanPollStrategy`），轮询框架只负责事件获取和状态更新。
2. **自适应轮询间隔**：当连续多次无新事件时自动放缓到 5-10 秒，有新事件时回到 1 秒。减少 idle 期间的网络开销。
3. **超时配置外置**：30 分钟硬编码可改为 feature flag 或配置文件，允许企业用户按需调整。
4. **Bundle 进度反馈**：大仓库 bundle 上传可能耗时较长，但目前没有进度指示。可以增加上传进度回调。

---

## 代码落点

| 模块 | 文件路径 | 关键行号 |
|------|---------|---------|
| 核心状态机 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L22-59（状态类型）、L60-64（任务类型枚举） |
| 任务注册 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L386-466（registerRemoteAgentTask） |
| 轮询循环 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L538-799（startRemoteSessionPolling） |
| 会话恢复 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L477-532（restoreRemoteAgentTasks） |
| Kill 实现 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L808-848（RemoteAgentTask.kill） |
| 审查提取 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L254-283（extractReviewFromLog） |
| 计划提取 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L208-218（extractPlanFromLog） |
| 通知发送 | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L166-183（enqueueRemoteNotification） |
| 前置条件检查 | `src/utils/background/remote/remoteSession.ts` | L45-98（checkBackgroundRemoteSessionEligibility） |
| 细粒度检查 | `src/utils/background/remote/preconditions.ts` | L23-235（各项检查函数） |
| 远程会话创建 | `src/utils/teleport.tsx` | L730-1190（teleportToRemote） |
| 事件轮询 | `src/utils/teleport.tsx` | L633-715（pollRemoteSessionEvents） |
| 会话归档 | `src/utils/teleport.tsx` | L1200-1225（archiveRemoteSession） |
| Sessions API | `src/utils/teleport/api.ts` | L289-327（fetchSession）、L361-417（sendEventToRemoteSession） |
| 环境管理 | `src/utils/teleport/environments.ts` | L32-70（fetchEnvironments）、L76-120（createDefaultCloudEnvironment） |
| 环境选择 | `src/utils/teleport/environmentSelection.ts` | L24-77（getEnvironmentSelectionInfo） |
| Git Bundle | `src/utils/teleport/gitBundle.ts` | L50-146（_bundleWithFallback）、L152-292（createAndUploadGitBundle） |
| Ultraplan 扫描器 | `src/utils/ultraplan/ccrSession.ts` | L80-181（ExitPlanModeScanner） |
| Ultraplan 轮询 | `src/utils/ultraplan/ccrSession.ts` | L198-306（pollForApprovedExitPlanMode） |
| 关键词检测 | `src/utils/ultraplan/keyword.ts` | L46-95（findKeywordTriggerPositions） |
| Pill 标签 | `src/tasks/pillLabel.ts` | L39-56（remote_agent pill 逻辑） |
| 任务类型定义 | `src/tasks/types.ts` | L1-47（TaskState 联合类型） |
| 元数据持久化 | `src/utils/sessionStorage.ts` | L305-399（RemoteAgentMetadata CRUD） |
| 任务基类 | `src/Task.ts` | L6-76（TaskType、TaskStatus、Task 接口） |
