# Claude 在你打字的时候偷偷在做什么？

当你还在思考下一条消息时，Claude Code 已经在偷偷干活了。它借鉴了 CPU 分支预测的经典思想，预测你最可能说的话，并提前启动完整的 AI 推理循环——如果猜对了，响应延迟直接归零。本章揭示投机执行（Speculation）系统的完整机制，包括 Copy-on-Write 文件隔离、管道化预测和 prompt cache 复用策略。

> 💡 **通俗理解**：就像餐厅服务员在你翻菜单时，已经根据你常点的菜预先备好了食材。

### 🌍 行业背景

"在用户思考时提前执行"这一思路在 AI 编码工具中正逐步浮现，但各家的实现深度差异巨大：

- **Cursor（Tab 补全）**：在你打字时实时预测下一段代码补全，但本质是 token 级别的预测，不涉及完整的 Agent 推理循环。它的"预测"更接近 IDE 自动补全的增强版，没有 Copy-on-Write 文件隔离层。
- **GitHub Copilot**：Agent Mode 已全面 GA，内置 Explore、Plan、Task 等专职智能体，但其设计侧重于意图驱动的自主工程，而非"预测用户下一步并提前执行"的投机执行范式。
- **Windsurf（Cascade）**：Cascade Engine 的持续状态感知能够实时跟踪开发者的光标位置、文件切换历史和终端输出轨迹，实现亚秒级"预测性编辑（Predictive Edits）"——在开发者打出需求的前几个字时即可预判跨文件联动修改。这是 UI 层面的预测编辑，与 Claude Code 在后台启动完整 Agent 推理循环的投机执行是不同层面的优化。
- **Aider**：纯终端工具，没有任何投机执行机制，每次交互都是同步的请求-响应模式。
- **Codex（OpenAI）**：采用并行 Agent 工作流以及内部称为 mailbox 的任务间通信模式（Codex v0.118.0 的公开说明；中文社区常译为"邮箱"），侧重于多任务异步处理而非单轮交互的提前预测。

Claude Code 的投机执行是目前公开可见的 AI 编码工具中最接近 CPU 分支预测思想的实现——不仅预测用户意图，还提前执行完整 Agent 循环并通过 COW 文件系统隔离副作用。不过需要注意，这一功能目前仅限 Anthropic 内部用户，尚未经过大规模外部验证。

---

## 问题

当 Claude Code 给你回了答案，你还没来得及打下一条消息，它已经开始干活了。这不是科幻——代码里有一个完整的 `speculation.ts` 模块，叫"投机执行"。这个东西是什么，怎么工作的？

---

## 你可能以为……

你可能以为 AI 应用的延迟只能靠更快的模型或更快的网络来改善——用户等待的时间等于"发请求 + 模型推理 + 网络回传"。这个公式看起来没什么可以优化的。

但 Claude Code 借鉴了 CPU 设计的一个经典技巧。

---

## 实际上是这样的

> **[图表预留 2.6-A]**：投机执行时间轴对比——上轨道：传统方式（等你打完才开始）；下轨道：投机执行（你打字时 AI 已在跑），清晰展示"命中时延迟≈0"的收益

### 两步预测：先猜你说什么，再提前做事

**第一步：提示词预测（Prompt Suggestion）**

每次 Claude 回答完你的问题，系统立刻启动一个"预测 Agent"，专门预测你接下来最可能说什么：

```
[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]
...
THE TEST: Would they think "I was just about to type that"?

EXAMPLES:
User asked "fix the bug and run tests", bug is fixed → "run the tests"
After code written → "try it out"
Claude offers options → suggest the one the user would likely pick
Task complete, obvious follow-up → "commit this" or "push it"

Format: 2-12 words, match the user's style. Or nothing.
```

这个预测 Agent 会输出 2-12 个 **word**（英文单词）的建议，比如 "run the tests"、"yes go ahead"、"commit this"——prompt 字面量是 "2-12 words"，中文阅读时请把"word"理解为英文的"一个词"而不是"一个汉字"。它被展示在输入框附近，你可以一键接受。

**第二步：投机执行（Speculation）**

一旦有了预测建议，系统不只是把它显示给你——它还立刻以这条建议为输入，**启动一个完整的 AI 推理循环**，假装你已经发送了这条消息。这就是"投机执行"。

### Copy-on-Write 覆盖文件系统

> 📚 **课程关联**：Copy-on-Write 是《操作系统》课程中的经典概念——Linux 的 `fork()` 系统调用就使用 COW 机制：父子进程共享物理内存页，只在某一方写入时才复制。Docker 的 OverlayFS 也是同一思想的文件系统级实现。Claude Code 在用户态构建了一个轻量级的覆盖文件系统，原理与 OverlayFS 的"上层/下层"模型几乎一致。

投机执行不能随意修改文件，否则预测错误时会产生脏数据。系统设计了一个 Copy-on-Write 覆盖文件系统：

```
主目录：~/my-project/
覆盖层：~/.claude/tmp/speculation/<PID>/<UUID>/

写操作（Edit/Write）：
  → 先把原文件复制到覆盖层
  → 修改写入覆盖层（主目录不变）

读操作（Read/Grep/Glob）：
  → 如果文件已在覆盖层（被本次投机修改过）→ 从覆盖层读
  → 否则 → 从主目录读（原版）
```

投机内部看到的是一个完整一致的文件系统视图，但所有修改都被隔离在临时覆盖层里。

### 接受与丢弃

**你真的发了那条消息：**
1. 覆盖层的文件变更合并回主目录
2. 投机生成的消息直接注入会话历史
3. **不需要再发起新的模型 API 调用** — 对于这一轮用户感知到的是"瞬时响应"；但若投机内部已经暂停并在等待人工确认（下文"投机的安全边界"），接受后仍需等待被阻塞的操作继续走完
4. 系统记录节省的时间（`timeSavedMs`）

**你发了别的消息：**
1. 覆盖层静默删除，不留任何痕迹
2. 以你实际发送的消息正常发起新的 API 请求

### 投机的安全边界

投机执行不是无限制的——它会在某些操作面前主动停下来：

```
允许：
  Read, Glob, Grep, ToolSearch — 只读操作，总是允许
  Edit/Write — 如果当前是 acceptEdits 或 bypassPermissions 模式
  Bash — 只允许只读命令（如 ls、cat）

遇到这些时，停止投机并记录边界：
  非只读 Bash → 记录命令，中止
  需要确认的文件编辑 → 记录文件路径，中止
  其他工具 → 记录工具名，中止

上限：最多 20 轮 AI 推理，100 条消息（源码常量：`src/services/PromptSuggestion/speculation.ts:58-59` `MAX_SPECULATION_TURNS = 20` / `MAX_SPECULATION_MESSAGES = 100`）
```

当投机遇到需要人工确认的操作时，它会"停在那里"——记录下它打算做什么，等你接受后再继续。

### 管道化预测

投机完成后，系统还会做一件事：**立刻开始预测"接受这次投机之后你会说什么"**。这样，一旦你接受了当前的建议，下一个建议和下一次投机也已经在路上了，形成一条预测流水线。

---

## 这背后是 CPU 投机执行思想

> 📚 **课程关联**：这里的投机执行直接对应《计算机体系结构》课程中的**分支预测与推测执行**（Speculative Execution）章节。CPU 的乱序执行流水线在遇到条件分支时，通过分支目标缓冲器（BTB）和分支历史表（BHT）预测跳转方向，提前执行预测路径上的指令，若预测正确则提交结果，错误则清空流水线（pipeline flush）。Claude Code 的 COW 文件系统本质上就是软件层面的"重排序缓冲区"（Reorder Buffer）——所有投机写入都暂存在隔离层，等待"提交"或"回滚"。

**CPU 的分支预测：**
```
执行 if-else 时，CPU 不等条件计算完成
→ 预测可能走哪个分支
→ 提前执行那个分支的指令
→ 预测正确：直接提交，无延迟
→ 预测错误：丢弃，重新执行，代价是几个周期
```

**Claude Code 的投机执行：**
```
AI 回答完，用户还在思考
→ 预测用户最可能发什么
→ 提前执行整个 AI 推理循环
→ 预测正确：直接注入响应，延迟为零
→ 预测错误：丢弃，正常处理用户实际输入
```

利用"等待时间"（用户思考）来"执行工作"（AI 推理），正确就提交，错误就回滚。

---

## 缓存复用的精妙之处

提示词预测 Agent 和投机 Agent 都使用与父请求**完全相同**的 API 参数（system prompt、tools、model、messages 前缀，以及 `maxOutputTokens`、`thinking.budget_tokens`、`effort` 等会影响 cache key 的"看似无关"的参数），专门为了共享父请求的 prompt cache。

为什么这很重要？如果缓存命中，这些额外的 API 调用只需要处理新增部分的 token，成本大幅下降。

有一个真实的教训：Claude Code 团队曾在内部尝试为预测 Agent 设置 `effort:'low'`（想节省成本），结果导致 prompt cache 命中率**大幅下降**，每次预测的缓存写入量**显著激增**（原书早期给出的 "92.7% → 61% · 激增 45 倍" 是团队内部某次 profiling 的一次观察值，不代表任何稳定数据，本书无法独立核实来源，故改为定性）。原因是改变了 `maxOutputTokens` 间接影响了 `thinking budget_tokens`，而这是 Anthropic API 缓存键的一部分——即使只改一个看似无关的参数，也会彻底破坏缓存复用。

---

## 这个功能现在对谁开放？

目前，投机执行是 **ant-only**（`process.env.USER_TYPE === 'ant'`），即 Anthropic 内部员工专属。

提示词建议（显示在输入框旁边）由 GrowthBook 特性门 `tengu_chomp_inflection` 控制，可能对部分外部用户开放。

这种"先对内部用户测试，再逐步推广"的模式在 Claude Code 代码库里随处可见。

---

## 从这里能学到什么

**等待时间是隐藏的工作窗口。**

任何有"人类思考时间"的交互系统，都可以考虑在这段时间里做预测和预执行：
- AI 聊天：预测用户下条消息，提前推理
- 搜索：用户还在打字，提前检索可能的结果
- IDE：用户阅读代码，提前分析可能的错误
- 数据库：当前查询还没来，提前预热缓存

关键技术是**隔离层**（确保预测错误不污染状态）和**低成本预测**（共享缓存，预测本身代价小）。

---

## 局限性与批判

- **仅限内部用户**：投机执行功能被 `USER_TYPE === 'ant'` 门控，外部用户无法体验"零延迟"响应，功能价值无法被广泛验证
- **预测准确率未知**：代码中没有公开的预测接受率数据；如果预测命中率低，额外的 API 调用和 COW 文件系统开销就变成了纯浪费
- **缓存参数耦合脆弱**：`CacheSafeParams` 要求预测 Agent 和主请求参数完全一致——任何参数调整（如 effort、maxOutputTokens）都可能破坏缓存命中率，这在本章"缓存复用的精妙之处"一节记录的 `effort:'low'` 教训中已有体现

---

## 代码落点

- `src/services/PromptSuggestion/` — 提示词预测模块目录
- `src/utils/speculation/` — 投机执行工具层
- `src/services/PromptSuggestion/speculation.ts`，第 402 行：`startSpeculation()` 函数入口
- `src/services/PromptSuggestion/speculation.ts`，第 717 行：`acceptSpeculation()` 接受逻辑
- `src/services/PromptSuggestion/promptSuggestion.ts`，第 258 行：`SUGGESTION_PROMPT` 预测提示词全文
- `src/services/PromptSuggestion/promptSuggestion.ts`，第 294 行：`generateSuggestion()` 函数
- `src/utils/forkedAgent.ts`，第 57 行：`CacheSafeParams` 类型定义和说明
- `src/state/AppStateStore.ts`，第 52 行：`SpeculationState` 和 `CompletionBoundary` 类型

---

## 还可以追问的方向

- `runForkedAgent()` 用于多少种场景？除了投机，还有 SessionMemory、compact 摘要，还有什么？
- 投机 Agent 的 `boundary` 信息在 UI 上是怎么展示的？用户能看到"投机在这里停下了，等你接受"的状态吗？
- 提示词预测对哪类对话最准确？有没有公开的数据说明预测接受率？

---

