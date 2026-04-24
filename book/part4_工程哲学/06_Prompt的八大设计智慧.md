# Prompt 的八大设计智慧：从大量提示词模板中提炼的工程哲学

从 Claude Code 2.1.88 源码中发现的大量 Prompt 模板（Part 2 第 14 章「Prompt 原文集」收录了完整编号），不仅是"让 AI 工作的指令"——它们是 Anthropic 工程团队在数万次实验中沉淀的 **AI 行为工程学**。这些模板里藏着一种反常识的认知：问题不是"如何让 AI 理解任务"，而是"如何对抗 AI 在完成任务时会不自觉产生的系统性偏差"。

本章从这些模板中提炼八条核心设计智慧，每条都指向一个可以直接应用到你自己 AI 系统的工程判断。

---

## 智慧一：反惰性工程学 — 用 Prompt 对抗 LLM 的认知偏差

**核心洞察：LLM 存在系统性的行为偏差——倾向于跳过验证、虚构成功信号、过度设计、回避困难检查。Anthropic 的解法不是寄希望于模型"自觉表现好"，而是把失败模式一条条写进 Prompt，然后告诉模型：你会产生做 X 的冲动，认出它，然后反其道而行之。**

这是一种对 AI 实施的认知行为疗法（CBT）——先命名扭曲的思维模式，再用显式规则覆盖。

### 来自源码的证据

**证据一：verificationAgent.ts 的"借口清单"**

`src/tools/AgentTool/built-in/verificationAgent.ts` 第 53-60 行（标题 + 引入句 + 6 条借口清单），验证 Agent 的 Prompt 写道：

```
=== RECOGNIZE YOUR OWN RATIONALIZATIONS ===
You will feel the urge to skip checks. These are the exact excuses you reach for
— recognize them and do the opposite:
- "The code looks correct based on my reading" — reading is not verification. Run it.
- "The implementer's tests already pass" — the implementer is an LLM. Verify independently.
- "This is probably fine" — probably is not verified. Run it.
- "Let me start the server and check the code" — no. Start the server and hit the endpoint.
- "I don't have a browser" — did you actually check for mcp__claude-in-chrome__*?
- "This would take too long" — not your call.
```

Anthropic 把六条具体的借口直接刻进 Prompt，每条后面接着反驳指令。这不是泛泛的"认真验证"——是预判好模型会说哪些话来合理化不验证，然后预先拦截。

**证据二：`prompts.ts` 的"虚假成功"防线**

`src/constants/prompts.ts` 第 240 行（ant-only 区块）：

```
Report outcomes faithfully: if tests fail, say so with the relevant output; if you
did not run a verification step, say that rather than implying it succeeded.
Never claim "all tests pass" when output shows failures, never suppress or simplify
failing checks (tests, lints, type errors) to manufacture a green result...
```

这条规则的出现背景有迹可循：注释 `// @[MODEL LAUNCH]: False-claims mitigation for Capybara v8 (29-30% FC rate vs v4's 16.7%)`——数据是 Capybara v8 模型的虚假声明率从 v4 的 16.7% 上升到了 29-30%，Anthropic 专门为此写了这条 Prompt 来压制这个回归。

**证据三：`Doing Tasks` 的反过度工程规则**

`src/constants/prompts.ts` 第 201-203 行：

```
Don't add features, refactor code, or make "improvements" beyond what was asked.
Three similar lines of code is better than a premature abstraction.
```

LLM 有天然的"帮倒忙"倾向——用户让改一行 bug，模型把整个模块重构了。这条规则显式对抗这个倾向。

### 为什么这对 AI 工程社区重要

大部分团队在"模型不按预期行为"时的第一反应是换模型或者加更多通用性指令。Anthropic 的方法是：**测量具体的失败模式，然后用外科手术式的 Prompt 对症处理**。这要求你先知道模型会在什么具体场景下失败，再针对性地写指令。

> **💡 通俗理解**：就像教新员工时，与其说"要认真负责"，不如说"当你觉得'代码看起来没问题'的时候，停下来，真的跑一下测试。我知道你会有这个冲动，这是每个工程师都会犯的毛病。"

### 可操作建议

1. **为你的 AI 应用建立"失败模式日志"**：每当模型产生不期望的行为，记录下来——不是记录结果，而是记录它当时的"推理路径"（通过 extended thinking 或 chain-of-thought 观察）。
2. **把 Top 5 失败模式写进系统 Prompt**：格式为"你会有 X 的冲动，这是错的，正确做法是 Y"。
3. **设置行为基准测试**：每次调整 Prompt 后，用固定的测试用例集测量失败率，而非主观判断。

---

## 智慧二：Prompt 即可执行规范 — 当提示词取代了文档

**核心洞察：`/security-review`（196 行）和 `/init`（224 行）不是"对 AI 的指令"，而是完整的工程规范，只不过写成了 Prompt 的形式。它们本可以是 PDF 文档交给人类工程师——但写成 Prompt 之后，规范本身就成了执行者。**

### 来自源码的证据

**证据一：security-review.ts 的 17 条硬性排除规则**

`src/commands/security-review.ts` 第 143-176 行，安全审查 Prompt 包含一个明确的"不报告清单"：

```
HARD EXCLUSIONS - Automatically exclude findings matching these patterns:
1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks.
2. Secrets or credentials stored on disk if they are otherwise secured.
...
10. Memory safety issues such as buffer overflows are impossible in rust.
    Do not report memory safety issues in rust or any other memory safe languages.
...
16. Regex DOS concerns.
17. Insecure documentation. Do not report any findings in documentation files.
```

再加上 PRECEDENTS（先例）清单，这是一个经过真实安全审查工作沉淀下来的专业判断标准，被直接编码到了 Prompt 里。一个安全工程师新人，照着这份 Prompt 工作，就等于站在了整个团队积累的经验肩上。

**证据二：/init 的 8 阶段向导**

`src/commands/init.ts` 的 NEW_INIT_PROMPT 描述了一个完整的 8 阶段流程：Phase 1（问用户想设置什么）→ Phase 2（探索代码库）→ Phase 3（填补信息空缺）→ Phase 4（写 CLAUDE.md）→ Phase 5（写 CLAUDE.local.md）→ Phase 6（生成 Skills）→ Phase 7（建议额外优化）→ Phase 8（最终确认）。

这是一个完整的产品向导设计，包含决策逻辑、用户访谈策略、约束传播（Phase 1 的选择约束 Phase 3-7 的行为）。如果把这份 Prompt 打印出来，它本身就是一份产品规格说明书。

**证据三：verificationAgent.ts 的输出格式强制**

验证 Agent 第 82-100 行定义了严格的输出模板，并附上了"好/坏"的对比示例——bad 示例用引用块展示，good 示例带完整的命令输出。这已经是一份"如何写验证报告"的操作手册，只不过执行者是 AI。

### 为什么这对 AI 工程社区重要

传统做法是把知识放在文档里，再让 AI 读文档。Anthropic 的做法是：**知识直接嵌入 Prompt，Prompt 直接驱动行为**。这消除了"文档和执行之间的翻译层"。当你的 Prompt 写得足够完整，它就既是规范也是实现。

> **💡 通俗理解**：普通做法是写一本"如何做安全审查"的手册，然后让 AI 读手册、再做审查。Anthropic 的做法是：手册本身就是 AI 接收到的任务书，读完即开工，没有中间商。

### 可操作建议

1. **用"能否打印给人类工程师用"作为 Prompt 质量标准**：如果一个 Prompt 打印出来，一个人类专家能照着执行，它就足够清晰。
2. **把团队的专业判断写进 Prompt**：你们多年积累的"不要报告 X 类问题"的判断，应该明确出现在 Prompt 里，而不是假设 AI 会自己领悟。
3. **为复杂工作流使用阶段结构**：大型任务拆成有编号的 Phase，每个 Phase 有明确的输入、输出、约束，Phase 间有信息传递关系。

---

## 智慧三：内外双面 — Feature Flag 驱动的 Prompt A/B 测试

**核心洞察：大量 Prompt 规则只对 Anthropic 内部用户（`process.env.USER_TYPE === 'ant'`）生效，外部用户拿到的是另一套版本。这不是偶然——这是 Anthropic 在用生产流量做 Prompt 的 A/B 测试：内部先用更严格或更新的版本，验证无副作用后再逐步推向外部。**

### 来自源码的证据

**证据一：5 条 ant-only 行为规则**

`src/constants/prompts.ts` 里，以下规则只在 `process.env.USER_TYPE === 'ant'` 时激活：

- 注释写作规范（"默认不写注释，只有逻辑不显而易见时才写"）
- 主动反驳用户错误假设（"如果发现用户的请求基于误解，说出来"）
- 完成前必须验证（"报告任务完成前，先实际运行验证"）
- 忠实报告失败（"测试失败就说失败，不要制造绿灯"）
- 数值长度约束（"工具调用之间的文字不超过 25 词"）

**证据二：两套完全不同的输出效率指令**

`src/constants/prompts.ts` 第 403-427 行，`getOutputEfficiencySection()` 函数根据 `USER_TYPE` 返回截然不同的内容：

- **ant 版本**：594 字的"Communicating with the user"——强调写作质量、inverted pyramid 结构、避免认知开销
- **外部版本**：短得多的"Output efficiency"——强调简洁、直接、省略铺垫

这不是同一个意思的两种表达，是两套完全不同的沟通哲学，分别针对两类用户实验。

**证据三：`@[MODEL LAUNCH]` 注释揭示的发布流程**

`src/constants/prompts.ts` 里散布着多处 `@[MODEL LAUNCH]` 注释，例如：

```javascript
// @[MODEL LAUNCH]: capy v8 assertiveness counterweight (PR #24302)
// — un-gate once validated on external via A/B
...(process.env.USER_TYPE === 'ant' ? [
  `If you notice the user's request is based on a misconception...`
] : []),
```

"un-gate once validated on external via A/B"——这是明确的发布计划标注。新规则先内测，A/B 验证通过后再解除 gate 推向外部。`prompts.ts` 里的每一个 ant-only 区块，都是一个准备发布的特性候选。

### 为什么这对 AI 工程社区重要

大多数团队把 Prompt 当成单一版本管理，测试靠主观感受。Anthropic 的方案是：**把 Prompt 视为可 A/B 测试的产品功能，用 Feature Flag 控制曝光，用定量指标决定发布**。这把 Prompt 工程从"写文字"变成了"发布产品功能"。

> **💡 通俗理解**：就像药厂上新药——不会直接给全国用户吃，而是先做一期临床（内部员工，ant-only）、再做二期临床（小比例外部用户，A/B gate）、数据达标后才全面推广。Prompt 的每条新规则就是一颗新药，`@[MODEL LAUNCH]` 注释就是审批批文的编号。

### 可操作建议

1. **建立 Prompt 的 Feature Flag 机制**：新增的行为约束先给内部用户或小比例用户，收集数据再扩大。
2. **为每个 Prompt 变更附上假设**：不要只写"改了什么"，写"我们预期这个改变会使 X 指标提升 Y%"。
3. **为不同用户群维护不同 Prompt 配置**：高级用户、新手用户、内部用户可以有不同的行为约束。

---

## 智慧四：Eval 驱动的迭代 — 数据消灭直觉

**核心洞察：`memoryTypes.ts` 的注释里直接嵌入了量化实验数据，记录着具体 Prompt 改动带来的 eval 测试通过率变化。这证明 Anthropic 用定量评估来调优 Prompt——不靠感觉，靠测量。**

### 来自源码的证据

**证据一：H1/H5 实验数据**（源码中 `memory-prompt-iteration.eval.ts` 共有 H1-H6 多条假设，本章展开其中影响最直观的 H1 和 H5，H6 及其他假设的详细数据在源码的 eval 文件里可查）

`src/memdir/memoryTypes.ts` 第 228-244 行，TRUSTING_RECALL_SECTION 的注释：

```javascript
// Eval-validated (memory-prompt-iteration.eval.ts, 2026-03-17):
//   H1 (verify function/file claims): 0/2 → 3/3 via appendSystemPrompt.
//      When buried as a bullet under "When to access", dropped to 0/3 —
//      position matters.
//   H5 (read-side noise rejection): 0/2 → 3/3 via appendSystemPrompt,
//      2/3 in-place as a bullet.
//
// Known gap: H1 doesn't cover slash-command claims (0/3 on the /fork case)
```

解读：
- H1 假设（记忆文件验证）：原来在 `## When to access` 下作为一个 bullet，通过率 0/3；改成独立章节 `## Before recommending from memory` 后，通过率 3/3。**位置变了，文字没变，通过率从 0% 跳到 100%。**
- H5 假设：appendSystemPrompt 方式 3/3，in-place 方式 2/3。

**证据二：H2 的显式保存门控**

同文件第 192-194 行：

```javascript
// H2: explicit-save gate. Eval-validated (memory-prompt-iteration case 3,
// 0/2 → 3/3): prevents "save this week's PR list" → activity-log noise.
'These exclusions apply even when the user explicitly asks you to save...'
```

H2 实验：在排除规则里加上"即使用户明确要求保存也不保存"，使该场景通过率从 0/2 提升到 3/3。

**证据三：章节标题的 A/B 测试**

`memoryTypes.ts` 第 240-244 行有一条罕见的注释：

```javascript
// Header wording matters: "Before recommending" (action cue at the decision
// point) tested better than "Trusting what you recall" (abstract).
// The appendSystemPrompt variant with this header went 3/3;
// the abstract header went 0/3 in-place. Same body text — only the header differed.
```

**同样的正文，只改了章节标题**，通过率从 0/3 变成 3/3。这证明了一个反直觉的结论：在 Prompt 里，**结构和位置的影响力不亚于内容本身**。

### 为什么这对 AI 工程社区重要

"这个 Prompt 写得好不好"是一个定性问题，大多数人只能靠感觉回答。Anthropic 把它变成了一个定量问题：**在固定的 eval 测试集上，通过率是多少？** 这使得 Prompt 优化有了客观标准，不再是玄学。

> **💡 通俗理解**：写 Prompt 过去像厨师调味——"多放点盐吧感觉淡了"，全靠经验。现在像做化学实验——每次只换一种试剂（位置 / 标题 / 措辞），其他条件不变，看反应结果（eval 通过率）。H1 实验的 0/3 → 3/3 就是这种实验室作风的产物。

### 可操作建议

1. **为每个关键行为建立 eval 测试用例**：至少 5 个用例，覆盖正常路径和边界情况（"至少 5 个"是作者基于通用测试工程经验的建议，不是源码里硬性规定的数字——你的团队可以根据风险等级调整）。
2. **把 eval 数据写进注释**：和代码一样，Prompt 变更需要理由和证据——"从 X 改成 Y，eval 通过率从 a% 提升到 b%"。
3. **单变量测试**：每次只改一个变量（位置/标题/措辞），否则你无法知道是什么起了作用。

---

## 智慧五：类型系统守护分布式一致性 — CacheSafeParams 的编译时安全

**核心洞察：`CacheSafeParams` 是一个 TypeScript 接口，它把"子 Agent 必须与父 Agent 共享相同的缓存参数"这条分布式系统约束，从"运行时规则 + 文档叮嘱"提升到"类型系统级别的结构性约束"。严格来说，TypeScript 类型只强制"你必须提供这 5 个字段"，不强制"它们的值必须等于父 Agent"——但通过把这些字段打包成一个不可分割的类型结构体（调用方要么整包传递父 Agent 的 `cacheSafeParams`，要么自己从头构造 5 个字段），在实践中大幅降低了"只改其中一个字段导致缓存失效"的概率。这在 AI 工程领域是少见的做法——大多数团队用运行时校验或文档约定处理类似约束。**

### 来自源码的证据

**证据一：CacheSafeParams 类型定义**

`src/utils/forkedAgent.ts` 第 57-68 行：

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

类型注释清楚写着"must match parent for cache hits"——这不是建议，是通过类型系统强制执行的契约。

**证据二：ForkedAgentParams 的警告注释**

同文件第 83-113 行，`ForkedAgentParams` 类型里有一条不寻常的警告：

```typescript
/**
 * Optional cap on output tokens. CAUTION: setting this changes both max_tokens
 * AND budget_tokens (via clamping in claude.ts). If the fork uses cacheSafeParams
 * to share the parent's prompt cache, a different budget_tokens will invalidate
 * the cache — thinking config is part of the cache key.
 * Only set this when cache sharing is not a goal (e.g., compact summaries).
 */
maxOutputTokens?: number
```

这条注释揭示了一个隐蔽的缓存失效陷阱：设置 `maxOutputTokens` 会改变 `budget_tokens`，而 thinking config 是缓存 key 的一部分，所以设置这个看似无关的参数会导致整个缓存失效。通过把它放在强类型接口里并附上 CAUTION 注释，这个知识被"固化"到了代码结构中。

**证据三：全局 CacheSafeParams 槽位**

同文件第 73-80 行：

```typescript
// Slot written by handleStopHooks after each turn so post-turn forks
// (promptSuggestion, postTurnSummary, /btw) can share the main loop's
// prompt cache without each caller threading params through.
let lastCacheSafeParams: CacheSafeParams | null = null

export function saveCacheSafeParams(params: CacheSafeParams | null): void
export function getLastCacheSafeParams(): CacheSafeParams | null
```

每轮对话结束后，系统自动把 CacheSafeParams 存在全局槽位里，让后续的 fork（如 promptSuggestion、postTurnSummary）可以直接复用，而不需要每个调用方单独传参。这是一个把分布式缓存协调问题从应用层下沉到基础设施层的设计。

### 为什么这对 AI 工程社区重要

在多 Agent 系统里，Prompt Cache 命中率直接影响成本和延迟。但缓存失效的原因可能非常隐蔽（比如只改了 `max_tokens` 就让整个系统 prompt 的缓存失效）。把缓存约束编码到类型系统里，让编译器替你守门，这是一个将运维知识转化为编码约束的思路。

> **💡 通俗理解**：就像在建筑设计图上用不同颜色的笔标注"这两根承重柱必须对齐，否则楼会塌"——不是靠施工人员记住，而是把约束画进图纸结构本身，不满足就根本建不起来。

### 可操作建议

1. **用类型系统编码缓存约束**：如果某些参数必须一起变化（或一起保持不变），用类型把它们捆绑成一个结构体。
2. **在 API 注释里写隐蔽的缓存失效场景**：不要假设调用者知道 `maxOutputTokens` 会影响 thinking config，直接写进 CAUTION 注释。
3. **设计"缓存安全"的子 Agent 启动入口**：把需要从父 Agent 继承的所有参数封装成一个类型，强制调用方传入，而不是提供一个"按需填写"的配置对象。

---

## 智慧六：Prompt 作为编译器 — 从自然语言到结构化输出

**核心洞察：`/loop` skill 的 Prompt 不是"描述任务的指令"，而是一个真正的**编译器**——它接收自然语言输入（`"check the deploy every 20m"`），按照优先级规则解析，提取 interval 和 prompt，生成 cron 表达式，输出到 `CronCreate` 工具。Prompt 里有语法规则、优先级顺序、边界情况、转换表，这就是一个 DSL 解析器。**

### 来自源码的证据

**证据一：三级解析优先级规则**

`src/skills/bundled/loop.ts` 第 31-43 行：

```
## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches `^\d+[smhd]$`
   (e.g. `5m`, `2h`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with `every <N><unit>`
   or `every <N> <unit-word>` (e.g. `every 20m`, `every 5 minutes`), extract that
   as the interval. Only match when what follows "every" is a time expression
   — `check every PR` has no interval.
3. **Default**: otherwise, interval is `10m` and the entire input is the prompt.
```

这是一个三层的歧义消解算法，用自然语言写成，但逻辑等价于一个正则表达式匹配器和优先级解析器。

**证据二：interval 到 cron 的转换表**

同文件第 49-57 行，一个完整的转换表：

| Interval pattern | Cron expression | Notes |
|------------------|-----------------|-------|
| `Nm` where N ≤ 59 | `*/N * * * *` | every N minutes |
| `Nm` where N ≥ 60 | `0 */H * * *`（此处 `H = floor(N/60)`，即把 N 分钟向下取整为整小时数） | round to hours |
| `Nh` where N ≤ 23 | `0 */N * * *` | every N hours |
| `Nd` | `0 0 */N * *` | every N days at midnight |
| `Ns` | treat as `ceil(N/60)m` | cron minimum granularity is 1 minute |

这是一个从 human-readable 时间表示到 cron 表达式的完整映射规则，包含边界情况处理（秒级向上取整、N≥60 分钟自动升级为小时）。

**证据三：边界情况的显式列举**

同文件第 58-60 行：

```
If the interval doesn't cleanly divide its unit (e.g. `7m` → `*/7 * * * *` gives
uneven gaps at :56→:00; `90m` → 1.5h which cron can't express), pick the nearest
clean interval and tell the user what you rounded to before scheduling.
```

编译器需要处理不合法输入——`7m` 会在 cron 里产生不均匀间隔，`90m` 无法表达。Prompt 把这些边界情况逐一处理，就像一个编译器的错误恢复机制。

### 为什么这对 AI 工程社区重要

通常我们把"自然语言 → 结构化格式"的转换视为一个 AI 黑盒问题。`/loop` 展示了另一种方式：**在 Prompt 里明确写出解析算法，把 AI 当作一个受控的解释器**。这使得行为可预测、可测试、可调试。

> **💡 通俗理解**：普通 Prompt 是"你给我翻译一下这句话"——翻译得好不好看运气；`/loop` 的 Prompt 是"这里是翻译规则手册：第一优先级按这个规则走，第二优先级按那个规则走，遇到 7 这样的除不尽的数就这样处理"——AI 不再是译者，而是按手册办事的公务员。

### 可操作建议

1. **对有明确解析逻辑的任务，把解析规则显式写进 Prompt**：不要期望 AI 自己摸索，把优先级、边界情况、转换规则都写清楚。
2. **用表格表达映射关系**：Interval → Cron 的转换表让 AI 的行为完全可预测，比自然语言描述更可靠。
3. **在 Prompt 里处理边界情况**：AI 需要像编译器一样，对不合法或模糊的输入有明确的处理策略，而不是靠猜测。

---

## 智慧七：元提示词 — 用 Prompt 教 AI 写 Prompt

**核心洞察：AgentTool 的描述文本告诉 Claude 如何给子 Agent 写好的 Prompt；而 `AGENT_CREATION_SYSTEM_PROMPT` 更进一步——它把 Claude 转化为一个"AI Agent 架构师"，接收用户的自然语言描述，输出完整的 Agent 配置 JSON。这是在用 Prompt 生成 Prompt——元级别的 Prompt 工程。**

### 来自源码的证据

**证据一：AgentTool 里的写作指导**

`src/tools/AgentTool/prompt.ts` 第 103-112 行：

```
Brief the agent like a smart colleague who just walked into the room — it hasn't
seen this conversation, doesn't know what you've tried, doesn't understand why
this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make
  judgment calls rather than just following a narrow instruction.

**Never delegate understanding.** Don't write "based on your findings, fix the bug"
or "based on the research, implement it." Those phrases push synthesis onto the
agent instead of doing it yourself.
```

这段 Prompt 不是在告诉 Claude 做什么任务，而是在教它**如何给另一个 Claude 写 Prompt**。这是元提示词：Prompt 的 Prompt。

**证据二：AGENT_CREATION_SYSTEM_PROMPT**

`src/components/agents/generateAgent.ts` 第 26-96 行，完整的 Agent 创建系统 Prompt：

```
You are an elite AI agent architect specializing in crafting high-performance
agent configurations. Your expertise lies in translating user requirements into
precisely-tuned agent specifications...

When a user describes what they want an agent to do, you will:
1. Extract Core Intent
2. Design Expert Persona
3. Architect Comprehensive Instructions
4. Optimize for Performance
5. Create Identifier
```

这个 Prompt 把 Claude 变成了一个专业的 Prompt 工程师。用户输入"我想要一个代码审查 Agent"，模型输出一个包含 `identifier`、`whenToUse`、`systemPrompt` 三个字段的 JSON——这个 JSON 本身就是另一个 AI Agent 的完整 Prompt 配置。

**证据三：记忆指令的动态注入**

同文件第 100-120 行，`AGENT_MEMORY_INSTRUCTIONS` 块只在 `isAutoMemoryEnabled()` 时追加到 AGENT_CREATION_SYSTEM_PROMPT：

```javascript
const systemPrompt = isAutoMemoryEnabled()
  ? AGENT_CREATION_SYSTEM_PROMPT + AGENT_MEMORY_INSTRUCTIONS
  : AGENT_CREATION_SYSTEM_PROMPT
```

这是三层嵌套的元提示词：第一层是生成 Agent Prompt 的系统 Prompt，第二层是动态追加的记忆指令模块，第三层是最终生成出来的目标 Agent 的 systemPrompt。

### 为什么这对 AI 工程社区重要

构建多 Agent 系统时，子 Agent 的质量直接依赖于为它们写的 Prompt 的质量。Anthropic 的解法是：**用一个专门优化过的元 Prompt 来自动生成子 Agent 的 Prompt**，从而把"写好子 Agent Prompt"这个技能封装成可复用的基础设施。

> **💡 通俗理解**：想象你要招一批专职文员，每个岗位都要写一份岗位说明书——过去是人事经理挨个写（手工维护 Prompt），现在是让 HR 总监写一份"如何写岗位说明书的指南"（元 Prompt），然后拿这份指南去让每个部门经理自动生成自己岗位的说明书。元 Prompt 就是"生产说明书的说明书"。

### 可操作建议

1. **为你的 AI 系统建立"Prompt 生成器"**：用一个专门的 Agent 或 Prompt 来生成其他 Agent 的配置，而不是手工维护每个 Agent 的 Prompt。
2. **把"写好 Prompt"的标准显式化**：像 AgentTool 那样，把"如何给子 Agent 写好 Prompt"的规则写成可引用的指南。
3. **区分写 Prompt 的指导原则和 Prompt 本身**：前者是元层面的知识，值得单独管理和迭代。

---

## 智慧八：认知科学映射 — Dream 不是比喻，是设计方法论

**核心洞察：记忆系统的 Dream 整合过程借鉴了认知科学中的记忆巩固理论。Dream 提示词把巩固流程显式拆成四阶段（Orient / Gather / Consolidate / Prune），这四阶段与"情节记忆→语义记忆→程序记忆"（episodic → semantic → procedural）的认知模型**不是一一对应**的——Gather/Consolidate 对应的是"情节→语义"的提取过程，Prune 对应索引维护，Orient 是唤醒现有图式；"程序记忆"（procedural）在 Dream 四阶段中没有明确对应物。本章使用这一类比是为了描述设计灵感来源，不是严格的神经科学映射。Phase 2 里的"不要穷举阅读 transcript，只寻找你已经怀疑重要的东西"是对睡眠巩固"假设驱动的再激活，而非全量重放"这一流行假说的工程化模拟。这说明 Anthropic 在用认知科学作为设计方法论的灵感源头，不只是作为修辞比喻。**

### 来自源码的证据

**证据一：Dream 的四阶段结构**

`src/services/autoDream/consolidationPrompt.ts` 第 15-64 行，buildConsolidationPrompt 构建的 Prompt：

```
# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files.
Synthesize what you've learned recently into durable, well-organized memories
so that future sessions can orient quickly.

## Phase 1 — Orient
## Phase 2 — Gather recent signal
## Phase 3 — Consolidate
## Phase 4 — Prune and index
```

这四个阶段对应认知科学的记忆巩固过程：Orient（激活工作记忆中的现有图式）→ Gather（选择性再激活近期情节记忆）→ Consolidate（提取核心语义，形成长时记忆）→ Prune（索引优化，维持记忆检索效率）。

**证据二：假设驱动的信息筛选**

同文件第 37-41 行：

```
Don't exhaustively read transcripts. Look only for things you already
suspect matter.
```

这句话是整个设计最关键的地方。人类睡眠期间的记忆巩固不是把一天的经历完整重放——认知科学文献中的一种流行假说认为，大脑在巩固时是假设驱动的：优先重激活与已有图式冲突的、情感权重高的、或预测错误的事件（此处作为工程灵感借鉴，非严格神经科学结论——见本章末"代价表"中的"认知科学映射"条目）。"只寻找你已经怀疑重要的东西"——正是对这个隐喻的工程化模拟。

**证据三：记忆衰减的时间语义**

`src/memdir/memoryTypes.ts` 第 78-80 行的 project 记忆写作规范：

```
Always convert relative dates in user messages to absolute dates when saving
(e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after
time passes.
```

这对应认知科学中的"时间编码"（temporal tagging）——记忆需要锚定到绝对时间点才能在检索时正确评估新鲜度和相关性。

### 为什么这对 AI 工程社区重要

大多数 AI 记忆系统用简单的向量数据库实现，把"记忆"等同于"检索"。Anthropic 的 Dream 系统体现了一个更深层的认知架构：**记忆不只是存储和检索，还包括主动的巩固（consolidation）——把碎片化的情节记忆转化为结构化的语义知识，删除过期内容，维护索引完整性**。把认知科学的机制映射到 Prompt 设计，是一种有理论支撑的工程决策。

> **💡 通俗理解**：你记住的不是昨天每分钟发生了什么，而是"昨天开会，老板说了一个重要决定"——你的大脑在睡眠时做了浓缩整理。Dream 系统模拟的就是这个整理过程：不读完所有聊天记录，而是主动寻找值得长期记住的东西。

### 可操作建议

1. **区分"记录"和"巩固"**：不要把所有对话内容直接存为记忆，设计一个专门的巩固步骤来提取真正值得长期保留的知识。
2. **使用假设驱动的记忆筛选**：巩固时让 AI 先形成"什么可能值得记住"的假设，再有针对性地搜索，而不是全量读取。
3. **为记忆设计时间语义**：相对日期（"上周"、"明天"）在保存时应转换为绝对日期，记忆的衰减和检索优先级应考虑时间距离。

---

## 综合：从 Prompt 工程到 AI 行为工程

这八条智慧合在一起，指向一个更大的范式转变。

**旧范式——Prompt 工程（Prompt Engineering）**：写一段聪明的文字，让 AI 理解任务，然后执行。核心问题是"如何描述任务"，核心技能是措辞和结构。

**新范式——AI 行为工程（AI Behavioral Engineering）**：把 AI 视为一个有系统性偏差的认知系统，通过 Prompt 的结构设计来塑造其行为特征、习惯模式和失败模式。核心问题是"AI 会在哪里偏离期望，如何系统性地纠正"，核心技能是测量、实验和约束设计。

从源码里看，这个范式转变体现在几个具体的转化：

| # | Prompt 工程的思路 | AI 行为工程的思路 | 源码例证 |
|---|---|---|---|
| 一 | 写清楚任务描述 | 预测失败模式，显式命名并反制 | verificationAgent 的六条借口清单 |
| 二 | Prompt 作为简单指令 | Prompt 作为可执行规范，直接编码操作规程与专业判断 | /security-review 的 17 条 HARD EXCLUSIONS + /init 的 8 阶段向导 |
| 三 | 一个版本对所有用户 | Feature Flag 控制曝光，A/B 测试驱动迭代 | ant-only 区块 + @[MODEL LAUNCH] 注释 |
| 四 | 靠直觉判断 Prompt 好坏 | 定量 eval 测试，数据驱动优化 | memoryTypes.ts 的 H1 0/2→3/3 记录 |
| 五 | 运行时发现缓存问题 | 编译时通过类型系统强制缓存约束 | CacheSafeParams 接口 |
| 六 | 描述任务 | 编码解析算法和转换规则 | /loop 的三级解析规则和 cron 转换表 |
| 七 | 人工写子 Agent Prompt | 元 Prompt 自动生成子 Agent 配置 | generateAgent.ts 的 AGENT_CREATION_SYSTEM_PROMPT |
| 八 | 简单存储和检索记忆 | 模拟认知巩固机制，假设驱动筛选 | autoDream consolidationPrompt |

**真正的工程化是可预测的失败**。一个成熟的 AI 系统不应该让你担心"这次 AI 会不会犯这个错"，而是让你清楚地知道"在哪些场景下它会失败，失败的概率是多少，我们采取了什么措施降低这个概率"。

Anthropic 的 大量 Prompt 模板（Part 2 第 14 章「Prompt 原文集」收录了完整编号）是这个方向的一份工程档案——它们的价值不在于文字本身，而在于文字背后的实验记录、失败案例和测量数据。这才是 AI 工程从艺术走向科学的必经之路。

## 八条智慧的代价：批判性反思

这八条智慧不是免费的午餐。每一条在解决一个问题的同时，都引入了新的复杂性、维护成本或权衡：

| 智慧 | 引入的代价/局限 |
|------|----------------|
| **预测失败模式** | verificationAgent 的"借口清单"很可能是一份从生产实践中蒸馏出来的档案——每一条读起来都像是"被 AI 真的这么说过"的反应（这是基于清单措辞的合理推断，具体每条是否对应特定 incident 源码里没有留下 case ID 或 PR 引用）。如果清单确实是从实际失败中归纳的，那就意味着新的失败模式只能在生产环境暴露后才能加入清单，存在**回顾性偏差**：未发生的失败模式无法被预先防范 |
| **Feature Flag 双轨** | ant-only/external 双版本意味着内部和外部用户体验存在系统性差异，调试时"我看到的行为"和"用户看到的行为"可能不一致，**增加了支持成本** |
| **数据驱动 eval** | H1/H2/H5/H6 等假设测试需要持续维护测试集和 ground truth，**eval 本身的维护成本**会随着系统演进不断累积。源码中没有 eval 退役机制 |
| **类型系统强制约束** | CacheSafeParams 把缓存共享的约束编码进类型，但也**绑定了 Anthropic API 的具体缓存键计算规则**——如果 API 实现细节变化，类型定义需要同步更新 |
| **元 Prompt** | 用 Prompt 生成 Prompt 的设计在抽象层级上多了一层，**调试链条变长**：当生成的子 Agent 行为异常时，问题可能出在元 Prompt 的措辞、Claude 的解析、或子 Agent 的执行任一环节 |
| **认知科学映射** | Dream 借鉴的睡眠巩固机制是一个**未经神经科学严格验证**的工程类比——它"看起来合理"，但缺少跨域有效性证明。这种类比能否泛化到其他场景（如长期记忆衰减），源码没有提供答案 |

更宏观的批判：**这八条智慧整体上都依赖一个隐性假设——你有 Anthropic 级别的资源**。维护大量 Prompt 模板（Part 2 第 14 章「Prompt 原文集」收录了完整编号）、持续运行 eval 测试集、为每个失败模式做实验记录——这套方法论的边际成本对小团队来说极高。一个 3 人创业公司能否复制这套体系？源码暗示的答案是"按需采用"：从最高 ROI 的智慧（如类型系统约束）开始，而非全盘复制。

值得警惕的另一点是：**这八条智慧之间存在张力**。"数据驱动 eval"鼓励快速迭代和 A/B 实验；"类型系统强制约束"要求结构稳定性。两者在实践中需要平衡——过度依赖 eval 可能导致频繁打破类型契约，而过度强调类型稳定性可能扼杀实验空间。源码中没有给出明确的取舍框架，这是留给应用方的开放问题。

---

*本章引用的源码文件：*
- *`src/constants/prompts.ts` — 主系统 Prompt，包含 ant/external 双版本逻辑*
- *`src/tools/AgentTool/built-in/verificationAgent.ts` — 反惰性验证 Agent*
- *`src/tools/AgentTool/prompt.ts` — AgentTool 描述及元提示词规范*
- *`src/memdir/memoryTypes.ts` — 记忆类型系统及 eval 实验记录*
- *`src/utils/forkedAgent.ts` — CacheSafeParams 及 Fork Agent 基础设施*
- *`src/commands/security-review.ts` — 安全审查 Prompt 规范（196 行）*
- *`src/commands/init.ts` — /init 8 阶段向导（224 行）*
- *`src/skills/bundled/loop.ts` — /loop 编译器式 Prompt*
- *`src/components/agents/generateAgent.ts` — Agent 创建元 Prompt*
- *`src/services/autoDream/consolidationPrompt.ts` — Dream 记忆巩固 Prompt*
