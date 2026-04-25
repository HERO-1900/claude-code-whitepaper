# AI 的记忆是怎么跨越对话存活的？

解析 Claude Code 的 Memory 持久化系统——用户偏好如何通过 MEMORY.md 索引文件跨对话存活，四种记忆类型的写入、加载与验证机制，以及记忆错误的风险与应对。

> 🌍 **行业背景**：AI 记忆持久化是当前所有编程助手面临的共同挑战，但各家方案差异显著。**ChatGPT** 的 Memory 功能存储在 OpenAI 服务器上，用户无法直接编辑底层数据，也无法控制存储位置——这是"云端托管"路线。**Cursor** 通过 `.cursorrules` 文件（后更名为 `.cursor/rules`）存储项目级指令，但这是静态配置而非动态学习的记忆。**Aider** 使用 `.aider.conf.yml` 和 convention files，同样是手动配置而非 AI 自主记忆。**GitHub Copilot** 通过 `.github/copilot-instructions.md` 提供项目级上下文，2025 年新增了 Memory 功能但仍以云端为主。**Windsurf** 有 `.windsurfrules` 类似 Cursor 的方案。Claude Code 的做法独树一帜：完全本地文件系统 + Markdown 格式 + AI 自主读写 + 结构化分类（四种类型）+ 验证机制。这种"AI 自主管理本地文件记忆"的方案在透明度和可控性上有优势（用户可以直接用编辑器查看和修改记忆），但也意味着记忆质量完全依赖 LLM 的判断能力。

---

## 问题

你今天告诉 Claude Code "我是后端工程师，测试必须连真实数据库"。明天打开新对话，Claude 自动调整了回答风格，测试建议也不再出现 mock。它是怎么"记住"的？这些记忆存在哪里？会不会有一天它记错了导致问题？

---

> **[图表预留 2.18-A]**：架构图 — Memory 系统的两层结构（MEMORY.md 索引 → 独立记忆文件），标注四种类型、截断限制、注入时机

> **[图表预留 2.18-B]**：流程图 — 记忆的完整生命周期（写入 → 索引 → 加载 → 验证 → 过期/更新）

## 你可能以为……

"应该是存在某个数据库或者云端服务器上吧？"你可能这么想。毕竟 ChatGPT 的 Memory 就是存在 OpenAI 的服务器上的。或者你可能猜测是存在某个配置文件里——一个 JSON 字段，key-value 形式。

> 💡 **通俗理解**：AI 的记忆系统就像**游戏存档**——当前对话的状态 = 内存中的游戏进度（关掉就没了）；会话记录 = 存档文件（可以读档继续）；Memory 系统 = 永久成就和角色属性（跨存档保留，换个游戏档也带着）。"你是后端工程师"这种信息被存在"永久成就"里，下次开新对话自动加载。

---

## 实际上是这样的

Claude Code 的记忆系统完全基于**本地文件系统**——用 Markdown 文件存储结构化记忆，用 frontmatter 元数据分类，用 MEMORY.md 做索引，用提示词工程驱动 AI 的读写行为。它没有数据库，没有云同步，没有向量检索。但它有四种记忆类型、五条排除规则（源码 `memoryTypes.ts:183-195`）、路径安全验证（6 种危险路径被拒绝）、eval 驱动的提示词优化，以及一个借鉴 WAL（Write-Ahead Log）思想的日志模式。

### 小节 1：四种记忆——不是什么都值得记住

系统定义了四种严格区分的记忆类型（`memoryTypes.ts:14-19`）：

| 类型 | 目的 | 例子 |
|------|------|------|
| **user** | 用户画像 | "用户是数据科学家，关注可观测性" |
| **feedback** | 行为指导 | "测试必须连真实数据库，不用 mock" |
| **project** | 项目上下文 | "3月5日起合并冻结，移动端发版" |
| **reference** | 外部指针 | "pipeline bug 在 Linear 的 INGEST 项目里追踪" |

每种类型不仅有不同的"什么时候保存"规则，还有不同的**内容结构要求**。feedback 和 project 类型的模板建议写出 `**Why:**` 和 `**How to apply:**` 行——因为光记住"不要 mock 数据库"是不够的，还需要知道**为什么**（上次 mock 测试通过但生产迁移失败）和**怎么用**（所有集成测试场景）。

说明："强制要求"这个词在本章前几版里用得过重——准确说法是：`memoryTypes.ts` 的模板段落**建议**这两行；它是 prompt 层面对 AI 的引导，并不存在一条"解析 frontmatter 后如果缺 `**Why:**` / `**How to apply:**` 就拒绝写入"的硬校验。换句话说，这是"强建议"而非"静态校验"。

但更重要的是**什么不记**。`memoryTypes.ts:183-195` 列出了五条排除规则：

1. 代码模式、架构、文件路径——从代码推导
2. Git 历史——`git log` 是权威源
3. 调试方案——修复在代码里，上下文在 commit message 里
4. CLAUDE.md 中已有的内容——避免重复
5. 临时任务细节——只在当前对话有用

最关键的一句（`memoryTypes.ts:193-194`）：

> "These exclusions apply **even when the user explicitly asks you to save**."

即使用户说"帮我记住这个文件的架构"，系统也会拒绝——因为文件架构应该从代码本身推导，而不是依赖一条可能过时的记忆。这是一个罕见的"AI 对用户说不"的设计。

### 小节 2：两层架构——索引与实体分离

记忆的物理存储结构：

```
~/.claude/projects/<sanitized-path>/memory/
  ├── MEMORY.md          ← 索引文件（每行一个指针）
  ├── user_role.md       ← 独立记忆文件
  ├── feedback_testing.md
  └── project_deadline.md
```

每个记忆文件有 frontmatter 元数据：

```markdown
---
name: 数据库测试规则
description: 集成测试必须连真实数据库，不用 mock
type: feedback
---

测试必须连真实数据库，不用 mock。

**Why:** 上季度 mock 测试全部通过，但生产环境迁移失败。mock/prod 分歧掩盖了一个有问题的迁移脚本。

**How to apply:** 所有涉及数据库的测试场景。如果测试框架默认 mock，显式替换为真实连接。
```

MEMORY.md 是索引——每个条目一行，指向对应的文件：

```markdown
- [数据库测试规则](feedback_testing.md) — 集成测试必须连真实数据库
- [用户角色](user_role.md) — 后端工程师，关注可观测性
```

为什么不把所有记忆直接写在一个文件里？因为 MEMORY.md 在**每次会话开始时注入到上下文窗口**中——它的大小直接影响每轮对话的 token 成本。独立文件则**按需读取**——只在相关时才加载。

关于"按需加载"的实现路径：MEMORY.md 的索引条目本身就是给 AI 看的"摘要"，AI 根据当前对话话题决定是否用 Read 工具去读某个指针指向的独立文件——选择逻辑主要走**提示词驱动的 LLM 决策**（基于索引里每条的一句话描述匹配当前问题），而不是向量检索或专门的排序算法。`findRelevantMemories` 这个函数是附加的辅助查找入口（比如在 extract 背景 agent 中按范围命中"哪些记忆可能被当前改动影响"），但主路径的"是否读这条记忆"决定权在 AI 本身；这是一条典型的"把检索委托给 LLM"的设计选择。

### 小节 3：200 行和 25KB——记忆的物理极限

```typescript
// src/memdir/memdir.ts，第 34-38 行
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
```

MEMORY.md 有**双重截断**机制（`memdir.ts:57-103`）：

1. 超过 200 行 → 按行截断
2. 超过 25KB → 按最后一个换行符位置截断（不在字中间断）
3. 截断后附加警告：`"> WARNING: MEMORY.md is too large. Only part of it was loaded."`

200 行限制意味着：如果你每天让 Claude 记住一条新信息，大约 6-7 个月后就会碰到天花板。到那时，**文件末尾超过 200 行的部分**会被截断不显示（双重截断的第一步是按行截断、保留前 200 行，超出行不进入上下文）——虽然独立文件还在磁盘上，但对应的索引指针不可见了，AI 就不知道去读它们。这意味着**最新添加的条目若写在文件末尾、在第 200 行之后，会最先"消失"**；因此实际应用中要么把最新条目插在文件前面，要么手动清理旧条目。

这是一个务实的设计权衡：记忆越多，每次对话的 token 开销越大。200 行大约 3000-5000 token（经验估算：按每行 15-25 tokens × 200 行推算，实际随内容密度变化），对于一个系统提示来说已经不小了。

### 小节 4：记忆会撒谎——"推荐前验证"机制

> 📚 **课程关联**：记忆漂移问题本质上是**数据库**课程中"缓存一致性"的变种。记忆文件相当于代码库状态的缓存——当"源数据"（代码）被修改后，"缓存"（记忆）可能过期。"推荐前验证"机制类似于 HTTP 的条件请求（If-Modified-Since）：不盲目信任缓存，先检查源数据是否变化。更准确的对应术语是**stale cache revalidation**（过期缓存再验证）；"read-your-writes 一致性"则是另一个侧重点的概念（指读请求能看到自己刚写入的数据），与本节要描述的"读之前先看源数据有没有变"并不完全相同，这里避免混用。

这是整个 Memory 系统最有教育意义的设计。

一条记忆说"项目里有一个 `validateAuth()` 函数在 `auth.ts` 里"。但自从写入这条记忆后，代码被重构了，函数改名为 `verifyToken()`，文件移到了 `middleware/auth.ts`。如果 AI 盲目引用过期记忆，用户会看到一个不存在的函数名——这比没有记忆还糟糕。

`memoryTypes.ts:240-256` 的 `TRUSTING_RECALL_SECTION` 段落强制 AI 在引用记忆之前做验证：

- 记忆中提到文件路径 → **先检查文件是否存在**
- 记忆中提到函数名或 flag → **先 grep 确认它还在**
- 如果用户要基于你的推荐采取行动 → **必须先验证**

最精彩的是 `memoryTypes.ts:228-236` 的注释——它记录了 eval（评估测试）的具体分数变化：

> "H1 (verify function/file claims): 0/2 → 3/3 via appendSystemPrompt"

这段提示词最初放在系统提示的某个位置，eval 结果是 0/2（两个测试案例全部失败——AI 直接引用了过期记忆中的函数名而不验证）。把它移到 `appendSystemPrompt`（更靠近对话末尾的位置）后，eval 变成了 3/3（测试集在这一轮优化中扩展到 3 条用例，全部通过）。

这意味着**提示词在系统消息中的位置**对 AI 行为有显著影响——靠后的指令更可能被遵循（因为更接近模型的注意力焦点）。这不是理论推测，而是有 eval 数据支撑的工程结论。

### 小节 5：路径安全——防止恶意仓库偷走你的 SSH 密钥

记忆目录的路径来自项目路径的 sanitization。假设一个恶意 Git 仓库在 `.claude/settings.json`（项目级设置）中写 `autoMemoryDirectory: '~/.ssh'`——**如果项目级设置可以改记忆目录**，那意味着恶意仓库就获得了向敏感目录写入文件的能力。

但 Claude Code 恰恰识别到了这个风险，并在设计上**排除了 projectSettings 这一来源**——项目级设置里的 `autoMemoryDirectory` 会被忽略，不会真的让记忆文件出现在 `~/.ssh/`。下面引用的注释明确了这一层防御：

> "projectSettings (.claude/settings.json committed to the repo) is intentionally excluded — a malicious repo could otherwise set autoMemoryDirectory: '~/.ssh' and gain silent write access to sensitive directories"

因此，项目级设置（提交在仓库中、可被恶意 PR 修改的那份）被**完全排除**在记忆路径配置之外。只有用户级设置（`~/.claude/settings.json`）才能修改记忆目录。

除此之外，`paths.ts:109-150` 的 `validateMemoryPath()` 还拒绝六种危险路径：

1. 相对路径（`../foo`）— 防止路径遍历
2. 根路径或近根路径（`/`、`/a`）— 防止覆盖系统目录
3. Windows 驱动器根（`C:\`）
4. UNC 路径（`\\server\share`）— 防止网络路径注入
5. null byte — 防止在 syscall 中截断路径（经典的安全漏洞向量）
6. `~` 展开限制：`~/`、`~/.`、`~/..` 不展开 — 防止匹配整个 `$HOME`

### 小节 6：Git Worktree 共享——Swarm 模式的隐秘桥梁

```typescript
// src/memdir/paths.ts，第 200-205 行
// Uses findCanonicalGitRoot so all worktrees of the same repo
// share one auto-memory directory
```

当多个 Claude 实例以 Swarm 模式工作时（每个在自己的 git worktree 中），它们共享**同一个记忆目录**。这意味着：

- 主 agent 记住了"这个项目的 CI 在 GitHub Actions 上跑"
- worktree 中的子 agent 立即可以访问这条记忆
- 所有 agent 对项目上下文的理解保持一致

这是通过 `findCanonicalGitRoot()` 实现的——无论你在哪个 worktree 里，都能找到 git 仓库的规范根路径，然后映射到同一个记忆目录。

### 小节 7：KAIROS 模式——从日志到蒸馏的记忆循环

> 📚 **课程关联**：KAIROS 模式的"先追加日志、后异步整理"架构是**数据库**课程中 WAL（Write-Ahead Log）模式的忠实映射。PostgreSQL 的 WAL、Redis 的 AOF（Append Only File）、Kafka 的日志存储都遵循同一原则：写入时只做追加（O(1) 复杂度、无锁冲突），后台异步 compaction 将日志整理为结构化索引。理解这个模式后，你会在从数据库到消息队列到文件系统的无数场景中反复看到它。

在标准模式下，AI 主动维护 MEMORY.md 索引。但在 KAIROS（Assistant）模式下，策略完全不同（`memdir.ts:318-370`）：

- **不维护** MEMORY.md 索引
- **追加**到日期命名的日志文件：`memory/logs/YYYY/MM/YYYY-MM-DD.md`
- 格式：带时间戳的短条目，append-only
- **夜间 `/dream` skill** 将日志蒸馏为主题文件 + 更新 MEMORY.md

这借鉴了数据库的 **WAL（Write-Ahead Log）** 思想：

1. 写入时只追加日志（快速、低冲突）
2. 后台异步将日志整理为结构化存储（`/dream` 蒸馏）
3. 读取时优先读结构化存储（MEMORY.md + 主题文件），日志是"最后手段"

一个值得注意的细节：日期路径使用**模式**（`YYYY/MM/YYYY-MM-DD`）而非当天的字面日期。为什么？因为记忆提示词被 `systemPromptSection('memory', ...)` 缓存——如果模板里硬编码了"2026-04-02"，那到 4 月 3 日时缓存就失效了（prompt cache miss = 额外的 token 成本）。用模式则让模板永远不变，模型从 `date_change` attachment 获取当前日期。

### 小节 8：后台 Extract Agent——你不知道的第二个 AI

`paths.ts:58-77` 揭示了一个大多数用户不知道的机制：

```
feature flag: EXTRACT_MEMORIES
GrowthBook gate: tengu_passport_quail
```

当这个 feature 启用时，**每轮对话后**都有一个后台 agent 扫描新消息，提取值得记忆的内容。如果主 agent 已经在那段对话中写了记忆，后台 agent 会跳过那个范围——避免重复。

**Extract Agent 触发条件（来自 `paths.ts:69-77` 的 `isExtractModeActive()`）**：
1. 编译时 feature flag `EXTRACT_MEMORIES` 已启用（由调用方单独 gate，参见 `paths.ts:65-67` 注释）
2. GrowthBook gate `tengu_passport_quail` 为 true
3. 当前是交互式会话 **或** GrowthBook gate `tengu_slate_thimble` 为 true（后者允许在非交互 / CI / 远程场景也跑后台 extract）

这三条同时满足才会跑。在 CI、`--print` 一次性执行等非交互模式下，默认**不**跑 extract，避免打扰批量脚本。代价是额外的 token 消耗——每轮对话多一次 LLM 调用。

关于 `/dream` 的触发机制：源码注释将其描述为 "nightly /dream skill"（`memdir.ts:323`、`paths.ts:243`），暗示是**夜间触发**。但从当前代码看不到明确的"定时任务/cron"调度路径，更可能是**手动调用 `/dream` 这条 slash 命令**、由用户或外部调度器在夜间触发，而不是 Claude Code 自身带了定时器自动跑。这一点读者可留意进一步验证。

---

## 这背后的哲学

Memory 系统的设计哲学可以用一句话总结：**记忆是一种有成本的资源，不是免费的特性**。

1. **Token 成本**。每条记忆都占用上下文窗口空间。200 行上限不是技术限制，是经济决策——超过这个量，记忆的 token 成本就超过了它提供的价值。
2. **准确性成本**。过期的记忆比没有记忆更危险。"推荐前验证"机制和漂移警告（`MEMORY_DRIFT_CAVEAT`："If a recalled memory conflicts with current information, trust what you observe now"）承认了记忆固有的不可靠性。
3. **安全成本**。允许 AI 写入文件系统意味着打开了一个攻击面。路径验证和 projectSettings 排除是为这个代价买的保险。
4. **认知成本**。四种类型 + 排除规则 + Why/How 结构 = AI 每次写入记忆都需要做分类判断。这些判断不总是对的（LLM 可能保存冗余信息），但结构化比无结构好。

最深刻的启示来自 eval 注释——Anthropic 不是在"设计"AI 行为，而是在**测量和优化**它。提示词的每个段落、每个位置都有对应的 eval 测试，分数变化直接记录在代码注释里。这是一种把 AI 行为调控当作实验科学（而非直觉艺术）来做的方法论。

---

## 代码落点

- `src/memdir/memoryTypes.ts`，第 14-19 行：`MEMORY_TYPES = ['user','feedback','project','reference']`
- `src/memdir/memoryTypes.ts`，第 183-195 行：五条排除规则
- `src/memdir/memoryTypes.ts`，第 193-194 行：排除规则即使用户明确要求也适用
- `src/memdir/memoryTypes.ts`，第 201-202 行：`MEMORY_DRIFT_CAVEAT` 漂移警告
- `src/memdir/memoryTypes.ts`，第 228-236 行：eval 结果注释（0/2 → 3/3）
- `src/memdir/memoryTypes.ts`，第 240-256 行：`TRUSTING_RECALL_SECTION` 推荐前验证
- `src/memdir/memoryTypes.ts`，第 261-271 行：frontmatter 格式模板
- `src/memdir/memdir.ts`，第 34-38 行：`ENTRYPOINT_NAME`、`MAX_ENTRYPOINT_LINES=200`、`MAX_ENTRYPOINT_BYTES=25000`
- `src/memdir/memdir.ts`，第 57-103 行：双重截断逻辑
- `src/memdir/memdir.ts`，第 116-117 行：`DIR_EXISTS_GUIDANCE`
- `src/memdir/memdir.ts`，第 318-370 行：`buildAssistantDailyLogPrompt()` KAIROS 模式
- `src/memdir/paths.ts`，第 30-55 行：`isAutoMemoryEnabled()` 五步优先级链
- `src/memdir/paths.ts`，第 58-77 行：`isExtractModeActive()` + `tengu_passport_quail`
- `src/memdir/paths.ts`，第 109-150 行：`validateMemoryPath()` 六种危险路径拒绝
- `src/memdir/paths.ts`，第 175-177 行：projectSettings 排除（防恶意仓库）
- `src/memdir/paths.ts`，第 200-205 行：Git Worktree 共享记忆目录

---

## 还可以追问的方向

1. **`findRelevantMemories.ts`**：按需加载独立记忆文件时，用什么算法判断"相关性"？是关键词匹配还是语义相似度？
2. **`memoryScan.ts`** 和 **`memoryAge.ts`**：记忆的扫描和过期策略是怎样的？多久没被引用的记忆会被建议清理？
3. **Team Memory 的 scope 决策**：feedback 默认 private、project 偏向 team——这个默认值是怎么确定的？
4. **Extract Memories 的成本分析**：每轮多一次 LLM 调用的 token 成本与记忆价值的 ROI？
5. **KAIROS `/dream` 蒸馏的具体实现**：日志到主题文件的蒸馏逻辑？如何处理跨天的连续主题？

---

