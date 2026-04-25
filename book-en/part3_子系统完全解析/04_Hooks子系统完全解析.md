# Complete Analysis of the Hooks Subsystem

Have you ever used delivery notifications? "Automatic text when package arrives," "Identity verification before signing," "Auto-forwarding if delivery fails" — that's what Hooks do, except instead of managing packages, they manage every action Claude takes.

Hooks let you inject custom logic at **27 critical moments** in Claude Code — intercepting before a tool call, automating permission decisions, checking "are you really done?" before the AI finishes a task — all by editing a single configuration file, no source code changes required. This chapter provides a complete enumeration of those 27 events, the 4 execution types, and the dual-track semantics of exit codes.

> **Source Code Locations**: `src/hooks/` (104 files), `src/services/hooks/`

> 💡 **Plain English**: Think of Hooks as notification settings for a parcel locker:
> - "Automatic text when package arrives" → `PostToolUse` (notify after tool use)
> - "Identity verification before signing" → `PreToolUse` + exit 2 (intercept before execution)
> - "Auto-forward if delivery fails" → `StopFailure` (trigger fallback on failure)
> - Notification method options: text message (command), AI judgment (prompt/agent), system integration (http)

With that analogy in mind, let's look at where Hooks sit in the broader industry landscape.

> 🌍 **Industry Context**: Lifecycle hooks are a well-established design pattern in software engineering. **Git** itself has pre-commit/post-commit hooks, and Claude Code clearly borrows from this design in naming and exit-code semantics. Among comparable AI tools: **Cursor** injects project instructions via `.cursorrules` but offers no event hooks; **Aider**'s `--lint-cmd`/`--test-cmd` are specialized equivalents of two Claude Code hooks; **LangChain**'s Callbacks concept is the closest match, but as a code API rather than configuration-driven. Claude Code's combination of 27 events + 4 execution types + exit 2 blocking semantics offers the broadest coverage, but also the steepest learning curve.

---

## Overview

Hooks are Claude Code's **lifecycle injection-point system** — users can register custom logic (shell commands, AI prompts, HTTP requests, or multi-turn Agents) on 27 predefined events throughout the system, altering behavior without modifying Claude Code's source code. From pre-tool-call interception to automated permission decisions to stop-condition validation for sub-Agents, Hooks can intervene at almost every critical decision point in the system.

---

> **[Chart placeholder 3.4-A]**: Lifecycle diagram — the position of all 27 events across the Session/Query/Tool/Agent four-layer lifecycle

> **[Chart placeholder 3.4-B]**: Exit-code decision table — the differing semantics of exit 0/2/other across event types

---

## 1. Complete Classification of the 27 Events

### 1.1 Tool Lifecycle (3 events)

| Event | Trigger Timing | Blockable? | stdout Purpose |
|------|---------------|------------|---------------|
| `PreToolUse` | Before tool invocation | ✅ Blocked by exit 2 (see note below) | stderr shown to model |
| `PostToolUse` | After tool invocation | ❌ | stdout injected into model |
| `PostToolUseFailure` | When tool invocation fails | ❌ | fire-and-forget (notify and move on, no response waited) |

> 💡 **What is an exit code?** Every program returns a number when it finishes, telling the system "how did I do?" **exit 0** = "All good, proceed"; **exit 2** = "I want to block this operation, do not execute"; **any other number** = "I had an error, but don't disrupt normal flow." It's like a traffic light: green means go, red means stop, yellow flashing means abnormal but non-blocking.

`PreToolUse` is the most powerful hook — it can intercept any tool before execution. Typical use cases: preventing Claude from modifying specific directories in CI, or sending a notification before a dangerous command runs.

### 1.2 Permission-Related (2 events)

| Event | Trigger Timing | Special Capability |
|------|---------------|-------------------|
| `PermissionDenied` | After auto classifier rejects | exit 2 can ask model to retry |
| `PermissionRequest` | When permission popup displays | `hookSpecificOutput` can replace user decision |

The `PermissionRequest` hook can **automatically answer permission popups** — meaning you can write a script that auto-approves or denies Claude's tool-call requests based on custom rules, enabling fully unattended automation pipelines.

> **Permission Decision Merging Logic: deny > ask > allow**
>
> When multiple Hooks are registered on the same event, their permission decisions merge under a **most-restrictive-wins** rule:
> - Any Hook returns `deny` → final decision is **deny**
> - No deny, but any Hook returns `ask` → final decision is **ask** (user confirmation required)
> - All Hooks return `allow` → final decision is **allow**
>
> This design preserves an important **security invariant** (a property that must remain true in all system states): **Hooks can only tighten permissions, never loosen them**. In other words, even if a Hook returns `allow`, it cannot override a `deny` already configured in the settings file. This prevents malicious or misconfigured Hooks from bypassing security policies by returning `allow`.

> ⚠️ **Security Threat Model**: `PermissionRequest` is essentially an **official bypass interface for the permission system**, and its security implications must be taken seriously:
>
> **Supply-chain attack vector**: A supply-chain attack means the attacker doesn't target you directly, but plants traps in upstream resources you trust — like poisoning food in a supermarket supply chain. Applied here: if an attacker injects a `PermissionRequest` hook (returning `{ decision: "allow" }`) into an open-source repo's `.claude/settings.json`, any user who clones that repo and trusts the workspace will automatically approve all dangerous operations — including deleting all files, arbitrary network requests, or modifying system files. This resembles the attack pattern of malicious npm packages (third-party libraries in the JavaScript ecosystem), but with more immediate impact.
>
> **Single Line of Defense**: The current system relies on a binary trust model via `hasTrustDialogAccepted()` — after the user confirms trust on first use, all hooks in that workspace gain execution permission. There is no finer-grained "trust this hook but not that one" mechanism. Trust is all-or-nothing: once you trust the workspace, you trust all its hooks.
>
> **Missing Defense Layers**: There is currently no hook-level signature verification, sandbox isolation, or operation audit logging. For enterprise deployments, recommendations are: (1) code-review all changes to `.claude/settings.json`; (2) use `localSettings` (not version-controlled) rather than `projectSettings` for sensitive hooks; (3) consider pairing with a `PreToolUse` hook for secondary validation.

### 1.3 Session Lifecycle (2 events)

| Event | Trigger Timing | Subtypes |
|------|---------------|---------|
| `SessionStart` | When a new session starts | startup/resume/clear/compact |
| `SessionEnd` | When a session ends | clear/logout/prompt_input_exit/other |

### 1.4 AI Turn (2 events)

| Event | Trigger Timing | Blockable? |
|------|---------------|------------|
| `Stop` | When Claude is about to end its turn | ✅ exit 2 prevents stopping, continues working |
| `StopFailure` | Ending due to API error | ❌ fire-and-forget |

The `Stop` hook is the key to implementing "verification loops" — you can run tests when Claude thinks a task is done, and if they fail, exit 2 makes Claude keep fixing it.

### 1.5 User Interaction (2 events)

| Event | Trigger Timing | Capability |
|------|---------------|-----------|
| `UserPromptSubmit` | When user submits prompt | Can modify or block prompt |
| `Notification` | When sending a notification | Custom notification channels |

`UserPromptSubmit` can **modify user input** — for example, automatically adding context, expanding abbreviations, or rejecting submission under certain conditions.

### 1.6 Sub-Agent (2 events)

| Event | Trigger Timing | Blockable? |
|------|---------------|------------|
| `SubagentStart` | When an Agent tool call begins | ❌ (stdout passed to sub-Agent) |
| `SubagentStop` | When a sub-Agent is about to end | ✅ exit 2 prevents ending |

### 1.7 Context Compression (2 events)

| Event | Trigger Timing | Capability |
|------|---------------|-----------|
| `PreCompact` | Before compression | stdout used as custom compression instruction; exit 2 blocks |
| `PostCompact` | After compression | Observation only |

### 1.8 Configuration & Instructions (3 events)

| Event | Trigger Timing | Capability |
|------|---------------|-----------|
| `Setup` | Initialization/maintenance | init/maintenance subtypes |
| `ConfigChange` | When config file changes | exit 2 blocks application of change |
| `InstructionsLoaded` | When CLAUDE.md is loaded | Observation only |

### 1.9 Team Collaboration (3 events)

| Event | Trigger Timing | Blockable? |
|------|---------------|------------|
| `TeammateIdle` | When a Teammate is about to go idle | ✅ exit 2 prevents |
| `TaskCreated` | When a task is created | ✅ exit 2 prevents |
| `TaskCompleted` | When a task is marked complete | ✅ exit 2 prevents |

### 1.10 MCP Interaction (2 events)

| Event | Trigger Timing | Capability |
|------|---------------|-----------|
| `Elicitation` | When MCP requests user input | Can auto-respond |
| `ElicitationResult` | After user responds | Can override response |

### 1.11 File System (4 events)

| Event | Trigger Timing | Special Capability |
|------|---------------|-------------------|
| `WorktreeCreate` | When creating a worktree | stdout = worktree path |
| `WorktreeRemove` | When removing a worktree | — |
| `CwdChanged` | When working directory changes | CLAUDE_ENV_FILE modifies environment variables |
| `FileChanged` | When a file changes | Dynamically adjust watched paths |

### Design Analysis of Event Granularity: Why 27?

The number 27 isn't the result of a single design pass; it's the product of incremental growth as features evolved. But examining the distribution reveals the designers' thinking about granularity:

**Asymmetric granularity choices**: The tool layer has 3 events (Pre/Post/PostFailure), while the session layer has only 2 (Start/End). Why no `PreSessionEnd`? Because tool calls are blockable (users may want to intercept before execution), but session endings are usually user-initiated, so blocking offers little value. This reflects a design principle: **event granularity follows blocking value, not mechanical symmetry**.

**Why are `Stop` and `StopFailure` separate?** This embodies the `fire-and-forget` pattern. `StopFailure` (stopping due to API error) doesn't support blocking because the API connection is already broken — blocking makes no sense; you can't make a failed API call "continue." This matches the design logic of `PostToolUseFailure`: failure events are notifications, not decision points.

**Configuration-driven vs. code-driven fundamental choice**: Claude Code configures hooks via `settings.json`, rather than registering them through a code API like LangChain's `handler.on_tool_start()`. This choice determines the entire system's character: (a) non-developers can configure hooks — just edit JSON; (b) complex logic must be externalized into shell scripts, lengthening the debug chain (JSON → shell → actual logic); (c) hooks cannot be dynamically registered or unregistered at runtime (LangChain Callbacks can). This is a trade-off between configurability and programmability — Claude Code chose the former, lowering the entry barrier but sacrificing flexibility.

**Serial execution model**: Multiple hooks registered on the same event execute sequentially in configuration order. If the first hook returns exit 2 (block), subsequent hooks don't run. This means **configuration order equals priority** — the first configured hook has veto power. This is a simple but limited model: if you need an "all hooks must agree to proceed" semantics, the current architecture cannot directly support it.

---

## 2. Four Execution Types

### 2.1 Command (shell command)

The most basic hook type. Spawns a child process to execute a shell command:

```json
{
  "hooks": {
    "PreToolUse": [{
      "type": "command",
      "command": "echo 'Tool about to run: $TOOL_NAME'"
    }]
  }
}
```

- Timeout: `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 600,000` (10 minutes)
- Default shell: determined by `DEFAULT_HOOK_SHELL`
- Windows support: PowerShell / Git Bash

### 2.2 Prompt (AI prompt)

Constructs an AI request:

```json
{
  "hooks": {
    "Stop": [{
      "type": "prompt",
      "prompt": "Check if the task is truly complete. If not, explain what's missing."
    }]
  }
}
```

### 2.3 Agent (multi-turn AI agent)

Creates a full multi-turn AI Agent to validate conditions:

```json
{
  "hooks": {
    "Stop": [{
      "type": "agent",
      "prompt": "Run the test suite and verify all tests pass."
    }]
  }
}
```

- Uses `dontAsk` permission mode — the precise source-code semantics are "Don't prompt for permissions, deny if not pre-approved," meaning **no popup asking, deny operations not pre-approved**. This does not mean "unconstrained by permissions": the Agent hook is still bound by the `alwaysAllowRules` whitelist, but operations that would require user interaction are downgraded from "popup ask" to "direct deny." However, the source code also adds `Read` permission for transcript files (`session: [...existingSessionRules, 'Read(/${transcriptPath})']`), meaning the Agent hook can read the full conversation history
- `MAX_AGENT_TURNS = 50` — if an Agent hook doesn't complete within 50 turns, the system aborts and returns `cancelled`, without blocking the main flow
- Returns structured output via `SyntheticOutputTool`: `{ ok: true/false, reason: string }`
- `querySource: 'hook_agent'`
- Defaults to `getSmallFastModel()` (usually Haiku), overridable via the `model` field

> **Cost Warning**: A misconfigured Agent hook (e.g., attached to the `Stop` event) can consume thousands of tokens at the end of every conversation turn. Assuming an average of 10 turns per validation at 2,000 tokens each, an hour of high-frequency interaction could generate hundreds of thousands of extra tokens. There is no cost budget or rate-limiting mechanism in the source code — this is entirely up to the user to control.

### 2.4 HTTP (remote endpoint)

```json
{
  "hooks": {
    "PostToolUse": [{
      "type": "http",
      "url": "https://my-server.com/hook",
      "method": "POST"
    }]
  }
}
```

### Design-Space Analysis of Execution Types

The existence of four types reflects an interesting design question: **where should hook logic run?**

| Type | Logic Location | Latency | Capability Ceiling | Suitable Scenarios |
|------|---------------|---------|-------------------|-------------------|
| command | Local process | Milliseconds | Anything shell can do | lint, test, notify |
| prompt | Remote API (single-turn) | Seconds | Natural language reasoning | condition check, content review |
| agent | Remote API (multi-turn) | Tens of seconds to minutes | Full Agent capabilities | complex validation, auto-fix |
| http | Remote service | Network-dependent | Determined by remote service | enterprise approval systems, log collection |

**Why are `prompt` and `agent` separate types?** Superficially, a prompt could be seen as "a 1-turn agent." But in the source code, their implementations are completely different: `execPromptHook` builds a single API request and parses JSON output; `execAgentHook` launches a full `query()` loop, creating an independent `hookAgentId`, registering a tool set, and managing multi-turn dialogue. Separating the two is a cost-capability trade-off — the prompt type calls Haiku for a single reasoning pass at negligible cost; the agent type may consume thousands of tokens. Users must choose the appropriate type based on validation complexity.

**Why no WebSocket (long-lived connection) type?** The HTTP hook is a stateless request-response model; each event trigger is an independent request. If state must be maintained (e.g., counting event occurrences), it can only be implemented on the remote server side. This limits the hook system's expressiveness for real-time monitoring scenarios, but also avoids the complexity of long-connection management (reconnection, heartbeat, etc.).

**Agent hook recursion issue**: An Agent hook uses the full tool set (filtered by `ALL_AGENT_DISALLOWED_TOOLS`), and those tool calls trigger `PreToolUse`/`PostToolUse` hooks. But an Agent hook cannot recursively trigger Agent hooks, because its tool set excludes tools that would spawn sub-Agents. This is a "limited recursion" design — hooks can trigger other hooks, but won't cause infinite recursion.

---

## 3. Exit-Code Semantics — The Dual-Track System

Exit codes are the most central design decision in the Hooks system — how does Claude know whether your script says "proceed" or "block"? The answer is a single number:

> 💡 **Plain English**: Exit codes are like traffic lights. After your hook script finishes, it returns a number telling Claude what to do: **green (0) = proceed**, **red (2) = block**, **yellow flashing (anything else) = the script had its own problem, but don't disrupt normal flow**.

| Exit Code | Meaning |
|-----------|---------|
| **0** | Success. stdout may be passed to the model (depending on event type) |
| **2** | **Block**. stderr shown to the model, operation prevented |
| **Other non-zero** | Non-blocking error. stderr shown only to the user (doesn't affect model) |

**Why exactly the number 2?** In short: a small integer that doesn't conflict with exit 1 (general error) was needed. exit 1 means "the script itself failed" (should not affect Claude behavior); exit 2 means "I intentionally block this operation." It's a pragmatic convention, not an inheritance from any Unix tradition.

> <details><summary>📚 <b>Technical Deep Dive: Exit Codes and OS IPC</b> (click to expand)</summary>
>
> The dual-track exit-code design is a real-world application of "inter-process communication (IPC)" from operating-systems courses. Unix processes obtain child exit codes via `waitpid()` — the simplest IPC mechanism, passing semantics through a single 8-bit integer (0-255). Claude Code defines three semantic zones (0/2/other) within this, analogous to HTTP status-code partitioning (2xx/4xx/5xx).
>
> An 8-bit integer cannot carry structured information, so Claude Code compensates with a combination of exit code + stdout/stderr + `hookSpecificOutput` (JSON): exit code carries "action semantics," stdout/stderr carries "content," and JSON carries "structured decisions." This is a classic pattern of building a higher-level protocol on top of a primitive IPC mechanism.
>
> On the origin of exit 2: POSIX only specifies `exit 0` (success) and `exit 1` (error); the Bash manual says exit 2 is "shell usage error"; BSD `sysexits.h` defines `EX_USAGE=64`. Git hooks only distinguish zero vs. non-zero, not 1 vs. 2. Claude Code's choice is closer to a custom protocol.
>
> </details>

Exceptions:
- `StopFailure`, `PostToolUseFailure`: fire-and-forget, output ignored
- `Notification`: notification-only, no blocking semantics

## 4. Environment Variable Injection

Every hook execution has access to a rich set of environment variables:

| Variable | Value |
|----------|-------|
| `CLAUDE_SESSION_ID` | Current session ID |
| `CLAUDE_CWD` | Current working directory |
| `TOOL_NAME` | Tool name (tool events) |
| `TOOL_INPUT` | Tool input JSON (tool events) |
| `TOOL_OUTPUT` | Tool output (`PostToolUse`) |
| `HOOK_EVENT` | Event name |
| `HOOK_SUBTYPE` | Event subtype |

## 5. Observability

Every hook execution produces three analytics events (also a core argument in Part 4's "Observability Is a Product Feature" chapter):

1. **hook_start**: execution begins
2. **hook_end**: execution ends (includes exit code, duration)
3. **hook_error**: execution fails (includes error type, message)

## 6. Design Trade-offs and Assessment

### Why 10 Minutes vs. 1.5 Seconds?

The default timeout for tool hooks is `TOOL_HOOK_EXECUTION_TIMEOUT_MS = 600,000` (10 minutes), while `SessionEnd` hooks time out at just 1,500 ms — a 400x difference. This isn't arbitrary:

- **10 minutes**: Tool hooks (especially `PreToolUse`, `Stop`) may need to run a full test suite. A large project's `npm test` can take several minutes. Ten minutes is an upper bound that "covers the vast majority of CI operations." But if a hook hangs for 9 minutes, the user experience is terrible — Claude is completely unresponsive with no progress indicator.
- **1.5 seconds**: `SessionEnd` fires when the user closes the terminal. If a long-running hook executes then, the terminal appears to "hang" and can't exit. 1,500 ms is an empirical upper bound of "delay a user will tolerate on exit," overridable via the `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` environment variable.

**Strengths**:
1. 27 events cover every critical decision point in the system
2. The exit 2 dual-track system clearly distinguishes errors from blocks
3. Agent-type hooks can use AI to validate AI output — forming a self-correction loop
4. Four execution types satisfy everything from simple scripts to complex automation
5. `PermissionRequest` hooks enable fully unattended automation

**Costs**:
1. The names and semantics of 27 events must be memorized — steep learning curve
2. Agent hooks use `dontAsk` mode — more precisely, "deny operations not pre-approved," no popup but not automatic approval for everything. Yet Agent hooks still have the full tool set (excluding sub-Agent spawning tools), and can read/write files, execute Bash commands, etc.
3. The exit 2 convention is a "magic number" — users unaware of it may accidentally block operations
4. A 10-minute timeout means a buggy hook script can freeze Claude for a long time, and there is no user-triggerable cancellation mechanism in the source code

### Capability Boundary: Hook ≠ Governance

> 💡 **Plain English**: Think of a Hook as a parcel-locker pickup notification — you can intercept or forward on that **single event**, but you can't control the logistics system's scheduling, routing, or warehouse inventory management. Hooks solve **local action constraints**; governance solves **end-to-end state consistency**.

This distinction is crucial. Hooks can intercept individual tool calls, inject single messages, and auto-answer permission popups. But they **cannot**:

1. **Observe the Agent's thinking process**: Hooks only mount on tool calls and session events. Claude's internal reasoning (thinking blocks) before calling a tool is invisible to Hooks. You can intercept `Bash("rm -rf /")`, but you can't see what reasoning led Claude to that decision. This limits Hooks for "intent audit" scenarios.
2. **Guarantee cross-session policy consistency**: Hook configurations are static files with no versioned policy-evolution mechanism. If a team's security policy needs to gradually tighten from "allow rm" to "prohibit all deletions," Hooks cannot express that progressive change.
3. **Handle distributed coordination**: In a Coordinator + Worker multi-Agent mode, each Worker executes Hooks independently. There is no mechanism for a Hook to perceive another Worker's state or global task progress.

> 🌍 **Industry Comparison**: **OpenClaw** (an open-source AI Agent framework) adopts a completely different Hooks philosophy — building an **observability extension system around the event stream**, rather than Claude Code's "permission decision system built around tool calls." Claude Code's `PreToolUse` + deny can **100% reliably** prevent dangerous operations (system-level enforced interception), whereas OpenClaw injects "reminders" into the message stream that the Agent might ignore. But OpenClaw can observe the complete message processing pipeline (including `message:preprocessed` and other intermediate steps), while Claude Code's Hooks can only intervene at specific anchor points. The two designs optimize for safety-critical scenarios and flexible observability scenarios respectively; neither is absolutely superior.

### Three Real-World Scenarios: What Hooks Can vs. Cannot Do

| Scenario | Implementation | Reliability | Notes |
|----------|---------------|-------------|-------|
| **Block `rm -rf /`** | `PreToolUse` + Command Hook detects command → exit 2 | ✅ 100% reliable | System-level enforced interception, AI cannot bypass |
| **Auto-run tests after every edit** | `PostToolUse` (filter: `FileEdit`) + `asyncRewake: true` + exit 2 wake-up | ✅ Reliable | Executes asynchronously without blocking main flow; exit code 2 wakes Agent to handle test results |
| **Inject project guidelines on startup** | `SessionStart` + Command Hook `echo "Project guidelines: ..."` | ⚠️ Requires external script | Overkill for simple scenarios — requires a separate shell script to read the guidelines file and output it |

## 7. Error Propagation and Fail-Open Strategy

A critical but easily overlooked design decision in the Hooks system is its **error propagation model**:

| Exit Code | Semantic | Impact on Main Flow |
|-----------|----------|---------------------|
| 0 | Success | Continue |
| 2 | Intentional block | Prevent operation |
| 1, 3, 4... | Hook itself errored | **Continue** (non-blocking) |
| Hook process crashes | Unexpected error | **Continue** (non-blocking) |
| Agent hook timeout | Didn't complete in 50 turns | **Continue** (returns cancelled) |

This is a **fail-open** strategy — a hook's own failure does not block the main flow. This is a deliberate trade-off between availability and security:

**Upside**: Users don't have to worry that a buggy hook script will render Claude completely unusable. If your lint hook errors because dependencies aren't installed (exit 1), Claude can still keep working.

**Downside**: If you deploy a security-audit hook (e.g., to prevent Claude from accessing `/etc/passwd`), an attacker can bypass the security check by deliberately crashing the hook (OOM, segfault) — because a crashed hook is silently ignored. There's a subtlety in the source code: `python3 <missing>.py` returns exit 2 (Python's exit code when a file isn't found), which would be misinterpreted as "intentional block," so the source code pre-checks plugin hook paths (`if (!(await pathExists(pluginRoot)))`), but user-defined command hooks lack this protection.

**Design implication**: If your hook carries security responsibilities (rather than convenience functions), implement fail-closed logic inside the hook script itself — `exit 2` under any exceptional condition — rather than relying on the system's default fail-open behavior.

---

*Quality Self-Check:*
- [x] Coverage: complete enumeration of 27 events + 4 types + exit-code semantics + error propagation model
- [x] Fidelity: event list, exit-code rules, and `dontAsk` semantics verified against source code (`src/schemas/hooks.ts`, `src/utils/hooks.ts`, `src/utils/hooks/execAgentHook.ts`, `src/entrypoints/sdk/coreSchemas.ts`)
- [x] Depth: pragmatic rationale for exit-code choice (not folklore), event granularity design principles, configuration-driven vs. code-driven trade-offs, fail-open security implications
- [x] Critical analysis: `PermissionRequest` supply-chain attack vector, Agent hook cost runaway, fail-open security risk, binary trust model limitations
- [x] Reusability: lifecycle hooks + exit-code semantic separation + error propagation strategy applicable to any extensible system
- [x] Cross-chapter consistency: the four execution type names (command/prompt/agent/http) aligned with Part 2 Q10
