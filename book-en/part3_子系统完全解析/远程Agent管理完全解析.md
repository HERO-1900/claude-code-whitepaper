# A Complete Analysis of Remote Agent Management

> **Source version**: Claude Code 2.1.88 (source-level analysis of the community-released code)
> **Core file**: `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` (855 lines)
> **Supporting modules**: `src/utils/teleport.tsx`, `src/utils/teleport/api.ts`, `src/utils/ultraplan/ccrSession.ts`

---

## 💡 Plain English

> Imagine you're running a **chain of takeout restaurants**. You (the local CLI) sit in the dispatch center at headquarters, while the chefs (remote Agents) are spread across different cloud kitchens cooking dishes.
>
> - **Placing an order (creating a session)**: You package the recipe (code repository) and customer requirements (user prompt) and send them to a cloud kitchen. Once the kitchen receives them, it starts prep. There are two ways to deliver the recipe: either tell the kitchen to fetch it directly from the GitHub repository itself (Git Clone mode), or personally pack up all the ingredients and courier them over (Git Bundle mode).
> - **Checking progress (polling and monitoring)**: You call the kitchen once every second and ask, "How far along is the dish?" That's the 1-second HTTP polling loop. The kitchen tells you how many dishes it's completed (TodoList updates), and whether it's still busy or already idle (session status).
> - **Handling results (notification and completion)**: When the dish is ready, the kitchen pushes a completion notice into your pending queue. If the kitchen still hasn't served the dish after 30 minutes (timeout), you mark the order as failed and notify the customer.
> - **Recovering after a disconnect (`--resume`)**: You went home after work (the terminal closed), and when you come back the next day you discover the kitchen is still cooking. You open yesterday's order ledger (sidecar metadata), call each kitchen one by one to confirm which ones are still working, and then resume monitoring them.
> - **Ultraplan (advanced approval workflow)**: It's like a Michelin chef writing out a full menu for your approval before cooking the main course. You can view that menu in the browser, edit it, approve it, or send it back. The chef will not start cooking until you click "Approve."

### 🌍 Industry Background

Remote/cloud Agent execution is an emerging trend in AI coding tools, and it became a major competitive focus starting in 2025:

- **Devin (Cognition)**: The earliest fully autonomous cloud coding Agent, running a complete development environment in cloud containers and supporting hour-scale unsupervised execution. Users interact through a Web UI, with no local CLI integration. Devin is positioned as fully autonomous, while Claude Code's remote mode puts more emphasis on local-cloud collaboration.
- **GitHub Copilot Coding Agent**: Released in 2025, it executes coding tasks in the cloud through GitHub Actions. Users trigger it with `@copilot` inside an Issue, and the Agent creates a PR for review. Like Claude Code, it uses Git to transfer code, but it has no real-time polling. Users simply wait for the PR to finish.
- **Cursor Background Agent**: A cloud execution capability launched in 2025 that can run long-lived tasks in the background. Its architecture is similar to Claude Code's (local CLI + cloud container), but Cursor relies on VS Code's Remote Development protocol, while Claude Code uses a self-built HTTP polling + Git Bundle approach.
- **CodeX (OpenAI)**: `v0.118.0` supports parallel Agent workflows and email-based communication, but it is mainly designed for local execution environments and does not support Claude Code-level cloud remote Agents. **OpenClaw (formerly Clawdbot)** represents a different remote execution paradigm: it uses WhatsApp/Telegram as the entry point, supports waking devices across regions and remote execution, and does not require a dedicated terminal.
- **Aider**: Purely local execution, with no remote Agent capability.

Claude Code's remote Agent solution is comparatively mature in two areas: the "code transfer" stage (GitHub Clone + three-level Git Bundle fallback) and the "disconnect recovery" stage (sidecar metadata + `--resume`). The HTTP polling approach has higher latency than WebSocket, but offers clear advantages in fault tolerance.

---

## Design Panorama: A Three-Layer Control Foundation

Before diving into the technical details, it's important to establish a global mental model: teleport, UDS inbox, ultraplan, and remote review may look like separate features, but they actually share **the same three-layer control foundation**:

| Layer | Responsibility | Key Components |
|------|------|---------|
| **Transport and Recovery Layer** | Send work out, and bring it back after a crash | `teleport.tsx` (Git Bundle packaging + remote session creation), `bridgePointer.ts` (pointer recovery) |
| **Scheduling and Business Layer** | Implement concrete workflows on top of the transport layer | `ultraplan` (remote planning + approval), `remote review` (bughunter code review), `autofix-pr` (automatic PR repair) |
| **Presentation and Hosting Layer** | Turn remote output into locally observable and operable objects | `RemoteAgentTask` (task registration + state persistence + UI display), XML tag protocol (output parsing), footer pill + Shift+Down dialog |

These are not three isolated subsystems, but rather **three facets of the same foundation**. Once you understand that, every technical detail that follows is just an expansion of those three layers.

### Cross-Subsystem Protocol Dictionary: constants/xml.ts

One often-overlooked but critically important file is `src/constants/xml.ts` (87 lines). It defines the **entire XML tag protocol** used for cross-subsystem communication:

| Tag | Purpose | Producer → Consumer |
|------|------|----------------|
| `ULTRAPLAN_TAG` | ultraplan remote plan result | CCR session → RemoteAgentTask |
| `REMOTE_REVIEW_TAG` | bughunter review result | CCR session → RemoteAgentTask |
| `TASK_NOTIFICATION_TAG` | task status notification | remote → local UI |
| `CROSS_SESSION_MESSAGE_TAG` | cross-session message | SendMessageTool → UDS inbox |
| `TEAMMATE_MESSAGE_TAG` | Swarm teammate message | teammate → inbox poller |
| `FORK_BOILERPLATE_TAG` | forked sub-Agent boilerplate | AgentTool → forked agent |

These string constants are the **only contract** for cross-subsystem communication. Changing a single tag will break remote output extraction, local task state, and UI presentation all at once. Centralizing them in one file reflects the design philosophy of "**protocol as code**."

### UDS Inbox Local Wake-Up Mechanism

UDS (Unix Domain Socket) inbox is the foundation that injects external messages into the local main loop. The call chain is:

```
setup.ts starts udsMessaging
  → systemInit.ts injects socket path (via system/init message)
  → external CLI (such as another Claude instance) sends a message to the socket
  → cli/print.ts enqueues the message → triggers run()
  → useInboxPoller.ts parses CROSS_SESSION_MESSAGE_TAG and TEAMMATE_MESSAGE_TAG
```

> 💡 **Plain English**: The UDS inbox is like the company's internal mail system. Coworkers (other Claude instances) drop messages into your inbox (the socket), and you process them when idle. teleport is responsible for sending work out (outbound), while the UDS inbox is responsible for receiving results and waking the local side back up (inbound). Together they form the send-and-receive loop of remote collaboration.

---

## 1. Architectural Overview

### 1.1 System Topology

```
┌──────────────────────────────────────┐        ┌─────────────────────────────┐
│         Local CLI (Claude Code)      │        │    Anthropic Cloud (CCR)     │
│                                      │        │                             │
│  RemoteAgentTask                     │        │  Session Container          │
│   ├─ registerRemoteAgentTask()       │        │   ├─ Agent execution        │
│   ├─ startRemoteSessionPolling()     │─HTTP──►│   ├─ Tool calls             │
│   │    └─ poll events+status every 1s│ GET    │   ├─ Git operations         │
│   ├─ restoreRemoteAgentTasks()       │        │   └─ Hook (SessionStart)    │
│   └─ RemoteAgentTask.kill()          │        │                             │
│                                      │        │  Sessions API (/v1/)        │
│  teleportToRemote()                  │─POST──►│   ├─ CreateSession          │
│   ├─ Git Bundle upload               │        │   ├─ GetSession             │
│   └─ Environment selection           │        │   ├─ ListEvents             │
│                                      │        │   ├─ SendEvent              │
│  Ultraplan Scanner                   │        │   └─ ArchiveSession         │
│   └─ ExitPlanModeScanner             │        │                             │
│                                      │        │  Environment API            │
│  Session Sidecar (on disk)           │        │   ├─ ListEnvironments       │
│   └─ remote-agents/*.meta.json       │        │   └─ CreateEnvironment      │
└──────────────────────────────────────┘        └─────────────────────────────┘
```

**Key design decision**: Claude Code does not use WebSocket or SSE (Server-Sent Events) for real-time push. Instead, it chose **HTTP polling** (GET the event list once every second). That means:
- Communication is **one-way pull**, not two-way push or server push
- It has stronger tolerance for network interruptions. A single failed poll does not break the connection
- The cost is up to 1 second of latency, plus one network request per second

**Why not SSE?** In 2025, SSE is the fairer comparison target than WebSocket. SSE is also HTTP-based, also one-way (server → client), also has built-in disconnect auto-reconnect semantics (`EventSource` in the browser), and has much lower latency than 1-second polling because events are pushed immediately. Possible reasons for choosing HTTP polling over SSE include: (1) the CCR infrastructure may not support long-lived connections (HTTP polling is friendliest to server-side load balancers); (2) it is the simplest possible implementation, with no need to manage persistent connection state; and (3) for background tasks, a 1-second delay is entirely acceptable. But this choice is not free. Suppose a single user runs 5 remote tasks at the same time (for example, multiple autofix-pr runs). With one poll per second per task, that becomes 432,000 HTTP requests per day. It may be "manageable" for a single user, but whether the fan-in of N users × M tasks × 86,400 seconds remains controllable at the CCR infrastructure level requires a server-side capacity analysis.

### 1.2 Remote Task Type System

The system defines five remote task types (`src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` L60): `remote-agent` (generic), `ultraplan` (remote planning approval), `ultrareview` (bughunter code review), `autofix-pr` (long-lived PR auto-fix), and `background-pr` (background PR processing).

The core difference among these five types lies in their **completion criteria**:
- `remote-agent`: completes when the remote side returns a `result` event
- `ultraplan`: must wait until the `ExitPlanMode` tool is approved in the browser
- `ultrareview`: must find the `<remote-review>` tag in hook stdout
- `autofix-pr` / `background-pr`: use a registered `completionChecker` callback and keep polling for a long time

---

## 2. The Full Lifecycle of a Remote Session

### 2.1 Session Creation (teleportToRemote)

Creating a remote session is a multi-step process. The core function is `teleportToRemote()` (`src/utils/teleport.tsx` L730-1190). It accepts as many as 15 parameters, covering authentication, repository detection, environment selection, and API calls.

#### Code Source Selection Ladder

The remote container needs access to the user's code repository. The system implements a three-level fallback strategy:

```
GitHub Clone (preferred) → Git Bundle (fallback) → Empty sandbox (last resort)
```

**Level 1: GitHub Clone**

```typescript
// src/utils/teleport.tsx lines 945-952
if (repoInfo && !forceBundle) {
  if (repoInfo.host === 'github.com') {
    // Preflight: can CCR's git-proxy clone this repo?
    ghViable = await checkGithubAppInstalled(
      repoInfo.owner, repoInfo.name, signal
    );
    sourceReason = ghViable
      ? 'github_preflight_ok'
      : 'github_preflight_failed';
  } else {
    // GHES (Enterprise): optimistically pass, backend validates
    ghViable = true;
    sourceReason = 'ghes_optimistic';
  }
}
```

There is a crucial **preflight mechanism** here. Before sending `CreateSession`, the code calls `checkGithubAppInstalled()` to verify whether the GitHub App is installed. The comment explains why: "50% of users drop off during the GitHub App installation step." Without this preflight, a large number of containers would fail with 401 errors.

**Level 2: Git Bundle**

When GitHub is unavailable, `createAndUploadGitBundle()` (`src/utils/teleport/gitBundle.ts` L152) creates and uploads a local repository bundle. The Bundle has a three-level fallback: `--all` (full repository) → `HEAD` (current branch only) → `squashed-root` (snapshot without history). Each downgrade triggers when the previous level exceeds the size limit (100MB by default, adjustable via feature flag). Uncommitted changes are automatically captured via `git stash create` → `refs/seed/stash`.

#### Environment Selection Logic

There are three environment types (`src/utils/teleport/environments.ts` L9): `anthropic_cloud`, `byoc`, and `bridge`. Selection priority is: user config → `anthropic_cloud` → non-`bridge` → first available. The title and branch name are automatically generated by a Haiku model, and the branch is always prefixed with `claude/` (for example, `claude/fix-mobile-login-button`).

### 2.2 Task Registration (registerRemoteAgentTask)

After session creation succeeds, the local side registers a task to track it:

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 386-466
export function registerRemoteAgentTask(options: {
  remoteTaskType: RemoteTaskType;
  session: { id: string; title: string };
  command: string;
  context: TaskContext;
  toolUseId?: string;
  isRemoteReview?: boolean;
  isUltraplan?: boolean;
  isLongRunning?: boolean;
  remoteTaskMetadata?: RemoteTaskMetadata;
}): { taskId: string; sessionId: string; cleanup: () => void } {
  const taskId = generateTaskId('remote_agent');
  // Create the output file before registration — readers may access it before any output arrives
  void initTaskOutput(taskId);

  const taskState: RemoteAgentTaskState = {
    ...createTaskStateBase(taskId, 'remote_agent', session.title, toolUseId),
    type: 'remote_agent',
    remoteTaskType,
    status: 'running',
    sessionId: session.id,
    command,
    title: session.title,
    todoList: [],
    log: [],
    pollStartedAt: Date.now(),       // Timeout counts from here
    // ...other flags
  };
  registerTask(taskState, context.setAppState);

  // Persist to sidecar so --resume can reconnect
  void persistRemoteAgentMetadata({
    taskId, remoteTaskType, sessionId: session.id,
    title: session.title, command, spawnedAt: Date.now(),
    // ...
  });

  // Start the polling loop
  const stopPolling = startRemoteSessionPolling(taskId, context);
  return { taskId, sessionId: session.id, cleanup: stopPolling };
}
```

### 2.3 Polling and Monitoring (startRemoteSessionPolling)

This is the **core loop** of remote Agent management: one HTTP request per second to fetch remote events:

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 538-799
function startRemoteSessionPolling(
  taskId: string, context: TaskContext
): () => void {
  let isRunning = true;
  const POLL_INTERVAL_MS = 1000;
  const REMOTE_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
  const STABLE_IDLE_POLLS = 5;  // Require 5 consecutive idle polls before declaring done
  let consecutiveIdlePolls = 0;
  let lastEventId: string | null = null;
  let accumulatedLog: SDKMessage[] = [];
  let cachedReviewContent: string | null = null;

  const poll = async (): Promise<void> => {
    if (!isRunning) return;
    // ... polling logic
    if (isRunning) {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  void poll();
  return () => { isRunning = false; };
}
```

#### Stable Idle Detection

An important engineering decision: remote sessions briefly enter `idle` between tool calls. If the system treated a single observed `idle` as completion, it would inevitably misjudge a run with 100+ rapid tool calls. The solution is **5 consecutive polling cycles with no log growth and status `idle`**:

> 📚 **Course connection**: The `STABLE_IDLE_POLLS = 5` design is essentially **debouncing** from digital circuits. For a signal that may be noisy (`idle`/`running` switching rapidly), the system waits for multiple consecutive samples confirming a steady state before transitioning state. Note that this is fundamentally different from TCP keepalive: keepalive infers failure from **no response** (absence of signal → failure), while stable idle infers completion from **a positive response** (presence of an `idle` signal → completion). The signal semantics are opposite. One checks "is the peer dead?" while the other confirms "is the peer truly idle?" Debouncing is the more accurate analogy.

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 544-546
// Remote sessions flip to 'idle' between tool turns. With 100+ rapid
// turns, a 1s poll WILL catch a transient idle mid-run. Require stable
// idle (no log growth for N consecutive polls) before believing it.
const STABLE_IDLE_POLLS = 5;
```

```typescript
// lines 661-666
if (response.sessionStatus === 'idle' && !logGrew && hasAnyOutput) {
  consecutiveIdlePolls++;
} else {
  consecutiveIdlePolls = 0;
}
const stableIdle = consecutiveIdlePolls >= STABLE_IDLE_POLLS;
```

#### Incremental Event Stream Processing

Polling uses **cursor-based incremental fetch** (`src/utils/teleport.tsx` L633-715), using the `after_id` parameter to retrieve only new events. There is a safety limit of 50 pages (`MAX_EVENT_PAGES`) to prevent infinite pagination if the cursor gets stuck. Each poll also fetches session metadata at the same time (branch, status).

#### Race Condition Protection

The polling loop must handle races with `stopTask` (user-initiated manual termination):

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 694-720
// Guard against terminal states — if stopTask raced while
// pollRemoteSessionEvents was in-flight (status set to 'killed',
// notified set to true), bail without overwriting status.
let raceTerminated = false;
updateTaskState<RemoteAgentTaskState>(taskId, context.setAppState,
  prevTask => {
    if (prevTask.status !== 'running') {
      raceTerminated = true;
      return prevTask;  // Don't overwrite terminal state
    }
    // ...normal update
  }
);
if (raceTerminated) return;
```

### 2.4 Task Completion and Notification

| Task type | Completion signal | Timeout |
|---------|---------|---------|
| `remote-agent` | `result` event | None |
| `ultraplan` | `ExitPlanMode` receives approval | Configurable |
| `ultrareview` | `<remote-review>` tag | 30 minutes |
| `autofix-pr` | `completionChecker` callback | None (long-lived) |

Notifications are injected into the message queue in XML `<task_notification>` format (L166-183). `markTaskNotified()` uses atomic updates through `updateTaskState` to guarantee that **the same task only sends one notification** even if the polling loop and `stopTask` trigger completion logic at the same time.

### 2.5 Session Termination (kill)

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 808-848
export const RemoteAgentTask: Task = {
  name: 'RemoteAgentTask',
  type: 'remote_agent',
  async kill(taskId, setAppState) {
    // 1. Atomically update state to killed + notified
    updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') return task;
      sessionId = task.sessionId;
      killed = true;
      return { ...task, status: 'killed', notified: true, endTime: Date.now() };
    });

    // 2. Notify SDK consumers
    if (killed) {
      emitTaskTerminatedSdk(taskId, 'stopped', { toolUseId, summary: description });
      // 3. Archive the remote session — release cloud resources
      if (sessionId) {
        void archiveRemoteSession(sessionId).catch(e =>
          logForDebugging(`RemoteAgentTask archive failed: ${String(e)}`)
        );
      }
    }
    // 4. Clean up on-disk output and metadata
    void evictTaskOutput(taskId);
    void removeRemoteAgentMetadata(taskId);
  }
};
```

The archive operation (`archiveRemoteSession`) is fire-and-forget: if it fails, the system only logs it and does not affect local termination. After archiving, the remote side rejects new event writes, so the Agent naturally stops on its next write operation.

**Risk analysis of fire-and-forget**: From the perspective of local user experience, this design is reasonable. A kill operation should return immediately and should not be blocked by network latency from the remote API. But if archiving **keeps failing** (network unreachable, CCR 5xx, expired authentication, etc.), it creates a classic distributed consistency problem where the "**client believes it has terminated, but the server is still running**":

- **Cloud resource leakage**: Unarchived containers are not released and continue consuming compute resources. If CCR does not have an independent timeout-based garbage collection mechanism (the source code does not confirm this), a container whose archive failed could run forever.
- **The remote Agent can continue producing side effects**: The most dangerous scenario is when the Agent is still running and continues pushing code to GitHub. The user thinks the task has stopped, but the remote side may already have pushed multiple commits to the `claude/` branch, or even opened a PR.
- **No retry mechanism**: When archiving fails, the code only does `logForDebugging`. There is no retry queue, no background retry, and no compensating cleanup on the next startup. By contrast, metadata persistence (`persistRemoteAgentMetadata`) is also fire-and-forget, but losing metadata only affects `--resume`. Archive failure affects actual resource usage.

A more robust design would be to write the session ID of failed archive attempts into a local "pending archive queue" and retry the cleanup on the next Claude Code startup (or inside `restoreRemoteAgentTasks`). Of course, that increases implementation complexity. The Claude Code team may have judged that CCR already has a timeout-based cleanup mechanism, which would make client-side archiving just an acceleration path rather than the only release path. But if that assumption exists, the architecture documentation should state it explicitly.

---

## 3. Session Recovery (`--resume`)

When the user closes the terminal and restarts Claude Code, the remote session may still be running in the cloud. The recovery flow is:

```typescript
// src/tasks/RemoteAgentTask/RemoteAgentTask.tsx lines 477-532
export async function restoreRemoteAgentTasks(
  context: TaskContext
): Promise<void> {
  const persisted = await listRemoteAgentMetadata();
  if (persisted.length === 0) return;

  for (const meta of persisted) {
    let remoteStatus: string;
    try {
      const session = await fetchSession(meta.sessionId);
      remoteStatus = session.session_status;
    } catch (e) {
      // 404 = session is gone → remove metadata
      // 401 = auth failed → recoverable via /login, skip but keep
      if (e.message.startsWith('Session not found:')) {
        void removeRemoteAgentMetadata(meta.taskId);
      }
      continue;
    }

    if (remoteStatus === 'archived') {
      // Session ended while we were offline — don't revive
      void removeRemoteAgentMetadata(meta.taskId);
      continue;
    }

    // Rebuild task state and restart polling
    const taskState: RemoteAgentTaskState = {
      ...createTaskStateBase(meta.taskId, 'remote_agent', meta.title),
      pollStartedAt: Date.now(),  // ← Key: reset the polling start point
      // ...other fields restored from metadata
    };
    registerTask(taskState, context.setAppState);
    startRemoteSessionPolling(meta.taskId, context);
  }
}
```

**`pollStartedAt` reset**: Notice line 525. During recovery, `pollStartedAt` is set to `Date.now()` rather than `meta.spawnedAt`. That means the 30-minute timeout is recomputed from the recovery moment. A task created 20 minutes ago still gets a full 30 minutes after recovery. The comment explicitly explains that this is intentional: "a restore doesn't immediately time out a task spawned >30min ago".

> 📚 **Course connection**: In session recovery, the design choice to "persist identity only, not runtime state" is a classic **thin-client recovery** pattern from distributed systems. The local side stores only the minimum information needed to rebuild the connection (the session ID), while runtime state is always fetched in real time from the authoritative source (the CCR cloud). Note that this is **not stateless recovery in the strict sense**. The system does persist state locally (`meta.json` files containing `taskId`, `sessionId`, `spawnedAt`, etc.); it simply places the authoritative source of runtime state on the server side. A more precise description is a hybrid recovery pattern of "**minimal state persistence + remote state query**" (identity-only persistence). Truly stateless recovery would mean the server does not depend on any client persistence at all, like the HTTP protocol itself. This distinction matters in engineering practice. If a developer mistakenly believes no persistence is needed at all and deletes `meta.json`, then no remote session can be recovered.
>
> Compared with WAL (Write-Ahead Log) recovery in databases: WAL means "persist the full operation log and replay it locally", while Claude Code means "persist the connection identity and query the remote side." Choosing the latter depends on the remote service being highly available. If CCR is unreachable, the locally stored session ID is useless.

### Metadata Persistence

`RemoteAgentMetadata` (`src/utils/sessionStorage.ts` L305-318) is stored at `{projectDir}/{sessionId}/remote-agents/remote-agent-{taskId}.meta.json`, containing fields such as `taskId`, `sessionId`, `remoteTaskType`, `title`, `command`, `spawnedAt`, and so on. The key design choice is: **persist identity information only, not runtime state**. Status is always fetched live from CCR, completely eliminating local cache consistency problems.

---

## 4. Preconditions Check System

`checkBackgroundRemoteSessionEligibility()` (`src/utils/background/remote/remoteSession.ts` L45-98) performs layered checks before creating a remote session: first organization policy (if blocked, return immediately), then login/environment/repository checks in parallel, and finally whether the GitHub App is required depending on the Bundle gate.

There are six precondition failure types:

| Failure type | Meaning | User action |
|---------|------|---------|
| `not_logged_in` | Not logged in to Claude.ai | Run `/login` |
| `no_remote_environment` | No available cloud environment | Configure one in claude.ai/code settings |
| `not_in_git_repo` | Current directory is not a Git repository | `git init` |
| `no_git_remote` | No GitHub remote exists | `git remote add origin` |
| `github_app_not_installed` | Claude GitHub App is not installed | Install the App |
| `policy_blocked` | Organization policy forbids it | Contact your administrator |

**Why Git Bundle matters**: After introducing the Bundle mechanism, the precondition dropped from "must have a GitHub remote + App installed" to "only need a `.git` directory." The comment claims this increased coverage from 43% (sessions with an `origin` remote) to 54% (sessions with a `.git` directory).

---

## 5. Ultraplan: Remote Planning Approval Workflow

Ultraplan is a special mode of remote Agent execution: the Agent generates an execution plan in the cloud, and the user must approve it in the browser before execution begins.

### 5.1 ExitPlanModeScanner: Event Stream State Machine

```typescript
// src/utils/ultraplan/ccrSession.ts lines 80-181
export class ExitPlanModeScanner {
  private exitPlanCalls: string[] = [];      // List of ExitPlanMode tool call IDs
  private results = new Map<string, ToolResultBlockParam>();  // Results received so far
  private rejectedIds = new Set<string>();   // Rejected call IDs
  private terminated: { subtype: string } | null = null;
  everSeenPending = false;

  ingest(newEvents: SDKMessage[]): ScanResult {
    for (const m of newEvents) {
      if (m.type === 'assistant') {
        // Collect ExitPlanMode tool calls
        for (const block of m.message.content) {
          if (block.name === EXIT_PLAN_MODE_V2_TOOL_NAME) {
            this.exitPlanCalls.push(block.id);
          }
        }
      } else if (m.type === 'user') {
        // Collect tool results (browser approve/reject)
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.results.set(block.tool_use_id, block);
          }
        }
      } else if (m.type === 'result' && m.subtype !== 'success') {
        // A non-success result means the session crashed
        this.terminated = { subtype: m.subtype };
      }
    }
    // ...decision logic
  }
}
```

### 5.2 State Transition Diagram

```
                            ┌────────────────────────────┐
                            │                            ▼
running ──(turn ends, no ExitPlanMode)──► needs_input ──(user replies)──► running
   │                                                                        │
   └──(ExitPlanMode emitted)──► plan_ready ──(rejected)────────────────► running
                                    │
                                    ├──(approved)──► poll resolves, task removed
                                    └──(teleport)──► plan returned to local
```

The system distinguishes three user actions this way:
- **approved**: `tool_result.is_error === false`, and the content contains the `## Approved Plan:` marker
- **rejected**: `tool_result.is_error === true`, with no teleport marker
- **teleport** (send back for local execution): `tool_result.is_error === true`, containing the `__ULTRAPLAN_TELEPORT_LOCAL__` marker

```typescript
// src/utils/ultraplan/ccrSession.ts line 48
export const ULTRAPLAN_TELEPORT_SENTINEL = '__ULTRAPLAN_TELEPORT_LOCAL__'
```

### 5.3 Polling Wait Loop

```typescript
// src/utils/ultraplan/ccrSession.ts lines 198-306
export async function pollForApprovedExitPlanMode(
  sessionId: string,
  timeoutMs: number,
  onPhaseChange?: (phase: UltraplanPhase) => void,
  shouldStop?: () => boolean,
): Promise<PollResult> {
  const scanner = new ExitPlanModeScanner();
  const MAX_CONSECUTIVE_FAILURES = 5;
  // 600 calls / 30 minutes — any non-zero 5xx probability will be hit
  // A single failure doesn't abort; give up only after 5 in a row

  while (Date.now() < deadline) {
    if (shouldStop?.()) {
      throw new UltraplanPollError('poll stopped by caller', 'stopped', ...);
    }
    const resp = await pollRemoteSessionEvents(sessionId, cursor);
    const result = scanner.ingest(resp.newEvents);

    if (result.kind === 'approved') {
      return { plan: result.plan, executionTarget: 'remote' };
    }
    if (result.kind === 'teleport') {
      return { plan: result.plan, executionTarget: 'local' };
    }

    // Phase derivation: pending ExitPlanMode → plan_ready
    //                   quiet idle → needs_input
    const phase = scanner.hasPendingPlan ? 'plan_ready'
                : quietIdle ? 'needs_input'
                : 'running';
    if (phase !== lastPhase) {
      onPhaseChange?.(phase);  // Drive UI pill updates
    }
    await sleep(POLL_INTERVAL_MS);  // 3 seconds
  }
}
```

---

## 6. Ultrareview: Remote Code Review

Remote review has two paths: **Bughunter mode** (the production path, running `run_hunt.sh` via the `SessionStart` Hook) and **Prompt mode** (the development/fallback path, using a normal Assistant conversation).

`extractReviewFromLog()` (L254-283) implements a four-level fallback extraction strategy: hook_progress tag scan → assistant message tag scan → tag scan after concatenating hook stdout (to handle tags split across events) → full-text concatenation. This extremely defensive programming approach makes it almost impossible to lose the review result.

---

## 7. Teleport API Layer

### 7.1 Retry and Fault Tolerance

`axiosGetWithRetry()` (`src/utils/teleport/api.ts` L47-81) implements exponential backoff retry (2s, 4s, 8s, 16s). It only retries transient errors (network errors + 5xx), while 4xx errors are thrown directly.

### 7.2 Sessions API Data Model

Session status has four phases: `requires_action` → `running` → `idle` → `archived`. `SessionResource` contains `session_context` (Git source, push target, model selection, bundle file ID, etc.) and the environment ID (L84-136).

### 7.3 Sending Messages to the Remote Session

`sendEventToRemoteSession()` (L361-417) sends user events by POSTing to `/v1/sessions/{id}/events`, with a 30-second timeout (CCR worker cold start is about 2.6 seconds).

---

## 8. UI and Permission Propagation

### Pill Labels

Remote tasks are displayed at the bottom of the CLI as pills (`src/tasks/pillLabel.ts` L39-56): a normal session shows `◇ 1 cloud session`, while Ultraplan shows `◇ ultraplan` / `◇ ultraplan needs your input` / `◆ ultraplan ready` depending on phase (`◇` hollow = running, `◆` solid = awaiting approval).

### Permission Mode Injection: A Protocol-Layer Hack Driven by API Constraints

The CreateSession API has no `permission_mode` field, so the system works around it through **initial event injection** (`src/utils/teleport.tsx` L1122-1139): it prepends a `control_request` of type `set_permission_mode` inside the `events` array. That event is written into the threadstore before the container connects, ensuring that the permission mode is already in effect before the first user turn. There is no timing race.

**This is one of the most interesting engineering decisions in the entire remote Agent system.** It reveals a common but rarely discussed architecture constraint: the Sessions API of CCR (Claude Code Remote) was designed **before** the permission mode feature existed. When the Claude Code team needed remote Agents to honor local permission settings (for example, `plan` mode requiring user approval before every step), they faced a classic problem: **your feature depends on an upstream API you cannot change immediately**.

There were three possible paths:

1. **Wait for the API to be upgraded**: add a `permission_mode` field to CreateSession. This is the "correct" solution, but it requires CCR team scheduling, development, deployment, and backward compatibility work. That could take weeks or even months.
2. **Send a configuration event after the container starts**: create the session first, wait until the container is ready, and then send the permission setting. The problem is the timing window: before that configuration arrives, the Agent may already have performed actions under the default permissions.
3. **Inject a control event into the `events` array at creation time** (Claude Code's actual choice): reuse CreateSession's existing `events` field, originally meant to carry the initial user prompt, to piggyback a `control_request` event. Because `events` are written into the threadstore before the container starts, there is no timing race.

The Claude Code team chose option 3. This is a **creative protocol-level piggyback**. It finds a legitimate extension point within the semantic boundary of the existing API (`events` can carry arbitrary event types), avoids waiting for upstream API changes, and introduces no timing risk.

This decision answers a question that comes up constantly in real-world engineering: **what do you do when your delivery speed is faster than the evolution speed of your upstream dependencies?** The answer is to find a legitimate extension point at the protocol layer, rather than bypassing the system or monkey-patching it, and attach the new semantics to the existing transport mechanism. The tradeoff is that the protocol becomes more implicit. Future maintainers need to know that the `events` array carries not only user messages, but also control instructions. If the CCR API later adds native support for a `permission_mode` field, this hack should be removed.

---

## 9. Critical Analysis

### 9.1 Design Strengths

**HTTP polling as a pragmatic choice**: Polling looks "low-tech," but it has practical advantages in real usage:
- Native tolerance for disconnects. A single failed poll does not affect the next one, and there is no need for heartbeat maintenance or reconnect logic
- Extremely friendly to load balancers. Stateless requests can be routed to any backend node
- A 1-second interval is a fully acceptable delay for background tasks
- Incremental retrieval via the `afterId` cursor

It should be stated honestly that SSE (Server-Sent Events) is superior to HTTP polling along most dimensions. It is also HTTP-based, also one-way, has native reconnect support, and provides immediate event delivery (millisecond-scale vs up to 1 second). The only clear advantage of HTTP polling over SSE is simpler implementation and minimal infrastructure requirements (no long-lived connection support needed). Choosing polling was more likely a **pragmatic decision under infrastructure constraints** (CCR may not support long-lived connections, or the team prioritized the simplest implementation to ship quickly), rather than the result of SSE/WebSocket comparison proving it optimal.

Quantifying the cost: if a single user has 5 parallel tasks, polling all day produces roughly 430,000 HTTP requests. If requests are billed (for example, CloudFront at $0.01-$1 per million requests), the daily cost per user is about $0.004-$0.43. For the CCR backend, the fan-in from 10,000 active users at about 50,000 req/s requires serious capacity planning. In addition, one HTTP request per second on a laptop has a measurable effect on battery life.

**Three-level Bundle fallback**: The fallback chain of `--all → HEAD → squashed-root` effectively handles repositories ranging from a few hundred KB to several GB. This kind of progressive degradation strategy is a common engineering pattern in file transfer systems, similar to adaptive bitrate in video streaming. The 100MB limit is adjustable via feature flag.

**Persist metadata identity, not runtime state**: Recovery always pulls the latest status from CCR in real time, which completely eliminates local cache consistency problems.

### 9.2 Design Flaws and Risks

**An 855-line single-file monster**: `RemoteAgentTask.tsx` packs the completion logic, notification logic, and recovery logic for all 5 remote task types (`remote-agent`, `ultraplan`, `ultrareview`, `autofix-pr`, `background-pr`) into one file. The inner `poll` closure inside `startRemoteSessionPolling` runs over 250 lines and nests multiple concerns such as bughunter detection, stable idle computation, race protection, and TodoList extraction. This is classic "accreted complexity": every new remote task type adds another branch inside `poll`.

**Scattered magic constants**:
- `STABLE_IDLE_POLLS = 5` (number of consecutive idle polls)
- `REMOTE_REVIEW_TIMEOUT_MS = 30 * 60 * 1000` (review timeout)
- `MAX_EVENT_PAGES = 50` (maximum page count)
- `POLL_INTERVAL_MS = 1000` (poll interval in `RemoteAgentTask`) vs `3000` (in ultraplan `ccrSession`)

These constants are not centrally managed or configurable through feature flags (except timeout in some cases). Adjusting them requires code changes.

**Fragility of stable idle**: In bughunter mode, the remote session is "always idle". The Hook is running, but the session status is `idle`. To deal with this, the code adds `hasSessionStartHook` detection to distinguish bughunter from prompt mode. But the comment itself admits this is a "theoretical" safeguard, and it is not forward-looking for future Hook types.

**The time-window issue caused by resetting `pollStartedAt`**: On recovery, `pollStartedAt = Date.now()` means an ultrareview that has already been running for 29 minutes gets a fresh 30 minutes after resume. Although the comment explains the motivation of avoiding "timing out immediately after recovery," it also means a failing task could extend its timeout indefinitely through repeated resumes.

**Global mutable state in `completionChecker`**:
```typescript
const completionCheckers = new Map<RemoteTaskType, RemoteTaskCompletionChecker>();
```
This is a module-level global Map. `registerCompletionChecker` is global side-effect registration. There is no unregister mechanism, no ordering guarantee, and no protection against overwriting.

### 9.3 Cost Model: Remote Agents Are Not Free

One important dimension of remote Agents that the source code barely touches is **cost**. Running cloud containers consumes real money, and understanding the cost model helps explain the deeper motivations behind several architecture decisions.

**Industry reference points**:
- **Devin**: $500/month, including 20 hours of ACU (Agent Compute Unit), with overage billed hourly. That works out to roughly $25/ACU-hour.
- **GitHub Copilot Coding Agent**: Included in Copilot Enterprise subscriptions ($39/user/month), using GitHub Actions minutes.
- **Claude Code remote execution**: As of this source version, the billing model does not appear in the client code. But it is reasonable to infer that Claude Max subscriptions ($100-200/month) may include some remote execution quota, with throttling or extra billing once the quota is exceeded.

**How cost drives architecture decisions**:

1. **The real motivation behind GitHub App preflight (50% drop-off)**: On the surface, it looks like a user-experience optimization. At a deeper level, it avoids wasted containers. If creating a CCR container costs $0.01-$0.10 (rough estimate based on cloud VM cold start + runtime), then 50% of sessions failing with 401 means half the container spend is wasted. The ROI of preflight is obvious.

2. **The economic meaning of stable idle detection**: Declaring completion and triggering archive after 5 consecutive idle polls (5 seconds) is not just about correctness, but also cost control. If idle detection is too sensitive (one idle observation is enough), the task may be killed incorrectly during a thinking gap and need to be rerun, which wastes even more. If it is too insensitive (20 idle observations before completion), the container burning 20 idle seconds seems cheap in isolation but becomes meaningful at scale.

3. **The cost risk of fire-and-forget archiving**: As discussed earlier, archive failure means the container is not released. If CCR has no independent timeout cleanup, a "zombie container" could continue billing for hours or even days. That turns archive reliability from a "nice to have" into a critical path directly affecting Anthropic's operating cost.

4. **Server-side cost of HTTP polling vs SSE**: One HTTP request per second is extremely cheap per user, but the server-side processing overhead it creates (TLS handshake, load balancing, logging) is far higher than the heartbeat overhead of SSE long-lived connections. Once active users reach the tens of thousands, the request volume generated by polling (~50,000 req/s) may push Anthropic to reevaluate the communication architecture.

**Practical impact on users**: Using remote Agents is not "free background work." When deciding whether to use remote mode, users should consider: (a) whether remote execution counts against subscription quota or incurs extra charges; (b) the cumulative cost of long-running `autofix-pr` / `background-pr` tasks; and (c) whether using remote mode is worth it for tasks that can be completed locally. The source code lacks user-facing guidance around these questions, which is a product-level area for improvement.

### 9.4 Directions for Improvement

1. **Split polling strategies**: Break task-type-specific logic out of `startRemoteSessionPolling` into strategy classes such as `ReviewPollStrategy` and `UltraplanPollStrategy`. The polling framework itself should only handle event fetching and state updates.
2. **Adaptive polling interval**: When multiple consecutive polls return no new events, automatically slow down to 5-10 seconds. Switch back to 1 second when new events appear. That reduces network overhead during idle periods.
3. **Externalize timeout configuration**: The hard-coded 30-minute timeout could be moved into a feature flag or config file so enterprise users can tune it as needed.
4. **Bundle progress feedback**: Uploading a Bundle for a large repository can take a while, but there is currently no progress indicator. An upload progress callback could be added.

---

## Code Locations

| Module | File path | Key lines |
|------|---------|---------|
| Core state machine | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L22-59 (state types), L60-64 (task type enum) |
| Task registration | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L386-466 (`registerRemoteAgentTask`) |
| Polling loop | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L538-799 (`startRemoteSessionPolling`) |
| Session recovery | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L477-532 (`restoreRemoteAgentTasks`) |
| Kill implementation | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L808-848 (`RemoteAgentTask.kill`) |
| Review extraction | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L254-283 (`extractReviewFromLog`) |
| Plan extraction | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L208-218 (`extractPlanFromLog`) |
| Notification send | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | L166-183 (`enqueueRemoteNotification`) |
| Preconditions check | `src/utils/background/remote/remoteSession.ts` | L45-98 (`checkBackgroundRemoteSessionEligibility`) |
| Fine-grained checks | `src/utils/background/remote/preconditions.ts` | L23-235 (individual check functions) |
| Remote session creation | `src/utils/teleport.tsx` | L730-1190 (`teleportToRemote`) |
| Event polling | `src/utils/teleport.tsx` | L633-715 (`pollRemoteSessionEvents`) |
| Session archive | `src/utils/teleport.tsx` | L1200-1225 (`archiveRemoteSession`) |
| Sessions API | `src/utils/teleport/api.ts` | L289-327 (`fetchSession`), L361-417 (`sendEventToRemoteSession`) |
| Environment management | `src/utils/teleport/environments.ts` | L32-70 (`fetchEnvironments`), L76-120 (`createDefaultCloudEnvironment`) |
| Environment selection | `src/utils/teleport/environmentSelection.ts` | L24-77 (`getEnvironmentSelectionInfo`) |
| Git Bundle | `src/utils/teleport/gitBundle.ts` | L50-146 (`_bundleWithFallback`), L152-292 (`createAndUploadGitBundle`) |
| Ultraplan scanner | `src/utils/ultraplan/ccrSession.ts` | L80-181 (`ExitPlanModeScanner`) |
| Ultraplan polling | `src/utils/ultraplan/ccrSession.ts` | L198-306 (`pollForApprovedExitPlanMode`) |
| Keyword detection | `src/utils/ultraplan/keyword.ts` | L46-95 (`findKeywordTriggerPositions`) |
| Pill labels | `src/tasks/pillLabel.ts` | L39-56 (`remote_agent` pill logic) |
| Task type definitions | `src/tasks/types.ts` | L1-47 (`TaskState` union type) |
| Metadata persistence | `src/utils/sessionStorage.ts` | L305-399 (`RemoteAgentMetadata` CRUD) |
| Task base class | `src/Task.ts` | L6-76 (`TaskType`, `TaskStatus`, `Task` interface) |
