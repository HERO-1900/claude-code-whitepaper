# assistant = viewer: Local Observation Mode for a Remote Session

When you type `claude assistant` in the terminal, your intuition might tell you: "This probably launches a more powerful Claude Agent mode, right?" No. It does something completely different from what you'd expect—**it does not start a new local Agent; instead, it attaches to a remote session**, acting as an observer for viewing and light interaction.

> 💡 **What does "remote session" mean?** It specifically refers to **an Agent session already running on a remote CCR (Claude Code Runtime)**—perhaps a task you previously initiated from the claude.ai web interface, a long-running task started on another device, or a background job delegated to Anthropic infrastructure. In short, it is not on your current machine.

> **Source locations**: `src/main.tsx` (command parsing), `src/hooks/useAssistantHistory.ts` (history page consumption), `src/hooks/useRemoteSession.ts` (live incremental consumption), `src/hooks/useReplBridge.tsx` (bridge lifecycle)

> **🔑 OS analogy:** `claude assistant` is like `ssh -t user@server tmux attach`—you aren't starting a new shell, but attaching to an already running tmux session. What you see is the remote screen, and your input is forwarded to the remote side.

> 🌍 **Industry positioning**: Claude Code is the **first product to natively integrate the tmux attach workflow into AI Agent operations**. Cursor's Background Agents follow a "dispatch mode" (send-and-forget), Aider is purely local, and Copilot Workspace has remote sandboxes but no local viewer attach. The ability to "attach to a running remote Agent and observe or lightly interact with it in real time while it's still running" is a design unique to `claude assistant`.

> 💡 **Plain English**: Imagine you're watching a projector in your living room—the projector (the remote CCR session) is doing the work, and you're sitting on the couch viewing it (viewer). You can press pause or fast-forward on the remote (light interaction), but you're not the director or the cinematographer—the movie itself is running remotely.

---

## 1. Command Entry: From argv to viewerOnly

`main.tsx` parses `assistant` as a subcommand. Once parsed, the system constructs a special configuration:

```
RemoteSessionConfig {
  viewerOnly: true,
  sessionId: <remote session ID>,
  ...
}
```

It then enters `launchRepl()`—the **same entry point** used by the ordinary REPL, but `viewerOnly: true` alters the behavior semantics of the entire runtime.

---

## 2. KAIROS: The Feature Gate for Assistant Mode

`KAIROS` is Claude Code's internal codename for assistant mode—**it appears 190 times across 61 files** (data source: total case-sensitive matches from `grep -r "KAIROS" | wc -l` in the `source/src/` directory, and the number of involved files from `grep -rl "KAIROS" | wc -l`; the core logic resides at `useReplBridge.tsx:155-170`). It is not an occasional local mention, but a **top-level feature flag woven throughout the codebase**.

When `feature('KAIROS')` is enabled and `isAssistantMode()` is true:
- The bridge enters **perpetual mode** (`perpetual = true`)
- `worker_type` becomes `claude_code_assistant`
- Daily memory mode switches to KAIROS logging mode (see Memory System §6.2)

**Meaning of perpetual**: An ordinary bridge performs a full teardown after a task completes (sending result, stopWork, closing transport). A perpetual bridge **does not do this**—it only stops polling, clears the flush gate, and refreshes the pointer, but keeps the transport connection open. This allows the assistant-mode bridge to **persist across multiple queries**, enabling true "long-running observation."

> 💡 **Quick terminology guide** (this section packs 5 technical terms, explained one by one):
> - **teardown**: takedown / cleanup—after a task ends, all temporarily established things are dismantled (like tearing down the stage after a concert)
> - **send result**: reporting the final result of this task to the remote side
> - **stopWork**: notifying the remote side "no more work here, you can release resources"
> - **transport**: the underlying connection (WebSocket / HTTP channel), analogous to a "phone line"
> - **flush gate**: refresh gate—a buffer staging unsent events; clearing it means "all pending events must be sent or dropped"
> - **pointer**: the bridge-pointer.json file (see Ch12 §9), a "bookmark" used for crash recovery
>
> A normal bridge ends with a full routine of "closing the door, settling the bill, tearing down the stage, and showing guests out"; a perpetual bridge is "pausing business but leaving the door unlocked and the furniture intact"—ready for direct reuse when the next query arrives.

---

## 3. Three Host Chains

In the current source code, there are three distinct host chains for observing/operating a remote session:

| Host chain | Entry type | viewerOnly | Lifecycle | Purpose |
|------------|------------|------------|-----------|---------|
| `claude assistant` | User command | ✅ yes | perpetual (persists across queries) | Long-running observation + light interaction |
| `/remote-control` | User command | ❌ no (full control endpoint) | per-query (each query is independent) | Control local CLI from the web |
| `runBridgeHeadless()` | Code function entry | ❌ no | headless (no UI, unattended) | CI/CD and other automation scenarios |

All three chains share the same bridge infrastructure (`replBridge.ts`), but differ along the following dimensions:

- **viewer permissions**: assistant mode disables interrupt/watchdog/title ownership; remote-control retains full control
- **Data source**: assistant uses `useAssistantHistory()` + `useRemoteSession()` **dual data sources** (history page + live increments); remote-control uses only the real-time stream
- **Lifecycle**: assistant is perpetual (persists across queries); remote-control follows the bridge session

---

## 4. The Exact Semantics of viewerOnly

`viewerOnly` is not "read-only"—it is a **role redefinition**.

### What is disabled
- **interrupt**: cannot interrupt a tool currently executing on the remote side
- **watchdog**: not responsible for monitoring remote health
- **title ownership**: cannot change the remote session's title/name

### What is retained
- **Messaging**: can still send messages and requests to the remote side
- **Permission handling**: permission prompts from the remote side propagate to the viewer for user confirmation
- **tool_result rendering**: via `convertToolResults: true`, remote tool execution results are converted into locally renderable messages (see the Brief/Viewer Channels chapter)
- **Feedback actions**: thumbs up / thumbs down and other light interactions

### Dual Data Sources

viewerOnly mode relies on two separate data streams:
1. **`useAssistantHistory()`**: fetches the remote session's historical messages (like scrolling through chat history)
2. **`useRemoteSession()``: receives live incremental events (like real-time chat push notifications)

The two must be coordinated—the history page provides context, while live increments provide real-time updates. If you only have history without increments, you see a "recording"; if you only have increments without history, you see a "livestream that started in the middle."

> 💡 **Why must both exist?** Because `claude assistant` may attach at any moment—you might connect 30 minutes after the remote session has already been running. If you only subscribe to live increments, you'll miss everything that happened before you attached (completely blank context, like starting a TV series at episode 8 without knowing what happened in the first 7). If you only fetch history without subscribing to increments, you see a snapshot at the moment of attachment (like opening a still photograph, unable to see what happens next on the remote side). Only by combining both can you "see what happened in the past and what is happening now"—just like git: you can't only look at today's commit without the history, nor only at the history without new commits.

> 💡 **Plain English**: viewerOnly is like an audience member in a theater—you can't walk on stage (interrupt), can't rewrite the script (watchdog/title), but you can applaud (feedback), raise your hand to ask a question (send a message), and when an actor needs audience confirmation, they'll turn to you (permission propagation).

---

## 5. How perpetual Affects Bridge Infrastructure

§4 covered the semantics of viewerOnly at the **user experience layer** (what is disabled, what is retained). But the viewerOnly + perpetual combination also **reaches downward to affect how the underlying bridge infrastructure** behaves—this section covers how the bridge itself differs in perpetual mode.

Differences between perpetual and non-perpetual bridge modes:

| Dimension | Ordinary bridge | perpetual bridge (KAIROS) |
|-----------|-----------------|---------------------------|
| During teardown | send result → stopWork → close transport | no result → no stopWork → **do not close transport** |
| Pointer handling | clean shutdown clears pointer | after teardown, **refresh** pointer (keep it) |
| v2 compatibility | supports env-less bridge (v2) | **not supported** (mutually exclusive at `initReplBridge.ts:410`) |
| Reconnect strategy | fresh session (create new session) | reconnect-in-place (attempt to resume the same session) |

**Why doesn't perpetual support v2?** In the current code, `if (isEnvLessBridgeEnabled() && !perpetual)` explicitly excludes perpetual from v2. The source comment (`initReplBridge.ts:407-410`) gives the direct explanation: "perpetual (assistant-mode session continuity via bridge-pointer.json) is env-coupled and **not yet implemented here** — fall back to env-based when set so KAIROS users don't silently lose cross-restart continuity."

So this is **not** an architectural semantic conflict, but **implementation lag**—perpetual mode relies on the env-coupled bridge pointer mechanism, and the v2 env-less path hasn't yet migrated this over. The source author explicitly marked a TODO intent: better to have KAIROS users fall back to the old path than to silently lose cross-restart continuity. This is a classic engineering trade-off favoring backward compatibility over aggressive simplification.

---

## 6. How Assistant Mode Reaches Backward into the Memory System

Why would assistant mode affect the memory system?

> 💡 **First, what is autoDream?** autoDream is the **automatic background tidying feature** of the Claude Code memory system, like "organizing your notes from the week on the weekend"—by default, the system periodically auto-consolidates scattered session notes into topical files (see the Memory System Deep Dive §6.2).

Because the semantics of "long-running observation" naturally conflict with "background auto-tidying" in terms of trigger timing—autoDream assumes a session has a clear endpoint (using that as the opportunity to tidy), whereas under perpetual mode the session never ends (you just keep watching). So Claude Code's design choice is:

When KAIROS mode is active, the memory system's behavior changes:
- **`autoDream` consolidation is completely disabled**. autoDream was originally designed to "periodically consolidate scattered session notes into topical files in the background," but under KAIROS mode the session doesn't end, so consolidation timing conflicts with real-time updates
- **Memory writes switch to append-only log mode** ("append-only log" mode).
  > 💡 **What is append-only?** A classic database/logging system pattern—**only append, never modify existing records**. The opposite is "update-in-place." Analogy: a running journal vs. a polished summary. In KAIROS mode, each day you simply append what you saw, with no secondary processing
- **Topic-based categorization** is replaced by append-only. Auto Memory normally stores memories in topic-based files (e.g., "refactoring auth module," "database migration" each get their own topic file); under KAIROS mode this changes to date-based log appending
- The manual `/dream` skill remains available (users can manually trigger an offline consolidation when needed, equivalent to "organizing the running journal once on the weekend")

See Memory System Deep Dive §6.2.

---

## Critical Analysis

### Strengths

1. **Shared infrastructure**: the assistant, remote-control, and headless chains all reuse the same bridge infrastructure, avoiding the maintenance burden of three independent implementations
2. **Role redefinition rather than a feature toggle**: viewerOnly is not simply `readonly: true`, but finely delineates the boundary between "controller behavior" and "observer behavior"
3. **perpetual mode** allows the assistant to persist across queries, truly enabling "long-running observation"—something the ordinary bridge's per-query lifecycle cannot achieve

### Costs

1. **The perpetual/v2 mutual exclusion** is a known tech debt—when v2 becomes the primary channel, assistant mode will need to be adapted
2. **Dual data sources** (history + live) increase state synchronization complexity—the two streams may overlap and require deduplication
3. **The KAIROS codename** is extremely dense in the source code (190 occurrences, 61 files). While this signals it's a top-level feature flag, it also adds noise when grepping—it simultaneously serves as launch-mode gating, memory-mode gating, perpetual trigger condition, and more, with boundaries that aren't perfectly crisp

---

### What to Read Next?

This chapter explained "`claude assistant` lets you observe a remote session like watching a projector"—**this is a special usage pattern of the Bridge subsystem**. But when the web side actually needs to send data to the local machine (files, messages, tool results), what format does that data use, and which channel does it travel through? That's the topic of the next chapter, **Part3 Ch25 The Brief Communication Family and Viewer Structured Channels**. If Ch12 was about "how the pipeline is built" and this chapter was about "how to attach to a remote session," then Ch25 is about "what format of cargo travels through the pipeline."

---

> **Cross-references**:
> - Bridge dual-track state → Part3 Ch12 §8
> - Perpetual Bridge → Part3 Ch12 §10
> - KAIROS memory mode → Part3 Memory System §6.2
> - tool_use_result rendering → Part3 Ch25 (Brief/Viewer channels)
