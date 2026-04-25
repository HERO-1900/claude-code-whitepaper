# Token Economics: Cost, Caching, and Performance Engineering

Token consumption is the core cost constraint of Claude Code — every API call involves input token billing, Prompt Cache hit optimization, and output token budget control. This chapter unpacks how the system manages this "monetary system" through six layers of context compaction, cache-friendly prompt ordering, and speculative execution.

> **Source locations**: `src/utils/token.ts` (counting and budgets), `src/utils/compact.ts` (context compaction), `src/services/api/claude.ts` (API calls and cache parameters)

---

## 🌍 Industry Context: Token Cost Is the "Invisible Battlefield" of AI Products

Token consumption isn't just a technical detail — it's the **core business logic** of AI programming assistants. Every AI coding product is answering the same question: how do you deliver maximum value to the user within a finite token budget?

Each player takes a radically different approach:

| Product | Token Optimization Strategy | Pricing Model | Core Philosophy |
|------|--------------|---------|---------|
| **Claude Code** | Prompt Cache boundary engineering + context compaction + speculative execution | Per-token billing (API passthrough) | Maximize cache hit rate so users "buy more intelligence per dollar" |
| **Cursor** | Fast/Slow model switching + Background Agents on cloud resources | Tiered subscription ($20/$60/$200) | Digest cost via model tiers; cloud VM execution costs are baked into higher-tier subscriptions |
| **Kimi Code** | Agent swarm extreme concurrency + low-cost MoE models | API per-usage billing ($0.60/$3.00 per 1M tokens) | 1T MoE activates only 32B parameters, delivering extreme inference efficiency at roughly one-ninth the price of Claude Opus 4.5 |
| **Aider** | AST-level Repo Map compaction + Architect mode differentiated models | BYO API key | AST maps drastically cut context token consumption; top-tier models for high-level reasoning, low-cost models for edits |
| **OpenCode** | 75+ model providers (including local Ollama) | Fully open-source and free | Local model execution eliminates token cost at the root; Go+Zig backend has minimal runtime overhead |
| **MiniMax Code (M2.5)** | Pre-architecture spec + extremely low compute cost | Open weights / extremely low API cost | Running 100 tokens per second for a full hour costs only $1 — a crushing cost advantage |
| **GLM (Z.ai)** | 744B parameters + domestic Ascend 910B chips | Open weights / subscription | Fully trained on domestic chips; Z Code platform targets private deployment with data sovereignty |
| **GitHub Copilot** | Agent Mode full GA + enterprise MCP registry | Fixed subscription ($10–$19) | Microsoft amortizes cost via Azure scale; built-in Explore/Plan/Task specialist agents |

**Claude Code's unique position**: Among the AI coding tools studied in this research, Claude Code invests most systematically in Prompt Cache engineering — not merely using caching, but enforcing cache safety at compile time via the TypeScript type system (`CacheSafeParams`). For other products, caching is a "nice-to-have" optimization; for Claude Code, it's a "must-have-or-lose-money" core design constraint. This directly shapes the ordering of system prompts, the structure of messages, and even the loading timing of tool descriptions.

---

## 📚 Course Connection: An Operating-System Resource Scheduling Lens

If you've taken an OS course, the concepts of token economics will feel familiar — because at heart it's a **resource scheduling** problem.

| Token Economics Concept | OS Equivalent | Shared Essence |
|----------------|------------|---------|
| Token budget (200K limit) | **CPU time slice / memory quota** | Allocation of finite resources — every process gets a CPU quota, every conversation gets a token quota |
| Prompt Cache | **Page Cache** | Frequently accessed data lives in a fast tier to avoid repeated slow-tier reads |
| Context compaction | **Page replacement** | When space runs out, evict the "least important" content to make room for new content |
| Speculative execution | **CPU branch prediction** | Guess the next operation and execute early; zero latency if correct, discard if wrong |
| Cost optimization (maximize cache hit rate) | **CFS (Completely Fair Scheduler)** | Find the optimal resource allocation strategy among competing demands |
| `maxResultSizeChars` truncation | **Process memory limit (ulimit)** | Hard ceiling preventing a single consumer from exhausting shared resources |

> 💡 **Plain English**: Token scheduling is like **toll-booth lane management on a highway** — at rush hour you can't let every car use the express ETC lane (too expensive), but you also can't force every car through manual toll booths (too slow). The system must do this: turn the most frequent travelers (system prompts) into ETC subscribers (cached), route occasional travelers (new messages) to manual lanes, and throttle oversized convoys (large files). The goal is to let the maximum number of cars through (complete tasks) with the fewest toll collectors (token cost).

---

## Prologue: The City's Water Bill

Every month you pay your water bill without much thought — turn on the tap, water flows. But if you manage a city's water supply, every drop is costed precisely: source treatment, pipeline losses, peak/off-peak pricing, plant maintenance.

Claude Code's tokens are that city's "water." Every API call consumes tokens, and every token has a cost. A large swath of design decisions — context compaction, Prompt Cache, speculative execution, lazy tool-description loading — are fundamentally **water-resource management**: reduce waste, reuse what has already been processed, store water during off-peak hours. As one community developer summarized: "Context is the most expensive resource and must be actively managed."

> **🔑 OS Analogy:** Tokens are like **mobile data**. Prompt Cache = web pages already downloaded (no need to re-download on revisit); context compaction = clearing phone storage to free up space; token budget = your monthly data cap. The more you save, the more you can do.
>
> 💡 **Plain English**: Token economics is like **managing a mobile phone bill** — making calls (output tokens) = the most expensive voice charges; receiving calls (input tokens) = relatively cheap; in-plan calls (cache reads) = 10× cheaper; exceeding your plan (cache miss) = full price. The entire system is designed to keep you "in-plan" and minimize the bill.

---

## 1. The Four "Water Prices" of Tokens

Not all tokens cost the same. The Claude API has four token types:

> **⚠️ Pricing note**: The figures below are current as of mid-2025 when this research was written. Please refer to Anthropic's official pricing at anthropic.com/pricing. Prices and cache rates may vary by model and over time.

| Type | Price (Opus 4.6)| Relative Cost | Analogy |
|------|----------------|---------|------|
| Input Token | $15 / 1M | 1x | Municipal tap water |
| Output Token | $75 / 1M | 5x | Purified water (5× more expensive) |
| Cache Read Token | $1.5 / 1M | 0.1x | Recycled greywater |
| Cache Write Token | $18.75 / 1M | 1.25x | Up-front reservoir construction |

**Key insight**: Cache Read is **10× cheaper** than Input. That means every time you make a request prefix hit the cache, you're "buying water" at one-tenth the price. **A huge share of Claude Code's design decisions chases cache hit rate.**

> 💡 **Plain English**: Prompt Cache is like a **restaurant's prepped ingredients** — popular dishes are prepped in advance (cache write, an up-front investment), and next time you order them only the final step is cooked (cache read, 10× cheaper), saving huge amounts of time and cost. The entire prompt ordering is designed to keep the "first half of the recipe" as stable as possible so the "prepped ingredients" can be reused every time.

---

## 2. Prompt Cache: The System's "Reservoir"

### 2.1 How It Works

Anthropic's Prompt Cache mechanism: if the message prefix of two requests is identical (token-for-token), the repeated portion doesn't need to be reprocessed.

```
Request 1: [System prompt][Tool schema][History][New message A]
Request 2: [System prompt][Tool schema][History][New message B]
            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            Same prefix → cache hit! Only [New message B] is fresh
```

### 2.2 Cache Sharing Scope

Anthropic's Prompt Cache is shared at the organization level; concurrent requests within the same org can reuse the cached prefix. However, the cache does not cross organizations or regions. For enterprise users, this means Claude Code instances within a team naturally share the cache, amplifying the economic value of prefix stability.

### 2.3 Cache Boundary Engineering

Claude Code carefully places `cache_control` breakpoints in API requests to control cache granularity:

```
[System prompt] ← cache_control breakpoint ①
  This part barely changes (completely static within a session)
  → Cache hit every time

[Tool Schema] ← cache_control breakpoint ②
  Tool list rarely changes (unless MCP servers change)
  → Cache hit most of the time

[History] ← cache_control breakpoint ③
  Only new messages grow
  → Existing messages hit cache

[New message]
  Different every time
  → Must pay full price
```

**Numbers:** In a typical conversation, system prompt + tool schema occupies roughly 20,000–40,000 tokens. If this hits the cache every time, the cost of these tokens drops to 1/10 — saving $0.30–$0.60 per API call. Over a 20-turn conversation, that's $6–$12 saved.

### 2.4 CacheSafeParams

> 💡 **Plain English**: Imagine a chain restaurant's central kitchen. Every branch (sub-Agent) must cook with **the exact same ingredients and recipe**, so customers taste the same dish at every location. If one branch secretly swaps ingredients (changes parameters), it no longer matches the "headquarters flavor" (cache invalidation). `CacheSafeParams` is that **mandatory-unified recipe list** — the TypeScript compiler will throw an error the moment you "swap ingredients," before the dish even reaches the table.

`CacheSafeParams` is a type constraint guaranteeing that a specific parameter combination won't break Prompt Cache. In short: a child Agent must use the exact same "cache key" as the parent Agent to open the same "cache lock."

Usage scenarios:
- **forkedAgent**: Agents forked from a parent request share the parent's message prefix → ensures cache hit
- **/btw command**: A side question (doesn't enter the main conversation flow) shares the current request's cache
- **Speculative execution**: The predicted next message also uses `CacheSafeParams` to ensure no cache miss

### 2.5 Two Underappreciated Cache Optimization Details

**① cache_edits: incremental deletion without invalidating the cache**

When context needs to clean up stale tool results, simply deleting messages breaks the cache prefix. `cache_edits` is an undocumented Anthropic API mechanism that achieves "skip these messages server-side without breaking the cache" in three steps:

1. Locally record the IDs of tool results to delete (`tool_use_id`)
2. Send `cache_edits: [{ type: "delete", cache_reference: "tool_use_id" }]` in the API request, telling the server to "skip these messages when reading the cache"
3. The server marks them as skipped but does not delete them — the cache prefix remains intact

> 💡 **Plain English**: It's like a library bookshelf — you don't need to move the entire row and rearrange it from scratch (cache invalidation); you simply stick a "skip" label on the unwanted book (`cache_edits`), and the librarian scans right past it. Every other book stays exactly where it was.

Key limitation: the `cache_edits` directive must be resent on every API round (the mark is not persistent); it is only used while the cache is still "hot" (within the 5-minute TTL). Once the cache has gone cold, messages are simply cleared, because the cache would need rebuilding anyway.

**② Agent list position optimization: 10.2% cache-creation savings**

A seemingly simple change in the source code produced a quantifiable effect: moving the Agent list from tool descriptions (inside the cached `system` segment) to Attachments (outside the cached segment). This single adjustment reduced Cache Creation Tokens by roughly **10.2%** — a non-trivial cost saving at a scale of millions of API calls per day.

> 📌 **Source trace**: The 10.2% figure comes from source comments — `src/tools/AgentTool/prompt.ts:53` notes *"The dynamic agent list was ~10.2% of fleet cache_creation tokens"*, and the same number appears again at `src/utils/attachments.ts:1482`. This is an Anthropic internal statistic of fleet-level cache-creation tokens in production, not an external estimate.

### 2.6 The Hidden Cost of Cache Invalidation

Cache invalidation doesn't throw errors — the system keeps working, it just **silently costs more money**. This makes cache misses hard to spot. The code documents several known invalidation scenarios:

| Scenario | Cause | Detection Method |
|------|------|---------|
| MCP server changes | Tool schema changed → everything after breakpoint ② misses | Cost monitoring |
| Conversation branch doesn't copy content-replacement | Message prefix inconsistent | Code review |
| KAIROS date literal | System prompt changes after midnight | Performance testing |
| Context compaction | Compaction rewrites history messages | Known at design time |
| Post-compact notification | After compaction, `notifyCompaction()` proactively resets the cache baseline | Pre-registered "known break" |

The "post-compact notification" entry in the table is a refined design: the system knows compaction necessarily breaks the cache, so `notifyCompaction()` pre-registers this break, ensuring `promptCacheBreakDetection.ts` doesn't falsely flag the expected post-compaction cache miss as an anomaly — focusing monitoring attention on truly unexpected invalidations.

This table is just the tip of the iceberg. `promptCacheBreakDetection.ts` (700+ lines) actually tracks **14 distinct cache-invalidation vectors**, including mode switches, tool additions/removals, and CLAUDE.md changes. The system also employs a "sticky latch" mechanism: once it enters a mode, it tries not to switch back, because mode switches almost inevitably cause cache-prefix mismatch. This is no longer mere "performance tuning" — at scale (millions of API calls per day), every cache miss is real money spent. Prompt Cache is fundamentally a **billing optimization problem**.

> 📖 **Deep dive**: The full detection mechanism for all 14 cache-invalidation vectors (tool-level schema hash tracking, diff diagnostic output, sticky latch implementation details) is covered in **Part 3: "Complete Prompt Cache Observability Analysis"**.

---

## 3. Context Compaction: Not Saving Money, but "Staying Alive"

The primary goal of compaction isn't to save money — it's to **avoid context-window overflow**. A 200K token window looks large, but a complex task can easily involve:
- System prompt: 20–40K
- Tool schema: 10–20K
- Dozens of conversation turns + tool calls: 100K+
- Space left for new messages: shrinking fast

Without compaction, the conversation hits `blocking_limit` after roughly 30–50 turns — cardiac arrest, conversation forcibly terminated.

A **side benefit** of compaction is cost savings: it reduces the input token volume of every API call. But the **cost** is cache invalidation — compacted messages differ from the originals, breaking the cache prefix.

This is a **classic trade-off**: compaction extends conversation lifespan but increases per-call cost. The system balances this by "compressing as late as possible and as little as possible."

> 📚 **Course Connection**: The tension between context compaction and cache invalidation is isomorphic to the classic **cache hierarchy** dilemma in computer architecture courses. Prompt Cache is analogous to an L1 cache (high hit rate, low access cost), the raw API call is main-memory access (slow and expensive), and context compaction is the OS **page replacement** — when the working set exceeds physical memory, some pages must be swapped to disk, but the swap operation itself causes TLB invalidation. Claude Code's "compress as late as possible" strategy is a direct application of the OS concept of **lazy paging** — trigger replacement only when genuinely approaching the memory limit, maximizing cache hit rate. If you've studied LRU / LFU replacement algorithms, the "keep the most important messages, compact the least important" decision here is the same class of problem.

---

## 4. Speculative Execution: Predictive Optimization with Cache as Collateral

Speculative execution is one of Claude Code's more aggressive performance optimizations: before the user has typed their next message, the system predicts their intent and fires off AI inference ahead of time.

### 4.1 Why It Saves Tokens

If the guess is right:
- When the user presses Enter, the AI response is **already ready** — zero latency
- The speculative request and the real request share the message prefix → Prompt Cache hit

If the guess is wrong:
- The speculative result is discarded — tokens spent for nothing
- But usually it's only the output tokens of a single message (a few hundred to a few thousand tokens), so the cost is bounded

### 4.2 When the Bet Is Worth It

Value of speculation = P(correct) × latency saved − P(wrong) × wasted token cost

P(correct) is high in these scenarios:
- The user just submitted code; the next step is very likely "run tests"
- The AI proposed a change; the next step is very likely "okay, go ahead"
- There's a clear TODO list in context; the next step is the next item on the list

---

## 5. The Eight Counters: The System's Dashboard

`state.ts:952-989` defines eight OTel Counters — the system's "water meters":

| Counter | Tracks What | Why It Matters |
|---------|---------|-----------|
| `claude_code.session.count` | Sessions | Usage baseline |
| `claude_code.lines_of_code.count` | Lines of code changed | Productivity indicator |
| `claude_code.pull_request.count` | PRs created | Workflow integration |
| `claude_code.commit.count` | Commits | Code output |
| `claude_code.cost.usage` | Spend (USD) | **Core cost metric** |
| `claude_code.token.usage` | Token consumption | Resource usage |
| `claude_code.code_edit_tool.decision` | Code edit accept/reject | **AI quality metric** |
| `claude_code.active_time.total` | Active time | Efficiency indicator |

**`code_edit_tool.decision`** is the most interesting — it tracks the user's acceptance rate of AI code edits. This directly reflects "how good is the AI's code modification quality?" — a high reject rate means the AI often gets it wrong. This is the **core quality signal** for Anthropic's product team.

---

## 6. The Token Budget System

### 6.1 Tool Result Budgets

Every tool has a `maxResultSizeChars` limit. Anything beyond is truncated. This isn't for safety — it's to **control input token volume**. A Read tool fetching a 10,000-line file would add tens of thousands of tokens to context if included in full. The system sets sensible ceilings to balance "the AI needs to see enough information" against "don't waste tokens."

### 6.2 The Economics of Model Selection

Token prices vary wildly across models:

> **⚠️ Pricing note**: The figures below are current as of mid-2025 when this research was written. Please refer to Anthropic's official pricing at anthropic.com/pricing. Prices and cache rates may vary by model and over time.

| Model | Input | Output | Characteristics |
|------|-------|--------|------|
| Opus 4.6 | $15/M | $75/M | Strongest, most expensive |
| Opus 4.6 Fast | $30/M | $150/M | Faster but **significantly more expensive** (note: the exact multiple depends on the input/output token ratio. Pure input is 2×, pure output is 2×; weighted mixed multiples vary by usage pattern) |
| Sonnet 4.6 | $3/M | $15/M | Best value |
| Haiku 4.5 | $0.80/M | $4/M | Cheapest |

**The economic meaning of the Effort system**: Opus 4.6 Pro defaults to `medium` effort (not `high`) — not because medium quality is good enough, but because it **maximizes rate limits**. A rate-limited Pro user who always used high effort would hit the cap much sooner. Medium is the optimal balance of performance, cost, and quota.

---

## 7. The Token Economics of omitClaudeMd

The `omitClaudeMd` flag lets child Agents skip loading CLAUDE.md. It looks like a small optimization, but the impact is staggering:

**Calculation**:
- A typical CLAUDE.md: 2,000–5,000 tokens
- A complex task may launch 5–10 Explore Agents
- Each Agent averages 3–5 API rounds
- Without omitClaudeMd: 5,000 × 10 × 5 = 250,000 tokens wasted (note: this estimate assumes each Agent starts independently without sharing the parent request's cache prefix. If Agents reuse the cached prefix, actual savings are smaller because CLAUDE.md content may already be covered by the cache)
- With omitClaudeMd: 0
- At Opus 4.6 prices: saves $3.75 per task

The team's estimate of **5–15 GTok/week** (5–15 billion tokens per week) shows the magnitude of Agent calls is staggering — Claude Code's Agent subsystem isn't an occasionally used feature, it's a **core execution path**.

---

## 8. Competitive Comparison: Different Philosophies of Token Optimization

Different products' attitudes toward token cost reflect fundamentally different product philosophies.

### 8.1 Pricing Model Comparison

| Product | Pricing Model | User-Perceived Cost | Token Optimization Incentive |
|------|---------|------------|--------------|
| **Claude Code** | API per-usage billing (user pays directly) | Fully transparent; every call has a cost | Extremely strong — every token saved is direct user savings |
| **Cursor** | $20/mo subscription + overage billing | Partially transparent (painless within quota, painful only if over) | Moderate — optimization incentive only kicks in beyond quota |
| **GitHub Copilot** | $10–19/mo fixed price | Completely opaque | Low (to the user) — Microsoft optimizes internally, user feels nothing |
| **Aider** | BYO API key | Fully transparent + detailed stats | Extremely strong — similar to Claude Code |

### 8.2 Caching Strategy Comparison

**Claude Code** treats Prompt Cache as an architectural-level design — message ordering, `cache_control` breakpoints, and `CacheSafeParams` type constraints are all built around cache hit rate.

**Cursor** takes a different path: rather than relying on a single caching mechanism, it controls cost through **model tiering**. Tab completions use a GPT-3.5-class small model (almost free), while complex tasks call GPT-4/Claude (expensive but powerful). This is the equivalent of "giving cheap work to cheap workers."

**Aider**'s repository map is an **input compression** strategy: instead of stuffing the entire codebase into context, it uses tree-sitter to generate a structural summary, passing only necessary function signatures and class definitions. The goal aligns with Claude Code's context compaction, but the implementation differs — Aider compresses *before* inclusion (pre-compression), while Claude Code compresses *when* the context is nearly full (post-compression).

### 8.3 Cost Transparency Comparison

**Aider** offers the best cost transparency — every conversation ends with a display of token consumption, cumulative spend, and cache hit rate. Claude Code also provides token stats (via OTel counters), but they are less visible to everyday users than Aider's summary.

**Cursor** and **Copilot** make cost almost invisible to users — the subscription model abstracts token cost away. This reduces decision fatigue, but also means users can't make the judgment "is this task worth this many tokens?"

> 💡 **Plain English**: The difference in pricing models is like **three ways of eating out** — Claude Code / Aider are à la carte (you know the price of every dish, so you plan carefully); Cursor is a buffet (fixed price, eat all you want, but "premium dishes" cost extra); Copilot is a company cafeteria (deducted from your paycheck monthly, you don't worry much about what you eat). Which is better? It depends on whether you're a meticulous "foodie" or a hassle-free "whatever" diner.

---

## 9. Design Trade-offs

### Strengths

1. **Prompt Cache boundary engineering** places the most stable content (system prompt) at the front — this is no accident, but deep understanding of the caching mechanism
2. **CacheSafeParams type constraints** prevent cache breakage at compile time — not runtime checks, but type-system guarantees
3. **Speculative execution risk/reward calculation** is sound — a wrong guess wastes only a few hundred tokens; a right guess saves seconds of latency
4. **`code_edit_tool.decision` Counter** tracks product quality directly — not a technical metric, but a user-value metric
5. **omitClaudeMd is a data-driven optimization** — not a theoretical estimate, but derived from production token-consumption observations

### Costs

1. **Cache invalidation is silent** — no error, just more money spent. Cache misses are hard to catch during development
2. **Opus 4.6 Fast carries a significant premium**, meaning the "speed button" is very expensive — users may not understand this cost difference
3. **The compaction-vs-cache trade-off** is fundamental — compaction breaks cache; no compaction hits the context limit. There is no perfect solution
4. **Token waste on wrong speculative guesses** is not tracked as an independent metric — making "miss rate" hard to evaluate
5. **Token budget truncation is a hard cutoff** — not an "intelligent summary"; anything beyond the limit is simply chopped, potentially losing critical information

---

> **[Chart placeholder 2.10-A]**: The Four Water Prices of Tokens — cost relationships among Input/Output/Cache Read/Cache Write
> **[Chart placeholder 2.10-B]**: Prompt Cache Hit Regions — cache boundaries for system prompts, tool schema, and history
> **[Chart placeholder 2.10-C]**: Compaction vs Cache trade-off decision tree — when to compact and when not to
