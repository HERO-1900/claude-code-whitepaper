# Peer 与 Session 发现层完全解析

当多个 Claude Code 实例同时运行在同一台机器上时——比如一个在编辑代码，另一个在跑测试，第三个通过 Bridge 接入远端会话——它们如何**发现彼此**并**互相通信**？这就是 Peer/Session 发现层要解决的问题。

> 🎯 **为什么这是 Agent 工作台的必要组件？** 多实例发现层是"Agent 工作台"这个定位的**必要组成**——单机单实例的聊天框根本不需要这些，只有当你要把 Claude Code 当成"开发者的 Agent 操作台"时，才需要回答"如何让多个 Agent 实例互相发现和协作"的问题。**据我们对 2026 年主流 AI 编码工具的对比（见本章末"行业对比"表）**，Claude Code 是少数把"多 Agent 实例必须互相发现"当成基础设施需求来构建的 AI 编码工具——Cursor、Aider、Cline 等工具都是"单实例单窗口"模型，两个窗口之间根本不能互发消息。

> **源码位置**：`src/utils/peerAddress.ts`（地址协议）、`src/utils/concurrentSessions.ts`（session PID registry）、`src/tools/SendMessageTool/`（跨会话消息）、`src/hooks/useInboxPoller.ts`（消息接收）、`tools.ts`（ListPeersTool 注册）

> **🔑 OS 类比：** Peer 发现层就像局域网中的**设备发现协议**——你的手机怎么找到同一 Wi-Fi 下的打印机？靠的是 mDNS/Bonjour 广播。Claude Code 的 Peer 发现层做的是同一件事：让同一台机器上的多个 Claude 实例互相发现、互相通信。

> 💡 **通俗理解**：想象一栋办公楼里有很多会议室（每个 Claude 实例是一间会议室）。Peer 发现层就是大楼的**会议室预订系统**——它知道哪些会议室在用、谁在里面、怎么联系他们。你想给隔壁会议室传个纸条（发消息），得先通过这个系统查到对方的房间号。

### 先认识四个关键术语

本章会反复用到几个技术缩写，先用一句话说清楚：

- **UDS**（Unix Domain Socket）：Unix 系统上**同一台机器内进程之间的通信通道**。就像办公楼内部的气动传送管——比走外面的邮局（网络 socket）快得多，因为不走出大楼
- **PID**（Process ID）：进程 ID。每个运行的程序都有一个操作系统给的编号，就像每个员工的**工号**，靠它就能找到这个程序
- **socket path**（套接字路径）：UDS 通信的"地址"，一般长成 `/tmp/claude-12345.sock` 的样子。就像办公室的内线电话号码
- **mDNS/Bonjour**（仅类比中用到）：苹果设备互相发现的协议，类似"局域网自动播报谁在线"

> 💡 **为什么同一台机器要搞 UDS 而不是直接用函数调用？** 因为每个 Claude 实例是**独立的进程**（类似不同的 App），它们之间不能互相调用对方的函数——必须通过系统级的通信通道。UDS 是 Unix 系统上最快的进程间通信方式。

---

## 1. 四层架构模型

Peer 发现不是一步完成的——它分为四层，每层做一件事：

```
┌─────────────────────────────────────────────────┐
│ 第四层：目标投影（把数据展示给三种消费者）              │
│  • ListPeersTool（给 AI 模型看）                    │
│  • /peers 命令（给人类用户看）                       │
│  • claude ps 命令（给运维/操作者看）                  │
├─────────────────────────────────────────────────┤
│ 第三层：目标整形                                   │
│  peerRegistry — 本地优先去重 + 地址格式化             │
├─────────────────────────────────────────────────┤
│ 第二层：活跃会话筛选                                │
│  listAllLiveSessions() — 逐个检查谁还"活着"          │
├─────────────────────────────────────────────────┤
│ 第一层：候选会话底座                                │
│  registerSession() — 登记 PID 记录                 │
└─────────────────────────────────────────────────┘
```

> 💡 **通俗理解**：就像找外卖骑手——第一层是"所有注册过的骑手名单"（PID registry），第二层是"目前在线的骑手"（活跃筛选），第三层是"去掉重复的、格式化地址"（整形），第四层是"给商家看的可接单骑手列表"（投影）。

[图表预留 23-A]

---

## 2. 第一层：Session PID Registry

每个 Claude Code 实例启动时，通过 `registerSession()` 函数（位于 `concurrentSessions.ts` 的 `registerSession()` 函数，启动时写入 PID 记录文件）在本地注册一张**会话运行时名片**。这张名片上的字段按语义可以分成**三组**：

**第一组·身份类**（这个会话"是谁"）：

| 字段 | 含义 | 示例 |
|------|------|------|
| `pid` | 进程 ID（操作系统给的进程编号，类似工号） | `12345` |
| `sessionId` | 会话唯一标识 | `session_abc123...` |
| `name` | 会话显示名（用户可读的名字） | `"重构 auth 模块"` |
| `cwd` | 当前工作目录 | `/Users/USERNAME/project` |
| `startedAt` | 启动时间 | `2026-04-10T10:00:00Z` |

**第二组·能力类**（这个会话"能做什么 / 怎么联系"）：

| 字段 | 含义 | 示例 |
|------|------|------|
| `kind` | 会话类型 | `interactive` / `bg` / `daemon` / `daemon-worker`（`concurrentSessions.ts:18` `export type SessionKind = 'interactive' \| 'bg' \| 'daemon' \| 'daemon-worker'`，完整四种）|
| `entrypoint` | 入口模式（用户是怎么启动这个会话的） | `repl` / `print` / `sdk` |
| `messagingSocketPath` | UDS 通信地址（其他进程给它发消息用的地址） | `/tmp/claude-12345.sock` |
| `logPath` | 日志文件路径 | `~/.claude/logs/session_abc.jsonl` |
| `agent` | 是否为 Agent 模式 | `true` / `false` |

**第三组·状态类**（这个会话"现在在干什么"，运行中动态更新）：

| 字段 | 何时写入 | 含义 |
|------|---------|------|
| `bridgeSessionId` | 通过 `updateSessionBridgeId()` | Bridge 连接成功后回写的远端 session 地址 |
| `status` | 通过 `updateSessionActivity()` | `busy` / `idle` / `waiting`（忙/闲/等待用户） |
| `waitingFor` | 通过 `updateSessionActivity()` | 等待原因：`approve tool`（等工具授权）/ `worker request`（等子任务）/ `sandbox request`（等沙箱授权）/ `dialog open`（等对话框）/ `input needed`（等用户输入） |
| `updatedAt` | 每次活动 | 最后活动时间戳 |

> 💡 **为什么要分三组？** 身份类是"签到时一次性填好的信息"（启动时就定），能力类是"这张名片本身的属性"（进程级别的能力），状态类是"动态更新的实时状态"（每分钟都可能变）。三组的**写入频率**和**读取者**完全不同——身份类只在注册时写，能力类在进程生命周期内不变，状态类则是高频更新。把它们分开，能帮助我们理解"谁在看这张名片、看什么"。

> 💡 **通俗理解**：这就像公司的员工在线状态系统——每个人登录时注册（pid + 工位号 + 部门），工作中不断更新状态（忙碌/空闲/等待审批），下班时注销。

---

## 3. 第二层：活跃会话筛选

**但光登记还不够**。§2 讲的 PID registry 只是一张"曾经登记过的会话名单"——一个进程登记之后，它可能已经 crash（宕机）、被 kill（被杀）、或正常退出了，但 registry 里的条目还在。这些"还挂着名但已经不在"的条目就是**僵尸会话**（zombie session）——如果你照着 registry 给它们发消息，消息永远送不到。所以光有第一层还不够，还需要一层**活跃性筛选**来剔除僵尸。

PID registry 中的记录不全是活跃的——进程可能已经 crash，registry 中的条目成了僵尸。

`listAllLiveSessions()`（`conversationRecovery.ts:494`）通过 UDS transport 级别的活跃枚举来筛选：只有 UDS socket 仍然可达的会话才被认为是活跃的。如果 UDS 不可用，回退到"全部视为可继续"（源码注释："UDS unavailable — treat all sessions as continuable"）。

**`--continue` 的 live truth 优先机制**：

`conversationRecovery.ts:487-506` 实现了一个关键的设计决策——当用户使用 `--continue` 恢复会话时：

1. 先调 `listAllLiveSessions()` 获取仍在运行的会话列表
2. 把 live 的非 interactive 会话（`bg` / `daemon` / `daemon-worker`）放入 `skip` set
3. 从剩余的已结束会话日志中，按时间排序找最近的可继续会话

**值得注意的是**，这个筛选过程消费的字段极其稀薄——live-session-filter 只看 `kind` 和 `sessionId`，不消费 `cwd`、`name`、`bridgeSessionId`、`status` 等更丰富的字段。这说明恢复链路被刻意设计为以**最少字段运行**，降低了对 registry 完整性的依赖。

**运行时活跃性是第一层过滤，transcript 最近性只是第二层排序。** 系统先信 **live truth**（"这个会话还活着，不要接管它"），再信 transcript（"在已经结束的会话中，最近的那个最可能是你想继续的"）。

> 💡 **live truth 是什么？** 它不是正式术语，是本书对"直接查询 UDS transport 得到的、当前还活着的会话这一权威事实"的简称。相比之下，transcript（对话记录日志）只能告诉你"某个会话最后一次写日志是什么时候"——不一定意味着它现在还活着。Live truth 优先就是"先信眼前看得见的活人，再信故纸堆"。

> 💡 **通俗理解**：就像你回办公室找人——先看谁现在还在座位上（live truth），不在的人才去翻最近的工作记录（transcript）猜谁最后走的。你不会去打扰还在工位上忙的同事，而是接手已经离开的人留下的工作。

---

## 4. 第三层：目标整形（peerRegistry）

> **⚠️ 关于证据来源的说明**：`peerRegistry.ts` 文件在当前源码快照中缺失（详见序章"研究边界声明"中的 checkout 级缺口清单）。但我们能反推它的职责——因为：
> 1. `peerAddress.ts` 的注释明确提到它（"kept separate from peerRegistry.ts"）
> 2. `replBridge.ts` 多处代码引用它的函数
> 3. 消费侧的调用姿态（SendMessageTool 如何整形地址）完整存在
>
> 通过这三条证据反推（即"**符号级缺口的三线收敛法**"——当某个模块的源码本体缺失时，用"注释引用、上游调用点、下游消费姿态"三条独立证据交叉验证来反推该模块的职责；详见序章"研究边界声明"和 Part5 代价章），可以确定 peerRegistry 承担以下职责：

1. **Local-first dedup**（本地优先去重）：同一个会话可能同时有 UDS 地址和 Bridge 地址。registry 优先保留 local（UDS），去掉 bridge 重复项——因为本地通信更快更可靠（`replBridgeHandle.ts` 注释："local is preferred"）

2. **地址格式化**：把 registry 中的原始数据整形成可直接用于 SendMessage 的地址字面量

> 💡 **dedup 是什么？** 是 "deduplication" 的缩写，意思是"去重"。就像你手机通讯录合并联系人——同一个朋友如果有两个号码被识别成两条，合并后只保留一条显示。

---

## 5. 第四层：三张表面

同一份 session registry 数据被投影为**三张完全不同的表面**：

| 表面 | 面向谁 | 暴露什么 | 隐藏什么 | 源码 |
|------|--------|---------|---------|------|
| `claude ps` | 人类**运维/操作者**（想知道机器上正在跑什么） | pid、status（busy/idle/waiting）、waitingFor、task-summary | 消息地址 | `REPL.tsx:updateSessionActivity()` |
| `/peers` 命令 | 人类**开发者**（想知道哪些会话可以沟通） | 会话列表、transport 类型、dedup 状态 | 模型可消费的格式 | `commands.ts`（feature gate `UDS_INBOX`） |
| `ListPeersTool` | **AI 模型**（另一个 Claude 实例，要发消息时查地址用） | **只有可发送地址**（`uds:/path` 或 `bridge:session_xxx`）+ name | **故意不暴露 busy state** | `tools.ts`（feature gate `UDS_INBOX`） |

**为什么 ListPeersTool 故意不暴露 busy/idle 状态？**

`SendMessageTool/prompt.ts:20` 明确写道："no 'busy' state; messages enqueue and drain at the receiver's next tool round"。

> 💡 **这句英文在说什么？** `enqueue` = 把消息放进队列；`drain` = 把队列里的消息取出来处理；`receiver's next tool round` = 接收方下一次进入工具处理循环的时机。**完整意思**：消息先排队等着，等接收方下次跑工具循环时再被统一取走处理。

所以跨会话消息走的是 **mailbox-pull**（收件箱拉取）语义：消息在队列里安静等着，直到接收方有空来拉。注意这不完全等于 email——**email 是 store-and-forward**（服务器主动推送/客户端定时拉取），**Claude Code 跨会话消息的 drain 时机必须等接收方的工具循环自然迭代到下一次**（可能几秒，也可能接收方卡在 Bash 里等几分钟）。

也就是说，发送方**知道**接收方"早晚会处理"，但**不知道什么时候**处理——这就是为什么 ListPeersTool 故意不暴露 busy state：给了你那个状态你也没法用它，因为消息本来就是异步的。

> 💡 **通俗理解**：三张表面就像同一栋大楼的三种视角——`claude ps` 是保安监控室（看谁在哪、忙不忙），`/peers` 是前台通讯录（看谁在、怎么联系），`ListPeersTool` 是快递员的地址列表（只要地址，不管人在不在家——快递放门口就行）。

---

## 6. Session Activity 三套投影

> **⚠️ 先澄清一个容易混淆的地方**：§5 讲的是 **peer 发现层**的三张投影（回答"**谁可以被发送消息**"），消费对象是 claude ps / /peers / ListPeersTool；本节讲的是 **session 活动状态**的三套投影（回答"**谁正在忙什么**"），消费对象是 claude ps / CCR worker state / Bridge UI。两者恰好都是"三套"，但**回答的问题不同**——前者是 WHERE（寻址），后者是 WHAT（活动）。

Session 的活动状态不只有一套表示——它被投影为三套完全独立的表面：

1. **claude ps 投影**（本地并发观测面）：`REPL.tsx` 通过 `updateSessionActivity()` 推送 `sessionStatus`（busy/idle/waiting）和 `waitingFor` 到 PID 文件。注释明确写道："Push status to PID file for claude ps"。

2. **CCR worker state 投影**（远端控制面）：远端 CCR 使用独立的状态集——`running` / `requires_action` / `idle` + `pending_action` + `task_summary`。这套状态通过 `sessionState.ts` / `ccrClient.ts` 同步。

3. **Bridge UI 投影**（控制台交互面）：从 NDJSON 事件流中抽取 `tool_start` / `text` / `result` / `error`，直接驱动 Bridge UI 的活动指示器。

三套投影的消费者不同、更新频率不同、状态粒度也不同——它们不是同一套数据的三种格式化，而是三条独立的状态投影链。

[图表预留 23-B]

---

## 7. 地址协议与 Local-First Dedup

当一个 Claude 实例想给另一个 Claude 实例发消息时，**消息的收件地址怎么写**？这就是地址协议要回答的问题。`peerAddress.ts` 定义了跨会话通信的地址协议——核心逻辑是"用 scheme 前缀来区分投递通道"，就像电子邮箱地址用 `user@domain.com` 区分用户名和服务商一样。详细的分析（包括一个命名空间劫持防御的精巧设计）见 Bridge 章节 §14（Peer 地址路由与兼容不对称），这里只给出三条核心要点：

核心要点：
- 两种显式 scheme：`uds:`（本地 socket）、`bridge:`（远端 session）；未带 scheme 前缀的字面量会被归入 `other`（teammate name）兜底分支——`other` 不是 scheme 而是 fallback 分类
- UDS 裸路径（`/tmp/...`）被自动兼容，bridge 裸 session id 不兼容（避免 teammate name 冲突）
- `parseAddress()` 被刻意从 `peerRegistry.ts` 分离，避免 SendMessageTool 在模块加载时引入重量级依赖

---

## 8. isReplBridgeActive 的二次用法观察

> ⚠️ **本节面向源码研究者**。讨论的是一个技术观察而非用户可见特性。

`isReplBridgeActive()` 最初是 SendMessageTool 的发送 gate——检查 bridge 消息投递能力是否就绪。它**除了原本的发送控制职责之外，还在一个额外位置被二次使用**——这是一个值得单独拎出来观察的现象，但需要诚实说明它的范围：

`ToolSearchTool/prompt.ts:96-105` 用 `isReplBridgeActive()` 决定 **`SendUserFile` 这一个工具**（在源码中以常量 `SEND_USER_FILE_TOOL_NAME` 引用，该常量定义在 `src/tools/SendUserFileTool/constants.ts`——或等价命名空间——以字符串形式给出该工具的规范名称）是否应该立即可用（不需要 ToolSearch 中转）。源码原文：

```typescript
if (
  feature('KAIROS') &&
  SEND_USER_FILE_TOOL_NAME &&
  tool.name === SEND_USER_FILE_TOOL_NAME &&
  isReplBridgeActive()
) {
  return false  // 不 defer，立即可用
}
```

注意三点：
1. 这个分支**只对 SendUserFile 一个工具生效**（不是"SendUserFile 等多个工具"）
2. 还被 `feature('KAIROS')` 二次门控——即只在 assistant 模式下才生效
3. 结合 Ch12 §8 指出的 `setReplBridgeActive()` writer 缺失——`isReplBridgeActive()` 在当前快照中恒返回 false，这意味着这段代码**在当前快照中是不会生效的死代码**（证据见 Ch12 §8：该符号仅有定义、无调用点写入 active=true 的路径）

> 💡 **诚实的结论**：这不是一个"广义能力门外溢"现象——它只是一个工具的二次条件判断，而且目前还不生效。但这个观察仍有价值：它揭示了 Anthropic 内部正在把 `isReplBridgeActive` 从"发送 gate"扩展为"工具可用性 gate"的设计意图——即使当前实现不完整，未来的演进方向已经在源码中留下了印记。

---

## 9. 符号级缺口清单

> ⚠️ **本节面向源码研究者**。普通读者可跳过——本节记录的是本书研究方法论下的"证据断点"，对理解系统行为没有必要，但对想自己 grep 源码验证的工程师很重要。

**从 §8 的一个观察到本节的全局清单**：§8 讨论的是 `isReplBridgeActive` 这一个具体的"调用点存在但 writer 缺失"的现象。这类"调用点存在但定义不生效"的 gap 在 Peer 层不止这一处——本节把所有此类 gap 汇总成清单，帮助源码研究者建立对本模块完整性的认知。

**符号级缺口（symbol-level gap）是什么？** 指调用点引用了某个符号（函数/类/模块），但该符号的定义宿主文件在当前源码快照中不存在——消费链完整，产生链缺失。这是序章定义的 checkout 级源码缺口的一种**子类型**。

以下模块在当前源码快照中被引用但宿主文件缺失：

| 缺失模块 | 引用位置 | 功能推断 |
|---------|---------|---------|
| `peerRegistry.ts` | `peerAddress.ts` 注释、`replBridge.ts` 引用 | local-first dedup + 目标整形 |
| `ListPeersTool/` 目录 | `tools.ts` require 引用 | 模型可见的 peer 地址列表工具 |
| `commands/peers/` 目录 | `commands.ts` require 引用 | 人类可见的 /peers 命令 |
| `peerSessions.js` | `SendMessageTool.ts:758` require 引用 | bridge 跨会话消息投递 executor |

这些缺失的共同特征是：**消费侧完整存在**（SendMessageTool 知道怎么调用、prompt 知道怎么描述、tools.ts 知道怎么注册），**只是执行宿主在当前快照中缺失**。

### 两条并行发送执行宿主

跨会话消息的实际投递有两条完全独立的执行路径：

| 通道 | 执行宿主 | 调用入口 | 状态 |
|------|---------|---------|------|
| **Bridge** | `peerSessions.js` → `postInterClaudeMessage()` | `SendMessageTool.ts:758`（bridge 分支） | 宿主缺失 |
| **UDS** | `udsClient.js` → `sendToUdsSocket()` | `SendMessageTool.ts`（uds 分支） | 宿主缺失 |

两条路径共享同一个 `parseAddress()` 入口做地址路由，但发送执行完全分离——bridge 通过 HTTP 走远端中转，UDS 通过本地 socket 直发。

### UserCrossSessionMessage 的硬渲染依赖

`UserCrossSessionMessage` 组件缺失不只是"渲染不够美"的问题——它是一个**无 fallback 的硬渲染依赖**。`UserTextMessage.tsx` 在检测到 `<cross-session-message` 标签后直接 `require("./UserCrossSessionMessage.js")`，没有 try/catch 降级、没有备用文本 renderer。如果这个 require 失败，整条 cross-session-message 渲染链会断裂。

### 宿主缺失的攻击面含义

宿主缺失不只是"源码研究不完整"——它暴露了一个值得讨论的**本地多实例攻击面**：

**如果 `peerSessions.js` 的实现不做 `from` 字段签名校验**，本地其他进程（哪怕是非 Claude Code 的普通恶意脚本）可以通过 UDS 直接构造 `from=session_xxx` 的跨会话消息发给当前 Claude。结合 `UserCrossSessionMessage` 的无 fallback 硬渲染依赖（一旦标签被识别就会进入渲染管线），这可能构成一条 **"本地进程 → Claude 模型上下文注入"** 的路径。

`SendMessageTool.ts:744-750` 的 TOCTOU 防御（"without this, from='unknown' ships"，详见 Bridge §14）说明源码作者**已经意识到 envelope 的完整性是敏感的安全边界**——但那个防御只在 SendMessageTool 这一侧检查，如果 peerSessions 的接收端不做对应的发件人验证，这条攻击路径仍然打开。

这是一个典型的"消费侧完整 + 执行侧缺失"gap 暴露的分析入口：**在现实部署中，本地多实例通信必须假定"每条进来的消息都可能来自不可信进程"**，需要在接收端做 envelope 签名校验。本书无法从当前快照直接验证 peerSessions 的接收端是否做了这层校验——这是生产部署时需要独立核验的审计项。

---

## 行业对比：为什么其他工具没有这一层？

Peer/Session 发现层在 AI 编码工具里是 Claude Code 独一份的基础设施——不是因为其他产品没想到，而是因为**它们根本没有这个问题**：

| 产品 | 多实例模型 | 为什么不需要 Peer 发现层 |
|------|----------|----------------------|
| **Cursor** | 单实例单窗口（"一个 Cursor 开一个 Composer"） | 同时开两个 Cursor 窗口，它们之间**不能互发消息**——每个窗口是独立的世界 |
| **Cline** / Claude Dev | 单实例 VS Code 扩展 | 同一个 VS Code 进程同一时刻只有一个 Agent 在跑，不存在"多个实例互相发现"的场景 |
| **Aider** | 单实例 CLI | 同时在两个终端开 Aider，它们彼此完全不知道对方存在 |
| **GitHub Copilot** | 单实例编辑器集成 | 所有通信都走 GitHub 服务器，本地多窗口之间没有 peer 概念 |
| **Kimi Code** | 多 subagent 但同进程 | 高并发 subagent 在**同一个主进程内**，通过函数调用交流，不需要跨进程发现（具体并发数以 Moonshot 官方文档为准） |

**Claude Code 的独特位置**：在本书对比的主流 AI 编码工具里，它是**少数明确假设"同一台机器上会有多个独立运行的 AI Agent 实例"**并为之构建基础设施的产品（以上表为对比范围，不代表全行业穷尽）。这个假设来自它的**Agent 工作台定位**——如果把 CC 当成"开发者的 Agent 操作台"（而不是"聊天框"或"IDE 插件"），那么"我在这台电脑上可能同时跑 5 个 Agent 做不同的事"就是自然需求。

所以 Ch23 回答的其实是一个别人**没提出过的问题**：当 AI 编程从"单实例工具"升级为"多实例工作台"后，实例之间如何寻址和通信？Peer/Session 发现层是对这个未来问题的提前布局。

---

## 批判性分析

### 优点

1. **四层分离**使得每一层可以独立演进——例如增加新的 transport（不只 UDS/bridge）时，第一层注册与第二层活跃筛选是主要改动点；第三层 dedup 需要扩展 scheme 识别、第四层投影需要扩展展示字段，但改动量相对集中
2. **故意不暴露 busy state** 的设计体现了对异步通信的深刻理解——跨会话消息不需要同步状态
3. **Local-first dedup** 优化了最常见场景——同机通信走 UDS 快于走 bridge 远端绕回
4. **三张表面各有侧重**，不存在"万能视图"——这是信息隐藏原则的工程落地

### 代价

1. **peerRegistry.ts 缺失**意味着我们无法验证 dedup 算法的具体实现——这是当前分析中最大的不确定性
2. **session PID registry 基于文件系统**（而非共享内存）——这是 Unix 多进程间通信的经典选择（文件系统是进程间最稳妥的"共享状态"介质），但意味着 registry 的更新和读取都要走文件 I/O。在合理使用场景下（几十个并发实例）这不是瓶颈，但如果未来 Claude Code 需要支持大规模多实例（比如数千个并发 agent），可能需要评估是否迁移到共享内存
3. **ListPeersTool 的地址只在当前连接生命周期内有效**——bridge session id 重连后旋转（见 Bridge 章节 §12），持有旧地址的模型会发送失败
4. **UDS 和 bridge 的兼容不对称**增加了认知负担——开发者需要知道"为什么 bare socket path 行但 bare session id 不行"

---

### 下一章看什么？

本章讲的是"同一台机器上的多个 Claude 实例如何互相发现"——这是 Agent 工作台的**本地多实例基础设施**。但如果**观察者和被观察者不在同一台机器上**呢？比如你在 claude.ai 网页上看着一个正在远端跑的 Agent——这种场景下的发现层是另一种设计，由下一章 **Part3 Ch24 assistant = viewer** 来回答：远端 Claude 如何被本地会话"附加观察"（attach）？Claude assistant 模式的本质是什么？

---

> **交叉引用**：
> - Bridge 状态双轨 → Part3 Ch12 §8
> - Bridge 地址路由 → Part3 Ch12 §14
> - Swarm teammate 通信 → Part2 Q14（多个 Claude 实例是怎么协同工作的）
> - UDS inbox 唤醒机制 → Part3 远程Agent管理 §"设计全景"
