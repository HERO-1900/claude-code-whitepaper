# Brief 通信家族与 Viewer 结构化通道完全解析

当你在 claude.ai 的 Web 界面上传一个文件、或者远程观察本地 Claude Code 执行工具的结果时，数据是怎么从一端流到另一端的？这背后涉及两个容易被忽视但架构意义重大的子系统：**Brief 通信家族**（文件/消息投递）和 **Viewer 结构化通道**（工具结果渲染）。

> 🎯 **为什么这是 Agent 工作台的必要组件？** 单机单窗口的"AI 聊天框"不需要这些机制——用户、AI、工具全在同一个进程里，直接共享内存就够了。但 **Agent 工作台**要求任务可以跨设备、跨进程、跨会话传递——Web 端的用户要能看到本地 CLI 的工具执行结果，本地 CLI 要能接收 Web 端上传的文件。这条"跨端数据通道"必须同时满足三个约束：(1) 数据结构完整（viewer 要能渲染）；(2) 不污染模型上下文（model context 很贵）；(3) 语义向后兼容（legacy 客户端不能被破坏）。Brief/Viewer 通道是 Claude Code 对这三个约束的完整答案，也是本章行业对比表中其他产品（ChatGPT Desktop、Cursor、Cline 等，以 2026 年 4 月公开资料为准）尚未触及的设计层。

> **源码位置**：`src/tools/BriefTool/`（Brief + SendUserFile 共享基础设施）、`src/utils/messages/mappers.ts`（tool_use_result 映射）、`src/remote/sdkMessageAdapter.ts`（远端结果回灌）、`src/ink/components/messages/UserToolSuccessMessage.tsx`（结果渲染）、`src/bridge/inboundAttachments.ts`（文件落盘）

> **🔑 OS 类比：** Brief 家族就像 Linux 中的 `write()` 和 `sendfile()` 系统调用——两者都负责"把数据送出去"，但 `write()` 送文本（Brief）、`sendfile()` 送文件（SendUserFile），底层共享同一个 VFS 接口但行为语义不同。

> 💡 **通俗理解**：Brief 家族就像快递公司的两种服务——"普通文本快递"（Brief：发一条消息，替换掉原来的回复）和"文件包裹快递"（SendUserFile：发一个文件，保留原来的回复上下文）。两种服务用同一个快递单系统（`attachments.ts`），但签收规则不同。

---

## 1. Brief 通信家族的双成员结构

### 两个成员，一个底座

`BriefTool`（别名 `SendUserMessage`）和 `SendUserFileTool` 同属一个家族，共享 `BriefTool/attachments.ts` 基础设施。

源码证据（`attachments.ts:2`）注释原文：
> "Shared attachment validation + resolution for SendUserMessage and SendUserFile"

在 `tools.ts` 中，两者紧邻注册。在 `Messages.tsx` 中，两者被归入同一个 `briefToolNames` 数组（见第 513 行附近的定义）。在 `conversationRecovery.ts:364-368` 中，实际上有**三个名字被并列为 terminal tool result**：`BRIEF_TOOL_NAME` + `LEGACY_BRIEF_TOOL_NAME` + `SEND_USER_FILE_TOOL_NAME`——其中 `LEGACY_BRIEF_TOOL_NAME` 是 Brief 工具的旧名字别名，为了 SDK 协议向后兼容保留，会和新名字被当作同一类工具处理。

### 关键不对称：dropText

**这是理解双成员关系的核心**。**但读者要先问一个问题：为什么需要关心 Brief 和 SendUserFile 的差异？** 答案是：如果你在 claude.ai Web 界面给远端 Claude Code 发消息或发文件，Web 和终端之间到底怎么传数据？这就是 Brief 家族要解决的——它决定了**Web 端你看到的对话记录是否会被 Claude 的下一条回复覆盖**。Brief 会覆盖（撤回+重发），SendUserFile 不会覆盖（追加附件）。这个差异看似微小，实际关系到用户每次操作后看到的界面状态是否符合预期。

现在看源码证据。**这里要看一小段代码——但请放心，你不需要学会编程，只需要看懂变量名的"意思"就够了**：

`Messages.tsx:513` 定义两个关键数组（"数组"可以理解为一个装了几个名字的清单）：
```typescript
const briefToolNames = [BRIEF_TOOL_NAME, SEND_USER_FILE_TOOL_NAME]
const dropTextToolNames = [BRIEF_TOOL_NAME]  // 只有 Brief，没有 SendUserFile
```

> 💡 **两个数组分别是什么意思？**
> - `briefToolNames` = "Brief 通信家族成员名单"——决定哪些工具在渲染时被归类为 Brief 家族。Brief 和 SendUserFile 都在这里
> - `dropTextToolNames` = "调用完成后要丢弃当前 turn 的 assistant 文本回复"——决定哪些工具触发后会让 Claude 之前说的话"作废"。只有 Brief 在这里

- **Brief**：发送替代文本。它的 turn 中，assistant 之前的回复文本被**丢弃**（`dropText`），因为 Brief 的消息本身就是新的回复——保留旧文本会造成重复
- **SendUserFile**：投递文件本体。它**保留** assistant 上下文——因为"发文件"和"之前说的话"是两件事，丢掉上下文会让后续对话失去连贯性

注释原文（`Messages.tsx:511`）："SendUserFile delivers a file without replacement text"。

> 💡 **通俗理解**：Brief 像"撤回并重新发送"（微信的撤回+重编辑），SendUserFile 像"追加附件"（邮件的"追加附件"按钮——原来的正文保留）。

[图表预留 25-A]

### SendUserFileTool 宿主目录缺失

讲完了 Brief 和 SendUserFile 的**行为差异**（dropText 不对称），还有一个关于 SendUserFile 的**实现层奇观**值得提：它在源码引用上无处不在，但实际定义文件却找不到。

`src/tools/` 下**没有** `SendUserFileTool/` 目录（经本书工作区的目录遍历确认），但 `tools.ts:42-43` 通过 `require('./tools/SendUserFileTool/SendUserFileTool.js')` 引用它。同时，`ToolSearchTool/prompt.ts`、`Messages.tsx`、`conversationRecovery.ts` 都引用它。这属于 checkout 级源码缺口（详见序章研究边界声明）——系统的"骨架"（注册、调度、渲染、恢复）都已经为它准备好，但"肌肉"（执行实现）不在当前快照中。

### Brief 与 SendUserFile 的可用性不对称（安全 trade-off）

值得注意的一个安全设计：**Brief 是无条件能力，SendUserFile 是 KAIROS 限定能力**——`tools.ts:42-44` 中 SendUserFileTool 被 `feature('KAIROS')` 硬门控。这意味着：

- **普通 CLI 用户默认不具备** SendUserFile 能力——即使 bridge 连上了
- 只有在 assistant 模式（KAIROS 启用）下才会装载这个工具
- 原因很直接：SendUserFile 涉及**文件落盘**（`~/.claude/uploads/{sessionId}/`），这是一个**写路径**——写操作的攻击面比读操作大得多，需要受控场景才开启

这是一个**有意的攻击面收窄**：Brief 只传文本，没有写文件能力，所以无条件开；SendUserFile 要写文件到本地磁盘，所以只在受控的 assistant 场景开。不要把 Brief 和 SendUserFile 当成"对称的双成员"——它们的可用性条件完全不对称。

---

## 2. file_uuid 附件闭环

Web 端上传的文件如何最终到达本地 Claude Code 的 `Read` 工具链？

### 端到端链路

> 💡 **读懂下面这张流程图的正确方法**：把它想象成一个**邮政分拣中心的物流路径图**——Web Composer 是寄件人把包裹投入邮筒，bridge/inboundAttachments.ts 是收件邮局的分拣窗口，file_uuid 是贴在包裹上的物流单号，~/.claude/uploads/ 是本地仓库，最后 Read 工具链是收件人拆包裹。下面的箭头就是包裹走的路线。

```
Web Composer 上传文件
  → 消息携带 file_uuid 字段（BriefTool.ts 中 attachments[].file_uuid）
  → bridge/inboundAttachments.ts 收到消息
  → 通过 OAuth 下载文件：GET /api/oauth/files/{uuid}/content
  → 写入本地磁盘：~/.claude/uploads/{sessionId}/
  → 转成 @"path" 交给 Claude 的 Read 工具链
```

### 不污染模型上下文

`utils/messages/mappers.ts:140-142` 注释明确写道：
> "Rides the protobuf catchall so web viewers can read things like BriefTool's file_uuid without it polluting model context"

这意味着 `file_uuid` 走的是一条**结构化 side-channel（侧信道）**——它被 protobuf catchall 携带，让 web viewer 能读取（用于展示文件预览），但不会进入模型的 context window（避免浪费 token 和干扰模型推理）。

> 💡 **先解释三个术语**：
> - **protobuf**（Protocol Buffers）：Google 设计的一种紧凑的数据传输格式，Claude Code 和远端服务器之间的消息都用它打包
> - **catchall**（兜底字段）：本项目消息映射层（`utils/messages/mappers.ts`）复用的一种约定——把不属于模型 context 的结构化数据附加在消息上一起传输。它不是 protobuf 规范本身的标准机制，而是 Claude Code 在 mappers 层为 `BriefTool.file_uuid` 与 `tool_use_result` 等字段共享的承载约定。相当于**信封上的"备注栏"**：邮局会送到，但收件人（模型）默认不看
> - **side-channel（侧信道）**：主通道之外的一条**平行传输路径**，用来送"元数据"（给系统工具看的信息）而不是正文（给模型看的内容）

> 💡 **通俗理解**：`file_uuid` 就像快递包裹上的**条形码**——物流系统（viewer）需要扫它来追踪包裹、显示预览图，但收件人（模型）不需要看条形码，只需要看包裹里面的东西。条形码和包裹一起运（side-channel），但走的是不同的"注意力通道"。

[图表预留 25-B]

### 安全 trade-off 讨论

> ⚠️ **本节面向有信息安全背景的读者**。讨论的是 file_uuid 闭环带来的攻击面分析。普通读者可以跳过——不影响理解通道本身的功能。

file_uuid 附件闭环本质上把一条"从 claude.ai 推送数据到本地文件系统"的写路径放进了 bridge 消费链。在 Ch12 讨论 Anthropic 中继服务器"单点信任锚"的语境下，这条路径的安全含义必须被明确：

- **uuid 的授权边界**：服务器签发的 file_uuid 必须由服务器侧做 per-user 授权校验——如果 uuid 可被枚举或预测，攻击者拿到 uuid 后就能让任意本地 Claude 下载文件。这是**服务器侧的信任锚**，不是本地防御能解决的
- **path traversal 防御**：写入路径 `~/.claude/uploads/{sessionId}/` 中 `sessionId` 是本地生成的随机值，不接受远端传入的路径组件——这阻止了"web 侧构造恶意 sessionId 让文件写到 `~/.claude/uploads/../ssh/` 之类的位置"的 path traversal 攻击
- **大小/类型校验**：bridge `inboundAttachments.ts` 的下载路径应该有大小限制、MIME 类型白名单、下载超时——这些是常规防御点，本书无法从源码直接验证每一项是否齐全，属于**审计待确认项**
- **信任链推理**：如果 Anthropic 的中继服务器被攻破，file_uuid 闭环意味着远端能让本地 Claude 任意下载文件到 `~/.claude/uploads/`。这条攻击面与 Ch12 §批判性分析中讨论的"Bridge 单点信任锚"共享同一个根本前提——中继服务器是整条 bridge 数据链的信任起点

---

## 3. tool_use_result：端到端结构化副通道

§2 讲的是 **Web → 本地** 的入站通道（用户上传的文件如何到达本地工具链）。但 Claude Code 是双向的——`tool_use_result` 副通道实际上涵盖**两条方向相反的链路**，共享 catchall 载体但用于不同场景。本节分别说清：

### 链路 A：本地工具结果 → Web viewer（出站）

本地工具执行完成后，结果如何送到远端 Web viewer 让用户看到：

```
① 构造
   queryHelpers.ts 构造 toolUseResult 字段
   ↓
② 传递
   utils/messages/mappers.ts 将 toolUseResult 映射为 tool_use_result
   → 通过 protobuf catchall 传递（不进模型 context）
   ↓
③ 上行
   出站经由 bridge transport 抵达 Web viewer，由 Web 侧按同一 schema 渲染
```

### 链路 B：远端 tool_result → 本地 viewer（入站）

当本地 REPL 是远端任务的观察者（assistant / remote-control / SSH / 直连模式），需要把远端产生的 tool_result 回灌成本地可渲染消息：

```
① 接收
   remote/sdkMessageAdapter.ts 在 convertToolResults:true 时
   将远端 tool_result 回灌为本地可渲染消息
   ↓
② 渲染
   UserToolSuccessMessage.tsx 通过 outputSchema.safeParse() 校验
   → 校验通过后调用 tool.renderToolResultMessage() 渲染
```

> **为什么拆成两条**：两条链路方向相反（出站 vs 入站）、触发条件不同（前者每次本地工具执行都跑，后者仅在 convertToolResults=true 的远程渲染模式下启用），但共用同一个 protobuf catchall side-channel 与 `tool_use_result` 字段名。

### outputSchema.safeParse 校验

`UserToolSuccessMessage.tsx:60` 在渲染工具结果前，先用 `tool.outputSchema?.safeParse(message.toolUseResult)` 做校验。这意味着 viewer 消费链**保持了工具原生输出契约**——不是任何 JSON 都能被渲染，必须符合工具定义的 output schema。

> 💡 **通俗理解**：tool_use_result 像一条**专用快递通道**——普通邮件（文本消息）走正常邮局，特殊包裹（工具结果）走专用物流（结构化副通道），而且签收时要核验包裹内容是否符合预期格式（safeParse）。

---

## 4. convertToolResults：远程渲染模式开关

`convertToolResults` 不是默认行为——它是一个**显式开关**，只在特定远程渲染模式下打开。

> 💡 **"远程渲染模式"指什么？** 当前 REPL 进程不是任务执行者，而是**另一台设备上任务的观察者/渲染者**——比如 `claude assistant`、`/remote-control`、SSH 会话、直连模式。这些场景的共同特征是：工具结果来自远端执行，不是本地产生的。只有远端结果才需要"翻译"成本地可渲染的消息格式（本地自己产生的结果已经在 context 里，不用转）。

### 四个显式触发点

| 触发位置 | 场景 |
|---------|------|
| `useAssistantHistory` | assistant 模式加载历史消息 |
| `useRemoteSession` (viewerOnly) | viewer 模式接收 live 增量 |
| `useDirectConnect` | 直连远端会话 |
| `useSSHSession` | SSH 隧道会话 |

`remote/sdkMessageAdapter.ts:155` 定义 `convertToolResults?: boolean`，第 185 行检查 `if (opts?.convertToolResults && isToolResult)`。

**为什么不是默认开启？** 本地 agent 自己产生的工具结果不需要转换——它已经在本地 context 中了。只有远端产生的结果才需要"翻译"成本地可渲染的消息格式。开启 convertToolResults 会增加 CPU 开销（需要 parse 每条 tool result），所以只在确实需要的四种远程场景中显式开启。

---

## 5. 跨会话消息的结构化限制

Bridge 跨会话消息**只支持纯文本**——structured message 被永久拒绝。

### 源码证据

`SendMessageTool.ts:635-641`：
```typescript
if (typeof input.message !== 'string') {
  // structured messages cannot be sent cross-session — only plain text
  return { success: false, message: '...' }
}
```

**关键细节**：这个检查发生在连接状态检查**之前**。也就是说，即使 bridge 正常连接，structured message 也会被拒绝——这不是"暂时不支持"的能力限制，而是**产品级永久语义**。

源码注释解释了原因：避免用户重连后（连接恢复）误以为 structured message 也恢复了——如果先检查连接再拒绝 structured，用户会觉得"断线时不行，重连后应该行了"，但实际上永远不行。

> 💡 **通俗理解**：就像办公室之间传纸条——只能传文字纸条（plain text），不能传复杂表格或 PPT（structured message）。这不是因为传纸条的窗户太小（临时限制），而是设计上就只支持纸条（永久语义）。

---

## 6. 行业对比：跨端数据通道的其他解法

Claude Code 的 Brief/Viewer 通道是对"跨端数据通道"这个问题的完整答案，但它不是唯一的解法。看看其他 AI 产品怎么做：

| 产品 | 跨端数据方案 | 关键差异 |
|------|------------|---------|
| **ChatGPT Desktop** | 用户在桌面 App 中上传文件，文件以附件形式直接进入对话 turn | 没有 Brief/SendUserFile 的语义分离——文件和消息混在同一个 turn 里，无法"追加文件但不覆盖正文" |
| **Cursor Chat** | 通过 Cursor IDE 本地上传，附件嵌入 Composer 消息体 | 文件-消息一体化，同样没有 dropText 不对称设计 |
| **Cline**（原 Claude Dev） | 基于 VS Code 扩展，文件通过 IDE 的文件系统 API 直接访问 | 不需要跨端通道——本地 IDE 进程直接读写本地文件 |
| **GitHub Copilot Workspace** | 用户在 Web 界面提交任务，文件通过 Git 仓库传递 | 异步批处理模式，没有"实时跨端通信"的需求 |

**Claude Code 的独特性**：在本章行业对比表覆盖的产品范围内（以 2026 年 4 月公开资料为准，不代表全行业穷尽），Claude Code 是少数**同时满足**（1）跨端异步数据通道、（2）消息覆盖/追加语义分离（dropText 不对称）、（3）side-channel 元数据通道（file_uuid 不污染 model context）**三个约束**的产品。这三个约束的同时满足，源于它的 Agent 工作台定位——单机单窗口的产品根本不需要这些机制，而云端批处理的产品又不需要实时双向交互。Claude Code 处在"本地执行 + 远程可观察 + 双向交互"的独特定位上，Brief/Viewer 通道是这个定位的必然结果。

---

## 7. 与 Bridge 章节的关系

本章和 Bridge 远程架构完全解析（Part3 Ch12）是**互补关系**：

- **Bridge 章**讲的是"管道怎么建"——握手、传输协议、JWT 认证、断线重连
- **本章**讲的是"管道里跑什么格式的货物"——Brief 消息投递、file_uuid 附件闭环、工具结果渲染通道

理解了 Bridge 的管道架构后，本章解释了管道中实际流动的数据格式和渲染链路。

---

## 批判性分析

### 优点

1. **Brief/SendUserFile 共享底座但语义分离**是优雅的设计——attachments.ts 不需要复制两份，但 dropText 行为通过一行配置精确区分
2. **file_uuid 的 side-channel 设计**避免了模型 context 的污染——文件元数据只对 viewer 可见，不浪费 token
3. **outputSchema.safeParse 校验**保证了 viewer 不会渲染格式不对的结果——从源头到消费端保持了类型安全
4. **structured message 的永久拒绝**通过 validateInput 顺序明确了设计意图——不留"也许以后会支持"的模糊空间

### SendUserFile 的四面收敛

尽管 SendUserFileTool 的执行宿主在当前快照中缺失，它在系统中的**地位**已经通过四个独立消费面完全确立：

1. **ToolSearch 面**：`ToolSearchTool/prompt.ts` 用 `isReplBridgeActive()` 控制其即时可用性——不需要 ToolSearch 中转
2. **Recovery 面**：`conversationRecovery.ts` 将其与 Brief 并列为 terminal tool result——恢复会话时能识别并正确处理
3. **Transcript 面**：`Messages.tsx` 的 `briefToolNames` 数组包含它——对话历史渲染时被当作 Brief 家族成员处理
4. **Viewer/Attachment 面**：`file_uuid` 通过 protobuf side-channel 传递，让 web viewer 能渲染文件预览

四面收敛意味着：即使执行宿主不在，系统**已经为它预留了完整的生态位**。一旦宿主回归，从消费侧已构建的接口契约来看，预期可以无缝接入——但"完全无需改动消费侧"是对当前快照的推断，不是源码可直接验证的事实。

### 代价

1. **SendUserFileTool 目录缺失**是当前源码快照中最显著的工具级缺口——系统知道它存在、知道怎么注册、知道怎么恢复，但执行宿主不在
2. **convertToolResults 的显式开关设计**增加了远程场景的配置复杂度——如果遗漏了某个需要开启的场景，工具结果就会变成不可渲染的空数据
3. **plain text only 的限制**使得跨会话通信只能传递文本——如果未来需要传递结构化数据（如 code block with metadata），需要在文本层面实现二次编码

---

### 本章在全书中的位置

本章是 Ch23（Peer/Session 发现层）→ Ch12 Bridge 架构 → Ch24（assistant=viewer）这一条"跨端通信基础设施"叙事链的**压轴章**——Ch23 回答"本地多实例如何发现彼此"，Ch12 回答"本地与远端如何建立管道"，Ch24 回答"如何 attach 到远端会话"，本章回答"管道里跑什么格式的数据"。这四章共同构成了 Claude Code 跨端通信的完整图景。接下来的章节（Ch26 及之后）回到本地核心系统——子系统分析将转向记忆、权限、工具等更纵向的主题。

---

> **交叉引用**：
> - Bridge 架构 → Part3 Ch12
> - assistant = viewer → Part3 Ch24
> - 发送契约 vs 状态面 → Part3 Ch12 §15
> - Peer 地址路由 → Part3 Ch12 §14 / Ch23 §7
