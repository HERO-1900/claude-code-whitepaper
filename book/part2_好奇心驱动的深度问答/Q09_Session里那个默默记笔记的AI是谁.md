# Session 里那个默默记笔记的 AI 是谁？

你可能从未注意到，Claude Code 在你工作的过程中，后台悄悄运行着一个"记笔记"的独立 AI 实例。它把你的对话要点、任务进展、遇到的错误自动整理成结构化的 `summary.md` 文件（路径：`{projectDir}/{sessionId}/session-memory/summary.md`），让 AI 在下次打开项目时就能记起"上次做到哪了"。本章解析这个 SessionMemory 系统的触发机制、笔记结构和工程设计。

> 💡 **通俗理解**：就像会议有专人做笔记——你只管开会讨论，它把要点记录下来，下次开会时你可以快速回忆。

### 🌍 行业背景

"让 AI 在工作过程中自动积累上下文记忆"是 AI 编码工具和 Agent 框架的共同追求，但各家的实现路径差异很大：

- **Cursor（长期记忆 / Memories）**：2024 年底引入记忆功能，通过用户手动标记或 AI 自动提取关键信息，存储在云端。但它不像 Claude Code 这样运行独立的后台 AI 实例来持续记笔记，更偏向"关键事实提取"而非"会话进展追踪"。
- **Aider（chat history + repo map）**：将对话历史持久化到 `.aider.chat.history.md` 文件，但这是原始对话的直接记录，没有经过 AI 摘要和结构化整理。Aider 的 repo map 功能会维护代码库结构的缓存，但这属于代码理解而非会话记忆。
- **Windsurf（Cascade Memory）**：声称具备跨会话的"记忆"能力，但具体实现未公开，文档中没有描述类似 SessionMemory 的独立后台提取机制。
- **LangChain / LangGraph（Memory 模块）**：提供了多种记忆实现——`ConversationBufferMemory`（全量保存）、`ConversationSummaryMemory`（AI 摘要）、`EntityMemory`（实体追踪）。LangChain 的 `ConversationSummaryMemory` 与 Claude Code 的 SessionMemory 最相似，都用一个 LLM 调用来压缩对话历史，但 LangChain 是同步执行，而 Claude Code 是后台异步执行。
- **ChatGPT（Memory）**：OpenAI 的记忆功能会在对话中提取用户偏好和关键事实，跨会话持久化。但它是云端服务而非本地文件，用户对记忆内容的控制粒度不同。

Claude Code 的 SessionMemory 的独特之处在于：（1）后台异步运行，不阻塞主对话；（2）输出是结构化的本地 Markdown 文件，用户可以直接查看和编辑；（3）通过 `runForkedAgent` 复用 prompt cache 降低成本。这种"用独立 AI 实例做后台记录员"的模式在 AI 编码工具中目前较为少见。

---

## 问题

如果你仔细看过 `~/.claude/projects/` 目录，可能会发现每个 session 目录下都有一个 `session-memory/summary.md`。这个文件是谁写的？什么时候写的？写的是什么？

---

## 实际上是这样的

Claude Code 在你工作的过程中，偷偷运行着一个**后台记笔记的 AI**。

### 机制

每次你发消息并等到 AI 回复完成后，系统会检查是否需要"提取记忆"：

```
shouldExtractMemory(messages):
  1. token 数超过初始化阈值？（如不超过，还不用记）
  2. 上次记忆提取以来，token 增长超过阈值？
  3. 工具调用次数超过阈值？
  4. 当前 AI 没在执行工具？（在工具执行中不打扰）

  触发条件：条件 1 已满足 + 条件 2 必须 + (条件 3 OR 条件 4)
  → 触发 extractSessionMemory()
```

注意一个关键细节：**token 增长阈值（条件 2）是触发的必要条件，不可绕过**——即使工具调用次数超过阈值，如果 token 没有足够增长，提取也不会发生。这防止了高频低成本工具调用（比如多次 Glob 查询）无意义地触发记笔记。条件 4 的"当前 AI 没在执行工具"是一个自然断点捕获——模型刚做完一段工作进入对话阶段时，记笔记的信息增益最高；它与条件 3 是"OR"关系，即工具调用次数够多或者刚好停在安全断点，两者至少有一个成立。

满足条件时，系统启动一个 `runForkedAgent`——一个独立的 AI 实例，任务只有一件事：**用 Edit 工具更新 session memory 的 `summary.md` 文件**。

### 笔记的结构

生成的笔记文件有 10 个固定节：

```markdown
# Session Title
_5-10 个词的简短描述（对应英文模板 "5-10 word descriptive title"）_

# Current State
_当前正在做什么？下一步是什么？_

# Task specification
_用户要求构建什么？有哪些设计决策？_

# Files and Functions
_重要的文件是哪些？它们包含什么？_

# Workflow
_通常运行哪些命令？顺序是什么？_

# Errors & Corrections
_遇到了什么错误？如何修复？哪些方法失败了？_

# Codebase and System Documentation
_重要的系统组件是什么？它们如何运作？_

# Learnings
_什么有效？什么无效？要避免什么？_

# Key results
_如果用户要求了特定输出，完整的结果在这里_

# Worklog
_每步做了什么？极简摘要_
```

更新时，记笔记的 AI **只能修改**每节标题下面的内容——节名（`# ...`）和斜体说明行（`_..._`）不能被修改或删除。所有 Edit 操作必须并行执行，然后立即停止。

#### 笔记模板原文（DEFAULT_SESSION_MEMORY_TEMPLATE）

**来源**: `src/services/SessionMemory/prompts.ts` → `DEFAULT_SESSION_MEMORY_TEMPLATE`（第 11-41 行）

这是写入 `session-memory.md` 的实际模板原文，每个节标题下的斜体行是给记笔记 AI 看的"写作说明"，不是给用户看的内容：

```markdown
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and 
should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, 
repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
```

**设计要点**：注意 `# Session Title` 的说明是 "Super info dense, no filler"——这不是普通的"请写一个标题"，而是明确要求高信息密度、无废话。`# Errors & Corrections` 的说明特别要求记录"What approaches failed and should not be tried again?"——这是防止下次会话重蹈覆辙的关键，也是这个系统对"历史教训"记忆的核心价值。用户可以通过在 `~/.claude/session-memory/config/template.md` 放置自定义模板来替换这个默认模板。

#### 更新指令原文（getDefaultUpdatePrompt）

**来源**: `src/services/SessionMemory/prompts.ts` → `getDefaultUpdatePrompt()`（第 43-80 行）

这是记笔记 AI 收到的完整任务指令。注意它开头第一句话就是免责声明——防止 AI 把这段"记笔记指令"本身也记进笔记里：

```
IMPORTANT: This message and these instructions are NOT part of the actual user conversation. 
Do NOT include any references to "note-taking", "session notes extraction", or these update 
instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message as well as 
system prompt, claude.md entries, or any past session summaries), update the session notes file.

The file {{notesPath}} has already been read for you. Here are its current contents:
<current_notes_content>
{{currentNotes}}
</current_notes_content>

Your ONLY task is to use the Edit tool to update the notes file, then stop. You can make multiple 
edits (update every section as needed) - make all Edit tool calls in parallel in a single message. 
Do not call any other tools.

CRITICAL RULES FOR EDITING:
- The file must maintain its exact structure with all sections, headers, and italic descriptions intact
-- NEVER modify, delete, or add section headers (the lines starting with '#' like # Task specification)
-- NEVER modify or delete the italic _section description_ lines (these are the lines in italics 
   immediately following each header - they start and end with underscores)
-- The italic _section descriptions_ are TEMPLATE INSTRUCTIONS that must be preserved exactly as-is 
   - they guide what content belongs in each section
-- ONLY update the actual content that appears BELOW the italic _section descriptions_ within each 
   existing section
-- Do NOT add any new sections, summaries, or information outside the existing structure
- Do NOT reference this note-taking process or instructions anywhere in the notes
- It's OK to skip updating a section if there are no substantial new insights to add. Do not add 
  filler content like "No info yet", just leave sections blank/unedited if appropriate.
- Write DETAILED, INFO-DENSE content for each section - include specifics like file paths, function 
  names, error messages, exact commands, technical details, etc.
- For "Key results", include the complete, exact output the user requested (e.g., full table, full 
  answer, etc.)
- Do not include information that's already in the CLAUDE.md files included in the context
- Keep each section under ~2000 tokens/words - if a section is approaching this limit, condense it 
  by cycling out less important details while preserving the most critical information
- Focus on actionable, specific information that would help someone understand or recreate the work 
  discussed in the conversation
- IMPORTANT: Always update "Current State" to reflect the most recent work - this is critical for 
  continuity after compaction

Use the Edit tool with file_path: {{notesPath}}

STRUCTURE PRESERVATION REMINDER:
Each section has TWO parts that must be preserved exactly as they appear in the current file:
1. The section header (line starting with #)
2. The italic description line (the _italicized text_ immediately after the header - this is a 
   template instruction)

You ONLY update the actual content that comes AFTER these two preserved lines. The italic description 
lines starting and ending with underscores are part of the template structure, NOT content to be 
edited or removed.

REMEMBER: Use the Edit tool in parallel and stop. Do not continue after the edits. Only include 
insights from the actual user conversation, never from these note-taking instructions. Do not delete 
or change section headers or italic _section descriptions_.
```

💡 **通俗理解**：这份指令就像给**新实习生**发的交接规范——"你只负责填表格里的内容格，表头和说明栏不许动；如果一格没什么可写，留空就行，别写'暂无'；每格不能超过 2000 tokens（原文 `~2000 tokens/words`），超了就自己缩减；最重要的是：不要把这份'如何填表的说明'也填进表格里"。

**五个关键设计决策分析**：

| 规则 | 代码表述 | 工程理由 |
|------|---------|---------|
| 不能修改节标题和斜体说明行 | "NEVER modify, delete, or add section headers" | 保证文件格式稳定，支持程序解析 |
| 允许留空，不强制填写 | "It's OK to skip updating a section" | 防止 AI 为凑内容生成低质量填充文字 |
| 每节上限 2000 tokens；文件总预算 12000 tokens | `MAX_SECTION_LENGTH = 2000`、`MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000` | 单节上限是"软引导"（模型被要求接近阈值就自行压缩），总预算是"硬触发"（超过时系统在 prompt 尾部追加强制压缩提醒）；两者配合让文件在长期会话中收敛而非线性增长 |
| 必须更新 Current State | "Always update 'Current State'... this is critical for continuity after compaction" | 这是压缩后恢复工作的核心断点信息 |
| `{{variableName}}` 模板变量 | `substituteVariables()` 单次替换 | 防止用户内容中的 `{{变量名}}` 被二次替换污染 |

注意提示词末尾的 `sectionReminders` 是动态追加的：当任何一节超过 2000 tokens 或总文件超过 12000 tokens 时，系统会自动在提示词末尾补充"你的第X节太长了，必须压缩"的警告。这是一个自动调节机制——不需要人工干预，文件会在每次更新时被自动修剪。

### 这个设计的工程亮点

**记笔记的 AI 复用了主请求的 prompt cache。** 同样是 `runForkedAgent` + `CacheSafeParams`，和投机执行一样——这让记笔记的额外成本降至最低（只需要处理新增的 token）。

> 📚 **课程关联**：`sequential()` 串行化机制直接对应《操作系统》课程中的**互斥与同步**章节。这本质上是一个生产者-消费者问题的简化版——多个"记笔记触发事件"（生产者）竞争同一个 `session-memory.md` 文件（临界资源），`sequential()` 充当了互斥锁（mutex）的角色，确保同一时刻只有一个写操作在执行。这比使用文件锁（`flock`）更轻量，因为所有操作都在同一个 Node.js 进程内，JavaScript 的单线程事件循环天然避免了真正的并发写入，`sequential()` 解决的是**异步操作的逻辑串行化**问题。

**`sequential()` 防止并发写入。** 如果上一次记笔记还没完成，新的触发会排队等待，不会并发写入文件造成内容混乱。

**只在主 REPL 线程运行。** 子 Agent、teammate、speculation 运行期间，记笔记的 AI 不会工作。这防止了噪音：只记录主线对话，不记录辅助 Agent 的内部状态。

### 笔记的用途

SessionMemory 与 AutoMem（跨项目自动记忆）是**两个独立系统**——SessionMemory 聚焦"单个 session 内部"的进度快照，AutoMem 聚焦"跨项目长期偏好"的规则沉淀。`summary.md` 的实际消费者主要有三条：

- **compaction**：`services/compact/sessionMemoryCompact.ts` 在触发自动压缩时读取 summary 作为"已知背景"，避免压缩后丢掉当前进度
- **/btw 离会摘要（awaySummary）**：当用户离开上下文时，用 summary 作为重入语境
- **skillify**：`skills/bundled/skillify.ts` 把 summary 作为"当前会话正在做什么"的上下文传给 skill 生成管线

换句话说，SessionMemory 不是独自存在的"长期记忆仓库"——它是压缩链路 / 会话恢复 / skill 生成的共享断点数据源。

### 相关阈值与默认值（可通过 GrowthBook 远程配置覆盖）

| 常量 | 默认值 | 含义 |
|------|--------|------|
| `minimumMessageTokensToInit` | 10000 | 对话累计 token 超过该值后才开始首次提取 |
| `minimumTokensBetweenUpdate` | 5000 | 两次提取之间上下文至少新增的 token |
| `toolCallsBetweenUpdates` | 3 | 两次提取之间至少发生的工具调用次数 |

默认值来自 `src/services/SessionMemory/sessionMemoryUtils.ts:32` 的 `DEFAULT_SESSION_MEMORY_CONFIG`。整个功能由 `tengu_session_memory` GrowthBook 特性门控制。

---

## 这个设计的工程价值

**把"AI 监视 AI 并记笔记"变成了一个可靠的后台服务。**

三个关键决策保证了可靠性：
1. `sequential()` — 串行化，防止并发
2. 阈值检查 — 防止每次 AI 回复都触发（成本控制）
3. 只更新内容，不修改结构 — 让文件格式在多次更新后保持稳定

---

## 局限性与批判

- **笔记质量不可控**：记笔记的 AI 通过 `runForkedAgent` + `createCacheSafeParams` 复用主请求的模型配置（用户设置决定，不是固定模型），对于高度技术性的对话可能遗漏关键细节或产生不准确的摘要
- **只记主线对话**：子 Agent、Speculation 等辅助线程的工作不被记录，但这些辅助工作可能包含重要的探索结果
- **阈值调优困难**：`minimumMessageTokensToInit` 和 `minimumTokensBetweenUpdate` 等阈值通过 GrowthBook 远程配置，但最优值因用户工作模式而异——快节奏的调试会话和慢节奏的架构讨论需要不同的触发频率

---

## 代码落点

- `src/services/SessionMemory/sessionMemory.ts`，第 272 行：`extractSessionMemory` 函数（完整逻辑）
- `src/services/SessionMemory/sessionMemory.ts`，第 134 行：`shouldExtractMemory()` 触发逻辑
- `src/services/SessionMemory/prompts.ts`，第 11 行：`DEFAULT_SESSION_MEMORY_TEMPLATE` 模板内容
- `src/services/SessionMemory/prompts.ts`，第 43 行：`getDefaultUpdatePrompt()` 提示词（包含详细规则）
