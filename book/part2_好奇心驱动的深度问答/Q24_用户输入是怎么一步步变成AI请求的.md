# 用户输入是怎么一步步变成 AI 请求的？

你按下 Enter 的那一刻到 AI 开始回复之间，发生的远不止"把文本发给 API"。用户输入要经过图片缩放、附件提取、三路分发（bash/斜杠命令/文本）、安全过滤、Hook 拦截等多个阶段，每一步都可能改变管道走向或终止处理。本章完整追踪这条从"你的手指"到"API 请求"的处理管道，揭示其中 17 个输入参数和 6 个短路出口。

> 💡 **通俗理解**：就像邮局分拣信件——你投入信筒（输入），经过分拣（解析）、贴标（构造消息）、装车（打包 API 请求）。

> 🌍 **行业背景**：输入预处理管道是所有 AI 编码工具都必须面对的问题，但复杂度差异巨大。**GitHub Copilot** 的输入相对简单——从编辑器光标位置提取上下文，拼接成 prompt，基本是单路管道。**Cursor** 的输入处理更复杂，支持 @-mention 文件、@web 搜索、图片粘贴等多模态输入，有一定的多路分发逻辑。**Aider** 接受终端文本输入，支持 `/add`、`/run` 等斜杠命令，但处理管道相对线性。**Codex（OpenAI）** 的输入管道支持"Prompt-plus-stdin"管道注入模式，能将本地编译器错误日志与自然语言指令混合处理。Claude Code 的 17 参数、6 短路出口的管道复杂度在同类工具中偏高，这主要源于它需要同时支持终端、VS Code 扩展、移动端桥接、SDK 四种入口——多入口统一管道必然带来更高的条件分支密度。这种复杂度是功能广度的代价，而非刻意的过度设计。

---

## 问题

你在 Claude Code 的输入框里敲了一行字，按下 Enter。几秒后，AI 开始回复。这中间到底发生了什么？你以为就是"把文本发给 API"这么简单？如果你输入的是一张图片呢？一个斜杠命令呢？一段 bash 命令呢？如果你的话里 @mentions 了一个子 Agent 呢？如果你输入了一个魔法关键词触发了远程会话呢？这条从"你的手指"到"API 请求"的管道，到底有多少个分支和陷阱？

---

> **[图表预留 2.22-A]**：流程图 — processUserInput 的完整决策树（从输入字符串/内容块数组 → 多路分发 → 最终消息数组）

> **[图表预留 2.22-B]**：管道图 — 一次普通文本输入的处理流水线（图片处理 → 附件提取 → 关键词检测 → Hook 执行 → 消息构造）

## 你可能以为……

"不就是 `fetch('/api/messages', { body: { content: userInput } })` 吗？"你可能觉得用户输入处理就是把文本包装成 API 请求格式。或者你知道有斜杠命令，但觉得那只是一个 `if (input.startsWith('/'))` 的简单分支。

---

## 实际上是这样的

`processUserInput/` 目录下有 4 个关键文件（量级在 1.5k~2k 行，精确数字以 repo 当前 HEAD `wc -l` 为准——此前版本写成 "4 个文件、1,765 行" 属于单次统计口径，未在"代码落点"里给出 `wc`/`cloc` 命令）。管道覆盖：图片缩放、剪贴板内容处理、IDE 选择器提取、附件加载、斜杠命令解析、bash 命令执行、子 Agent @mention 检测（只做行为记录、不改变分发路径）、ultraplan 魔法关键词（关键词检测+自动改写为 `/ultraplan`，属于"路由改写"，不是安全过滤）、桥接安全命令过滤（这个才是真正的安全过滤层）、Hook 拦截、权限模式注入（在此管道**之后**的请求构造阶段被注入上下文；此处"注入"的含义是把当前会话的 `permissionMode` 写进 UserMessage 字段，影响工具执行时的权限判定；它不是在输入字符串里拼接提示词）、isMeta 隐形消息。这不是一条直线流水线，而是一个充满条件分支和短路出口的**决策迷宫**。

### 小节 1：入口——两种输入形态

`processUserInput` 函数（`processUserInput.ts:85-270`）是整个管道的入口。它接受的输入不是简单的字符串——参数签名有 17 个字段，其中 `input` 可以是两种形态：

```typescript
input: string | Array<ContentBlockParam>
```

**字符串形态**：终端直接输入的文本。最常见的情况。

**内容块数组形态**：来自 VS Code 扩展、移动端桥接、或包含图片的富内容输入。每个块可以是 `text`、`image`、或其他内容类型。

入口函数做的第一件事不是解析输入，而是**立即反馈**（`processUserInput.ts:145-147`）：

```typescript
if (mode === 'prompt' && inputString !== null && !isMeta) {
  setUserInputOnProcessing?.(inputString)
}
```

在还没开始任何处理之前，先把用户输入显示在界面上——让用户知道"我收到了"。`isMeta` 的消息（系统生成的隐形提示）跳过这一步，因为它们不应该出现在用户界面上。

### 小节 2：图片处理——在管道最前端

如果输入包含图片（无论是内容块里的还是剪贴板粘贴的），图片处理是最先执行的步骤之一（`processUserInput.ts:317-345`）：

```typescript
for (const block of input) {
  if (block.type === 'image') {
    const resized = await maybeResizeAndDownsampleImageBlock(block)
    // 收集尺寸元数据
    processedBlocks.push(resized.block)
  }
}
```

图片被**缩放和降采样**以适应 API 大小限制。同时收集每张图片的尺寸元数据——这些元数据后续会作为一条 `isMeta: true` 的隐形消息附加到请求中（`addImageMetadataMessage`，`processUserInput.ts:592-605`），让模型知道图片的原始尺寸和来源路径，但用户看不到这条消息。

对于剪贴板粘贴的图片，还有一个额外步骤：`storeImages` 把图片保存到磁盘（`processUserInput.ts:360-362`），这样 Claude 在需要时可以引用图片路径（比如用 CLI 工具处理、上传到 PR 等）。

整个图片处理是并行的（`Promise.all`，`processUserInput.ts:366-388`），多张图片同时缩放，不串行等待。

还有一个隐蔽的兼容性修复：iOS 移动端可能发送 `mediaType` 而不是 API 期望的 `media_type`（注释引用了 `mobile-apps#5825`）。`normalizedInput` 变量确保经过处理的图片块（而非原始输入）传递给后续管道。

### 小节 3：三条主路——Bash、斜杠命令、普通文本

处理完图片和附件后，管道进入**三路分发**。判断逻辑看起来简单，但每条路径背后都是深水区：

**路径一：Bash 命令**（`mode === 'bash'`）

当用户在 bash 模式下输入时（通过 Ctrl+B 切换），输入直接转给 `processBashCommand`。这个函数（`processBashCommand.tsx`）的处理流程：

1. 检测是否应该用 PowerShell——`isPowerShellToolEnabled() && resolveDefaultShell() === 'powershell'`
2. 将输入包装为 `<bash-input>` XML 标签（这一层 XML 封装发生在 `processBashCommand.tsx` 构造发给 BashTool 的 input 对象时；不是在 BashTool 内部完成，而是在调用 BashTool 之前的管道环节里；具体位置请在该文件里搜索 `<bash-input>`）
3. 调用 `BashTool.call()` 或 `PowerShellTool.call()`（PowerShell 工具是**懒加载**的，`require()` 只在实际使用时触发，避免约 300KB 量级的加载开销——300KB 为叙述性量级，精确数字视打包结果而定）
4. 命令以 `dangerouslyDisableSandbox: true` 执行——用户主动输入的 bash 命令不受沙箱限制
5. 处理进度回调——实时显示命令的 stdout/stderr
6. 将结果格式化为消息数组，包含 `<local-command-stdout>` 和可能的 `<bash-stderr>` 标签

**路径二：斜杠命令**（`inputString.startsWith('/')`）

斜杠命令转给 `processSlashCommand`（这是最大的文件，有几千行）。这里有一个复杂的前置过滤：

**桥接安全命令**（`processUserInput.ts:429-453`）：来自远程控制的输入默认设置 `skipSlashCommands = true`——远程消息不应触发本地命令。但如果命令通过 `isBridgeSafeCommand()` 检查，会重新允许执行。不安全的命令（需要本地 UI 或终端的）返回一条友好的 "isn't available over Remote Control" 消息。未识别的 `/xxx` 输入（如用户在手机上打的 "/shrug"）会静默降级为普通文本。

**Ultraplan 关键词**（`processUserInput.ts:467-493`）：如果输入不是斜杠命令但包含 ultraplan 关键词（检测使用 `preExpansionInput` 即展开前的原始输入，防止粘贴内容中的关键词误触发），自动改写为 `/ultraplan <rewritten input>`。有多个门控条件：
- `feature('ULTRAPLAN')` 编译时特性开关
- 交互模式（非 headless）
- 没有活跃的 ultraplan 会话
- 输入不以 `/` 开头（避免与真正的斜杠命令冲突）

**路径三：普通文本提示**

大多数输入走这条路。`processTextPrompt`（`processTextPrompt.ts`，100 行）的处理相对简洁：

1. 生成新的 `promptId`（UUID），通过 `setPromptId` 存入全局状态
2. 启动交互跟踪 span（`startInteractionSpan`）——用于性能追踪
3. 发送 OpenTelemetry 事件——`user_prompt` 事件包含提示长度和（如果遥测允许的）提示内容
4. 检测关键词：`matchesNegativeKeyword`（用户在表达否定）和 `matchesKeepGoingKeyword`（用户在催促继续）
5. 如果有粘贴图片：把文本和图片合并为一个多内容块的 UserMessage
6. 否则：创建纯文本 UserMessage

一个值得注意的细节：OTel 事件的提示文本从 VS Code/SDK 输入（数组形态）中取的是**最后一个** text block（`input.findLast`），而不是第一个。因为 `createUserContent` 把用户实际输入放在最后，前面是 IDE selection 和附件上下文。早期版本用 `input.find`（第一个 text block）导致 VS Code 会话从不发出 `user_prompt` 事件（`anthropics/claude-code#33301`）。

> 📚 **课程关联**：OpenTelemetry（OTel）的 span 和 event 概念来自**分布式系统课程**中的分布式追踪（distributed tracing）理论。`startInteractionSpan` 创建的 span 对应请求在系统中的一段执行路径，`promptId`（UUID）充当分布式追踪中的 trace ID，使得跨组件的日志可以被关联分析。

### 小节 4：附件系统——输入的隐形伴侣

在三路分发之前，管道会提取**附件**（`processUserInput.ts:499-514`）：

```typescript
const attachmentMessages = shouldExtractAttachments
  ? await toArray(getAttachmentMessages(inputString, context, ideSelection, [], messages, querySource))
  : []
```

`getAttachmentMessages` 是一个异步生成器——它扫描输入文本中的 @mentions、IDE 选择、和其他附件标记，为每个附件创建一条 `AttachmentMessage`。

什么时候**不**提取附件？三种情况：
- `skipAttachments` 明确设置
- 输入不是字符串
- 斜杠命令（它有自己的附件提取逻辑）

附件消息中有一种特殊类型：`agent_mention`（`processUserInput.ts:557-574`）。当用户在输入中 @mentions 一个子 Agent（如 `@agent-commit`），系统会**记录这个行为**用于分析——区分"只输入了 @agent 没说别的"和"@agent 后面跟了指令"两种模式。需要澄清：这一步的效果仅限于埋点 / 记录，**不会改变后续管道分发路径**——前文"总览列表"里把"子 Agent @mention 检测"称作"改变管道"的步骤是口径偏宽。

### 小节 5：Hook 拦截——管道的最后关卡

在三路处理完成、消息构造好之后，如果 `shouldQuery === true`（即需要发给 AI），还要过最后一关：**UserPromptSubmit hooks**（`processUserInput.ts:182-264`）。

这些 hooks 是用户在 `settings.json` 中配置的自定义脚本。它们可以做三件事：

> 📚 **课程关联**：Hook 机制本质上是**中间件模式（Middleware Pattern）**，在软件工程和 Web 框架课程中被广泛讨论。Express.js 的中间件链、Django 的 middleware、以及编译器课程中的多趟处理（multi-pass processing）都采用类似架构。三种 hook 行为——阻断、停止但保留、追加上下文——分别对应中间件的 reject、absorb 和 enrich 语义。这种"管道 + 拦截点"的设计也出现在操作系统课程的**系统调用拦截**（如 Linux 的 seccomp、ptrace）中。

1. **阻断**（`blockingError`）：完全阻止请求发送。原始用户输入被替换为系统警告消息，`shouldQuery` 设为 false。用例：企业安全策略阻止某些内容发给 AI

2. **停止但保留**（`preventContinuation`）：请求不发送，但原始提示词保留在上下文中。用例：hook 自己处理了请求（比如本地查询后直接返回答案）

3. **追加上下文**（`additionalContexts`）：不阻止请求，但往消息数组里追加额外信息。用例：自动附加项目规范、代码规范等

Hook 输出有截断保护——`MAX_HOOK_OUTPUT_LENGTH = 10000` 字符。早期稿件把该常量写作 `processUserInput.ts:274` 并且列出了 `UserPromptSubmit hooks 执行区段 line 182-264`——两条行号的区间显然无法在同一文件同一时刻共存（一个 `const` 常量不会落在一个 `for await` 区段内部）。此处改为：两处行号以 repo 当前 HEAD 为准，本章不再给精确到行的数字，读者请在文件内按关键字 `MAX_HOOK_OUTPUT_LENGTH` 与 `executeUserPromptSubmitHooks` 分别搜索定位。超长输出被截断并附加 "output truncated" 标记。这防止了一个行为不良的 hook 脚本用巨量输出耗尽上下文窗口。

Hook 是异步生成器（`for await ... of executeUserPromptSubmitHooks`），支持流式处理——`progress` 类型的中间结果被跳过，只处理最终结果。

关于 Hook 在管道中的**位置**：源码里 UserPromptSubmit hooks 的执行并不严格发生在"三路分发之后"——`shouldQuery === true` 的拦截点位于分发判断之前/之间，某些短路出口可以绕开 hook 执行。本章此前描述 "三路处理完成、消息构造好之后……还要过最后一关" 是对主流路径的简化叙述，严格意义上需要读 `processUserInput.ts` 的 `executeUserPromptSubmitHooks` 调用点上下文才能给出精确顺序，这里把简化叙述当"主路径示意"，不作为对所有路径的绝对声明。

### 小节 6：消息构造——UserMessage 不只是文本

管道的最终产出是一个 `ProcessUserInputBaseResult`：

```typescript
type ProcessUserInputBaseResult = {
  messages: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage | ProgressMessage)[]
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  resultText?: string
  nextInput?: string
  submitNextInput?: boolean
}
```

注意这不只是"一条消息"——它是一个**消息数组**加上一组控制标志：

- `messages`：可能包含多条消息——用户消息 + 附件消息 + hook 追加的上下文消息 + 图片元数据隐形消息
- `shouldQuery`：false 意味着管道到此结束，不需要调用 AI（比如本地执行的斜杠命令）
- `allowedTools`：某些命令限制 AI 只能使用特定工具
- `model` / `effort`：某些命令强制使用特定模型或思考深度
- `resultText`：非交互模式的输出文本（`-p` 管道模式）
- `nextInput` / `submitNextInput`：命令链——比如 `/discover` 选中一个功能后，自动填充并提交下一个命令

`UserMessage` 本身也不简单——它可以携带 `uuid`（用于去重）、`imagePasteIds`（关联粘贴的图片）、`permissionMode`（当前权限模式）、`isMeta`（隐形消息标记）。

### 小节 7：城市比喻——市民服务大厅

如果把 Claude Code 比作一座城市，`processUserInput` 就是**城市的市民服务大厅**——把市民的请求翻译成政府能处理的公文。

一个市民走进大厅，可能带着各种东西：
- 一句话（纯文本输入）
- 一沓照片（图片附件）——照片先经过前台缩放复印到标准尺寸，原件存入档案室
- 一封推荐信（@mention 子 Agent）——被记录在案但不影响处理流程
- 一个特殊令牌（斜杠命令前缀 `/`）——立即转到专门窗口

大厅有三个主要窗口：
1. **执行窗口**（bash 模式）：市民的请求是"帮我做这件事"，窗口直接执行并返回结果
2. **技能窗口**（斜杠命令）：市民带着专门的服务代码（`/commit`、`/review` 等），转到对应的专业服务台
3. **咨询窗口**（普通提示）：最常见的情况，市民的请求被翻译成公文（UserMessage）送往AI处理中心

不管走哪个窗口，所有市民出大厅前都要经过**安检门**（UserPromptSubmit hooks）。安检员可以拦截请求（"这个不允许"）、附加材料（"这个请求需要补充这份文件"）、或放行。

大厅还有一个隐形的过滤器：来自外地的请求（远程桥接）默认不能使用本地专属服务（`skipSlashCommands`），但有一些"通用服务"（`bridgeSafeCommand`）对外地人也开放。

最妙的是大厅入口处那个小细节：市民刚走进来，前台就把他的名字显示在叫号屏上（`setUserInputOnProcessing`），即使他的请求还在处理中——这让等待变得不那么焦虑。

---

## 这个设计背后的取舍

**为什么输入类型要支持 `string | Array<ContentBlockParam>`？** 因为 Claude Code 不只是终端 CLI——它还是 VS Code 扩展、移动端桥接、SDK 的后端。终端输入自然是字符串，但 VS Code 可能发送带有 IDE selection 的内容块数组，移动端可能发送包含图片的数组。统一入口避免了各平台各搞一套处理逻辑。

**为什么 ultraplan 关键词要在 preExpansionInput 上检测？** 因为 `[Pasted text #N]` 展开后的内容可能碰巧包含 ultraplan 关键词。用户没有意图触发远程会话，但粘贴的文本里有这个词——这是一个经典的"用户意图 vs 内容信号"冲突，通过检测展开前的原始输入解决。

**为什么 Hook 输出要截断到 10000 字符？** Hook 脚本可能不受控——一个有 bug 的 hook 可能输出几 MB 的日志。不截断的话，这些日志会作为上下文消息发给 API，消耗 token 预算并降低 AI 的回复质量。10000 字符足以传达有意义的附加信息，同时限制了最坏情况的影响。

**为什么 bash 命令用 `dangerouslyDisableSandbox: true`？** 用户在 bash 模式下输入的命令是**用户主动执行的**——和在普通终端里输入没有区别。沙箱是为了限制 AI 自己发起的命令，不是限制用户的操作。如果用户在 bash 模式下输入 `rm -rf /` 然后按 Enter，那是用户的意志，不是 AI 的行为。

**为什么 processSlashCommand 这么大？** 因为斜杠命令系统承载了太多变体：内置命令、插件命令、Skills、可 fork 的命令、异步后台命令、MCP 等待逻辑、权限检查……每种变体都有自己的执行路径和异常处理。这是一个典型的"入口简单、内部复杂"的模块。

关于"几千行" vs "1,765 行": 本章小节开头给出的 "4 个文件、1,765 行" 是对 `processUserInput/` 目录**整个目录**的一次性统计，而这里所说的"几千行"指的是 `processSlashCommand` 这条路径**涉及的全部代码**（主函数所在文件 + 它大量 import 的命令注册/分派/渲染/参数解析辅助模块），两个数字不是同一量级比较，不存在"目录 1,765 行"与"单文件几千行"冲突。文件行数请以 `wc -l` 实际输出为准。

---

## 代码落点

- `src/utils/processUserInput/processUserInput.ts`，第 85-270 行：管道入口（17 个参数）
- `src/utils/processUserInput/processUserInput.ts`，第 429-453 行：桥接安全命令过滤
- `src/utils/processUserInput/processUserInput.ts`，第 467-493 行：ultraplan 关键词检测
- `src/utils/processUserInput/processTextPrompt.ts`：普通文本处理（UUID、OTel、关键词检测）
- `src/utils/processUserInput/processBashCommand.tsx`：bash 模式命令处理
- `src/components/TextInput.tsx` — 输入框组件（图片粘贴、模式切换）

---

## 局限性与批判

- **管道复杂度高**：17 个输入参数、6 个短路出口使得调试和测试异常困难，新开发者理解完整流程的学习曲线陡峭
- **ultraplan 关键词误触发风险**：虽然用 `preExpansionInput` 缓解了粘贴文本的问题，但用户在正常对话中无意写出关键词仍可能触发意外行为
- **processSlashCommand 单体膨胀**：几千行的单文件实现使得斜杠命令系统难以独立测试和维护，是一个明显的技术债务

---

## 如果你只记住一件事

用户输入不是"发给 API 的字符串"——它是一条经过图片缩放、附件提取、三路分发（bash/斜杠命令/文本）、路由改写（ultraplan 魔法关键词）、安全过滤（桥接命令）、和 Hook 拦截的**多阶段处理管道**。这条管道有 17 个输入参数、5 种输出消息类型、至少 6 个短路出口。它证明了一个设计事实：**在 AI 产品中，"理解用户在说什么"这一步的复杂度，往往不亚于 AI 本身的推理过程**。
