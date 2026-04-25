# Eight Design Wisdoms of Prompts: Engineering Philosophy Distilled from 124 Prompt Templates

The 124 prompt templates discovered in the Claude Code 2.1.88 source code are not merely "instructions for making AI work"—they represent **AI behavioral engineering** distilled by Anthropic's engineering team through tens of thousands of experiments. These templates contain a counterintuitive insight: the problem is not "how to make AI understand the task," but rather "how to counteract the systematic biases AI unconsciously generates when completing tasks."

This chapter distills eight core design wisdoms from these templates, each pointing to an engineering judgment you can directly apply to your own AI systems.

---

## Wisdom 1: Anti-Laziness Engineering — Using Prompts to Counteract LLM Cognitive Biases

**Core Insight: LLMs exhibit systematic behavioral biases—a tendency to skip verification, fabricate success signals, over-engineer, and avoid difficult checks. Anthropic's solution does not rely on hoping the model will "behave well" on its own; instead, they write failure modes into the Prompt one by one, then tell the model: you will feel an urge to do X, recognize it, and do the opposite.**

This is a form of cognitive behavioral therapy (CBT) applied to AI—first name the distorted thought patterns, then override them with explicit rules.

### Evidence from Source Code

**Evidence 1: The "Excuse List" in verificationAgent.ts**

Lines 54-61 of `src/tools/AgentTool/built-in/verificationAgent.ts`, the verification Agent's Prompt states:

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

Anthropic engraves six specific excuses directly into the Prompt, each followed by a rebuttal command. This is not a vague "verify carefully"—it is preemptively anticipating the justifications the model will use to rationalize not verifying, and intercepting them in advance.

**Evidence 2: The "False Success" Defense in `prompts.ts`**

Line 240 of `src/constants/prompts.ts` (ant-only block):

```
Report outcomes faithfully: if tests fail, say so with the relevant output; if you
did not run a verification step, say that rather than implying it succeeded.
Never claim "all tests pass" when output shows failures, never suppress or simplify
failing checks (tests, lints, type errors) to manufacture a green result...
```

The context behind this rule is traceable: the comment `// @[MODEL LAUNCH]: False-claims mitigation for Capybara v8 (29-30% FC rate vs v4's 16.7%)`—the data shows that the Capybara v8 model's false claim rate rose from v4's 16.7% to 29-30%, and Anthropic wrote this Prompt specifically to suppress that regression.

**Evidence 3: The Anti-Over-Engineering Rule in `Doing Tasks`**

Lines 201-203 of `src/constants/prompts.ts`:

```
Don't add features, refactor code, or make "improvements" beyond what was asked.
Three similar lines of code is better than a premature abstraction.
```

LLMs have a natural tendency to "help too much"—the user asks to fix a one-line bug, and the model refactors the entire module. This rule explicitly counteracts that tendency.

### Why This Matters to the AI Engineering Community

Most teams' first reaction when "the model doesn't behave as expected" is to switch models or add more generic instructions. Anthropic's approach is: **measure specific failure modes, then apply surgical Prompt treatment**. This requires you to first know the exact scenarios in which the model fails, then write targeted instructions.

> **💡 Plain English**: It's like onboarding a new employee. Rather than saying "be diligent and responsible," say: "When you think 'the code looks fine,' stop and actually run the tests. I know you'll feel that urge—it's a mistake every engineer makes."

### Actionable Recommendations

1. **Establish a "failure mode log" for your AI application**: Whenever the model produces undesirable behavior, record it—not just the result, but its "reasoning path" (observed via extended thinking or chain-of-thought).
2. **Write your Top 5 failure modes into the system Prompt**: Format as "You will feel an urge to do X; this is wrong; the correct approach is Y."
3. **Set behavioral benchmark tests**: After each Prompt adjustment, measure failure rates against a fixed test case set, rather than relying on subjective judgment.

---

## Wisdom 2: Prompt as Executable Specification — When Prompts Replace Documentation

**Core Insight: `/security-review` (196 lines) and `/init` (224 lines) are not "instructions for AI"—they are complete engineering specifications, just written in Prompt form. They could have been PDF documents given to human engineers—but by writing them as Prompts, the specification itself becomes the executor.**

### Evidence from Source Code

**Evidence 1: 17 Hard Exclusion Rules in security-review.ts**

Lines 143-176 of `src/commands/security-review.ts`, the security review Prompt contains an explicit "do not report" list:

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

Combined with a PRECEDENTS list, this is a professional judgment standard distilled through real security review work, directly encoded into the Prompt. A junior security engineer following this Prompt would be standing on the shoulders of the entire team's accumulated experience.

**Evidence 2: The 8-Phase Wizard in /init**

The NEW_INIT_PROMPT in `src/commands/init.ts` describes a complete 8-phase process: Phase 1 (ask the user what they want to set up) → Phase 2 (explore the codebase) → Phase 3 (fill information gaps) → Phase 4 (write CLAUDE.md) → Phase 5 (write CLAUDE.local.md) → Phase 6 (generate Skills) → Phase 7 (suggest additional optimizations) → Phase 8 (final confirmation).

This is a complete product wizard design, containing decision logic, user interview strategy, and constraint propagation (choices in Phase 1 constrain behavior in Phases 3-7). If you printed this Prompt, it would itself be a product specification document.

**Evidence 3: Output Format Enforcement in verificationAgent.ts**

Lines 82-100 of the verification Agent define a strict output template, complete with "good/bad" comparison examples—bad examples shown in blockquotes, good examples with complete command output. This is already an operations manual for "how to write a verification report," except the executor is AI.

### Why This Matters to the AI Engineering Community

The traditional approach is to put knowledge in documents, then have AI read the documents. Anthropic's approach is: **embed knowledge directly into the Prompt, and let the Prompt directly drive behavior**. This eliminates the "translation layer between documentation and execution." When your Prompt is complete enough, it is simultaneously the specification and the implementation.

> **💡 Plain English**: The ordinary approach is to write a "how to do security reviews" manual, then have AI read the manual and do the review. Anthropic's approach is: the manual itself is the AI's task brief—it starts working as soon as it finishes reading, with no middleman.

### Actionable Recommendations

1. **Use "could this be printed and used by a human engineer?" as a Prompt quality standard**: If a Prompt, when printed, could be followed by a human expert, it is clear enough.
2. **Write your team's professional judgments into the Prompt**: Your years of accumulated "don't report X-type issues" judgments should appear explicitly in the Prompt, rather than assuming the AI will figure them out.
3. **Use phased structures for complex workflows**: Break large tasks into numbered Phases, each with clear inputs, outputs, and constraints, and information handoff between Phases.

---

## Wisdom 3: Dual Internal/External Faces — Feature Flag-Driven Prompt A/B Testing

**Core Insight: Numerous Prompt rules only take effect for Anthropic internal users (`process.env.USER_TYPE === 'ant'`); external users receive a different version. This is not accidental—it is Anthropic using production traffic to conduct A/B tests on Prompts: internal users get stricter or newer versions first, and after verifying they cause no side effects, they are gradually rolled out externally.**

### Evidence from Source Code

**Evidence 1: Five ant-only Behavioral Rules**

In `src/constants/prompts.ts`, the following rules are only activated when `process.env.USER_TYPE === 'ant'`:

- Comment writing standards ("don't write comments by default; only when logic is not self-evident")
- Proactively refute user misconceptions ("if you find the user's request is based on a misunderstanding, say so")
- Must verify before completion ("before reporting task completion, actually run verification")
- Faithfully report failures ("if tests fail, say so; don't manufacture a green light")
- Word length constraints ("text between tool calls should not exceed 25 words")

**Evidence 2: Two Completely Different Output Efficiency Instructions**

Lines 403-427 of `src/constants/prompts.ts`, the `getOutputEfficiencySection()` function returns drastically different content based on `USER_TYPE`:

- **ant version**: 594 words of "Communicating with the user"—emphasizing writing quality, inverted pyramid structure, avoiding cognitive overhead
- **external version**: A much shorter "Output efficiency"—emphasizing conciseness, directness, and omitting preamble

These are not two expressions of the same idea; they are two completely different communication philosophies, targeting two user cohorts in separate experiments.

**Evidence 3: `@[MODEL LAUNCH]` Comments Reveal the Release Process**

`src/constants/prompts.ts` contains multiple `@[MODEL LAUNCH]` comments, such as:

```javascript
// @[MODEL LAUNCH]: capy v8 assertiveness counterweight (PR #24302)
// — un-gate once validated on external via A/B
...(process.env.USER_TYPE === 'ant' ? [
  `If you notice the user's request is based on a misconception...`
] : []),
```

"un-gate once validated on external via A/B"—this is an explicit release plan annotation. New rules are internally tested first, and only un-gated for external rollout after A/B validation passes. Every ant-only block in `prompts.ts` is a feature candidate awaiting release.

### Why This Matters to the AI Engineering Community

Most teams treat Prompts as single-version artifacts, testing them subjectively. Anthropic's approach is: **treat Prompts as A/B-testable product features, controlling exposure with Feature Flags, and deciding release based on quantitative metrics**. This transforms Prompt engineering from "writing text" into "shipping product features."

### Actionable Recommendations

1. **Establish a Feature Flag mechanism for Prompts**: New behavioral constraints should first go to internal users or a small percentage of users, with data collected before broader rollout.
2. **Attach a hypothesis to each Prompt change**: Don't just write "what changed"; write "we expect this change to improve metric X by Y%."
3. **Maintain different Prompt configurations for different user groups**: Advanced users, novice users, and internal users can have different behavioral constraints.

---

## Wisdom 4: Eval-Driven Iteration — Data Eliminates Intuition

**Core Insight: The comments in `memoryTypes.ts` directly embed quantitative experiment data, recording how specific Prompt changes affected eval test pass rates. This proves Anthropic uses quantitative evaluation to tune Prompts—not relying on gut feeling, but on measurement.**

### Evidence from Source Code

**Evidence 1: H1/H5/H6 Experiment Data**

Lines 228-244 of `src/memdir/memoryTypes.ts`, comment on TRUSTING_RECALL_SECTION:

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

Interpretation:
- H1 hypothesis (memory file verification): originally a bullet under `## When to access`, pass rate 0/3; changed to a standalone chapter `## Before recommending from memory`, pass rate 3/3. **The position changed, the text stayed the same, and the pass rate jumped from 0% to 100%.**
- H5 hypothesis: appendSystemPrompt approach 3/3, in-place approach 2/3.

**Evidence 2: H2 Explicit Save Gate**

Lines 192-194 of the same file:

```javascript
// H2: explicit-save gate. Eval-validated (memory-prompt-iteration case 3,
// 0/2 → 3/3): prevents "save this week's PR list" → activity-log noise.
'These exclusions apply even when the user explicitly asks you to save...'
```

H2 experiment: adding "do not save even when the user explicitly asks" to the exclusion rules improved pass rate from 0/2 to 3/3 in that scenario.

**Evidence 3: A/B Testing Section Headers**

Lines 240-244 contain a rare comment:

```javascript
// Header wording matters: "Before recommending" (action cue at the decision
// point) tested better than "Trusting what you recall" (abstract).
// The appendSystemPrompt variant with this header went 3/3;
// the abstract header went 0/3 in-place. Same body text — only the header differed.
```

**The exact same body text, only the section title changed**, and the pass rate went from 0/3 to 3/3. This proves a counterintuitive conclusion: in Prompts, **structure and position are as influential as content itself**.

### Why This Matters to the AI Engineering Community

"Is this Prompt well-written?" is a qualitative question that most people can only answer by feel. Anthropic turns it into a quantitative question: **what is the pass rate on a fixed eval test set?** This gives Prompt optimization an objective standard, no longer a matter of mysticism.

### Actionable Recommendations

1. **Establish eval test cases for each key behavior**: At least 5 cases, covering happy paths and edge cases.
2. **Write eval data into comments**: Like code, Prompt changes need reasons and evidence—"changed from X to Y, eval pass rate improved from a% to b%."
3. **Single-variable testing**: Change only one variable at a time (position/title/wording), otherwise you cannot know what made the difference.

---

## Wisdom 5: Type Systems Guard Distributed Consistency — CacheSafeParams and Compile-Time Safety

**Core Insight: `CacheSafeParams` is a TypeScript interface that transforms the distributed systems constraint "child Agents must share the same cache parameters as parent Agents" from a runtime rule into a compile-time enforcement. If you forget to pass the correct parameters, the code simply won't compile. This is extremely rare in the AI engineering space—using a type system to guarantee distributed cache consistency.**

### Evidence from Source Code

**Evidence 1: CacheSafeParams Type Definition**

Lines 57-68 of `src/utils/forkedAgent.ts`:

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

The type comment clearly states "must match parent for cache hits"—this is not advice, but a contract enforced through the type system.

**Evidence 2: The Warning Comment in ForkedAgentParams**

Lines 83-113 of the same file contain an unusual warning in the `ForkedAgentParams` type:

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

This comment reveals a subtle cache invalidation trap: setting `maxOutputTokens` changes `budget_tokens`, and thinking config is part of the cache key, so setting this seemingly unrelated parameter causes the entire cache to invalidate. By placing it in a strongly typed interface with a CAUTION comment, this knowledge is "solidified" into the code structure.

**Evidence 3: Global CacheSafeParams Slot**

Lines 73-80 of the same file:

```typescript
// Slot written by handleStopHooks after each turn so post-turn forks
// (promptSuggestion, postTurnSummary, /btw) can share the main loop's
// prompt cache without each caller threading params through.
let lastCacheSafeParams: CacheSafeParams | null = null

export function saveCacheSafeParams(params: CacheSafeParams | null): void
export function getLastCacheSafeParams(): CacheSafeParams | null
```

After each conversation turn, the system automatically stores CacheSafeParams in a global slot, allowing subsequent forks (e.g., promptSuggestion, postTurnSummary) to reuse it directly without each caller threading parameters through. This is a design that sinks the distributed cache coordination problem from the application layer to the infrastructure layer.

### Why This Matters to the AI Engineering Community

In multi-Agent systems, Prompt Cache hit rate directly affects cost and latency. But cache invalidation causes can be extremely subtle (e.g., changing only `max_tokens` invalidates the entire system prompt cache). Encoding cache constraints into the type system and letting the compiler guard the door is an approach that transforms operational knowledge into coding constraints.

> **💡 Plain English**: It's like using different colored pens on an architectural blueprint to mark "these two load-bearing columns must align, or the building will collapse"—not relying on construction workers to remember, but drawing the constraint into the blueprint structure itself, making it impossible to build if not satisfied.

### Actionable Recommendations

1. **Use the type system to encode cache constraints**: If certain parameters must change together (or stay constant together), bind them into a struct with types.
2. **Write subtle cache invalidation scenarios in API comments**: Don't assume callers know that `maxOutputTokens` affects thinking config; write it directly into a CAUTION comment.
3. **Design a "cache-safe" child Agent launch entry point**: Encapsulate all parameters that need to be inherited from the parent Agent into a type, forcing callers to pass it, rather than offering a "fill in as needed" configuration object.

---

## Wisdom 6: Prompt as Compiler — From Natural Language to Structured Output

**Core Insight: The `/loop` skill Prompt is not a "task description instruction"—it is a true **compiler**—it receives natural language input (`"check the deploy every 20m"`), parses it according to priority rules, extracts interval and prompt, generates a cron expression, and outputs it to the `CronCreate` tool. The Prompt contains syntax rules, priority ordering, edge cases, and conversion tables. This is a DSL parser.**

### Evidence from Source Code

**Evidence 1: Three-Level Parsing Priority Rules**

Lines 31-43 of `src/skills/bundled/loop.ts`:

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

This is a three-level ambiguity resolution algorithm, written in natural language but logically equivalent to a regex matcher and priority parser.

**Evidence 2: Interval-to-Cron Conversion Table**

Lines 49-57 of the same file contain a complete conversion table:

| Interval pattern | Cron expression | Notes |
|------------------|-----------------|-------|
| `Nm` where N ≤ 59 | `*/N * * * *` | every N minutes |
| `Nm` where N ≥ 60 | `0 */H * * *` | round to hours |
| `Nh` where N ≤ 23 | `0 */N * * *` | every N hours |
| `Nd` | `0 0 */N * *` | every N days at midnight |
| `Ns` | treat as `ceil(N/60)m` | cron minimum granularity is 1 minute |

This is a complete mapping from human-readable time expressions to cron expressions, including edge case handling (seconds round up, N≥60 minutes automatically upgrades to hours).

**Evidence 3: Explicit Edge Case Enumeration**

Lines 58-60 of the same file:

```
If the interval doesn't cleanly divide its unit (e.g. `7m` → `*/7 * * * *` gives
uneven gaps at :56→:00; `90m` → 1.5h which cron can't express), pick the nearest
clean interval and tell the user what you rounded to before scheduling.
```

Compilers need to handle invalid input—`7m` produces uneven gaps in cron, `90m` is inexpressible. The Prompt handles these edge cases one by one, like a compiler's error recovery mechanism.

### Why This Matters to the AI Engineering Community

Usually we treat "natural language → structured format" conversion as an AI black-box problem. `/loop` demonstrates another approach: **explicitly write the parsing algorithm in the Prompt, treating AI as a controlled interpreter**. This makes behavior predictable, testable, and debuggable.

### Actionable Recommendations

1. **For tasks with clear parsing logic, write parsing rules explicitly into the Prompt**: Don't expect AI to figure it out on its own; spell out priorities, edge cases, and conversion rules clearly.
2. **Use tables to express mapping relationships**: The Interval → Cron conversion table makes AI behavior fully predictable, more reliable than natural language description.
3. **Handle edge cases in the Prompt**: AI needs to behave like a compiler, having explicit handling strategies for invalid or ambiguous input rather than guessing.

---

## Wisdom 7: Meta-Prompts — Using Prompts to Teach AI to Write Prompts

**Core Insight: The AgentTool description text teaches Claude how to write good Prompts for child Agents; and `AGENT_CREATION_SYSTEM_PROMPT` goes further—it transforms Claude into an "AI Agent architect," receiving the user's natural language description and outputting a complete Agent configuration JSON. This is using Prompts to generate Prompts—meta-level Prompt engineering.**

### Evidence from Source Code

**Evidence 1: Writing Guidance in AgentTool**

Lines 103-112 of `src/tools/AgentTool/prompt.ts`:

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

This Prompt is not telling Claude what task to do; it is teaching it **how to write a Prompt for another Claude**. This is a meta-prompt: a Prompt for Prompts.

**Evidence 2: AGENT_CREATION_SYSTEM_PROMPT**

Lines 26-96 of `src/components/agents/generateAgent.ts`, the complete Agent creation system Prompt:

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

This Prompt turns Claude into a professional Prompt engineer. The user inputs "I want a code review Agent," and the model outputs a JSON containing `identifier`, `whenToUse`, and `systemPrompt`—this JSON itself is a complete Prompt configuration for another AI Agent.

**Evidence 3: Dynamic Memory Instruction Injection**

Lines 100-120 of the same file, the `AGENT_MEMORY_INSTRUCTIONS` block is only appended to AGENT_CREATION_SYSTEM_PROMPT when `isAutoMemoryEnabled()`:

```javascript
const systemPrompt = isAutoMemoryEnabled()
  ? AGENT_CREATION_SYSTEM_PROMPT + AGENT_MEMORY_INSTRUCTIONS
  : AGENT_CREATION_SYSTEM_PROMPT
```

This is three layers of nested meta-prompts: the first layer is the system Prompt for generating Agent Prompts, the second layer is the dynamically appended memory instructions module, and the third layer is the final target Agent systemPrompt that gets generated.

### Why This Matters to the AI Engineering Community

When building multi-Agent systems, the quality of child Agents directly depends on the quality of Prompts written for them. Anthropic's solution is: **use a specially optimized meta-Prompt to automatically generate child Agent Prompts**, thereby encapsulating the skill of "writing good child Agent Prompts" into reusable infrastructure.

### Actionable Recommendations

1. **Establish a "Prompt generator" for your AI system**: Use a dedicated Agent or Prompt to generate configurations for other Agents, rather than manually maintaining each Agent's Prompt.
2. **Make the standards for "writing good Prompts" explicit**: Like AgentTool, write the rules for "how to write a good Prompt for a child Agent" into a referenceable guide.
3. **Distinguish between Prompt writing principles and the Prompt itself**: The former is meta-level knowledge, worth managing and iterating separately.

---

## Wisdom 8: Cognitive Science Mapping — Dream Is Not a Metaphor, but a Design Methodology

**Core Insight: The Dream consolidation process in the memory system directly maps to memory consolidation theory in cognitive science (episodic → semantic → procedural). In Phase 2, "don't exhaustively read transcripts, only look for things you already suspect matter"—this is not accidental wording, but a deliberate simulation of human sleep memory consolidation mechanisms (hypothesis-driven reactivation, not full replay). This shows Anthropic uses cognitive science as a design methodology, not just as a metaphor.**

### Evidence from Source Code

**Evidence 1: The Four-Phase Structure of Dream**

Lines 15-64 of `src/services/autoDream/consolidationPrompt.ts`, the buildConsolidationPrompt constructs:

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

These four phases correspond to the memory consolidation process in cognitive science: Orient (activate existing schemas in working memory) → Gather (selectively reactivate recent episodic memories) → Consolidate (extract core semantics to form long-term memory) → Prune (index optimization, maintaining memory retrieval efficiency).

**Evidence 2: Hypothesis-Driven Information Filtering**

Lines 37-41 of the same file:

```
Don't exhaustively read transcripts. Look only for things you already
suspect matter.
```

This sentence is the most critical part of the entire design. Human sleep memory consolidation is not a full replay of the day's experiences—neuroscience research shows that during consolidation, the brain is hypothesis-driven: it preferentially reactivates events that conflict with existing schemas, have high emotional weight, or represent prediction errors. "Only look for things you already suspect matter"—this is an accurate simulation of that mechanism.

**Evidence 3: Temporal Semantics of Memory Decay**

Lines 78-80 of `src/memdir/memoryTypes.ts`, the project memory writing standard:

```
Always convert relative dates in user messages to absolute dates when saving
(e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after
time passes.
```

This corresponds to "temporal tagging" in cognitive science—memories need to be anchored to absolute time points in order to correctly evaluate freshness and relevance during retrieval.

### Why This Matters to the AI Engineering Community

Most AI memory systems are implemented with simple vector databases, equating "memory" with "retrieval." Anthropic's Dream system embodies a deeper cognitive architecture: **memory is not just storage and retrieval, but also active consolidation—transforming fragmented episodic memories into structured semantic knowledge, deleting expired content, and maintaining index integrity**. Mapping cognitive science mechanisms to Prompt design is an engineering decision with theoretical grounding.

> **💡 Plain English**: You don't remember every minute of what happened yesterday; you remember "in yesterday's meeting, the boss made an important decision"—your brain did condensation and organization during sleep. The Dream system simulates exactly this process: not reading all chat logs, but actively searching for things worth remembering long-term.

### Actionable Recommendations

1. **Distinguish between "recording" and "consolidation"**: Don't store all conversation content directly as memory; design a dedicated consolidation step to extract knowledge truly worth preserving long-term.
2. **Use hypothesis-driven memory filtering**: During consolidation, have the AI first form hypotheses about "what might be worth remembering," then search selectively, rather than reading everything.
3. **Design temporal semantics for memory**: Relative dates ("last week," "tomorrow") should be converted to absolute dates when saving; memory decay and retrieval priority should consider temporal distance.

---

## Synthesis: From Prompt Engineering to AI Behavioral Engineering

Taken together, these eight wisdoms point to a larger paradigm shift.

**Old Paradigm — Prompt Engineering**: Write a clever piece of text that makes AI understand the task, then execute. The core question is "how to describe the task"; the core skill is wording and structure.

**New Paradigm — AI Behavioral Engineering**: Treat AI as a cognitive system with systematic biases, and shape its behavioral characteristics, habit patterns, and failure modes through Prompt structure design. The core question is "where will AI deviate from expectations, and how to systematically correct it"; the core skills are measurement, experimentation, and constraint design.

From the source code, this paradigm shift is reflected in several concrete transformations:

| Prompt Engineering Mindset | AI Behavioral Engineering Mindset | Source Code Example |
|---|---|---|
| Write clear task descriptions | Predict failure modes, explicitly name and counteract them | verificationAgent's six-item excuse list |
| One version for all users | Feature Flag-controlled exposure, A/B test-driven iteration | ant-only blocks + @[MODEL LAUNCH] comments |
| Judge Prompt quality by intuition | Quantitative eval tests, data-driven optimization | H1 0/2→3/3 records in memoryTypes.ts |
| Discover cache issues at runtime | Enforce cache constraints at compile time via type system | CacheSafeParams interface |
| Describe tasks | Encode parsing algorithms and transformation rules | /loop's three-level parsing rules and cron conversion table |
| Manually write child Agent Prompts | Meta-Prompt automatically generates child Agent configs | AGENT_CREATION_SYSTEM_PROMPT in generateAgent.ts |
| Simple storage and retrieval of memory | Simulate cognitive consolidation mechanisms, hypothesis-driven filtering | autoDream consolidationPrompt |

**True engineering is predictable failure**. A mature AI system should not make you worry "will the AI make this mistake this time?"—it should let you clearly know "in which scenarios it will fail, what is the failure probability, and what measures have we taken to reduce that probability."

Anthropic's 124 Prompt templates are an engineering archive in this direction—their value lies not in the text itself, but in the experiment records, failure cases, and measurement data behind the text. This is the necessary path for AI engineering to evolve from art to science.

## The Cost of the Eight Wisdoms: A Critical Reflection

These eight wisdoms are not a free lunch. Each solves a problem while introducing new complexity, maintenance cost, or trade-offs:

| Wisdom | Cost/Limitation Introduced |
|--------|---------------------------|
| **Predicting failure modes** | The verificationAgent "excuse list" is a historical archive—each item corresponds to a real failure case. This means new failure modes can only be added after they are exposed in production, creating **retrospective bias**: unexperienced failure modes cannot be preemptively guarded against |
| **Feature Flag dual-track** | The ant-only/external dual version means internal and external users experience systematic differences, and during debugging "the behavior I see" may differ from "the behavior the user sees," **increasing support cost** |
| **Data-driven eval** | H1/H2/H3 hypothesis testing requires continuously maintaining test sets and ground truth, and **eval maintenance costs** will accumulate as the system evolves. The source code contains no eval retirement mechanism |
| **Type system enforced constraints** | CacheSafeParams encodes cache-sharing constraints into types, but also **couples to Anthropic API's specific cache key computation rules**—if API implementation details change, the type definitions need synchronous updates |
| **Meta-Prompts** | The design of using Prompts to generate Prompts adds an abstraction layer, **lengthening the debug chain**: when a generated child Agent behaves abnormally, the problem could lie in the meta-Prompt wording, Claude's parsing, or the child Agent's execution |
| **Cognitive science mapping** | The sleep consolidation mechanism that Dream draws upon is an **engineering analogy not strictly validated by neuroscience**—it "seems reasonable," but lacks cross-domain validity proof. Whether this analogy can generalize to other scenarios (such as long-term memory decay) is not answered by the source code |

A broader critique: **all eight wisdoms depend on a hidden assumption—you have Anthropic-level resources**. Maintaining 124 Prompt templates, continuously running eval test sets, and doing experimental records for every failure mode—the marginal cost of this methodology is extremely high for small teams. Can a 3-person startup replicate this system? The source code implies the answer is "adopt as needed": start with the highest-ROI wisdoms (such as type system constraints), rather than copying the whole system wholesale.

Another point worth vigilance: **there is tension among these eight wisdoms**. "Data-driven eval" encourages rapid iteration and A/B experimentation; "type system enforced constraints" demands structural stability. The two need balance in practice—over-reliance on eval may lead to frequently breaking type contracts, while over-emphasis on type stability may stifle experimental space. The source code does not provide an explicit trade-off framework; this is an open question left to practitioners.

---

*Source code files referenced in this chapter:*
- *`src/constants/prompts.ts` — Main system Prompt, containing ant/external dual-version logic*
- *`src/tools/AgentTool/built-in/verificationAgent.ts` — Anti-laziness verification Agent*
- *`src/tools/AgentTool/prompt.ts` — AgentTool description and meta-prompt standards*
- *`src/memdir/memoryTypes.ts` — Memory type system and eval experiment records*
- *`src/utils/forkedAgent.ts` — CacheSafeParams and Fork Agent infrastructure*
- *`src/commands/security-review.ts` — Security review Prompt specification (196 lines)*
- *`src/commands/init.ts` — /init 8-phase wizard (224 lines)*
- *`src/skills/bundled/loop.ts` — /loop compiler-style Prompt*
- *`src/components/agents/generateAgent.ts` — Agent creation meta-Prompt*
- *`src/services/autoDream/consolidationPrompt.ts` — Dream memory consolidation Prompt*
