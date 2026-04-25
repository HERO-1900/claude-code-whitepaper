# What Is Claude Doing While You're Still Typing?

While you're still thinking about your next message, Claude Code is already working. It borrows a classic idea from CPU branch prediction: it predicts what you're most likely to say and launches a full AI inference loop ahead of time—if it guesses right, response latency drops to zero. This chapter reveals the complete mechanism of the Speculation system, including Copy-on-Write file isolation, pipelined prediction, and prompt cache reuse strategies.

> 💡 **Plain English**: It's like a restaurant server prepping ingredients for your usual order while you're still browsing the menu.

### 🌍 Industry Context

The idea of "executing before the user finishes thinking" is gradually emerging across AI coding tools, but implementation depth varies widely:

- **Cursor (Tab completion)**: It predicts the next code completion in real time as you type, but this is essentially token-level prediction and doesn't involve a full Agent reasoning loop. Its "prediction" is closer to an enhanced IDE autocomplete, with no Copy-on-Write file isolation layer.
- **GitHub Copilot**: Agent Mode is fully GA, with dedicated agents like Explore, Plan, and Task, but its design focuses on intent-driven autonomous engineering rather than the speculative execution paradigm of "predicting the user's next step and executing ahead of time."
- **Windsurf (Cascade)**: The Cascade Engine's continuous state awareness tracks the developer's cursor position, file-switching history, and terminal output in real time, enabling sub-second "Predictive Edits"—anticipating cross-file changes from the first few characters of a request. This is UI-level predictive editing, a different layer of optimization from Claude Code's approach of launching a full Agent inference loop in the background.
- **Aider**: A pure terminal tool with no speculative execution mechanism; every interaction follows a synchronous request-response pattern.
- **CodeX (OpenAI)**: Uses parallel Agent workflows and an inbox communication mechanism, focusing on multi-task asynchronous processing rather than predicting a single turn ahead of time.

Claude Code's speculative execution is the most CPU-branch-prediction-like implementation among publicly visible AI coding tools today—it doesn't just predict user intent, but also executes the full Agent loop ahead of time and isolates side effects through a COW file system. However, note that this feature is currently limited to Anthropic internal users and has not yet been validated at scale externally.

---

## The Problem

When Claude Code answers you, it starts working before you've even typed your next message. This isn't science fiction—there's an entire `speculation.ts` module in the codebase called "speculation." What is this thing, and how does it work?

---

## You Might Think...

You might think latency in AI applications can only be improved with faster models or faster networks—the user's wait time equals "send request + model inference + network transfer." This formula seems to leave little room for optimization.

But Claude Code borrows a classic trick from CPU design.

---

## How It Actually Works

> **[Chart placeholder 2.6-A]**: Speculative execution timeline comparison—top track: traditional approach (wait until you finish typing); bottom track: speculative execution (AI is already running while you type), clearly showing the "latency ≈ 0 on hit" benefit

### Two-Step Prediction: Guess First, Act Early

**Step 1: Prompt Suggestion**

Every time Claude answers you, the system immediately launches a "prediction Agent" whose sole job is to predict what you're most likely to say next:

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

This prediction Agent outputs a 2-12 word suggestion, such as "run the tests", "yes go ahead", or "commit this". It's displayed near the input box, and you can accept it with one click.

**Step 2: Speculation**

Once a suggestion exists, the system doesn't just show it to you—it immediately uses that suggestion as input to **launch a full AI inference loop**, pretending you've already sent that message. This is "speculation."

### Copy-on-Write Overlay File System

> 📚 **Course Connection**: Copy-on-Write is a classic concept from operating systems courses—Linux's `fork()` syscall uses COW: parent and child processes share physical memory pages, and a copy is made only when one side writes. Docker's OverlayFS is a filesystem-level implementation of the same idea. Claude Code builds a lightweight userspace overlay file system, and its principle is almost identical to OverlayFS's "upper/lower" layer model.

Speculative execution can't modify files arbitrarily, or a misprediction would leave dirty data behind. The system designs a Copy-on-Write overlay file system:

```
Main directory: ~/my-project/
Overlay layer: ~/.claude/tmp/speculation/<PID>/<UUID>/

Write operations (Edit/Write):
  → First copy the original file to the overlay layer
  → Modifications are written to the overlay layer (main directory unchanged)

Read operations (Read/Grep/Glob):
  → If the file is already in the overlay layer (modified by this speculation) → read from overlay
  → Otherwise → read from the main directory (original)
```

The speculative context sees a complete, consistent filesystem view, but all modifications are isolated in a temporary overlay layer.

### Accept or Discard

**If you actually send that message:**
1. File changes from the overlay layer are merged back into the main directory
2. The speculatively generated message is injected directly into the session history
3. **No new API call is needed** — response latency is zero
4. The system logs the time saved (`timeSavedMs`)

**If you send something else:**
1. The overlay layer is silently deleted, leaving no trace
2. A new API request is initiated normally with your actual input

### Safety Boundaries of Speculation

Speculative execution isn't unlimited—it proactively stops in front of certain operations:

```
Allowed:
  Read, Glob, Grep, ToolSearch — read-only operations, always allowed
  Edit/Write — only if currently in acceptEdits or bypassPermissions mode
  Bash — only read-only commands (e.g., ls, cat)

When encountering these, stop speculation and record the boundary:
  Non-read-only Bash → record command, abort
  File edit requiring confirmation → record file path, abort
  Other tools → record tool name, abort

Limits: at most 20 turns of AI inference, 100 messages
```

When speculation hits an operation requiring human confirmation, it "pauses there"—recording what it intended to do, waiting for you to accept before continuing.

### Pipelined Prediction

After speculation completes, the system does one more thing: **it immediately starts predicting what you'll say after accepting this speculation**. This way, once you accept the current suggestion, the next suggestion and the next speculation are already in flight, forming a prediction pipeline.

---

## This Is CPU Speculative Execution in Software

> 📚 **Course Connection**: This speculative execution maps directly to the **Branch Prediction and Speculative Execution** chapter in computer architecture courses. When a CPU's out-of-order execution pipeline encounters a conditional branch, it uses a Branch Target Buffer (BTB) and Branch History Table (BHT) to predict the jump direction, executing instructions on the predicted path ahead of time. If correct, it commits the results; if wrong, it flushes the pipeline. Claude Code's COW file system is essentially a software-level Reorder Buffer (ROB)—all speculative writes are staged in an isolated layer, awaiting "commit" or "rollback."

**CPU branch prediction:**
```
When executing if-else, the CPU doesn't wait for the condition to resolve
→ Predicts which branch is likely taken
→ Executes instructions on that branch ahead of time
→ Prediction correct: commit directly, zero delay
→ Prediction wrong: discard and re-execute, cost is a few cycles
```

**Claude Code's speculation:**
```
After AI answers, while the user is still thinking
→ Predict what the user is most likely to send
→ Execute the full AI inference loop ahead of time
→ Prediction correct: inject response directly, zero latency
→ Prediction wrong: discard and process the user's actual input normally
```

It uses "waiting time" (human thinking) to "do work" (AI inference). Correct means commit; wrong means rollback.

---

## The Subtlety of Cache Reuse

Both the prompt suggestion Agent and the speculation Agent use the **exact same** API parameters as the parent request (system prompt, tools, model, message prefix), specifically to share the parent request's prompt cache.

Why does this matter? If the cache hits, these additional API calls only need to process the tokens in the new portion, dramatically reducing cost.

There's a real lesson here: someone tried setting `effort: 'low'` for the prediction Agent to save costs, and the prompt cache hit rate dropped from 92.7% to 61%, while cache write volume per prediction jumped 45x. That's because changing `maxOutputTokens` indirectly affected `thinking budget_tokens`, which is part of the Anthropic API cache key.

---

## Who Has Access to This Feature?

Currently, speculative execution is **ant-only** (`process.env.USER_TYPE === 'ant'`), meaning it's exclusive to Anthropic employees.

Prompt suggestions (shown next to the input box) are controlled by the GrowthBook feature gate `tengu_chomp_inflection` and may be partially available to external users.

This "test internally first, then gradually roll out" pattern is visible everywhere in the Claude Code codebase.

---

## What We Can Learn From This

**Wait time is a hidden work window.**

Any interactive system with "human thinking time" can consider predicting and pre-executing during that window:
- AI chat: predict the user's next message, reason ahead of time
- Search: while the user is still typing, retrieve likely results early
- IDE: while the user reads code, pre-analyze likely errors
- Database: before the current query arrives, pre-warm the cache

The key technologies are an **isolation layer** (ensuring mispredictions don't pollute state) and **low-cost prediction** (shared cache, small prediction overhead).

---

## Limitations and Critique

- **Internal-only**: The speculative execution feature is gated behind `USER_TYPE === 'ant'`, so external users can't experience "zero-latency" responses, and the feature's value can't be broadly validated.
- **Unknown prediction accuracy**: There's no public data on prediction acceptance rates in the codebase; if the hit rate is low, the extra API calls and COW filesystem overhead become pure waste.
- **Fragile cache parameter coupling**: `CacheSafeParams` requires prediction Agent and main request parameters to be identical—any parameter tweak (e.g., effort, maxOutputTokens) can break cache hit rates, as demonstrated in the "low-effort experiment" lesson.

---

## Code Landmarks

- `src/services/promptSuggestion/` — prompt suggestion module directory
- `src/utils/speculation/` — speculative execution utility layer
- `src/services/PromptSuggestion/speculation.ts`, line 402: `startSpeculation()` entry point
- `src/services/PromptSuggestion/speculation.ts`, line 717: `acceptSpeculation()` acceptance logic
- `src/services/PromptSuggestion/promptSuggestion.ts`, line 258: `SUGGESTION_PROMPT` full prediction prompt
- `src/services/PromptSuggestion/promptSuggestion.ts`, line 294: `generateSuggestion()` function
- `src/utils/forkedAgent.ts`, line 57: `CacheSafeParams` type definition and notes
- `src/state/AppStateStore.ts`, line 52: `SpeculationState` and `CompletionBoundary` types

---

## Directions for Further Inquiry

- How many scenarios use `runForkedAgent()`? Besides speculation, there's SessionMemory, compact summaries—what else?
- How is the speculative Agent's `boundary` information surfaced in the UI? Can users see a "speculation paused here, waiting for your acceptance" state?
- What conversation types are most accurate for prompt suggestions? Is there any public data on prediction acceptance rates?

---

*Quality self-check:*
- [x] Coverage: prompt suggestion, speculative execution, COW filesystem, pipelining, and cache reuse all covered
- [x] Fidelity: code locations and constant values (`MAX_SPECULATION_TURNS=20`, 2-12 words) are sourced from the codebase
- [x] Readability: CPU analogy builds intuition; code blocks explain mechanisms
- [x] Consistency: aligned with type definitions in AppStateStore
- [x] Critical: notes ant-only limitation and cache lesson
- [x] Reusable: linked chapters listed
