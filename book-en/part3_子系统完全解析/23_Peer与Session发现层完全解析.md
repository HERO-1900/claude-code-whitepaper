# Complete Analysis of the Peer and Session Discovery Layer

When multiple Claude Code instances run simultaneously on the same machine—one editing code, another running tests, a third connected to a remote session via Bridge—how do they **discover each other** and **communicate**? This is the problem the Peer/Session discovery layer solves.

> 🎯 **Why is this a necessary component of the Agent Workbench?** The multi-instance discovery layer is a **necessary part** of the "Agent Workbench" positioning—a single-instance chatbox would never need this. Only when you treat Claude Code as a "developer's Agent operations console" do you need to answer the question: "How do multiple Agent instances discover and collaborate with each other?" **Claude Code is the first AI coding tool to treat "multi-Agent instance discovery" as an infrastructure requirement**—Cursor, Aider, Cline, and others all follow a "single-instance, single-window" model where two windows cannot send messages to each other at all.

> **Source locations**: `src/utils/peerAddress.ts` (address protocol), `src/utils/concurrentSessions.ts` (session PID registry), `src/tools/SendMessageTool/` (cross-session messaging), `src/hooks/useInboxPoller.ts` (message receiving), `tools.ts` (ListPeersTool registration)

> **🔑 OS Analogy:** The Peer discovery layer is like a **device discovery protocol** on a local network—how does your phone find the printer on the same Wi-Fi? It relies on mDNS/Bonjour broadcasts. Claude Code's Peer discovery layer does the exact same thing: it enables multiple Claude instances on the same machine to discover and communicate with each other.

> 💡 **Plain English**: Imagine an office building with many conference rooms (each Claude instance is a room). The Peer discovery layer is the building's **conference room booking system**—it knows which rooms are in use, who is in them, and how to reach them. If you want to pass a note to the next room (send a message), you first use this system to look up their room number.

### Three Key Terms to Know First

This chapter will use several technical abbreviations repeatedly. Here is a one-sentence definition for each:

- **UDS** (Unix Domain Socket): A communication channel between processes on the **same machine** in Unix systems. Like a pneumatic tube inside an office building—much faster than going through the external post office (network socket) because it never leaves the building
- **PID** (Process ID): Process ID. Every running program gets a number from the operating system, like an employee's **ID badge**—you use it to find the program
- **socket path**: The "address" for UDS communication, typically looking like `/tmp/claude-12345.sock`. Like an internal office extension number
- **mDNS/Bonjour** (used only in the analogy): Apple's device discovery protocol, similar to "automatically broadcasting who is online on the local network"

> 💡 **Why use UDS instead of direct function calls on the same machine?** Because each Claude instance is an **independent process** (like different apps). They cannot call each other's functions directly—they must communicate through a system-level channel. UDS is the fastest inter-process communication method available on Unix systems.

---

## 1. Four-Layer Architecture Model

Peer discovery is not accomplished in one step—it is divided into four layers, each doing one thing:

```
┌─────────────────────────────────────────────────┐
│ Layer 4: Target Projection (present data to three consumers) │
│  • ListPeersTool (for the AI model)             │
│  • /peers command (for human users)             │
│  • claude ps command (for ops/operators)        │
├─────────────────────────────────────────────────┤
│ Layer 3: Target Shaping                         │
│  peerRegistry — local-first dedup + address formatting │
├─────────────────────────────────────────────────┤
│ Layer 2: Active Session Filtering               │
│  listAllLiveSessions() — check one by one who is still "alive" │
├─────────────────────────────────────────────────┤
│ Layer 1: Candidate Session Foundation           │
│  registerSession() — register PID records       │
└─────────────────────────────────────────────────┘
```

> 💡 **Plain English**: Like finding a delivery rider—Layer 1 is "the list of all registered riders" (PID registry), Layer 2 is "riders currently online" (active filtering), Layer 3 is "remove duplicates and format addresses" (shaping), and Layer 4 is "the list of available riders shown to the merchant" (projection).

---

## 2. Layer 1: Session PID Registry

When each Claude Code instance starts, it registers a **session runtime business card** locally via the `registerSession()` function (the `registerSession()` function in `concurrentSessions.ts`, which writes a PID record file at startup). The fields on this card can be semantically divided into **three groups**:

**Group 1 · Identity** (who this session "is"):

| Field | Meaning | Example |
|------|------|------|
| `pid` | Process ID (the process number assigned by the OS, like an employee ID) | `12345` |
| `sessionId` | Unique session identifier | `session_abc123...` |
| `name` | Display name of the session (human-readable) | `"Refactor auth module"` |
| `cwd` | Current working directory | `/Users/USERNAME/project` |
| `startedAt` | Start time | `2026-04-10T10:00:00Z` |

**Group 2 · Capabilities** (what this session "can do / how to contact it"):

| Field | Meaning | Example |
|------|------|------|
| `kind` | Session type | `interactive` / `bg` / `daemon` / `daemon-worker` (the `SessionKind` type in `concurrentSessions.ts` defines all four) |
| `entrypoint` | Entry mode (how the user launched this session) | `repl` / `print` / `sdk` |
| `messagingSocketPath` | UDS communication address (the address other processes use to send it messages) | `/tmp/claude-12345.sock` |
| `logPath` | Log file path | `~/.claude/logs/session_abc.jsonl` |
| `agent` | Whether it is in Agent mode | `true` / `false` |

**Group 3 · Status** (what this session "is currently doing", dynamically updated at runtime):

| Field | When Written | Meaning |
|------|---------|------|
| `bridgeSessionId` | via `updateSessionBridgeId()` | The remote session address written back after a Bridge connection succeeds |
| `status` | via `updateSessionActivity()` | `busy` / `idle` / `waiting` (busy / idle / waiting for user) |
| `waitingFor` | via `updateSessionActivity()` | Reason for waiting: `approve tool` (waiting for tool approval) / `worker request` (waiting for subtask) / `sandbox request` (waiting for sandbox approval) / `dialog open` (waiting for dialog) / `input needed` (waiting for user input) |
| `updatedAt` | on every activity | Last activity timestamp |

> 💡 **Why divide into three groups?** Identity fields are "information filled out once at check-in" (fixed at startup). Capability fields are "properties of the business card itself" (process-level capabilities). Status fields are "dynamically updated real-time status" (can change every minute). The **write frequency** and **consumers** of the three groups are completely different—identity is only written at registration, capabilities do not change during the process lifetime, and status is updated frequently. Separating them helps us understand "who is looking at this business card and what they want to see."

> 💡 **Plain English**: This is like a company's employee presence system—everyone registers at login (pid + desk number + department), and constantly updates their status while working (busy / idle / waiting for approval), unregistering when they leave.

---

## 3. Layer 2: Active Session Filtering

**But registration alone is not enough.** The PID registry described in §2 is just a list of "sessions that have ever registered"—after a process registers, it may have crashed, been killed, or exited normally, but its entry in the registry remains. These entries that "still have a name but are no longer present" are **zombie sessions**—if you send messages to them based on the registry, the messages will never be delivered. So Layer 1 alone is insufficient; we need an additional **liveness filter** to eliminate zombies.

Not all records in the PID registry are active—a process may have crashed, leaving a zombie entry in the registry.

`listAllLiveSessions()` (`conversationRecovery.ts:494`) filters through transport-level UDS enumeration: only sessions whose UDS socket is still reachable are considered active. If UDS is unavailable, it falls back to "treat all sessions as continuable" (source comment: "UDS unavailable — treat all sessions as continuable").

**The `--continue` live truth priority mechanism**:

`conversationRecovery.ts:487-506` implements a key design decision—when a user employs `--continue` to resume a session:

1. First call `listAllLiveSessions()` to get the list of sessions still running
2. Put live non-interactive sessions (`bg` / `daemon`) into a `skip` set
3. From the remaining ended session logs, find the most recent continuable session sorted by time

**Notably**, the fields consumed by this filtering process are extremely sparse—the live-session filter only looks at `kind` and `sessionId`, not consuming richer fields like `cwd`, `name`, `bridgeSessionId`, or `status`. This shows that the recovery path is deliberately designed to operate with the **minimum set of fields**, reducing dependency on registry completeness.

**Runtime liveness is the first layer of filtering; transcript recency is only the second layer of sorting.** The system trusts **live truth** first ("this session is still alive, do not take it over"), and trusts transcript second ("among ended sessions, the most recent one is most likely the one you want to continue").

> 💡 **What is live truth?** It is not a formal term; it is this book's shorthand for "the authoritative fact of which sessions are currently alive, obtained by directly querying the UDS transport." By contrast, a transcript (conversation log) can only tell you "when a session last wrote a log"—it does not necessarily mean it is still alive. Live truth priority means "trust the living person you can see in front of you first, then trust the archives."

> 💡 **Plain English**: Like returning to the office to find someone—first check who is still at their desk (live truth), and for those not present, flip through recent work records (transcript) to guess who left last. You won't disturb a colleague who is still busy at their desk; instead, you take over the work left by someone who has already left.

---

## 4. Layer 3: Target Shaping (peerRegistry)

> **⚠️ Note on evidence sources**: The `peerRegistry.ts` file is missing from the current source snapshot (see the checkout-level gap list in the Prologue "Research Boundary Statement"). However, we can infer its responsibilities from the call sites because:
> 1. Comments in `peerAddress.ts` explicitly mention it ("kept separate from peerRegistry.ts")
> 2. `replBridge.ts` references its functions in multiple places
> 3. The consumer-side calling posture (how SendMessageTool shapes addresses) is fully present
>
> Through these three lines of evidence (the "three-line convergence method for symbol-level gaps" described in the Prologue and Part 5 Cost chapter), we can determine that peerRegistry assumes the following responsibilities:

1. **Local-first dedup**: The same session may have both a UDS address and a Bridge address. The registry preferentially keeps the local (UDS) entry and drops the bridge duplicate—because local communication is faster and more reliable (`replBridgeHandle.ts` comment: "local is preferred")

2. **Address formatting**: Shaping raw data from the registry into address literals directly usable for SendMessage

> 💡 **What is dedup?** Short for "deduplication," meaning "removing duplicates." Like merging contacts on your phone—if the same friend has two numbers and is recognized as two entries, they are merged so only one is kept.

---

## 5. Layer 4: Three Surfaces

The same session registry data is projected into **three completely different surfaces**:

| Surface | For whom | What is exposed | What is hidden | Source |
|------|--------|---------|---------|------|
| `claude ps` | Human **ops/operators** (who want to know what is running on the machine) | pid, status (busy/idle/waiting), waitingFor, task-summary | Message address | `REPL.tsx:updateSessionActivity()` |
| `/peers` command | Human **developers** (who want to know which sessions are reachable) | Session list, transport type, dedup state | Model-consumable format | `commands.ts` (feature gate `UDS_INBOX`) |
| `ListPeersTool` | **AI model** (another Claude instance, looking up addresses to send messages) | **Only sendable addresses** (`uds:/path` or `bridge:session_xxx`) + name | **Busy state is deliberately not exposed** | `tools.ts` (feature gate `UDS_INBOX`) |

**Why does ListPeersTool deliberately not expose busy/idle status?**

`SendMessageTool/prompt.ts:20` explicitly states: "no 'busy' state; messages enqueue and drain at the receiver's next tool round."

> 💡 **What is this English sentence saying?** `enqueue` = putting a message into a queue; `drain` = taking messages out of the queue to process them; `receiver's next tool round` = the next time the receiver enters its tool-processing loop. **Full meaning**: Messages wait in line, and are fetched and processed together when the receiver next runs its tool loop.

So cross-session messages follow a **mailbox-pull** semantics: messages sit quietly in the queue until the receiver has time to pull them. Note that this is not exactly email—**email is store-and-forward** (server pushes / client pulls on a schedule), **while Claude Code cross-session messages must wait for the receiver's tool loop to naturally iterate** (could be seconds, or the receiver could be stuck waiting in Bash for minutes).

That is, the sender **knows** the receiver "will get to it eventually," but **does not know when**—this is why ListPeersTool deliberately does not expose busy state: giving you that state would be useless anyway, because messages are inherently asynchronous.

> 💡 **Plain English**: The three surfaces are like three views of the same building—`claude ps` is the security monitor room (seeing who is where and how busy), `/peers` is the front desk directory (seeing who is in and how to contact them), and `ListPeersTool` is the courier's address list (only addresses, regardless of whether anyone is home—just leave the package at the door).

---

## 6. Three Projections of Session Activity

> **⚠️ First, let me clarify a common point of confusion**: §5 discussed the **peer discovery layer's** three projections (answering "**who can be sent messages**"), consumed by claude ps / /peers / ListPeersTool. This section discusses the **three projections of session activity status** (answering "**who is busy doing what**"), consumed by claude ps / CCR worker state / Bridge UI. Both happen to be "three sets," but they **answer different questions**—the former is WHERE (addressing), the latter is WHAT (activity).

Session activity status does not have just one representation—it is projected into three completely independent surfaces:

1. **claude ps projection** (local concurrency observation surface): `REPL.tsx` pushes `sessionStatus` (busy/idle/waiting) and `waitingFor` to the PID file via `updateSessionActivity()`. The comment explicitly states: "Push status to PID file for claude ps".

2. **CCR worker state projection** (remote control surface): The remote CCR uses an independent state set—`running` / `requires_action` / `idle` + `pending_action` + `task_summary`. This state is synchronized through `sessionState.ts` / `ccrClient.ts`.

3. **Bridge UI projection** (console interaction surface): `tool_start` / `text` / `result` / `error` are extracted from the NDJSON event stream to directly drive the Bridge UI activity indicator.

The three projections have different consumers, different update frequencies, and different state granularities—they are not three formattings of the same data, but three independent state projection chains.

---

## 7. Address Protocol and Local-First Dedup

When one Claude instance wants to send a message to another Claude instance, **how is the recipient address written**? This is the question the address protocol answers. `peerAddress.ts` defines the cross-session communication address protocol—the core logic is "using a scheme prefix to distinguish delivery channels," just like email addresses use `user@domain.com` to distinguish the username and service provider. Detailed analysis (including an elegant namespace-hijacking defense design) is in the Bridge chapter §14 (Peer Address Routing and Compatibility Asymmetry); here we only give three core points:

Core points:
- Three schemes: `uds:` (local socket), `bridge:` (remote session), `other` (teammate name)
- Bare UDS paths (`/tmp/...`) are automatically compatible; bare bridge session ids are not (to avoid teammate name conflicts)
- `parseAddress()` is deliberately separated from `peerRegistry.ts` to prevent SendMessageTool from pulling in heavyweight dependencies at module load time

---

## 8. Secondary Usage Observation of isReplBridgeActive

> ⚠️ **This section is for source code researchers.** It discusses a technical observation rather than a user-visible feature.

`isReplBridgeActive()` was originally the sending gate for SendMessageTool—checking whether bridge message delivery capability is ready. It **is used a second time in one additional location beyond its original sending control duty**—a phenomenon worth calling out on its own, but with an honest statement of its scope:

`ToolSearchTool/prompt.ts:96-105` uses `isReplBridgeActive()` to determine whether **`SendUserFile` alone** should be immediately available (without ToolSearch mediation). The original source:

```typescript
if (
  feature('KAIROS') &&
  SEND_USER_FILE_TOOL_NAME &&
  tool.name === SEND_USER_FILE_TOOL_NAME &&
  isReplBridgeActive()
) {
  return false  // do not defer, immediately available
}
```

Note three things:
1. This branch **only applies to the single tool SendUserFile** (not "SendUserFile and other tools")
2. It is also gated by `feature('KAIROS')`—meaning it only takes effect in assistant mode
3. Combined with the missing `setReplBridgeActive()` writer pointed out in Ch12 §8—`isReplBridgeActive()` always returns false in the current snapshot, meaning this code is **dead code that does not currently execute**

> 💡 **Honest conclusion**: This is not a "general capability gate spillover" phenomenon—it is a secondary condition check for just one tool, and it is currently inactive. But this observation still has value: it reveals Anthropic's internal design intention to expand `isReplBridgeActive` from a "sending gate" to a "tool availability gate"—even if the current implementation is incomplete, the future evolutionary direction has already left its mark in the source code.

---

## 9. Symbol-Level Gap List

> ⚠️ **This section is for source code researchers.** Casual readers may skip—this section records "evidence breakpoints" under this book's research methodology, which are unnecessary for understanding system behavior but important for engineers who want to grep the source themselves for verification.

**From the observation in §8 to this global list**: §8 discussed the specific phenomenon of `isReplBridgeActive` as a "call site exists but writer is missing" case. This type of gap—where the call site references a symbol (function/class/module) but the symbol's host file is missing from the current source snapshot—is not unique to Peer layer. This section aggregates all such gaps into a list to help source researchers build a complete picture of this module's integrity.

**What is a symbol-level gap?** It refers to a call site referencing a symbol (function/class/module) whose definition host file is missing from the current source snapshot—the consumption chain is complete, but the production chain is missing. This is a **subtype** of the checkout-level source gap defined in the Prologue.

The following modules are referenced in the current source snapshot but their host files are missing:

| Missing Module | Reference Location | Inferred Function |
|---------|---------|---------|
| `peerRegistry.ts` | `peerAddress.ts` comments, `replBridge.ts` references | local-first dedup + target shaping |
| `ListPeersTool/` directory | `tools.ts` require reference | Model-visible peer address list tool |
| `commands/peers/` directory | `commands.ts` require reference | Human-visible /peers command |
| `peerSessions.js` | `SendMessageTool.ts:758` require reference | Bridge cross-session message delivery executor |

The common characteristic of these missing modules is: **the consumer side is fully present** (SendMessageTool knows how to call it, the prompt knows how to describe it, tools.ts knows how to register it), **only the execution host is missing in the current snapshot.**

### Two Parallel Sending Execution Hosts

Actual cross-session message delivery has two completely independent execution paths:

| Channel | Execution Host | Call Entry | Status |
|------|---------|---------|------|
| **Bridge** | `peerSessions.js` → `postInterClaudeMessage()` | `SendMessageTool.ts:758` (bridge branch) | Host missing |
| **UDS** | `udsClient.js` → `sendToUdsSocket()` | `SendMessageTool.ts` (uds branch) | Host missing |

The two paths share the same `parseAddress()` entry for address routing, but sending execution is completely separated—bridge goes through HTTP via remote relay, while UDS goes directly through the local socket.

### Hard Rendering Dependency of UserCrossSessionMessage

The missing `UserCrossSessionMessage` component is not merely a "rendering could be prettier" issue—it is a **hard rendering dependency with no fallback**. `UserTextMessage.tsx` directly `require("./UserCrossSessionMessage.js")` upon detecting a `<cross-session-message` tag, with no try/catch degradation and no fallback text renderer. If this require fails, the entire cross-session message rendering chain breaks.

### Attack Surface Implications of Missing Hosts

Missing hosts are not just "incomplete source research"—they expose a local multi-instance attack surface worth discussing:

**If the `peerSessions.js` implementation does not perform signature validation on the `from` field**, other local processes (even ordinary malicious scripts that are not Claude Code) can directly construct cross-session messages with `from=session_xxx` and send them to the current Claude instance via UDS. Combined with the no-fallback hard rendering dependency of `UserCrossSessionMessage` (once the tag is recognized, it enters the rendering pipeline), this could constitute a **"local process → Claude model context injection"** path.

The TOCTOU defense in `SendMessageTool.ts:744-750` ("without this, from='unknown' ships", see Bridge §14 for details) shows that the source authors **are already aware that envelope integrity is a sensitive security boundary**—but that defense only checks on the SendMessageTool side. If the peerSessions receiver does not perform corresponding sender validation, this attack path remains open.

This is a typical gap where the **consumer side is complete + execution side is missing** exposing an analysis entry point: **in real-world deployments, local multi-instance communication must assume "every incoming message may come from an untrusted process"**, and envelope signature validation must be performed on the receiving side. This book cannot directly verify from the current snapshot whether the peerSessions receiver implements this validation—this is an independent audit item to be verified in production deployments.

---

## Industry Comparison: Why Don't Other Tools Have This Layer?

The Peer/Session discovery layer is unique to Claude Code among AI coding tools—not because other products didn't think of it, but because **they simply don't have this problem**:

| Product | Multi-Instance Model | Why They Don't Need a Peer Discovery Layer |
|------|----------|----------------------|
| **Cursor** | Single instance, single window ("one Cursor opens one Composer") | Open two Cursor windows simultaneously, and they **cannot send messages to each other**—each window is an independent world |
| **Cline** / Claude Dev | Single-instance VS Code extension | Only one Agent runs per VS Code process; there is no scenario where "multiple instances need to discover each other" |
| **Aider** | Single-instance CLI | Open Aider in two terminals, and they are completely unaware of each other |
| **GitHub Copilot** | Single-instance editor integration | All communication goes through GitHub servers; there is no peer concept between local multi-windows |
| **Kimi Code** | Multiple subagents but same process | 100 concurrent subagents run in the **same main process**, communicating via function calls with no need for cross-process discovery |

**Claude Code's unique position**: It is **currently the only AI coding tool that assumes "multiple independent AI Agent instances may run on the same machine"** and builds infrastructure for it. This assumption stems from its **Agent Workbench positioning**—if you treat CC as a "developer's Agent operations console" (rather than a "chatbox" or "IDE plugin"), then "I might run 5 Agents doing different things on this computer at the same time" becomes a natural requirement.

So Ch23 is actually answering a question that **no one else has asked**: when AI programming upgrades from a "single-instance tool" to a "multi-instance workbench," how do instances address and communicate with each other? The Peer/Session discovery layer is an early layout for this future problem.

---

## Critical Analysis

### Strengths

1. **Four-layer separation** allows each layer to evolve independently—for example, adding a new transport (beyond UDS/bridge) only requires registration in Layer 1 + filtering in Layer 2, with Layers 3 and 4 unchanged
2. The design choice to **deliberately not expose busy state** demonstrates a deep understanding of asynchronous communication—cross-session messages do not need synchronous state
3. **Local-first dedup** optimizes the most common scenario—same-machine communication via UDS is faster than bridge remote round-trip
4. **The three surfaces each have their own focus**; there is no "universal view"—this is the engineering embodiment of the information hiding principle

### Costs

1. **The missing `peerRegistry.ts`** means we cannot verify the specific dedup algorithm implementation—this is the largest uncertainty in the current analysis
2. **The session PID registry is file-system based** (rather than shared memory)—this is the classic Unix choice for multi-process communication (the file system is the most reliable "shared state" medium between processes), but it means registry updates and reads must go through file I/O. Under reasonable usage (dozens of concurrent instances) this is not a bottleneck, but if Claude Code ever needs to support massive multi-instancing (e.g., thousands of concurrent agents), it may need to evaluate migration to shared memory
3. **ListPeersTool addresses are only valid for the current connection lifecycle**—bridge session ids rotate after reconnection (see Bridge chapter §12), so a model holding an old address will experience send failures
4. **The compatibility asymmetry between UDS and bridge** adds cognitive burden—developers need to know "why bare socket paths work but bare session ids do not"

---

### What to Read Next?

This chapter explained "how multiple Claude instances on the same machine discover each other"—this is the **local multi-instance infrastructure** of the Agent Workbench. But what if the **observer and the observed are not on the same machine**? For example, you are watching a remotely running Agent on claude.ai—this scenario's discovery layer is a different design, answered in the next chapter **Part3 Ch24 assistant = viewer**: How can a remote Claude be locally attached and observed? What is the essence of Claude assistant mode?

---

> **Cross-references**:
> - Bridge dual-track state → Part3 Ch12 §8
> - Bridge address routing → Part3 Ch12 §14
> - Swarm teammate communication → Part2 Q14 (How do multiple Claude instances collaborate?)
> - UDS inbox wakeup mechanism → Part3 Remote Agent Management §"Design Panorama"
