# Token 是一等公民

在 Claude Code 的代码库里，token 消耗是一个被反复考量的设计约束，和内存、CPU 一样被当作"一等公民"对待（"一等公民"是编程术语，意思是"享受最高待遇的核心对象"——就像 VIP 会员，系统的每个环节都要优先考虑它）。

> 💡 **通俗理解**：Token 就像**手机话费**——发短信（AI 输入）每条 1 毛，打电话（AI 输出）每分钟 5 毛，但如果对方已经在通讯录里（缓存命中），发短信只要 1 分钱。Claude Code 的每一个设计决策，都在精打细算这笔话费——能省一条就省一条，能用通讯录内的就不用通讯录外的。

> 🌍 **行业背景**：把计算资源当作一等约束来设计系统并不是 AI 时代的发明——**Google 的 "data center tax" 思维**（2013 年论文 *Profiling a Warehouse-Scale Computer*）早就把每瓦特功耗、每字节内存当作架构决策的核心约束。但 token 经济学确实带来了新维度：传统软件的资源（CPU、内存、网络）是**固定成本**（买了服务器就是那么多），而 LLM token 是**可变成本**，每多一个 token 就多花一分钱。在 AI 编码工具中，**Cursor** 通过"快速模型 + 慢速模型"分层来控制成本（简单补全用小模型，复杂任务用大模型）；**Aider** 用 repo map 技术只发送相关代码片段而非整个仓库，减少输入 token；**LangChain** 生态的 `CallbackHandler` 让开发者追踪每次调用的 token 消耗。这些做法都是 LLM 应用领域的**行业基线**——token 计数、上下文裁剪、工具描述截断，已经成为任何严肃 LLM 应用的标配。Claude Code 的特点在于将这些基线做法系统化，并在某些环节（如 prompt cache 参数对齐）做出了超越行业基线的工程创新。

---

## Token 生命周期：四个优化层面

与其罗列孤立的证据，不如从 token 的生命周期来理解 Claude Code 的策略——从"减少输入"到"缓存复用"到"控制输出"再到"管理存量"，每一层解决不同的问题。

### 第一层：减少输入——少发不必要的 token

**omitClaudeMd：子 Agent 的上下文裁剪（行业基线做法）**

下面一行代码的含义是：创建子 Agent 时，决定是否省略 CLAUDE.md（项目规则文件）的内容。默认不省略（`false`），但对于只需要"看看代码"的子 Agent，可以省掉这部分来节省 token：

```typescript
// 在创建 Explore/Plan 类型子 Agent 时
const omitClaudeMd = agentDefinition.omitClaudeMd ?? false
```

只读型 Agent（用于探索代码、制定计划）不需要提交规范、lint 规则、代码风格指南——这些 CLAUDE.md 内容对"只是去读读代码"的任务毫无用处。源码注释中提到这一设计"Saves ~5-15 Gtok/week across 34M+ Explore spawns"（`loadAgentsDir.ts`），即每周节省约 50-150 亿 token（注：GTok = Giga-Token = 10 亿 token）。

需要注意的是，这类"按需裁剪 system prompt"的做法是 LLM 应用的行业标准——Aider 的不同模式也使用不同的 system prompt。Claude Code 的贡献在于将其制度化：通过 `omitClaudeMd` 布尔开关 + `tengu_slim_subagent_claudemd` feature flag 远程控制，让裁剪决策可以快速回滚。`false-by-default` 的设计意味着**宁可多花 token，也不让子 Agent 失去项目上下文**——这是一个偏向质量的保守默认值。

**工具描述截断：2048 字符的防御性上限（行业基线做法）**

```typescript
// MCP client.ts
const MAX_MCP_DESCRIPTION_LENGTH = 2048
```

OpenAPI 生成的 MCP 服务器会把完整的 API endpoint 文档塞进工具描述，源码注释明确记录了这一现象："OpenAPI-generated MCP servers have been observed dumping 15-60KB of endpoint docs into tool.description"。2048 字符的上限是防御性截断——宁可丢失一些描述，也不让每次 API 调用都带着 60KB 的工具文档。

2048 这个数字的选择值得推敲。源码注释说它"caps the p95 tail without losing the intent"，即截断了最长的 5% 尾部描述，同时保留了绝大多数工具的完整语义。这很可能是基于实际 MCP 工具描述长度分布的经验值——2048 字符足以覆盖大多数工具的完整描述（包含参数说明和使用示例），而超过 2048 的通常是 OpenAPI 自动生成的冗余内容。类似的防御性截断在 OpenAI 的 function calling 实践中也很常见，是行业通用做法。

---

### 第二层：缓存复用——prompt cache 参数对齐（真正的工程创新）

**这一层是 Claude Code token 优化策略中最有价值、最独到的部分**。

生成"下一条预测消息"的 Agent 有一个严格的约束：它必须使用与父请求**完全相同**的 API 参数，才能共享 prompt cache。

```
// promptSuggestion.ts 的注释（摘要）：
// DO NOT override any API parameter that differs from the parent request.
// The fork piggybacks on the main thread's prompt cache by sending identical
// cache-key params. The billing cache key includes more than just
// system/tools/model/messages/thinking — empirically, setting effortValue
// or maxOutputTokens on the fork (even via output_config or getAppState)
// busts cache.
```

这段注释后面紧跟着一个关键的生产教训（来自 PR #18143 的记录）：

> 有一次尝试用 `effort:'low'` 节省预测成本——结果缓存命中率从 92.7% 降到 61%（用话费比喻：原本 92.7% 的短信走通讯录优惠价，突然只有 61% 能享受优惠），缓存写入量激增 45 倍。

这组数据直接来源于源码注释中对 PR #18143 的记录，是开发团队在生产环境中观测到的真实数据。

这次失败揭示了一个**未被 API 文档记载的行为特征**：Anthropic API 的 prompt cache 键比预期更细粒度。cache key 不仅包含 system prompt、tools、model、messages 前缀、thinking config 这些显而易见的参数——`effortValue`、`maxOutputTokens` 等看似"输出控制"的参数，也会影响缓存键。这不是文档能告诉你的，是在生产中付出代价后学到的。

**CacheSafeParams：将教训制度化**

为了防止类似事故再次发生，Claude Code 将 prompt cache 兼容性封装成了一个显式的类型契约：

```typescript
// forkedAgent.ts
export type CacheSafeParams = {
  systemPrompt: SystemPrompt        // system prompt - 必须与父请求一致
  userContext: { [k: string]: string }  // 用户上下文 - 影响 cache key
  systemContext: { [k: string]: string } // 系统上下文 - 影响 cache key
  toolUseContext: ToolUseContext      // 包含 tools、model 等
  forkContextMessages: Message[]     // 父请求的消息前缀
}
```

所有需要共享父请求缓存的 forked agent（promptSuggestion、sessionMemory、extractMemories、autoDream 等）都通过 `createCacheSafeParams(context)` 获取参数，然后传递给 `runForkedAgent()`。注释中明确标注了"安全"的覆盖范围——只有 `abortController`（不发送到 API）、`skipTranscript`（纯客户端）、`skipCacheWrite`（控制 cache_control 标记而非缓存键）这三类参数可以安全修改。

这个设计的核心价值在于：**它把一个隐式的、容易遗忘的约束（"别改参数否则缓存会失效"）变成了一个显式的、编译器能检查的类型约束**。任何新加入团队的开发者，只要看到 `CacheSafeParams` 类型，就知道这些参数不能随意修改。

### 类型系统守护缓存一致性

`CacheSafeParams` 在设计层面的创新值得单独审视——它是代码库中最能体现"用类型系统解决分布式系统问题"思想的案例。

从 `src/utils/forkedAgent.ts:57-68` 直接读取接口定义：

```typescript
export type CacheSafeParams = {
  /** System prompt - must match parent for cache hits */
  systemPrompt: SystemPrompt
  /** User context - prepended to messages, affects cache */
  userContext: { [k: string]: string }
  /** System context - appended to system prompt, affects cache */
  systemContext: { [k: string]: string }
  /** Tool use context containing tools, model, and other options */
  toolUseContext: ToolUseContext
  /** Parent context messages for prompt cache sharing */
  forkContextMessages: Message[]
}
```

每个字段的 JSDoc 注释不是文档装饰，而是工程契约的一部分：`systemPrompt` 字段注明"must match parent for cache hits"（必须与父请求一致才能命中缓存）——这是对调用者的强制声明，嵌入在类型定义里，不能被忽略。

**这里发生了什么？**分布式缓存系统里最难的问题之一是**缓存键一致性**：多个并发请求如何确保它们的缓存键完全相同？传统解决方案是运行时检查（调用前对比参数）或监控告警（调用后检测缓存命中率下降）。两者都是**事后发现**——等代码写完跑起来才知道坏了。

`CacheSafeParams` 把这个运行时问题转化为**编译时问题**：如果一个 forked agent 想传入不同的参数（比如用 `effort: 'low'` 降成本），它就必须绕过 `CacheSafeParams` 类型——这个"绕过"动作本身就是警示信号，TypeScript 编译器会在 code review 之前就把它暴露出来。

**与行业常规做法的对比**：大多数 LLM 应用对 prompt cache 参数的保护是通过文档约定（"这些参数不要改"）或运行时监控来实现的。两者都依赖工程师的主动意识——新入职的工程师看到一个配置项，很难凭直觉判断"改这个会破坏全球缓存命中率"。`CacheSafeParams` 把这个判断逻辑编码进了类型系统，让工具链代替工程师来做守卫。

这个模式有一个有趣的扩展性：源码注释（`forkedAgent.ts:70-72`）进一步设计了一个全局槽位——每次主循环 turn 结束后，`saveCacheSafeParams()` 把最新参数写入模块级变量，后续所有 fork（`promptSuggestion`、`postTurnSummary`、`/btw`）都调用 `getLastCacheSafeParams()` 取用，无需每个调用者各自传参。类型系统的约束 + 单一来源的参数存储，双重保证了缓存键的全局一致性。

> 💡 **通俗理解**：这就像**一个餐厅的食材供应系统**——所有菜品必须用同一批进货的食材（父请求参数）才能保证口味一致（缓存命中）。普通的做法是贴一张"请用今天的食材"的纸条，靠厨师自觉遵守。`CacheSafeParams` 的做法是：设计一个只能插今天食材的接口，物理上禁止厨师拿错——如果有人想偷偷换食材，接口会直接拒绝。

**promptCacheBreakDetection：缓存失效的主动监控**

更进一步，Claude Code 建立了完整的缓存失效检测系统（`promptCacheBreakDetection.ts`），跟踪 **12 个** 可能导致缓存失效的参数维度（SoT 核实 `promptCacheBreakDetection.ts:72-83`）：

1. `systemPromptChanged` — 系统提示词 hash
2. `toolSchemasChanged` — 工具 schema hash
3. `modelChanged` — 模型切换
4. `fastModeChanged` — Fast 模式切换
5. `cacheControlChanged` — cache_control 标记变更
6. `globalCacheStrategyChanged` — 全局缓存策略
7. `betasChanged` — API betas 变更
8. `autoModeChanged` — 自动模式切换
9. `overageChanged` — 计费溢出状态
10. `cachedMCChanged` — 缓存中的模型配置
11. `effortChanged` — effort 级别
12. `extraBodyChanged` — extra body params

每次 API 调用后，系统对比缓存读取 token 的变化——如果下降超过 5% 且绝对值超过 2000 token，就触发告警，并自动生成 diff 文件帮助诊断。

这种主动监控的做法在 LLM 应用中是不常见的——大多数工具只在账单上发现缓存问题，而 Claude Code 在每次 API 调用后都进行实时检测。

> 📖 **深度阅读**：缓存失效检测系统的完整架构（工具级 Schema 哈希、Diff 输出、粘性闩锁机制）详见 **Part 3「Prompt Cache 可观测性完全解析」**。

> 📚 **课程关联**：prompt cache 的缓存键问题与**数据库系统**课程中的**查询缓存失效**高度类似——MySQL 的 Query Cache 曾因为查询文本的任何微小差异（包括大小写、空格）导致缓存未命中。同样的教训：缓存键的粒度往往比你预期的更细。命中率从 92.7% 降到 61%，意味着未命中率从 7.3% 升到 39%（5.3 倍增长）。用话费比喻来说：原本你 93% 的短信都走通讯录优惠（1分钱/条），现在只有 61% 能走优惠，其余都要按原价（1毛/条甚至更贵）——总话费翻了近 3 倍。

---

### 第三层：控制输出——会话记忆的信息密度触发

**SessionMemory 的三阈值机制（超越行业基线的调度设计）**

SessionMemory（后台记笔记的 AI）的触发条件不是"每次 AI 回复后"，而是基于三个阈值的联合判断：

```typescript
// 默认配置值（sessionMemoryUtils.ts）
const DEFAULT_SESSION_MEMORY_CONFIG = {
  minimumMessageTokensToInit: 10000,    // 上下文达到 1 万 token 后才开始首次提取
  minimumTokensBetweenUpdate: 5000,     // 两次提取之间至少增加 5000 token
  toolCallsBetweenUpdates: 3,           // 两次提取之间至少 3 次工具调用
}
```

如果每次 AI 回复后都触发记忆提取，额外成本会无法接受。三个阈值确保记忆提取只在"积累了足够有价值的新信息"时才运行。

源码注释揭示了一个重要的设计细节：**token 阈值是硬约束**（"The token threshold is ALWAYS required. Even if the tool call threshold is met, extraction won't happen until the token threshold is also satisfied"）。这意味着 `minimumTokensBetweenUpdate` 和 `toolCallsBetweenUpdates` 不是"满足任一即可"，而是"tool call 阈值只是前提条件之一，token 阈值必须同时满足"。

这种"信息密度驱动"而非"时间或事件频率驱动"的调度策略，在传统事件驱动架构中有对应物（如 Kafka 的 `linger.ms` + `batch.size` 双阈值），但在 AI Agent 领域的应用相对新颖——对比 AutoGPT 的"每步都存储记忆"方式，信息密度感知调度避免了大量低价值的重复提取。

---

### 第四层：管理存量——六级上下文压缩

**渐进式降级（行业基线框架，Claude Code 的具体实现）**

单一的压缩策略（比如"超过 80% 上下文时截断"）不够精细，既可能触发太早（浪费可用上下文空间），又可能触发太晚（需要丢弃大量有用信息）。

Claude Code 的六套机制逐步升级：
1. **工具结果预算**（`applyToolResultBudget`）——按预算裁剪大号工具结果
2. **snip 快速压缩**（`snipCompactIfNeeded`）——只丢弃工具结果的细节
3. **microCompact 微压缩**（`microCompact.ts`）——用 AI 压缩单条工具结果
4. **API-level microcompact**（`apiMicrocompact.ts`）——通过 `context_management` API 参数让服务端清理（详见 Part 3 Q02）
5. **context collapse 折叠**（`applyCollapsesIfNeeded`）——折叠旧消息段
6. **autocompact 自动全文压缩**（`autoCompact.ts`）——接近阈值时生成完整摘要 + SessionMemory

触发阈值由 `getAutoCompactThreshold()` 动态计算：`有效上下文窗口大小 - 13000 token 缓冲`（`AUTOCOMPACT_BUFFER_TOKENS = 13_000`），其中有效上下文窗口 = 模型上下文窗口 - 输出预留（最多 20000 token）。

需要坦承的是，渐进式降级本身是上下文管理的行业标配——Aider 在 2024 年初就有 repo map → 增量更新 → 全量压缩的多级策略，LangChain 的 `ConversationSummaryBufferMemory` 也实现了两级策略。Claude Code 做到六级，但"多级压缩"这个框架不是 Claude Code 的创新——具体的阈值计算、级间切换逻辑、以及与 prompt cache 的协调（如 `notifyCompaction()` 通知缓存检测系统重置基线），才是实现层面的工程细节。

---

## 这带来了什么设计原则

**缓存是基础设施，不是优化。**

在 token 经济里，缓存命中率直接影响成本。`CacheSafeParams` 不是"优化措施"，而是"任何新 API 调用默认都应该尝试复用父请求缓存"的架构约束。`promptCacheBreakDetection` 不是"性能监控"，而是"基础设施健康检查"——就像你不会把 CPU 使用率监控叫做"优化"一样。如果缓存是基础设施，它不可用时系统应该降级运行而非崩溃——Claude Code 的缓存失效检测 + 告警机制正是这种可靠性保证的体现。

**Token 优化的 ROI 不均匀——不是每一层都值得同等投入。**

从源码来看，第二层（prompt cache 参数对齐）的 ROI 最高——一次参数错误就能导致成本翻 3 倍。第一层（裁剪 system prompt）和第四层（压缩上下文）是行业标配，重要但不是差异化竞争力。第三层（记忆提取频率控制）介于二者之间。对 AI 从业者来说，真正的启示不是"token 很贵要省着用"（这是常识），而是：**在整个 token 生命周期中，缓存层的优化杠杆最大，因为它影响的是乘数而非加数。**

---

## 类比

在传统软件工程里，我们有"内存不是免费的"（所以我们用 LRU 缓存、内存池、引用计数）和"网络 I/O 不是免费的"（所以我们批量请求、连接复用、CDN 加速）的思维定式。

AI 应用增加了一个新约束：**token 不是免费的**，它直接转化为成本，而且有上限（context window）。

需要注意的是，"把稀缺资源当一等公民"本身是软件工程的通用原则——嵌入式系统把每一字节 RAM 当一等公民，移动开发把电池寿命当一等公民，游戏引擎把每一帧的渲染预算当一等公民。Claude Code 的贡献不在于发明了"资源敏感设计"这个理念，而在于**具体展示了 token 经济学如何影响 AI 应用的每一个架构决策**——从 system prompt 的内容取舍、到缓存键的参数对齐、到压缩机制的六级渐进策略。这些是 token 约束下的具体实践，是其他资源约束领域没有现成答案的。

---

## 代码落点

- `src/utils/forkedAgent.ts`：`CacheSafeParams` 类型定义和 `createCacheSafeParams()` 工厂函数——所有 forked agent 的缓存共享基础
- `src/services/api/promptCacheBreakDetection.ts`：缓存失效检测系统——跟踪 12+ 个参数维度，API 调用后实时检测缓存断裂
- `src/services/PromptSuggestion/promptSuggestion.ts`：prompt prediction 的缓存安全约束——包含 PR #18143 教训的完整注释
- `src/services/SessionMemory/sessionMemoryUtils.ts`：三阈值配置和判断逻辑——默认值 10000/5000/3 token
- `src/services/mcp/client.ts`：MCP 工具描述 2048 字符截断——"caps the p95 tail without losing the intent"
- `src/services/compact/autoCompact.ts`：自动压缩阈值计算——`有效上下文窗口 - 13000` token 缓冲
- `src/tools/AgentTool/loadAgentsDir.ts`：`omitClaudeMd` 定义——包含 "~5-15 Gtok/week across 34M+ Explore spawns" 注释

## 代价与权衡

把 token 当一等公民也有代价，且每一层的代价不同：

- **缓存层的代价最重**：`CacheSafeParams` 的维护成本不低——任何改动 system prompt 结构或 API 参数的需求都要考虑缓存兼容性。这实际上在系统架构中创建了一个**隐式耦合**：所有 forked agent 的参数自由度被父请求约束住了。
- **裁剪层的质量风险**：让子 Agent 跳过 CLAUDE.md 加载，意味着它失去了项目上下文。源码中通过 feature flag `tengu_slim_subagent_claudemd` 提供了远程回滚能力，但并未看到公开的 A/B 测试数据说明这对输出质量的影响程度。
- **压缩层的信息损失**：六级压缩的每一级都意味着信息损失。过早压缩会丢弃后续可能需要的上下文，过晚则冒着 context overflow 的风险。

更根本的是，从 2023 年到 2025 年，主流 LLM 的 token 价格呈**数量级的下降趋势**（具体倍数因模型/服务商/量级而异，请以 OpenAI、Anthropic 等各家官方 pricing 页面和历史 release notes 为准；本书不给出精确倍数以避免误导）。**这不是假设，这是正在发生的趋势**。Claude Code 今天精心设计的六级压缩机制和缓存对齐策略，在未来可能变成维护负担。但也正因如此，理解哪些优化的 ROI 最高（缓存层 > 裁剪层 > 压缩层）才更重要——价格下降时，低 ROI 的优化应该首先被简化。
