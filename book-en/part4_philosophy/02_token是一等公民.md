# Tokens as First-Class Citizens

In the Claude Code codebase, token consumption is a design constraint that is weighed repeatedly, treated as a "first-class citizen" alongside memory and CPU. ("First-class citizen" is a programming term meaning "a core object that receives top priority"—like a VIP member that every part of the system must prioritize.)

> 💡 **Plain English**: Tokens are like **mobile phone credit**—sending a text (AI input) costs 10 cents per message, making a call (AI output) costs 50 cents per minute, but if the recipient is already in your contacts (cache hit), sending a text costs only 1 cent. Every design decision in Claude Code carefully budgets this credit—save one message if possible, and use contacts whenever available.

> 🌍 **Industry Context**: Treating compute resources as a first-class architectural constraint is not an invention of the AI era. **Google's "data center tax" mindset** (from the 2013 paper *Profiling a Warehouse-Scale Computer*) long ago made watts-per-compute and bytes-per-memory core constraints for architectural decisions. But token economics introduces a new dimension: traditional software resources (CPU, memory, network) are **fixed costs** (you buy a server and that's what you get), whereas LLM tokens are **variable costs**—every additional token costs money. Among AI coding tools, **Cursor** controls costs through a "fast model + slow model" tier (simple completions use small models, complex tasks use large models); **Aider** uses repo map technology to send only relevant code snippets rather than the entire repository, reducing input tokens; the **LangChain** ecosystem's `CallbackHandler` lets developers track token consumption per call. These practices are the **industry baseline** in the LLM application space—token counting, context truncation, and tool description trimming have become standard equipment for any serious LLM application. Claude Code's distinguishing feature is systematizing these baseline practices and, in certain areas (such as prompt cache parameter alignment), delivering engineering innovations that exceed the industry baseline.

---

## The Token Lifecycle: Four Layers of Optimization

Rather than listing isolated evidence, it is more illuminating to understand Claude Code's strategy through the token lifecycle—from "reducing input" to "cache reuse" to "controlling output" to "managing stock." Each layer solves a different problem.

### Layer 1: Reduce Input—Don't Send Unnecessary Tokens

**omitClaudeMd: Context Trimming for Sub-Agents (Industry Baseline Practice)**

The following line means: when creating a sub-agent, decide whether to omit the CLAUDE.md (project rules file) content. The default is not to omit (`false`), but for sub-agents that only need to "look at code," skipping this saves tokens:

```typescript
// When creating Explore/Plan type sub-agents
const omitClaudeMd = agentDefinition.omitClaudeMd ?? false
```

Read-only agents (used for exploring code and making plans) do not need submission guidelines, lint rules, or code style guides—this CLAUDE.md content is useless for tasks that are "just reading code." Source comments note that this design "Saves ~5-15 Gtok/week across 34M+ Explore spawns" (`loadAgentsDir.ts`), which translates to roughly 5–15 billion tokens saved per week (Note: GTok = Giga-Token = 1 billion tokens).

It is worth noting that this "trim system prompts on demand" practice is an industry standard for LLM applications—Aider's different modes also use different system prompts. Claude Code's contribution is institutionalizing it: through the `omitClaudeMd` boolean switch plus the `tengu_slim_subagent_claudemd` feature flag for remote control, so trimming decisions can be quickly rolled back. The `false-by-default` design means **spend more tokens rather than deprive the sub-agent of project context**—a conservative default that favors quality.

**Tool Description Truncation: A Defensive 2048-Character Cap (Industry Baseline Practice)**

```typescript
// MCP client.ts
const MAX_MCP_DESCRIPTION_LENGTH = 2048
```

OpenAPI-generated MCP servers have been observed dumping complete API endpoint documentation into tool descriptions. Source comments explicitly document this phenomenon: "OpenAPI-generated MCP servers have been observed dumping 15-60KB of endpoint docs into tool.description." The 2048-character cap is a defensive truncation—better to lose some description than carry 60KB of tool documentation on every API call.

The choice of 2048 merits scrutiny. The source comment says it "caps the p95 tail without losing the intent," meaning it trims the longest 5% of descriptions while preserving the full semantics for the vast majority of tools. This is likely an empirical value drawn from the actual distribution of MCP tool description lengths—2048 characters is enough to cover most tools' complete descriptions (including parameter explanations and usage examples), while anything beyond 2048 is usually redundant content auto-generated from OpenAPI. Similar defensive truncation is common in OpenAI's function calling practice and is an industry-wide convention.

---

### Layer 2: Cache Reuse—Prompt Cache Parameter Alignment (Genuine Engineering Innovation)

**This layer is the most valuable and distinctive part of Claude Code's token optimization strategy.**

Agents that generate the "next predicted message" operate under a strict constraint: they must use **exactly the same** API parameters as the parent request in order to share the prompt cache.

```
// Comment from promptSuggestion.ts (abridged):
// DO NOT override any API parameter that differs from the parent request.
// The fork piggybacks on the main thread's prompt cache by sending identical
// cache-key params. The billing cache key includes more than just
// system/tools/model/messages/thinking — empirically, setting effortValue
// or maxOutputTokens on the fork (even via output_config or getAppState)
// busts cache.
```

Immediately following this comment is a critical production lesson (drawn from PR #18143):

> On one occasion, an attempt to save prediction cost by using `effort:'low'` caused the cache hit rate to drop from 92.7% to 61% (using the phone-credit analogy: 92.7% of texts suddenly lost the contacts discount, leaving only 61% eligible), while cache write volume surged 45×.

These figures come directly from the source comments documenting PR #18143, reflecting real production observations by the development team.

This failure revealed an **undocumented behavioral characteristic** of the Anthropic API: the prompt cache key is more fine-grained than expected. The cache key includes not only the obvious parameters such as system prompt, tools, model, message prefix, and thinking config—parameters like `effortValue` and `maxOutputTokens`, which appear to be "output controls," also affect the cache key. This is not something the documentation tells you; it was learned the hard way in production.

**CacheSafeParams: Institutionalizing the Lesson**

To prevent similar incidents, Claude Code encapsulated prompt cache compatibility into an explicit type contract:

```typescript
// forkedAgent.ts
export type CacheSafeParams = {
  systemPrompt: SystemPrompt        // system prompt - must match parent request
  userContext: { [k: string]: string }  // user context - affects cache key
  systemContext: { [k: string]: string } // system context - affects cache key
  toolUseContext: ToolUseContext      // includes tools, model, etc.
  forkContextMessages: Message[]     // parent request message prefix
}
```

All forked agents that need to share the parent request's cache (promptSuggestion, sessionMemory, extractMemories, autoDream, etc.) obtain their parameters via `createCacheSafeParams(context)` and pass them to `runForkedAgent()`. The comments explicitly label the "safe" override scope—only three categories of parameters can be safely modified: `abortController` (not sent to the API), `skipTranscript` (client-side only), and `skipCacheWrite` (controls the `cache_control` flag rather than the cache key).

The core value of this design is that **it transforms an implicit, easily forgotten constraint ("don't change parameters or the cache will break") into an explicit, compiler-checkable type contract**. Any new developer joining the team who sees the `CacheSafeParams` type immediately knows these parameters cannot be modified arbitrarily.

### Type System Guarding Cache Consistency

The `CacheSafeParams` design warrants separate scrutiny—it is the codebase's clearest example of the philosophy "use the type system to solve distributed systems problems."

Reading the interface definition directly from `src/utils/forkedAgent.ts:57-68`:

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

Each field's JSDoc comment is not mere documentation decoration; it is part of the engineering contract. The `systemPrompt` field explicitly states "must match parent for cache hits"—a mandatory declaration embedded in the type definition itself, impossible to ignore.

**What is happening here?** In distributed cache systems, one of the hardest problems is **cache key consistency**: how do concurrent requests ensure their cache keys are identical? Traditional solutions are runtime checks (compare parameters before calling) or monitoring alerts (detect cache hit rate drops after calling). Both are **reactive**—you only discover the problem after the code is written and running.

`CacheSafeParams` transforms this runtime problem into a **compile-time problem**: if a forked agent wants to pass different parameters (such as using `effort: 'low'` to cut costs), it must bypass the `CacheSafeParams` type—and that bypass itself is a warning signal, one that the TypeScript compiler will surface before code review even begins.

**Comparison with industry convention**: Most LLM applications protect prompt cache parameters through documentation conventions ("don't change these parameters") or runtime monitoring. Both rely on engineer vigilance—a new engineer seeing a configuration option has little intuition that changing it might destroy global cache hit rates. `CacheSafeParams` encodes this judgment logic into the type system, letting the toolchain act as the guard instead of the engineer.

This pattern has an interesting extension: source comments in `forkedAgent.ts:70-72` further design a global slot—after every main loop turn ends, `saveCacheSafeParams()` writes the latest parameters into a module-level variable, and all subsequent forks (`promptSuggestion`, `postTurnSummary`, `/btw`) call `getLastCacheSafeParams()` to retrieve them, without each caller passing parameters individually. Type system constraints plus single-source parameter storage doubly guarantee global cache key consistency.

> 💡 **Plain English**: This is like **a restaurant's ingredient supply system**—all dishes must use ingredients from the same batch (parent request parameters) to ensure consistent flavor (cache hits). The ordinary approach is to tape up a note saying "please use today's ingredients" and rely on the chefs' self-discipline. The `CacheSafeParams` approach is to design an interface that physically only accepts today's ingredients, preventing chefs from grabbing the wrong batch—if someone tries to sneak in a substitution, the interface simply rejects it.

**promptCacheBreakDetection: Proactive Monitoring of Cache Invalidation**

Going further, Claude Code has built a complete cache invalidation detection system (`promptCacheBreakDetection.ts`), tracking more than 12 parameter dimensions that could break cache: system prompt hash, tool schemas hash, model, fast mode, cache_control, betas, effort, extra body params, and more. After every API call, the system compares changes in cache read tokens—if the drop exceeds 5% and the absolute value exceeds 2000 tokens, it triggers an alert and automatically generates a diff file to aid diagnosis.

This proactive monitoring practice is uncommon in LLM applications—most tools only discover cache problems on the bill, whereas Claude Code performs real-time detection after every API call.

> 📖 **Deep Dive**: The full architecture of the cache invalidation detection system (tool-level schema hashing, diff output, sticky latch mechanism) is detailed in **Part 3 "Complete Analysis of Prompt Cache Observability."**

> 📚 **Course Connection**: The prompt cache key problem is highly analogous to **query cache invalidation** in database systems courses—MySQL's Query Cache was notorious for cache misses caused by any tiny difference in query text (including case and whitespace). The same lesson: cache key granularity is often finer than you expect. A hit rate drop from 92.7% to 61% means the miss rate grew from 7.3% to 39% (a 5.3× increase). In phone-credit terms: originally 93% of your texts enjoyed the contacts discount (1 cent per message); now only 61% do, and the rest are charged full price (10 cents or more per message)—total cost nearly triples.

---

### Layer 3: Control Output—Session Memory Information-Density Triggers

**SessionMemory's Triple-Threshold Mechanism (Scheduling Design Beyond the Industry Baseline)**

SessionMemory (the background note-taking AI) does not trigger "after every AI response." Instead, it relies on a joint evaluation of three thresholds:

```typescript
// Default config values (sessionMemoryUtils.ts)
const DEFAULT_SESSION_MEMORY_CONFIG = {
  minimumMessageTokensToInit: 10000,    // First extraction only starts after context reaches 10k tokens
  minimumTokensBetweenUpdate: 5000,     // At least 5k new tokens between two extractions
  toolCallsBetweenUpdates: 3,           // At least 3 tool calls between two extractions
}
```

If memory extraction fired after every AI response, the additional cost would be unacceptable. The three thresholds ensure extraction only runs when "enough valuable new information has accumulated."

Source comments reveal an important design detail: **the token threshold is a hard constraint** ("The token threshold is ALWAYS required. Even if the tool call threshold is met, extraction won't happen until the token threshold is also satisfied"). This means `minimumTokensBetweenUpdate` and `toolCallsBetweenUpdates` are not "satisfy either one"; rather, "the tool call threshold is merely one prerequisite, and the token threshold must be satisfied simultaneously."

This "information-density-driven" rather than "time- or event-frequency-driven" scheduling strategy has analogs in traditional event-driven architecture (such as Kafka's `linger.ms` + `batch.size` dual thresholds), but its application in the AI agent space is relatively novel—compared to AutoGPT's "store memory on every step" approach, information-density-aware scheduling avoids a great deal of low-value repetitive extraction.

---

### Layer 4: Manage Stock—Six-Level Context Compression

**Progressive Degradation (Industry Baseline Framework, Claude Code's Concrete Implementation)**

A single compression strategy (e.g., "truncate when context exceeds 80%") is not fine-grained enough—it may trigger too early (wasting available context space) or too late (requiring the discard of large amounts of useful information).

Claude Code's six mechanisms escalate gradually: first snip tool result details, then compress tool results with AI, then collapse old messages (context collapse), then autocompact, and finally full summarization. Trigger thresholds are dynamically computed by `getAutoCompactThreshold()`: `effective context window size - 13000 token buffer` (`AUTOCOMPACT_BUFFER_TOKENS = 13_000`), where effective context window = model context window - output reservation (up to 20000 tokens).

It must be acknowledged that progressive degradation itself is an industry standard for context management—Aider had a multi-tier strategy of repo map → incremental updates → full compression as early as 2024, and LangChain's `ConversationSummaryBufferMemory` also implements a two-tier strategy. Claude Code achieves six tiers, but the "multi-tier compression" framework is not Claude Code's innovation—the specific threshold calculations, inter-tier switching logic, and coordination with prompt cache (such as `notifyCompaction()` notifying the cache detection system to reset its baseline) are the engineering details at the implementation level.

---

## The Design Principles This Yields

**Cache is infrastructure, not optimization.**

In token economics, cache hit rate directly impacts cost. `CacheSafeParams` is not an "optimization measure"; it is an architectural constraint that "any new API call should try to reuse the parent request's cache by default." `promptCacheBreakDetection` is not "performance monitoring"; it is "infrastructure health checking"—just as you would not call CPU utilization monitoring an "optimization." If cache is infrastructure, the system should degrade gracefully rather than crash when it is unavailable—Claude Code's cache invalidation detection + alerting mechanism is exactly this kind of reliability guarantee.

**Token optimization ROI is uneven—not every layer deserves equal investment.**

From the source perspective, Layer 2 (prompt cache parameter alignment) offers the highest ROI—a single parameter mistake can triple costs. Layer 1 (trimming system prompts) and Layer 4 (compressing context) are industry standards: important, but not differentiating competitive advantages. Layer 3 (memory extraction frequency control) sits between the two. For AI practitioners, the real insight is not "tokens are expensive, so be frugal" (that is common knowledge), but rather: **across the entire token lifecycle, cache layer optimization offers the greatest leverage because it affects a multiplier, not an addend.**

---

## Analogy

In traditional software engineering, we have the mental models that "memory is not free" (so we use LRU caches, memory pools, reference counting) and "network I/O is not free" (so we batch requests, reuse connections, and use CDNs).

AI applications add a new constraint: **tokens are not free**—they translate directly into cost, and they have a hard cap (the context window).

It is worth noting that "treat scarce resources as first-class citizens" is a general principle of software engineering—embedded systems treat every byte of RAM as a first-class citizen, mobile development treats battery life as a first-class citizen, and game engines treat every frame's rendering budget as a first-class citizen. Claude Code's contribution is not inventing the idea of "resource-sensitive design"; it is **concretely demonstrating how token economics influence every architectural decision in an AI application**—from system prompt content trade-offs, to cache key parameter alignment, to the six-tier progressive compression strategy. These are concrete practices under token constraints, ones for which other resource-constrained domains provide no ready-made answers.

---

## Code Landing Points

- `src/utils/forkedAgent.ts`: `CacheSafeParams` type definition and `createCacheSafeParams()` factory function—the foundation for cache sharing across all forked agents
- `src/services/api/promptCacheBreakDetection.ts`: Cache invalidation detection system—tracks 12+ parameter dimensions and performs real-time cache break detection after every API call
- `src/services/PromptSuggestion/promptSuggestion.ts`: Cache-safety constraints for prompt prediction—includes the complete comment documenting the PR #18143 lesson
- `src/services/SessionMemory/sessionMemoryUtils.ts`: Triple-threshold configuration and evaluation logic—defaults of 10000/5000/3 tokens
- `src/services/mcp/client.ts`: MCP tool description 2048-character truncation—"caps the p95 tail without losing the intent"
- `src/services/compact/autoCompact.ts`: Automatic compression threshold calculation—`effective context window - 13000` token buffer
- `src/tools/AgentTool/loadAgentsDir.ts`: `omitClaudeMd` definition—includes the "~5-15 Gtok/week across 34M+ Explore spawns" comment

## Costs and Trade-offs

Treating tokens as first-class citizens has costs, and each layer carries a different price:

- **The heaviest cost is at the cache layer**: `CacheSafeParams` is non-trivial to maintain—any change to system prompt structure or API parameters must consider cache compatibility. This effectively creates an **implicit coupling** in the system architecture: all forked agents' parameter freedom is constrained by the parent request.
- **Quality risk at the trimming layer**: Letting a sub-agent skip CLAUDE.md loading means it loses project context. The source provides remote rollback capability via the `tengu_slim_subagent_claudemd` feature flag, but no public A/B test data is visible regarding the magnitude of impact on output quality.
- **Information loss at the compression layer**: Each of the six compression tiers implies information loss. Compressing too early discards context that may be needed later; compressing too late risks context overflow.

More fundamentally, from 2023 to 2025, mainstream LLM token prices have fallen by 10–50×. **This is not speculation; it is an ongoing trend**. The six-tier compression mechanism and cache alignment strategy that Claude Code carefully designs today may become maintenance burdens in the future. But for that very reason, understanding which optimizations offer the highest ROI (cache layer > trimming layer > compression layer) becomes even more important—as prices fall, low-ROI optimizations should be the first to be simplified.
