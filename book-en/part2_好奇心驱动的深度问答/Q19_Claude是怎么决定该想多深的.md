# How Does Claude Decide How "Deep" to Think?

Renaming a variable and refactoring a complex module obviously demand different depths of thought. Claude Code doesn't leave this decision entirely to the model—it has designed three independent thinking-depth control mechanisms: a persistent Effort gear, a temporary Ultrathink magic keyword, and an Advisor that calls a stronger model for review. This chapter disassembles the implementation details, cost trade-offs, and economic logic of these three mechanisms.

> 💡 **Plain English**: It's like writing a paper—jot down a quick answer for easy questions, but research, outline, and revise for hard ones.

> 🌍 **Industry Context**: Thinking-depth control was a hot topic in LLM applications during 2024-2025, but implementations vary widely. **OpenAI**'s o1/o3 series introduced the concept of "reasoning tokens," letting users control reasoning depth via a `reasoning_effort` parameter (low/medium/high)—very similar to Claude Code's Effort mechanism at the API level. **Cursor** lets users choose between "Fast" and "Normal" modes in settings to trade speed for quality. **GitHub Copilot** launched multi-model selection in 2025 (GPT-4o, Claude, Gemini), indirectly controlling thinking depth by switching models, but offers no in-model gear adjustment. **Aider** controls the quality/speed trade-off by switching between different models (e.g., GPT-4 vs GPT-3.5) with no single-model multi-gear mechanism. Claude Code's three-layer system (persistent Effort gear + temporary Ultrathink keyword + external Advisor review) is among the industry's most granular and flexible, especially the Advisor's "call a stronger model to review the current model" pattern, which is still rare in mainstream programming tools. That said, the low/medium/high Effort levels themselves are not original to Claude Code—they map to standard Anthropic API parameters, contemporaneous with OpenAI's `reasoning_effort`.

---

## The Question

When you ask Claude to rename a variable, it answers in 0.3 seconds. When you ask it to refactor a complex module, it thinks for ten seconds before acting. Add `ultrathink` to your message, and it spends even longer crafting a more rigorous plan. Sometimes you even see it "consulting" a stronger model. How does Claude Code switch between "quick answer" and "deep thought"? What mechanisms drive this behind the scenes?

---

> **[Chart placeholder 2.19-A]**: Hierarchy diagram — from Effort to Ultrathink to Advisor, the three-layer thinking-depth control (persistent default → temporary boost → external review)

## You Might Think...

"It's probably just up to the model, right? Simple questions get less thought, complex ones get more." You might reason by analogy to humans: 1+1 gets an instant answer, but a differential equation takes careful work.

---

## How It Actually Works

In Claude Code, "how deep to think" is decomposed into **three independent mechanisms**, each with different control granularity, trigger conditions, and cost profiles:

1. **Effort** — a persistent "default gear," like a car's driving modes (Eco / Normal / Sport / Track)
2. **Ultrathink** — a temporary "turbo boost," triggered by adding a single keyword to one message
3. **Advisor** — "get a second brain to review," calling a stronger model to check the current model's work

### Section 1: Effort — A Four-Speed Transmission

> 📚 **Course Connection**: The essence of the Effort mechanism is an application of **operating systems** resource scheduling—like Linux's `nice` value controlling process priority, or mobile OS "power-saving/performance modes" regulating CPU frequency. By selecting an Effort gear, the user tells the system "how much compute I'm willing to spend on this task," and the system adjusts the thinking-token budget accordingly. It also maps the **computer architecture** concept of DVFS (dynamic voltage and frequency scaling) to the AI inference layer.

```typescript
// src/utils/effort.ts, lines 13-18
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
```

| Level | Behavior | Availability |
|-------|----------|--------------|
| **low** | Fast and direct, minimal overhead | All Claude 4.6 models |
| **medium** | Balances speed and quality | All Claude 4.6 models |
| **high** | Thorough and deep (API default) | All Claude 4.6 models |
| **max** | Deepest reasoning, longest thinking | **Opus 4.6 only** |

Note the last row—`max` is exclusive to Opus 4.6. If you set `max` on Sonnet 4.6, the system automatically downgrades it to `high` (`effort.ts:163`). This isn't a software restriction; it's an API constraint—other models return an error when sent `max`.

The **priority chain** for Effort is (`effort.ts:152-167`):

```
Env var CLAUDE_CODE_EFFORT_LEVEL → user setting (appState) → model default
```

The environment variable also supports a special value, `unset`—meaning "don't send the effort parameter at all, let the API use its own default."

Most interesting is the default strategy:

```typescript
// src/utils/effort.ts, lines 307-319
// Default effort on Opus 4.6 to medium for Pro.
if (model.toLowerCase().includes('opus-4-6')) {
  if (isProSubscriber()) {
    return 'medium'
  }
  if (getOpusDefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())) {
    return 'medium'
  }
}
```

**Opus 4.6 defaults to `medium`, not `high`.** The code comment explains why:

> "We recommend medium effort for most tasks to balance speed and intelligence and **maximize rate limits**."

This is a carefully calculated economic decision (OpenAI's o1 series made a similar default effort choice). Pro users have rate limits (calls per minute/day). `high` effort consumes more tokens, which means fewer tasks fit under the same rate limit. Defaulting to `medium` gives users a smooth experience in most scenarios, with manual upgrades to `high` or `max` only when truly needed.

### Section 2: Ultrathink — The Magic Keyword

If you don't want to permanently change the effort setting but need Claude to think deeper **just this once**, simply type `ultrathink` in your message:

```typescript
// src/utils/thinking.ts, lines 29-31
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}
```

The system detects this word in your input (case-insensitive, `\b` ensures it's a whole word, not a substring), and then:

1. **UI feedback**: `ultrathink` renders in **rainbow colors** in the input box (a 7-color cycle plus shimmer variants, `thinking.ts:60-78`), confirming it's recognized
2. **Temporary boost**: This request's thinking effort is bumped to `high` (from the default `medium`)
3. **No persistence**: The next request reverts to the default effort

Ultrathink must pass two gates: a compile-time `feature('ULTRATHINK')` and a runtime GrowthBook gate `tengu_turtle_carbon` (codename: turtle carbon—turtle implying "slow thinking"?).

### Section 3: Three Thinking Modes

At a lower level, Claude's "thinking" capability has three configuration modes (`thinking.ts:10-13`):

```typescript
export type ThinkingConfig =
  | { type: 'adaptive' }                          // model decides on its own
  | { type: 'enabled'; budgetTokens: number }      // forced on + token budget
  | { type: 'disabled' }                           // off
```

**Adaptive thinking** is the new capability in Claude 4.6 models—the model decides whether to think, and for how long, based on problem complexity. This is why you observe "easy questions answered instantly, hard questions pondered deeply."

A strongly worded warning appears in the code comments (`thinking.ts:135-138`):

> "Newer models (4.6+) are all trained on adaptive thinking and MUST have it enabled for model testing. **DO NOT** default to false for first party, otherwise we may silently degrade model quality."

This shows that adaptive thinking is not an optional optimization but a core assumption of model training. Disabling it is like forcing someone trained to "think before speaking" to blurt out answers—quality drops significantly.

### Section 4: Advisor — Letting Opus Review Sonnet

> 📚 **Course Connection**: Advisor mode is the AI implementation of **software engineering** code review—just as a senior engineer reviews a junior engineer's PR, a stronger model reviews a weaker model's output. It also maps to the **distributed systems** "arbiter" pattern: when a single node's decision isn't reliable enough, bring in an external authority for final arbitration.

This is the most complex of the three mechanisms. Advisor doesn't adjust the depth of the same model; it **calls another model to review the current model's work**.

```typescript
// src/utils/advisor.ts, lines 9-14
export type AdvisorServerToolUseBlock = {
  type: 'server_tool_use'
  id: string
  name: 'advisor'
  input: { [key: string]: unknown }
}
```

Advisor is a **server-side tool**—when the primary model (e.g., Sonnet 4.6) decides review is needed, it "calls" the advisor tool. This call isn't executed locally; the API server forwards the entire conversation history to a stronger model (e.g., Opus 4.6), which reviews it and returns advice.

The invocation strategy is hard-coded in a long prompt instruction block (`advisor.ts:130-145`). Core rules:

1. **Call before writing code**—not after finishing, but at the decision point
2. **Call when you think the task is done**—but write the results to files first! Because the advisor call takes time, and if the session interrupts, at least the code is saved
3. **Don't silently switch when you find contradictions**—if your observation conflicts with the advisor's suggestion, call again and explicitly ask, "I found X, you suggest Y, which is correct?"

One curious variant of the advisor result (`advisor.ts:22-25`):

```typescript
| { type: 'advisor_redacted_result'; encrypted_content: string }
```

**Encrypted results**. This means part of the advisor's response may contain content that shouldn't be exposed to the client—perhaps internal reasoning from a safety layer, or raw output from a differently RLHF-trained model. We only see the encrypted ciphertext.

### Section 5: The Cost of the Three Mechanisms

The Cost Tracker system (`cost-tracker.ts`) fully tracks the cost of each mechanism:

Opus 4.6 pricing structure (`modelCost.ts`):

| Mode | Input (per Mtok) | Output (per Mtok) | Multiplier |
|------|------------------|-------------------|------------|
| Standard | $5 | $25 | 1x |
| Fast mode | $30 | $150 | **6x** |

This means:
- `medium` effort + standard mode = most economical
- `high` effort + standard mode = moderate cost
- `max` effort + standard mode = deepest thinking
- any effort + fast mode = 6× price but faster output

Advisor cost is **additive**—it doesn't replace the primary model call; it stacks an advisor model call on top. `cost-tracker.ts:304-321` shows that advisor token usage is extracted from the main request's `usage.iterations` and costed separately.

An unexpected finding: legacy Opus 4/4.1 pricing was $15/$75—**3× more expensive** than the new Opus 4.6 standard mode ($5/$25). This suggests Anthropic achieved massive inference-efficiency gains in version 4.6, or is intentionally cutting prices to drive migration.

### Section 6: OpenTelemetry Four-Dimensional Metering

After every API call, costs are reported via OTel counters (`cost-tracker.ts:286-301`), with dimensions:

```typescript
getCostCounter()?.add(cost, { model, speed? })       // cost counter
getTokenCounter()?.add(tokens, { model, speed?, type })  // token counter
// type: 'input' | 'output' | 'cacheRead' | 'cacheCreation'
```

Fast-mode calls carry a `speed: 'fast'` attribute, letting the backend track standard and fast-mode usage independently. This isn't just "accounting"—this data drives rate-limit strategy, pricing adjustments, and economic decisions like "Opus defaults to medium."

---

## The Philosophy Behind It

The design philosophy of the three-layer thinking-control system is **"let users pay for the thinking they need"**:

1. **Effort is the baseline**. Like a phone's performance mode, you set it once. Defaulting to `medium` is a carefully calculated economic optimum—balancing "good enough" with "saving money."
2. **Ultrathink is the exception**. Not worth changing settings? Type one magic keyword—it auto-reverts next time. Zero friction, zero persistence.
3. **Advisor is insurance**. When the cost of a wrong decision is high, spending double the tokens for a stronger model review is worth it.

At a deeper level, these three mechanisms reflect Anthropic's understanding of AI tool pricing: **thinking is a costly resource, not a free feature**. Users aren't buying "an AI assistant"; they're buying "X amount of thinking." Effort, ultrathink, and advisor are the three controls for "turn down / turn up / call for help."

The GrowthBook gate name `tengu_grey_step2` hints at a staged gray rollout—first default Pro users to medium (step 1), then gradually expand to Max/Team (step 2). This cautious pace reflects how sensitive defaults are to user experience: one wrong default can make masses of users feel "Claude got dumber."

---

## Limitations and Critique

- **Risk of perceived degradation from the medium default**: Opus 4.6 defaulting to `medium` instead of `high` saves rate limits, but users may feel "Claude got dumber" without knowing they can manually raise it—an economically optimal but user-perception-unfriendly default
- **Advisor encrypted results are opaque**: `encrypted_content` means users cannot inspect the advisor's full advice, which is a trust issue in scenarios requiring explainability
- **Ultrathink discoverability is poor**: The magic keyword lacks in-product documentation; users only learn about it through word of mouth or accidentally discovering that typing `ultrathink` temporarily boosts thinking depth

---

## Code Landmarks

- `src/utils/thinkingBudget.ts` — thinking token budget management
- `src/services/api/` — API call layer (effort/thinking parameter injection)
- `src/utils/effort.ts`, lines 13-18: `EFFORT_LEVELS = ['low','medium','high','max']`
- `src/utils/effort.ts`, lines 52-65: `modelSupportsMaxEffort` Opus 4.6 restriction
- `src/utils/effort.ts`, lines 152-167: `resolveAppliedEffort` priority chain
- `src/utils/effort.ts`, lines 260-265: `OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT`
- `src/utils/effort.ts`, lines 307-319: Opus 4.6 Pro default medium
- `src/utils/effort.ts`, lines 209-215: numeric effort ant-only mapping
- `src/utils/thinking.ts`, lines 10-13: `ThinkingConfig` three modes
- `src/utils/thinking.ts`, lines 19-24: `isUltrathinkEnabled()` dual gates
- `src/utils/thinking.ts`, lines 29-31: `hasUltrathinkKeyword()` regex
- `src/utils/thinking.ts`, lines 60-78: rainbow colors + shimmer variants
- `src/utils/thinking.ts`, lines 113-144: adaptive thinking Claude 4.6 restriction
- `src/utils/advisor.ts`, lines 9-32: `AdvisorServerToolUseBlock` + `AdvisorToolResultBlock`
- `src/utils/advisor.ts`, lines 53-58: `tengu_sage_compass` GrowthBook gate
- `src/utils/advisor.ts`, lines 89-96: Opus 4.6 + Sonnet 4.6 restriction
- `src/utils/advisor.ts`, lines 130-145: `ADVISOR_TOOL_INSTRUCTIONS`
- `src/utils/modelCost.ts`, lines 54-69: Opus 4.6 standard $5/$25 + fast $30/$150
- `src/utils/modelCost.ts`, lines 94-99: `getOpus46CostTier()` fast mode detection
- `src/cost-tracker.ts`, lines 286-301: OTel counter four-dimensional metering
- `src/cost-tracker.ts`, lines 304-321: Advisor token extraction + cost accumulation

---

## Directions for Further Inquiry

1. **Numeric effort's exact API behavior**: What happens inside the model when an ant-only numeric effort (e.g., 75) is sent to the API? How does the model interpret it?
2. **Purpose of Advisor encrypted results**: Where is `encrypted_content` decrypted? On the claude.ai frontend or the backend?
3. **Interaction between Ultrathink and Effort**: If a user sets `max` effort and also types `ultrathink`, what happens? Stack or ignore?
4. **Technical implementation of fast mode**: What does the 6× price buy? Larger GPU clusters, more parallelism, or shorter queue wait times?
5. **Precise control of thinking budget tokens**: How does `ThinkingConfig.enabled.budgetTokens` get enforced on the API side?

---

*Quality self-check:*
- [x] Coverage: deep read of five core files—effort.ts, thinking.ts, advisor.ts, modelCost.ts, cost-tracker.ts
- [x] Fidelity: all constants, prices, and line numbers come from source code
- [x] Readability: car transmission / turbo boost / second brain analogies build intuition
- [x] Consistency: follows the standard Q&A chapter structure
- [x] Critical: points out opacity of encrypted_content and Pro vs Max experience differences
- [x] Reusable: the three-layer thinking-control model and OTel four-dimensional metering can be applied to any paid AI service
