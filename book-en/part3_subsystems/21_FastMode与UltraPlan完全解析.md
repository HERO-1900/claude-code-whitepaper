# Fast Mode and UltraPlan Deep Dive

Claude Code is not a static tool—it has "gears." Fast Mode (827 lines) switches the AI into a high-speed inference mode (same Opus 4.6 model, but faster output), while UltraPlan (1,557 lines) lets the AI execute large-scale exploration tasks via a remote Claude instance for up to 30 minutes. These two systems represent Claude Code's ability to "upshift" along the dimensions of performance and capability.

> **Source locations**: Fast Mode — `src/utils/fastMode.ts` (533 lines), `src/commands/fast/` (294 lines); UltraPlan — `src/commands/ultraplan.tsx` (1,028 lines), `src/utils/ultraplan/` (529 lines)

> 💡 **Plain English**: Fast Mode is like a car's Sport mode—same engine, but sharper throttle response and more aggressive shifting. UltraPlan is like delegating a task to a remote "expert team"—you place the order locally, a cloud-based Claude spends 30 minutes on deep planning, and sends the proposal back for your approval.

---

## Part 1: Fast Mode

### Industry Context

"Fast mode" is implemented differently across AI coding tools:

- **Cursor**: Tab completion uses a small model (fast but lower accuracy), chat uses a large model (slow but higher accuracy)—the two modes are **different models**
- **GitHub Copilot**: Balances speed and quality by adjusting `temperature` and `max_tokens`
- **CodeX**: No explicit fast mode, but supports different model tiers (GPT-4o vs o3)

Claude Code's Fast Mode is unique in that **it does not switch models**—it remains Opus 4.6, only the inference engine outputs faster. This avoids the trap of "fast mode = low-quality mode."

---

### 1. Architecture

```
User: /fast (toggle Fast Mode)
  │
  ▼
┌────────────────────────────────────────────┐
│ fast.tsx — CLI command UI                   │
│  · Display current status                   │
│  · Toggle switch                            │
│  · Show unavailability reasons              │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ fastMode.ts — Core state management         │
│  · isFastModeEnabled(): currently on?       │
│  · isFastModeAvailable(): available?        │
│  · getFastModeUnavailableReason(): reason   │
│  · Cooldown management                      │
│  · Organization-level control               │
│  · Overage billing check                    │
└────────────────────────────────────────────┘
```

### 2. Multi-layer Availability Check

Whether Fast Mode is available depends on multiple independent conditions—all must be met to enable it:

```
           ├─ Model supported? (Opus 4.6 only) ─── No → unavailable
           │
           ├─ Provider supported? (1P Anthropic only) ─── Bedrock/Vertex/Foundry → unavailable
           │
User toggles ─┤─ Org-level allowed? (GrowthBook flag) ─── org disabled → unavailable
           │
           ├─ Billing status OK? (no overage) ─── overage unconfirmed → unavailable
           │
           ├─ Rate-limit cooldown active? ─── cooldown not expired → temporarily unavailable
           │
           └─ Per-session confirmation? (optional flag) ─── unconfirmed → confirmation required
```

### 3. Cooldown Mechanism

When the API returns a rate limit (429), Fast Mode does not retry immediately; instead, it enters a cooldown period:

```typescript
// fastMode.ts — Cooldown management

triggerFastModeCooldown() {
  // Set cooldown expiration time (exponential backoff)
  // First: 5 minutes
  // Second: 15 minutes
  // Third: 1 hour
  // ...
  
  // Automatically fall back to normal mode during cooldown
  // Automatically restore Fast Mode after cooldown expires
}

// Event signals
onCooldownTriggered  → UI shows cooldown countdown
onCooldownExpired    → UI shows "Fast Mode restored"
```

> 💡 **Plain English**: It's like driving in Sport mode on a road with speed cameras—you can engage Sport mode, but if you get flashed for speeding (rate limit triggered), the system automatically downshifts to normal mode and makes you "wait it out" for a while (cooldown). Only after the "points" are cleared can you re-engage Sport.

### 4. Organization-level Control

Fast Mode is not purely a user-level feature—organization admins can globally control it via a GrowthBook Feature Flag:

```typescript
// GrowthBook flag: tengu_penguins_off
// true → org disables Fast Mode
// false → org allows Fast Mode

// Priority: org disabled > user wants on → unavailable
// Even if the user sets "I want Fast Mode," the org can override it
```

### 5. Overage Billing Check

```typescript
// If the user's API usage exceeds the free quota:
// 1. Check whether "Extra Usage" is enabled
// 2. If not enabled → Fast Mode unavailable
// 3. If the org rejects the overage request → permanently disable Fast Mode

handleFastModeOverageRejection() {
  // Permanently disabled (for this session)
  // User must confirm overage billing in the Anthropic console to re-enable
}
```

---

## Part 2: UltraPlan

### Industry Context

"Large-scale planning" is an emerging capability in AI tools:

- **Devin (Cognition)**: Long-duration autonomous execution, but lacks user approval checkpoints
- **GitHub Copilot Workspace**: Plan → approve → execute, but planning time is relatively short
- **SWE-Agent**: Autonomous debug loop, no separation between planning and execution
- **OpenAI o3/o4**: Long reasoning chains, but at the API layer rather than the programming tool layer

Claude Code's UltraPlan is unique in its **remote planning + local approval + teleportation**—planning happens in the cloud (leveraging greater resources of the remote Claude), but execution authority returns to the user.

---

### 6. Architecture

```
User: "Help me plan how to refactor the auth module"
  │
  ▼
┌────────────────────────────────────────────┐
│ ultraplan.tsx — Command dispatcher (1,028 lines) │
│  · Assemble system prompt + user input      │
│  · Launch remote CCR session                │
│  · 30-minute timeout                        │
└─────────────────┬──────────────────────────┘
                  │ Remote session
                  ▼
┌────────────────────────────────────────────┐
│ Cloud-based Claude (CCR = Claude Code Remote) │
│  · Explore codebase in the cloud            │
│  · Produce structured plan                  │
│  · Phases: running → needs_input → plan_ready │
└─────────────────┬──────────────────────────┘
                  │ Event stream
                  ▼
┌────────────────────────────────────────────┐
│ ccrSession.ts — Event polling + plan extraction │
│  · Background polling of remote session status │
│  · ExitPlanModeScanner: side-effect-free state machine │
│  · Extract plan produced by remote Claude   │
└─────────────────┬──────────────────────────┘
                  │ Plan text
                  ▼
┌────────────────────────────────────────────┐
│ PlanModal (browser UI)                      │
│  · Present plan to user                     │
│  · User chooses: approve / reject / modify  │
│  · "Execute in CCR" or "Teleport to local"  │
└────────────────────────────────────────────┘
```

### 7. State Machine

```
           ┌────────┐
           │running │ ← Remote Claude is exploring code and reasoning about solutions
           └───┬────┘
               │ Claude needs user input (e.g., "Do you want to keep the old interface?")
               ▼
         ┌───────────┐
         │needs_input│ ← Waiting for user reply
         └─────┬─────┘
               │ User replies, then continues
               ▼
           ┌────────┐
           │running │ ← Continue planning
           └───┬────┘
               │ Planning complete
               ▼
         ┌───────────┐
         │plan_ready │ ← Plan is ready, awaiting user approval
         └─────┬─────┘
               │
           ┌───┴───┐
           ▼       ▼
     "Execute in CCR"   "Teleport to local"
     (Remote PR)         (Local selective execution)
```

### 8. ExitPlanModeScanner — Side-Effect-Free State Machine

UltraPlan's event-stream parser is a classic pure-function design—it performs no I/O whatsoever, only receives event batches and outputs state:

```typescript
// ccrSession.ts — ExitPlanModeScanner

class ExitPlanModeScanner {
  // Input: batch of SDKMessage[]
  // Output: phase state ('running' | 'needs_input' | 'plan_ready')
  
  // Design principles:
  // 1. No I/O (no file reads, no network requests)
  // 2. Pure function (same input → same output)
  // 3. Batch processing (process a batch at a time, not one by one)
  
  ingest(messages: SDKMessage[]): void {
    // Scan messages for state-transition signals
    // Update internal phase state
  }
  
  get phase(): Phase {
    // Return current phase
  }
}
```

### 9. "Teleport" Mechanism

When remote planning completes, the user can choose to "teleport" the plan back to local:

```
Remote CCR finishes planning
  │
  ▼
User chooses "Teleport to local"
  │
  ▼
Plan text transmitted to local CLI
  │
  ▼
Local Claude Code receives the plan
  │
  ▼
User decides locally: execute / modify / discard
```

> 💡 **Plain English**: It's like hiring an external consultant to create a plan—you send project materials to the consultant (remote Claude), the consultant spends a few hours drafting the proposal (30 minutes of planning), then sends it back for your approval. You can choose to "have the consultant execute it" (execute in CCR) or "I'll do it myself" (teleport to local).

### 10. Rejection Tracking

The system tracks how often users reject plans, for product optimization purposes:

```typescript
// If a user repeatedly rejects UltraPlan output:
// → Report to analytics (anonymized)
// → Help Anthropic improve planning quality
// → Does not affect user experience (no feature restrictions)
```

---

## Design Trade-offs

### Fast Mode

| Decision | Choice | Alternative | Rationale |
|------|------|---------|------|
| Same-model acceleration | ✅ Opus 4.6 unchanged | Switch to smaller model (e.g., Sonnet) | Guarantee quality does not drop |
| Org-level control | ✅ Admin can globally disable | Pure user-level control | Cost governance requires it |
| Cooldown vs hard deny | ✅ Auto-recovery | Permanently disable after trigger | Better UX |
| 1P API only | ✅ No third-party support | Support Bedrock/Vertex | Fast Mode relies on Anthropic internal infrastructure |

### UltraPlan

| Decision | Choice | Alternative | Rationale |
|------|------|---------|------|
| Remote plan execution | ✅ CCR cloud | Local execution | Remote has more resources (memory, context) |
| User approval checkpoint | ✅ Mandatory approval | Auto-execute | 30-minute plans have high impact, need human oversight |
| 30-minute timeout | ✅ Hard limit | Unlimited | Prevent cost runaway |
| Teleport mechanism | ✅ Support back to local | Remote-only execution | User may want to execute in local environment |

---

## Critique and Reflection

### Fast Mode: Perception vs. Reality

"Same model, faster output"—users might ask, "then why not always use Fast Mode?" The answer is that Fast Mode's acceleration is achieved through different inference-engine configurations, which may sacrifice some reasoning depth in edge cases. But Anthropic has not disclosed the specific technical details, so users cannot judge the actual trade-off of Fast Mode.

### UltraPlan's "Planning Paradox"

Having an AI spend 30 minutes planning, but requiring the user to wait—this may be slower than the user spending 10 minutes on a quick plan themselves. UltraPlan's value depends on whether the planning quality is truly significantly higher than local Claude's instant planning. For simple tasks, UltraPlan may be over-engineered; for truly complex refactors, 30 minutes may not be enough.

> 🔑 **Deep insight**: Fast Mode and UltraPlan represent two expansion directions for AI tools—**speed** (doing the same thing faster) and**depth** (doing more complex things). What they have in common is the need to balance "user control" and "autonomous action." Fast Mode keeps users in control through org-level controls and cooldown mechanisms; UltraPlan keeps users in the decision loop through approval checkpoints and teleportation. As AI grows more powerful, these "keep-human-in-the-loop" design patterns will become increasingly important.
