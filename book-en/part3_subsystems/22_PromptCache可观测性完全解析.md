# Complete Analysis of Prompt Cache Observability

Every time Claude Code calls the API, it sends 15,000–34,000 tokens of system prompts. If these tokens hit Anthropic's Prompt Cache, the cost is only 1/10th; if they miss, it's 10× the expense. The Prompt Cache observability system (727 lines) acts as the "detective"—when the cache unexpectedly breaks, it pinpoints the exact line of code and parameter change that caused the invalidation, helping developers avoid unnecessary cost spikes.

> **Source code location**: `src/services/api/promptCacheBreakDetection.ts` (727 lines); related: `src/utils/tokenBudget.ts` (74 lines)

> 💡 **Plain English**: It's like supermarket loyalty points—every purchase earns you credits (cache hit = cheap). But if you swap your membership card number (the system prompt changes), all previous points become invalid. This system acts like a "points reconciliation clerk"—it tells you, "Your points expired on March 5th because you changed your phone number," so you know exactly what went wrong.

---

## Overview

This chapter is divided into two parts: Part I analyzes the Prompt Cache Break detection system (why caches invalidate and how to pinpoint the cause); Part II introduces the Token Budget parser (a small but elegant auxiliary system that lets users control token consumption in natural language).

---

> **[Chart placeholder 3.22-A]**: Cache Break detection flow — pre-request state snapshot → API call → response header check → diff generation → alert

---

## Part I: Cache Break Detection (727 lines)

### 1. Why Do Caches Invalidate?

Anthropic's Prompt Cache is based on **prefix matching**—as long as the first N tokens of a request exactly match those in the cache, it's a cache hit. But if even a single token in the prefix changes, the entire cache becomes invalid.

Possible sources of change that can cause invalidation:

| Source of Change | Frequency | Cost Impact |
|------------------|-----------|-------------|
| System prompt content changes | Rare (during code updates) | High |
| Tool description schema changes | Every time MCP tools load | High |
| Beta header changes | When feature flags toggle | Medium |
| `cache_control` position changes | After compression | Medium |
| Overage status changes | When billing status switches | Low |
| `effort` parameter changes | When user switches modes | Low |

### 2. Detection Mechanism

```typescript
// promptCacheBreakDetection.ts — core detection flow

// Step 1: Snapshot current state before every API call
type PreviousState = {
  systemPromptHash: string    // SHA256 of the system prompt
  toolSchemasHash: string     // SHA256 of all tool descriptions
  betaHeaders: string[]       // List of beta headers
  cacheControlPositions: any  // Positions of cache_control markers
  overageState: string        // Overage billing state
  effort: string              // Reasoning effort level
}

// Step 2: After API response, compare states
function trackCacheBreak(
  prevState: PreviousState,
  currentState: PreviousState,
  responseHeaders: Headers
) {
  // Check whether each field changed
  // If something changed → generate diff → log to temp directory
}
```

### 3. Tool-Level Schema Tracking

77% of cache invalidations come from tool description changes—MCP servers may return different tool lists or descriptions at different times. The system computes a hash for each tool individually:

```typescript
// Instead of concatenating all tool descriptions into one string and hashing
// it hashes each tool separately, enabling precise identification of
// "which tool changed"

const toolHashes = tools.map(tool => ({
  name: tool.name,
  hash: sha256(JSON.stringify(tool.input_schema))
}))

// During comparison:
// "BashTool hash unchanged, ReadTool hash unchanged,
//  mcp__slack__send_message hash changed!
//  → The Slack MCP server returned a different schema"
```

### 4. Diff Output

When a cache break is detected, the system generates a structured diff file:

```typescript
// Written to temp directory: /tmp/claude-cache-breaks/
// Filename: cache-break-{timestamp}.diff

function buildCacheBreakDiff(
  prev: PreviousState,
  curr: PreviousState
): string {
  // Generate unified diff format
  // Precisely annotate which fields and contents changed
  // Can be used for offline analysis and regression detection
}
```

### 5. Cache Strategy Types

```typescript
type CacheStrategy =
  | 'tool_based'        // Cache boundary based on tool descriptions
  | 'system_prompt'     // Cache boundary based on system prompt
  | 'none'              // No caching (MCP integration scenarios)
```

### 6. The "Sticky Latch" Pattern

Some state changes should not cause cache invalidation—the system uses a "Sticky Latch" pattern:

```typescript
// Overage status change: free → overage
// This change affects beta headers
// But should not trigger cache rebuild

// Sticky latch: once in overage state,
// even a brief return to free does not switch back
// Prevents state jitter from causing repeated cache invalidations
```

> 💡 **Plain English**: It's like air-conditioning temperature control—set to 25°C. You don't want the AC to turn off at 25.1°C and back on at 24.9°C (that would cycle on and off constantly, like a cache repeatedly invalidating). Instead, you set a dead band—turn off at 25.5°C and on at 24.5°C—to avoid flipping back and forth at the boundary.

---

## Part II: Token Budget Parser (74 lines)

### 7. Functionality

`parseTokenBudget` (`src/utils/tokenBudget.ts`, 74 lines) is a small but elegant parser—it lets users control AI token consumption budgets in natural language:

```typescript
// Supported formats:

// Prefix format:
"+500k tokens refactor this module for me"
→ Parsed as: budget = 500,000 tokens

// Suffix format:
"help me refactor this module, spend 2M tokens."
→ Parsed as: budget = 2,000,000 tokens

// Keyword format:
"use 100k tokens on this refactor"
→ Parsed as: budget = 100,000 tokens
```

### 8. Implementation

```typescript
// tokenBudget.ts

// Core function
parseTokenBudget(text: string): number | null {
  // Regex matches abbreviations: k=1K, m=1M, b=1B
  // Anchored to start/end of text or keyword
  // Avoids false matches inside normal sentences
}

// Helper function
findTokenBudgetPositions(text: string):
  Array<{ start: number; end: number }> {
  // Returns all match positions (for UI highlighting)
}

// Progress message
getBudgetContinuationMessage(
  pct: number,           // Percentage used
  turnTokens: number,    // Tokens consumed this turn
  budget: number         // Total budget
): string {
  // "45% of budget used (450K/1M tokens)"
}
```

> 💡 **Plain English**: It's like ordering takeout and saying "budget is 50 bucks"—the system doesn't need you to be precise down to "50,000 tokens"; saying "500k" is enough. The system also tells you mid-execution how much you've spent, like the "estimated cost" shown in a delivery driver's app.

### 9. Design Highlights

**Natural-language token budget control in just 74 lines**—this is a textbook example of "small but beautiful" design:

- Regexes are anchored to the start/end, preventing false matches in sentences like "the model processes 500k tokens per request"
- Supports three formats (prefix / suffix / keyword), covering most natural expressions
- Returns `null` (rather than a default value) to mean "user didn't specify a budget"—no assumptions made

---

## Critique and Reflection

### The "Hindsight" Problem of Cache Observability

The current system only detects and reports cache breaks **after** they have already occurred—it is a diagnostic tool, not a preventive one. The ideal design would warn *before* sending a request that could invalidate the cache. But that would require predicting the future contents of API requests, which is technically very difficult.

### The Precision Problem of Token Budget

When a user says "use 500k tokens," actual consumption may deviate due to:

- Compression operations changing context size
- Uncertain token consumption from tool calls
- Unpredictable AI response length

The system can only offer best-effort budget control, not precise budgeting.

> 🔑 **Deep Insight**: Prompt Cache observability and the Token Budget parser represent Claude Code's two approaches to managing "cost"—**diagnostic** (identifying the cause after a problem occurs) and **budgetary** (setting a spending cap in advance). In the business model of an AI coding tool, cost management is not an optional "ops feature" but a core product feature that directly affects user retention—no one wants to spend 10× the API cost without knowing why.

---

## Appendix: Three Small Runtime Subsystems

The following three subsystems do not have enough code to warrant their own chapters, but each plays a non-trivial role in Claude Code's runtime behavior. This appendix analyzes them together as a "small subsystem cluster."

---

### A. Computer Use: From Terminal to Browser (~474 lines)

> **Source code location**: `src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx` (440 lines), `src/skills/bundled/claudeInChrome.ts` (34 lines), `src/utils/claudeInChrome/setup.ts` (401 lines), `src/utils/claudeInChrome/prompt.ts` (84 lines)

> 💡 **Plain English**: Claude Code could originally only read and write code inside the terminal. Computer Use is like giving it a "remote arm"—it can reach into your Chrome browser, click buttons, fill out forms, and take screenshots to inspect pages. But before it reaches in, it must ask you: "May I touch these apps?"

#### A.1 Permission Approval UI: Two-Panel Dispatcher

The `ComputerUseApproval` component is a classic "two-panel dispatcher." Depending on the request state, it shows completely different UI panels:

```typescript
// ComputerUseApproval.tsx — entry decision
export function ComputerUseApproval({ request, onDone }) {
  // tccState exists → macOS permissions missing (Accessibility / Screen Recording)
  // tccState absent → normal app whitelist panel
  return request.tccState
    ? <ComputerUseTccPanel ... />     // Panel 1: guide user to System Settings
    : <ComputerUseAppListPanel ... /> // Panel 2: app whitelist approval
}
```

**Panel 1: TCC permission guidance (macOS only).** When missing Accessibility or Screen Recording permissions are detected, the UI directly opens the corresponding macOS System Preferences page using the `open x-apple.systempreferences:` URL scheme. This isn't "telling the user where to go"—it's directly opening that settings page for them.

**Panel 2: App whitelist approval.** This is the core interaction—listing all apps that need access, each with a checkbox. Key design points:

```typescript
// Sentinel classification warnings for high-risk apps
const SENTINEL_WARNING = {
  shell: 'equivalent to shell access',            // equivalent to shell access
  filesystem: 'can read/write any file',          // can read/write any file
  system_settings: 'can change system settings'   // can change system settings
}
```

High-risk apps (Terminal, Finder, System Settings) display prominent warning labels. `getSentinelCategory()` classifies apps by `bundleId` into danger levels—this is a UI manifestation of the **principle of least privilege**.

**Permission response triplet**: The approval result is not a simple allow/deny, but a `{ granted[], denied[], flags }` triplet. `flags` contains three granular toggles: `clipboardRead`, `clipboardWrite`, and `systemKeyCombos`.

#### A.2 Chrome Integration: Skill + MCP + Native Host

Claude Code's browser automation is implemented through a three-layer architecture:

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Skill layer | `claudeInChrome.ts` | Registers the `claude-in-chrome` Skill, injects browser operation prompts |
| Transport layer | `setup.ts` + MCP Server | Starts MCP process over stdio, manages Native Host manifest installation |
| Protocol layer | Chrome Native Messaging | Communicates with the browser extension via `com.anthropic.claude_code_browser_extension` |

The Native Host installation flow in `setup.ts` is quite clever: it creates a wrapper script in the `~/.claude/chrome/` directory (a shell script on macOS/Linux, a .bat file on Windows), because Chrome's Native Messaging manifest `path` field does not allow command-line arguments. Installation covers all Chromium-based browsers (Chrome, Edge, Brave, Arc, etc.); on Windows, registry entries are also required.

Extension detection uses a **one-way caching strategy**: it only caches positive "installed" detection results, never "not installed." The reason is that `~/.claude.json` may be shared across multiple machines—if a `false` value were cached on a remote development machine without Chrome, it would permanently poison the auto-enable logic on all other machines.

#### A.3 Industry Comparison and Critique

**Comparison with Cursor**: Cursor has no browser control capability. Claude Code bridges the browser via the MCP protocol, which is architecturally more flexible but also more fragile—Native Host installation requires writing to the filesystem and registry, creating complex failure modes.

**Critique**: More than half of the 440-line `ComputerUseApproval.tsx` is React Compiler-generated memo cache code (`$[0]`, `Symbol.for("react.memo_cache_sentinel")`, etc.); the actual business logic is less than 200 lines. This is typical bloat from compiled output—with source maps, this component would probably only be 100–120 lines in hand-written React.

---

### B. Rate Limiting: Rate-Limit State Machine and Dev/Test Simulation (~400+ lines)

> **Source code location**: `src/services/rateLimitMessages.ts` (345 lines), `src/services/rateLimitMocking.ts` (145 lines), `src/services/mockRateLimits.ts` (~400 lines), `src/commands/rate-limit-options/` (220 lines)

> 💡 **Plain English**: It's like a mobile data plan—when you run out of data at the end of the month, the system doesn't just cut you off. Instead, it pops up a menu: "Buy a top-up? Upgrade your plan? Or wait until next month?" Claude Code's rate-limiting system is the full logic behind that popup, including how to identify which rate-limit state you're in, what copy to show, and a simulator for internal engineers to test various rate-limit scenarios.

#### B.1 Rate Limit State Classification

Claude Code doesn't face a simple binary "rate-limited / not rate-limited" state, but a multi-dimensional state matrix:

| Dimension | Possible Values | Corresponding Header |
|-----------|-----------------|----------------------|
| Base status | `allowed` / `allowed_warning` / `rejected` | `anthropic-ratelimit-unified-status` |
| Overage status | `allowed` / `allowed_warning` / `rejected` | `anthropic-ratelimit-unified-overage-status` |
| Limit type | `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` | `anthropic-ratelimit-unified-representative-claim` |
| Overage disabled reason | `out_of_credits` / `org_level_disabled_until` / ... | `anthropic-ratelimit-unified-overage-disabled-reason` |

The **combination** of base status and overage status determines final behavior—a `rejected` base status doesn't necessarily mean the request is blocked; if the overage channel is `allowed`, the request can still proceed (it just starts billing).

#### B.2 Message Generation: A Carefully Designed State Machine

The core function `getRateLimitMessage()` in `rateLimitMessages.ts` is a priority-ordered decision chain:

```typescript
// rateLimitMessages.ts — decision priority
function getRateLimitMessage(limits, model): RateLimitMessage | null {
  // 1. Using overage? → only warn when approaching overage cap
  if (limits.isUsingOverage) {
    if (limits.overageStatus === 'allowed_warning') return warning(...)
    return null  // normal overage use, no message needed
  }

  // 2. Already rejected? → error message
  if (limits.status === 'rejected') return error(getLimitReachedText(...))

  // 3. Approaching limit? → warning message (but with threshold filter)
  if (limits.status === 'allowed_warning') {
    // Key: only warn when utilization exceeds 70%
    // Prevents API from sending stale allowed_warning after weekly reset
    if (limits.utilization < 0.7) return null
    return warning(getEarlyWarningText(...))
  }

  return null
}
```

The 70% threshold filter is a noteworthy defensive design: the API may still return `allowed_warning` shortly after the weekly quota resets (server-side data lag). Without the threshold filter, users would see a misleading "approaching limit" warning at 0% utilization.

**Differentiated copy for different user types**: Team/Enterprise users see "Request extra usage" (ask your admin), while Pro/Max users see "Upgrade your plan." Anthropic internal employees also see a Slack channel link and the `/reset-limits` command.

#### B.3 Options Menu: User Escapes After Rate Limiting

The `rate-limit-options` command is a **hidden internal command** (`isHidden: true`), only auto-invoked by the system when rate limiting triggers. It offers up to three options:

```typescript
// rate-limit-options.tsx — option construction logic
actionOptions = []
if (extraUsage.isEnabled()) {
  // "Switch to extra usage" or "Request extra usage" or "Add funds..."
  actionOptions.push({ label: ..., value: 'extra-usage' })
}
if (!isMax20x && !isTeamOrEnterprise && upgrade.isEnabled()) {
  actionOptions.push({ label: 'Upgrade your plan', value: 'upgrade' })
}
// Cancel option is always available
cancelOption = { label: 'Stop and wait for limit to reset', value: 'cancel' }
```

Option ordering is controlled by the GrowthBook feature flag `tengu_jade_anvil_4`—when `buyFirst=true`, the paid option appears first ("buy before waiting"); otherwise the cancel option appears first ("wait before buying"). This is a classic A/B-test-driven conversion optimization.

#### B.4 Mock Testing System: 22 Scenario Simulations

`mockRateLimits.ts` (~400 lines) implements a full rate-limit scenario simulator, defining 22 `MockScenario`s: from `normal` (no rate limiting) to `opus-limit` (Opus-specific limiting), `fast-mode-short-limit` (fast mode short-term limiting), etc. Each scenario sets a specific group of mocked HTTP header values.

`rateLimitMocking.ts` is the facade layer—it checks before every API request whether mocking is enabled, and if so, intercepts headers and injects simulated values. For `status=rejected` scenarios, it even constructs an `APIError(429, ...)` object directly, completely skipping the real API call.

> 💡 **Plain English**: It's like a flight simulator for pilot training—you don't need to actually cause an engine failure to practice emergency landing procedures. Engineers enter "simulator mode" with the `/mock-limits` command to test UI behavior under various rate-limit scenarios.

#### B.5 Critique

**Fragile prefix matching for info messages**: The `RATE_LIMIT_ERROR_PREFIXES` array uses prefix string matching to determine whether a message is a rate-limit error—"You've hit your", "You've used", etc. Any copy change could break the UI component's ability to recognize the rate-limit state. A more robust design would attach structured type tags to message objects rather than relying on content matching.

---

### C. Remote Sessions WebSocket and Env-less Bridge Implementation Details (~1400 lines)

> **Source code location**: `src/remote/SessionsWebSocket.ts` (404 lines), `src/bridge/remoteBridgeCore.ts` (1008 lines)

> 💡 **Plain English**: Chapter 12 covered the "building blueprint" of Bridge remote control—the architectural evolution from v1 environment layer to v2 direct connection. This section covers the "plumbing" inside the v2 building: how to reconnect when the WebSocket drops, how to refresh an expired JWT, and how to queue a thousand messages for sending without losing any.

> **Relationship with Chapter 12**: Chapter 12 already covered Bridge's overall architecture, v1/v2 comparison, and five-step lifecycle. This section zooms in on two implementation files not expanded in Chapter 12: `SessionsWebSocket` (the WebSocket client on the CCR Web side) and `remoteBridgeCore` (the full state management for Env-less bridging).

#### C.1 SessionsWebSocket: Tiered Reconnection Strategy

`SessionsWebSocket` is the WebSocket client used by the CCR (Claude Code Remote) web interface to subscribe to session event streams. Its reconnection strategy is divided into three tiers based on close code:

```typescript
// SessionsWebSocket.ts — reconnection decisions
const PERMANENT_CLOSE_CODES = new Set([4003])  // unauthorized → never reconnect
const MAX_SESSION_NOT_FOUND_RETRIES = 3        // 4001 → limited retries
const MAX_RECONNECT_ATTEMPTS = 5               // others → general reconnect

handleClose(closeCode) {
  // Tier 1: permanent rejection (4003 unauthorized) → give up immediately
  if (PERMANENT_CLOSE_CODES.has(closeCode)) { onClose(); return }

  // Tier 2: transient missing (4001 session not found) → progressive delayed retry
  // Server may briefly think session expired during compaction
  if (closeCode === 4001) {
    sessionNotFoundRetries++
    if (sessionNotFoundRetries > 3) { onClose(); return }
    scheduleReconnect(RECONNECT_DELAY_MS * sessionNotFoundRetries, ...)
    return
  }

  // Tier 3: general disconnect → standard reconnect (max 5 attempts)
  if (previousState === 'connected' && reconnectAttempts < 5) {
    reconnectAttempts++
    scheduleReconnect(RECONNECT_DELAY_MS, ...)
  }
}
```

The special handling for 4001 is noteworthy—the comment explicitly states this is because the server briefly considers the session expired during "compaction." This is a **business-semantics-driven reconnection strategy**, not a simple "reconnect when disconnected."

**Dual-runtime compatibility**: Inside the `connect()` method, code paths are split for Bun and Node.js runtimes—Bun uses the native `WebSocket` (via `addEventListener`), while Node.js uses the `ws` package (via `.on()`). Both paths do exactly the same thing, just with different APIs. A 30-second heartbeat interval (`PING_INTERVAL_MS`) keeps the connection alive.

#### C.2 Env-less Bridge Core: Ten-Step Lifecycle

The `initEnvLessBridgeCore()` function in `remoteBridgeCore.ts` implements the full environment-less bridge, with comments clearly marking ten steps. Chapter 12 covered the first three steps (create session → get credentials → establish transport); here we supplement the implementation details of the remaining seven steps:

**Step 4 — State Management and Message Deduplication**:

```typescript
// remoteBridgeCore.ts — two-tier UUID deduplication
const recentPostedUUIDs = new BoundedUUIDSet(2000)  // ring buffer, capacity 2000
const initialMessageUUIDs = new Set<string>()         // unbounded fallback set

// Why two tiers?
// recentPostedUUIDs is a ring buffer; old UUIDs are evicted after 2000 entries.
// If there are many initial history messages, their UUIDs may be evicted and
// then replayed by the server, causing duplicates. initialMessageUUIDs is an
// unbounded fallback defense line.
```

This "ring buffer + unbounded fallback set" two-tier deduplication is a **defense-in-depth** pattern; the comment explicitly notes it was inherited from `replBridge.ts`.

**Step 5 — JWT Refresh Scheduler Race Condition Guard**:

JWT expiration refresh and SSE 401 recovery may fire simultaneously (classic scenario: laptop lid wake). The code solves the race with an `authRecoveryInFlight` boolean latch:

```typescript
// remoteBridgeCore.ts — race condition guard
onRefresh: (sid, oauthToken) => {
  // Key: seize the flag BEFORE the /bridge request
  // because every /bridge call bumps the epoch
  // If both paths call /bridge, the first epoch becomes stale immediately → 409
  if (authRecoveryInFlight || tornDown) return
  authRecoveryInFlight = true
  // ... fetch + rebuildTransport ...
}
```

The comment's insight "each /bridge call bumps epoch" is critical: epoch is a monotonically increasing version number on the server side, incremented by +1 on every `/bridge` call. If two refresh paths call `/bridge` concurrently, the epoch obtained by the first one is already stale when the second one completes.

**Step 7 — Transport Rebuild FlushGate Mechanism**:

`rebuildTransport()` must pause all writes while rebuilding the transport layer—otherwise messages would be written to an old transport channel that is about to be closed:

```typescript
// remoteBridgeCore.ts — FlushGate queue
async function rebuildTransport(fresh, cause) {
  flushGate.start()  // Start queuing; all writeMessages enter buffer
  try {
    const seq = transport.getLastSequenceNum()  // Save sequence number
    transport.close()                           // Close old transport
    transport = await createV2ReplTransport({   // Create new transport
      initialSequenceNum: seq,                  // Resume from old sequence number
      // ...
    })
    wireTransportCallbacks()
    transport.connect()
    drainFlushGate()  // Drain buffer into new transport
  } finally {
    flushGate.drop()  // Drop queue on failure
  }
}
```

`initialSequenceNum: seq` ensures the new transport resumes from the old transport's high-water mark, so the server won't replay already-received messages.

**Step 9 — Teardown Budget Constraints**:

```typescript
// remoteBridgeCore.ts — graceful shutdown
async function teardown() {
  // 1. Send result message first (fire-and-forget)
  transport.reportState('idle')
  void transport.write(makeResultMessage(sessionId))

  // 2. Then archive session (with time budget)
  // gracefulShutdown gives cleanup functions 2 seconds total
  // archive timeout is 1500ms, leaving 500ms for other cleanup
  let status = await archiveSession(..., cfg.teardown_archive_timeout_ms)

  // 3. If archive returns 401 → try refreshing OAuth and retry once
  if (status === 401 && onAuth401) {
    await onAuth401(token ?? '')
    status = await archiveSession(...)
  }

  // 4. Finally close transport
  transport.close()
}
```

Note the "write result first, then archive" order—`transport.write()` merely enqueues (SerialBatchEventUploader buffers and sends asynchronously), so the 100–500ms network latency of `archive` naturally provides a drainage window for the uploader. If the order were reversed (close first, then write), `closed=true` would block the drain loop.

#### C.3 Industry Comparison and Critique

**Comparison with VS Code Remote Tunnels**: VS Code's remote tunnels use long connections to `dev.tunnels.api.visualstudio.com`, relying on Azure infrastructure for automatic recovery after disconnects. Claude Code's approach is lighter (pure OAuth + SSE, no extra infrastructure required), but also more fragile—edge cases like JWT expiration, epoch races, and compaction transient loss must all be handled individually in client code.

**FlushGate design trade-off**: `flushGate.drop()` discards all queued messages when rebuild fails. This means if network recovery is attempted but rebuild fails again, user actions during the "queuing window" are silently lost. The code comment openly admits this ("Queued messages are dropped (transport still dead)"), but provides no user-visible notification. One improvement would be to trigger a UI alert inside `drop()` so users know some messages may have been lost.

**1008-line closure factory**: `initEnvLessBridgeCore` is a giant closure factory function—all state (`transport`, `tornDown`, `authRecoveryInFlight`, `initialFlushDone`, etc.) lives as closure variables. This pattern is common in JavaScript, but when closure variables exceed 10, cognitive load increases sharply. In contrast, `SessionsWebSocket` uses a more traditional class pattern with clearer state management.

> 🔑 **Deep Insight**: These three subsystems represent three sources of engineering complexity in Claude Code—**Computer Use** complexity comes from inter-process communication (Terminal → MCP → Chrome Extension → Web Page), **Rate Limiting** complexity comes from combinatorial explosion of product logic (user type × limit type × overage status × billing entitlement), and **Remote Bridge** complexity comes from classic distributed systems problems (reconnection recovery, race conditions, message deduplication, ordered delivery). Together they illustrate one thing: the real engineering challenges of an AI coding tool are not in the AI itself, but in the messy boundary conditions where AI meets the real world.
