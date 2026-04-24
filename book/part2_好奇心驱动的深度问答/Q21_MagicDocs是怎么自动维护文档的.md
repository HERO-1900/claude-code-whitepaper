# MagicDocs 是怎么自动维护文档的？

手动维护文档是开发者最头疼的事之一——代码改了，文档往往跟不上。MagicDocs 用两行 Markdown 头部激活一个后台子 Agent，让文档在你工作的间隙自动更新——新加的模块被记录，过时的描述被修正，你甚至不知道它什么时候动过手。本章解析这个"自动档案馆"从检测、注册、触发到安全隔离的完整机制。

> 💡 **通俗理解**：就像自动更新的百科全书——内容变了，文档自动跟着变。

> 🌍 **行业背景**：自动文档维护是 AI 编码工具中尚未普及的前沿方向。**GitHub Copilot**（Agent Mode 已全面 GA，内置 Explore/Plan/Task 专职智能体）和 **Cursor**（已推出 Background Agents 云端并行执行）虽然能力大幅增强，但仍没有内置的文档自动同步机制。**Aider** 支持在对话中编辑多个文件（包括文档），但需要用户主动指定，不会后台自动维护。**Windsurf (Codeium)** 的 Cascade 模式可以在上下文中感知文档，但同样没有"后台子 Agent 自动更新"这一层。传统的文档自动化工具如 **Swagger/OpenAPI** 从代码注解生成 API 文档、**TypeDoc/JSDoc** 从类型签名生成参考文档，但它们都是"从代码提取"的模板驱动方案，无法理解对话语境或设计决策。MagicDocs 的差异化在于它监听的是**对话上下文**而非代码结构——这更接近"会议纪要自动同步到文档"的范式，是一种有别于传统文档生成的新尝试。

---

## 问题

你在项目里创建了一个 Markdown 文件，第一行写了 `# MAGIC DOC: 架构总览`。之后你照常工作——改代码、讨论设计、重构模块。几个小时后你打开这个文件，发现它**自己更新了**：新加的模块被记录了，过时的描述被修正了，甚至格式都更整洁了。没有人手动编辑过它。这是怎么做到的？这个"自动档案馆"背后的机制是什么？

---

<!-- viz:start:Q21-A -->
> **[图表预留 Q21-A]**：架构图 — MagicDocs 的完整工作流（文件读取 → 头部检测 → 注册追踪 → post-sampling hook → 子 Agent 更新）
<!-- viz:end:Q21-A -->

<!-- viz:start:Q21-B -->
> **[图表预留 Q21-B]**：时序图 — 一次 MagicDocs 更新的生命周期（从对话空闲到 subagent 完成编辑）
<!-- viz:end:Q21-B -->

## 你可能以为……

"自动更新文档？大概就是在每次对话结束时，把聊天记录总结一下追加到文件末尾吧？"你可能这么想。或者你猜测是用某种模板引擎，从代码里提取注释自动生成文档。

---

## 实际上是这样的

MagicDocs 的设计远比"追加总结"复杂。它是一个**完整的后台子 Agent 系统**——用正则表达式检测魔法头部，用文件读取监听器自动注册，用 post-sampling hook 在对话空闲时触发，用一个权限严格受限的 Sonnet 子 Agent 执行实际编辑，而且这个子 Agent 能看到你完整的对话上下文。整个系统只有 2 个核心源文件（本章引用时 `magicDocs.ts` 253 行左右、`prompts.ts` 127 行左右；以 repo 当前 HEAD `wc -l` 为准），但覆盖了从发现、注册、触发、更新到安全隔离的完整生命周期。

### 小节 1："魔法头部"——两行文本激活整个系统

一切始于一个正则表达式（定义在 `magicDocs.ts:33`，消费在 `detectMagicDocHeader()` 函数里，该函数声明在 `magicDocs.ts:52-81`）：

```
/^#\s*MAGIC\s+DOC:\s*(.+)$/im
```

**重要澄清**：这个正则带 `m` 标志，`^` 会匹配**任意行的开头**而不仅仅是"文件首行"；`content.match()` 会返回第一次匹配。因此严格意义上，系统是"匹配文件中**第一处** `# MAGIC DOC: ...` 行"——只要把魔法头写在文件最前面就生效，放在文件中间也会被检测到。社区约定是写在首行，但这是**约定而非强制**，这一点下面章节继续提到的"首行检测"描述请按"首个匹配位置"理解。

检测不止于此——系统还会在头部之后查找一行可选的斜体文本（`magicDocs.ts:35`）：

```
/^[_*](.+?)[_*]\s*$/m
```

这行斜体文本就是**文档级别的自定义指令**。比如你可以写：

```markdown
# MAGIC DOC: API 变更日志
_只记录公开 API 的破坏性变更，忽略内部重构_
```

`detectMagicDocHeader` 函数（`magicDocs.ts:52-81`）解析这两部分，返回一个 `{ title, instructions? }` 对象。它允许头部和斜体指令之间有一个空行（`afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/)`），这个宽松匹配是为了容忍不同的 Markdown 排版风格。

这不是一个简单的"标记"——它是一个**双层配置协议**：标题行负责激活（必需），斜体行定义更新策略（可选）。"两行文本激活"指的是"**第一行**必选的 `# MAGIC DOC: ...` 触发整个系统，**第二行**可选的斜体指令用来微调更新行为"。这两条与前文"斜体指令可选"描述是一致的——标题行本身就足够激活系统，斜体指令是 opt-in 的增强项。用最少 1 行、最多 2 行纯 Markdown 文本，不需要任何配置文件、不需要 frontmatter、不需要 YAML。

### 小节 2：自动注册——"读到即追踪"

MagicDocs 不需要你手动注册哪些文件需要维护。它依赖一个精巧的**文件读取监听器模式**。

初始化时（`initMagicDocs`，`magicDocs.ts:242-254`），系统做两件事：

1. **注册文件读取监听器**：调用 `registerFileReadListener`，每当任何工具读取文件时触发回调
2. **注册 post-sampling hook**：在每次 AI 采样完成后触发更新逻辑

当 Claude 通过 `FileReadTool` 读取任何文件时，监听器自动检查内容是否包含魔法头部。如果匹配，就调用 `registerMagicDoc(filePath)` 注册追踪——将文件路径存入一个 `Map<string, MagicDocInfo>`（`magicDocs.ts:42`）。

这意味着：**你不需要做任何额外操作**。只要 Claude 在对话过程中读到了一个带魔法头部的文件——无论是你让它读的，还是它在搜索代码时偶然读到的——这个文件就被纳入了自动维护名单。

注册逻辑有一个关键的幂等性保护（`magicDocs.ts:89`）：`if (!trackedMagicDocs.has(filePath))` ——同一个文件只注册一次。但 hook 在触发时总是**重新读取文件最新内容**，重新检测头部和指令，所以你可以随时修改斜体指令行来改变更新策略。

还有一个隐藏的限制：整个 MagicDocs 功能**只对 Anthropic 内部用户开放**（`magicDocs.ts:243`）：

```typescript
if (process.env.USER_TYPE === 'ant') {
```

这是一个内部先行实验的信号——功能完整但尚未公开发布。**`USER_TYPE === 'ant'` 这个常量解释为"内部 Anthropic 员工开关"是基于源码其它处同名常量的惯例（见本书多处 ant-only 门控讨论）；它在源码里是 `process.env.USER_TYPE`，在外部构建下取值 `'external'`，所以 `=== 'ant'` 永为 false、功能对外部用户不可见——这一点是运行时可验证的行为，但"只给 Anthropic 员工"这个具体语义是根据 `ant` 字面量惯例的推断，源码没有一句话注释明确说这点。

### 小节 3：触发时机——"只在对话空闲时更新"

MagicDocs 的更新**不是**每次文件被修改就触发的。它使用了一个精心设计的 post-sampling hook（`magicDocs.ts:217-240`），有三个层层过滤的条件：

**条件一：只在主线程触发**

```typescript
if (querySource !== 'repl_main_thread') {
  return
}
```

子 Agent 的采样不会触发 MagicDocs 更新——否则 MagicDocs 的更新子 Agent 自己也会触发 MagicDocs 更新，导致无限递归。

**条件二：只在对话空闲时触发**

```typescript
const hasToolCalls = hasToolCallsInLastAssistantTurn(messages)
if (hasToolCalls) {
  return
}
```

如果 AI 的最后一个回复包含工具调用，说明它还在"工作中"——可能还要继续调用更多工具。只有当 AI 回复了纯文本（没有工具调用）时，才意味着一个工作单元结束了，现在是安全的更新时机。

**条件三：有文档需要更新**

```typescript
if (docCount === 0) {
  return
}
```

如果没有注册任何 MagicDoc，直接跳过。

这个"空闲时更新"策略意味着 MagicDocs 永远不会打断你的工作流。它是真正的后台任务——在你和 Claude 的对话间隙，悄悄地把新信息整合到文档中。

> 📚 **课程关联**：MagicDocs 的触发机制是经典的**事件驱动架构**（软件工程课程）。post-sampling hook 对应观察者模式（Observer Pattern），文件读取监听器是发布-订阅的变体。`sequential()` 包装器解决的是**并发控制**问题（操作系统课程）——本质上是一个互斥锁（mutex），确保对共享资源（文档文件）的串行访问，避免竞态条件（race condition）。

整个 hook 还被 `sequential()` 包装（`magicDocs.ts:217`），这意味着即使多个采样快速完成，更新也会排队串行执行——不会出现两个子 Agent 同时编辑同一个文件的竞态条件。

### 小节 4：子 Agent——权限最小化的编辑者

实际执行更新的是一个**子 Agent**——通过 `runAgent` 函数创建，运行 Sonnet 模型。这个子 Agent 的配置极其精简（`magicDocs.ts:99-109`）：

```typescript
function getMagicDocsAgent(): BuiltInAgentDefinition {
  return {
    agentType: 'magic-docs',
    tools: [FILE_EDIT_TOOL_NAME], // 只允许 Edit
    model: 'sonnet',
    source: 'built-in',
  }
}
```

注意这里的**权限最小化设计**（最小权限原则 / Principle of Least Privilege 是操作系统安全的基础概念）：

1. **只有一个工具**：`FILE_EDIT_TOOL_NAME`（即 `Edit` 工具）。不能读文件，不能执行命令，不能搜索代码——只能编辑
2. **只能编辑一个文件**：`canUseTool` 回调函数（`magicDocs.ts:172-193`）进一步限制，即使使用 Edit 工具，也只允许编辑当前 MagicDoc 的路径。编辑其他任何文件都会被拒绝
3. **用 Sonnet 而非 Opus**：选择更轻量的模型，因为文档更新不需要最强的推理能力

子 Agent 运行时能看到什么？关键在于 `forkContextMessages: messages`（`magicDocs.ts:201`）——它能看到**你的完整对话历史**。这意味着它知道你们讨论了什么、改了什么代码、做了什么决定。但它不是简单地"总结对话"——提示词要求它从对话中提取**与文档主题相关的新信息**。

更新前还有一个巧妙的处理：系统会 clone 一份 `FileStateCache`，然后删除当前文档的缓存条目（`magicDocs.ts:124-125`）。为什么？因为 `FileReadTool` 有去重逻辑——如果文件内容没变就返回 `file_unchanged` 存根。但 MagicDocs 需要**实际内容**来重新检测头部和指令，所以必须绕过这个缓存。

### 小节 5：提示词工程——"不是写日志，是维护活文档"

`prompts.ts` 的提示词模板（整个文件 127 行）是 MagicDocs 质量的关键。它不是简单地说"更新这个文件"，而是定义了一套完整的**文档哲学**：

**核心原则——"保持当前状态，不记录历史"**：

> "Keep the document CURRENT with the latest state of the codebase - this is NOT a changelog or history"
> "Update information IN-PLACE to reflect the current state - do NOT append historical notes"

这是 MagicDocs 和传统变更日志的根本区别：它维护的是**真相的快照**，不是时间线。如果一个 API 的端点从 `/v1/users` 改成了 `/v2/users`，文档里直接改，不留"原来是 v1"的注脚。

**写什么、不写什么**：

提示词明确列出了 DO 和 DON'T：

- **DO**：高层架构、非显而易见的模式、关键入口点、重要设计决策、关联文件引用
- **DON'T**：代码里显而易见的东西、详尽的函数列表、逐步实现细节、底层代码机制

这个区分对应了一个重要洞察：**好的文档填补的是代码和理解之间的鸿沟**，而不是复读代码。

**自定义指令的优先级**：

如果文件有斜体指令行，提示词会特别强调（`prompts.ts:108-115`）：

> "These instructions take priority over the general rules below."

这意味着你的自定义指令可以覆盖默认的文档哲学——如果你在指令里说"记录所有 API 变更历史"，系统会尊重你的选择，即使这与默认原则矛盾。

**变量替换机制**：

提示词使用 `{{variable}}` 模板语法（`prompts.ts:81-93`），通过单遍替换避免两个 bug：
1. `$` 反向引用损坏——用替换函数而非字符串避免 `$1` 被解释
2. 双重替换——用户内容碰巧包含 `{{varName}}` 时不会被二次替换

还有一个隐藏的扩展点：你可以在 `~/.claude/magic-docs/prompt.md` 放置自定义提示词模板（`prompts.ts:66-76`），完全替换默认的更新逻辑。这是为高级用户准备的逃生舱。

### 小节 6：城市比喻——自动更新的档案馆

如果把 Claude Code 比作一座城市，MagicDocs 就是**城市的自动更新档案馆**。

传统档案馆需要专职档案员——有人做了事，然后手动去档案馆登记。MagicDocs 的档案馆不一样：它有一个隐形的观察者，不断听着城市里发生的对话。当对话告一段落、城市安静下来的时候，观察者就派出一个专门的档案员（子 Agent），拿着对话的完整记录，去更新相关的档案。

档案员有严格的工作守则：
- 只能修改被标记为"魔法档案"的文件（最小权限）
- 只能更新，不能创建或删除（只有 Edit 工具）
- 必须保持档案反映当前状态，不留历史痕迹（活文档哲学）
- 如果档案的第一行标记被去掉了，档案员就不再管这个文件（自动退出追踪）

最妙的是那个斜体指令行——它相当于贴在档案柜上的便签："这个档案只记录破坏性变更"。档案员每次打开档案柜时都会重新读这张便签，所以你随时可以换一张。

---

## 这个设计背后的取舍

**为什么不用主模型直接更新？** 因为 MagicDocs 更新是"副作用"——不应该出现在对话流中；走单独的 Sonnet 子 Agent 让用户完全无感知、而且通常成本更低。关于"不消耗用户付费的主模型额度"这一断言，本章没有从源码（例如计费 / quota 代码路径）找到直接证据证明它走的是不同的计费账户——"成本更低"是有根据的（Sonnet 明显比 Opus 单价低、额外一次短调用而非延长主对话），但"完全不占主模型额度"严格来讲是产品侧的决策，需要以官方计费说明为准。

**为什么只给 Edit 工具？** 更多工具意味着更多攻击面。如果子 Agent 能执行 Bash 命令，一个精心构造的 MagicDoc 内容可能通过提示注入让子 Agent 执行任意代码。只给 Edit + 限制路径，把爆炸半径控制在"最坏情况下改坏了一个文档文件"。

**为什么不实时更新？** 实时更新意味着每次工具调用后都可能触发子 Agent，这会拖慢主对话的响应速度。"空闲时更新"是一个典型的**批量 vs 实时权衡**——牺牲时效性，换取零干扰。

**为什么只对内部用户开放？** `USER_TYPE === 'ant'` 的门控说明这是一个正在验证的功能。自动修改用户文件是一个高风险操作——如果子 Agent 理解错了上下文，或者提示词有缺陷，可能会写入错误信息。先在内部积累足够的信心，再对外发布。

**为什么用纯 Markdown 而非数据库？** MagicDoc 就是一个普通的 Markdown 文件，可以被 Git 追踪、被 PR review、被手动编辑。这意味着它完全融入了开发者已有的工作流——自动生成的内容和手动写的内容共存，都受版本控制保护。

---

## 代码落点

- `src/services/MagicDocs/magicDocs.ts`，第 33 行：`detectMagicDocHeader()` 魔法头部正则
- `src/services/MagicDocs/magicDocs.ts`，第 89 行：`registerMagicDoc()` 幂等注册
- `src/services/MagicDocs/magicDocs.ts`，第 99-109 行：`getMagicDocsAgent()` 子 Agent 定义（仅 Edit 工具）
- `src/services/MagicDocs/magicDocs.ts`，第 217 行：`sequential()` 包裹的 post-sampling hook
- `src/services/MagicDocs/magicDocs.ts`，第 242-254 行：`initMagicDocs()` 初始化入口
- `src/services/MagicDocs/prompts.ts`，第 66-76 行：自定义提示词模板逃生舱
- `src/services/MagicDocs/prompts.ts`，第 81-93 行：`{{variable}}` 模板变量替换

---

## 局限性与批判

- **仅限内部用户**：`USER_TYPE === 'ant'` 门控意味着外部用户完全无法使用此功能，无法验证其在大规模多样化项目中的稳健性
- **单文档视角**：子 Agent 每次只更新一个文档，无法感知多个 MagicDoc 之间的信息重叠或冲突——如果两份文档覆盖同一个模块，可能产生不一致描述
- **依赖对话质量**：文档更新的质量完全取决于主对话中讨论的深度和准确性；如果对话本身包含错误理解，错误会被"自动化"地写入文档

---

## 如果你只记住一件事

MagicDocs 不是一个"文档生成器"——它是一个**后台运行的专职文档维护子 Agent**，由两行 Markdown 头部激活，在对话空闲时自动工作，只有 Edit 一把钥匙，只能开自己负责的那个档案柜。它证明了一个设计理念：**最好的文档系统不是让你写得更快，而是让你完全不用写**。
