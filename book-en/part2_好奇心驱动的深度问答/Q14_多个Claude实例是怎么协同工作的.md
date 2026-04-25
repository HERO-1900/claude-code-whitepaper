# How Do Multiple Claude Instances Work Together?

A deep dive into Claude Code's Swarm multi-instance collaboration model—how the Leader assigns tasks, how Teammates execute independently, how the Mailbox message system enables cross-instance communication, and how permission approvals converge at a unified entry point.

---

### 🌍 Industry Context

Multi-AI Agent collaboration is the fastest-evolving direction in AI engineering from 2024 to 2026. By 2026, multi-instance coordination has moved from experimental frameworks to full production deployment. **Kimi Code**, based on the K2.5 1T MoE model, has achieved **up to 100 concurrent sub-agents** in its Agent Swarm, representing the highest-concurrency production implementation to date. **CodeX (OpenAI)** v0.118.0 introduced a mailbox communication mechanism (Mailbox) that allows different background processes to interact asynchronously—conceptually similar to Claude Code's Mailbox file-system communication, though CodeX's Mailbox leans more toward an inter-process asynchronous message queue. **Devin's** Manage Devins feature deploys multiple instances across isolated VMs, paired with fine-grained Human-in-the-loop control—compared to Claude Code's Swarm mode, Devin takes the "cloud VM isolation" route, whereas Claude Code takes the "local process/terminal isolation" route. **OpenAI's Swarm framework** (open-sourced in 2024) proposed a peer-to-peer "handoff" orchestration pattern, but it is a purely in-memory proof of concept with no persistence or multi-process support. **LangGraph** defines agent workflows as directed graphs, supporting state persistence and conditional branching, but its collaboration model is a predefined graph structure rather than dynamic message passing. **AutoGen** (Microsoft) uses a centralized GroupChat manager rather than a star topology. **OpenClaw** (formerly Clawdbot) uses communication apps (WhatsApp/Telegram) as interaction entry points, adopting a "sense-plan-act-observe" closed loop that supports cross-regional device wakeup and remote execution—representing a fundamentally different "de-terminalized" multi-instance collaboration paradigm.

Claude Code's Swarm mode has unique engineering depth—it truly solves production-grade problems such as multi-process isolation (three backends), file-system-level communication (Mailbox), and cross-instance permission synchronization. Compared to Kimi Code's hundred-level concurrent Swarm or Devin's cloud VM cluster, Claude Code's Swarm focuses more on deep integration with the local terminal environment and fine-grained permission control. However, its star topology (all permissions flow back to the Leader) may become a bottleneck as the number of agents grows, a known limitation of all centralized coordination architectures.

---

## The Question

Claude Code has a "Swarm" mode that allows multiple Claude instances to work simultaneously. How are these instances coordinated? How do they communicate? How are permissions managed? How does a single 1,552-line `inProcessRunner.ts` drive the entire system?

> 💡 **Plain English**: Swarm mode is like **remotely piloting multiple drones**—the Leader (remote controller/ground station) handles overall command and approval, while each Teammate (drone) independently executes its mission, staying in contact via the signal link (Mailbox message system). All critical decisions (permission approvals) converge at the ground station to ensure safety and control.

---

> **[Chart placeholder 2.14-A]**: Swarm topology diagram—Leader in the center, Teammates (A/B/C) arranged around it, annotated with: communication arrows (Mailbox messages), permission-convergence arrows (LeaderPermissionBridge), Backend type labels (tmux/in-process/iTerm2)

## City Analogy

The Swarm system is the city's **project management department**—breaking a large project into pieces and assigning them to multiple construction crews working in parallel. The Leader is the chief project commander, sitting in the control center (main terminal); the Teammates are the individual construction crews, some in the same office building (in-process), some in separate sheds (tmux panes), and some in the high-end office tower next door (iTerm2 native splits). Regardless of location, all crews use the same **mail system** (Mailbox) to send and receive instructions, and all safety approvals must be stamped by the chief commander (LeaderPermissionBridge).

---

## Core Concept: Leader + Teammates

Swarm mode has a single coordinator (the Leader, i.e., the main Claude instance) and several Teammates (workers). This is a classic star topology—all coordination and permission decisions converge through the Leader.

> 📚 **Course Connection**: The star topology is one of the foundational network topologies taught in **computer networking** courses. The Leader acts as the central node, similar to a switch—all communication and decisions pass through it. The advantages of this topology are simple management and good fault isolation (one Teammate crashing does not affect the others), while the disadvantage is that the central node becomes a single point of failure and a performance bottleneck. In **distributed systems** courses, this corresponds to the "centralized coordinator" pattern (such as ZooKeeper leader election), contrasting with decentralized peer-to-peer (P2P) networks.

**Identity format**: `researcher@my-team`
- `researcher`: The Teammate's name (role identifier)
- `my-team`: The team name

This format is generated by `formatAgentId()` and serves as the unique identifier throughout the system. `sanitizeAgentName()` replaces `@` with `-` to prevent conflicts with the separator character.

### Team File

Each team has a persistent configuration file on disk, stored at `~/.claude/teams/{teamName}/config.json`:

```typescript
// teamHelpers.ts
type TeamFile = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId?: string          // Leader's session UUID
  hiddenPaneIds?: string[]        // Currently hidden panes
  teamAllowedPaths?: TeamAllowedPath[]  // Team-level path permissions
  members: Array<{
    agentId: string
    name: string
    model?: string
    prompt?: string
    color?: string
    planModeRequired?: boolean
    joinedAt: number
    tmuxPaneId: string
    cwd: string
    worktreePath?: string          // Optional git worktree path
    backendType?: BackendType      // 'tmux' | 'iterm2' | 'in-process'
    isActive?: boolean             // false=idle, true/undefined=active
    mode?: PermissionMode
  }>
}
```

Note the `teamAllowedPaths` field: a team can configure global path permissions that all Teammates automatically inherit at startup without individual approval. This is the mechanism of "trust propagation"—when the Leader says "everyone can edit this directory," all construction crews automatically gain that permission.

### AppState Representation of Each Teammate

Each Teammate has an `InProcessTeammateTaskState` in AppState, an extremely information-dense struct (`types.ts`, 121 lines):

```typescript
type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'
  identity: TeammateIdentity         // agentId, agentName, teamName, color, planModeRequired
  prompt: string                     // Initial instruction
  model?: string                     // Optional model override

  // Dual AbortController design
  abortController?: AbortController         // Kill the entire Teammate (lifecycle level)
  currentWorkAbortController?: AbortController  // Abort only the current turn (Escape key)

  // Permissions and plan mode
  awaitingPlanApproval: boolean
  permissionMode: PermissionMode     // Can be toggled independently via Shift+Tab

  // Messages and progress
  messages?: Message[]               // For UI display, with a cap
  inProgressToolUseIDs?: Set<string> // Currently executing tool calls (for animations)
  pendingUserMessages: string[]      // Pending messages sent by user through UI

  // Lifecycle
  isIdle: boolean
  shutdownRequested: boolean
  onIdleCallbacks?: Array<() => void>  // Notify waiters when idle
}
```

**Design intent of the dual AbortController**: this solves a real interaction problem. When the user presses Escape, they want to stop only what the Teammate is currently doing (such as a long-running bash command), not kill the entire Teammate. `currentWorkAbortController` lets Escape cancel only the current turn; `abortController` is the true "life-or-death switch." In the code (`inProcessRunner.ts` line 1057), this distinction is clearly visible:

```typescript
// Create a per-turn abort controller for this iteration.
// This allows Escape to stop current work without killing the whole teammate.
const currentWorkAbortController = createAbortController()
```

---

## Three Execution Backends

Teammates can run in three ways. Backend selection is automatically determined by detection logic in `registry.ts`, with the following priority:

1. If inside tmux, always use tmux (even inside iTerm2)
2. If inside iTerm2 and the `it2` CLI is available, use the iTerm2 backend
3. If inside iTerm2 but `it2` is unavailable, prompt for installation
4. If tmux is available (but not currently inside it), create an external tmux session
5. If none of the above work, fall back to in-process mode

### in-process (Same-Process Execution)

This is the most important backend and the only mode that does not require an external terminal. The Teammate runs within the same Node.js process, using `AsyncLocalStorage` to isolate context.

```typescript
// spawnInProcess.ts
export async function spawnInProcessTeammate(
  config: InProcessSpawnConfig,
  context: SpawnContext,
): Promise<InProcessSpawnOutput> {
  // 1. Generate deterministic Agent ID
  const agentId = formatAgentId(name, teamName)
  // 2. Create independent AbortController (not linked to Leader)
  const abortController = createAbortController()
  // 3. Create AsyncLocalStorage context
  const teammateContext = createTeammateContext({...})
  // 4. Register Perfetto tracing
  if (isPerfettoTracingEnabled()) {
    registerPerfettoAgent(agentId, name, parentSessionId)
  }
  // 5. Register task in AppState
  registerTask(taskState, setAppState)
}
```

Note step 2: the Teammate's AbortController is **independent of the Leader**. The code comment explicitly states the reason: `Teammates should not be aborted when the leader's query is interrupted`. When the Leader presses Escape to interrupt their own query, it should not cascade and kill all Teammates.

**Pros**: Fast startup (millisecond-level), low communication latency, can share API client and MCP connections, no tmux installation required

**Cons**: If one Teammate crashes, it may affect the entire process; memory contention

**Key detail**: when the InProcessBackend launches a Teammate, it **clears the Leader's conversation messages** before passing them to the Teammate:

```typescript
// InProcessBackend.ts lines 122-123
// Strip messages: the teammate never reads toolUseContext.messages
// Passing the parent's conversation would pin it for the teammate's lifetime.
toolUseContext: { ...this.context, messages: [] },
```

This seemingly odd operation has a solid rationale: if the Leader's full conversation were passed to the Teammate, the JavaScript garbage collector could not free the Leader's old messages for as long as the Teammate remained alive—because the Teammate holds a reference. For long-running Teammates, this would cause severe memory leaks.

### tmux (Multi-Terminal Panes)

Each Teammate runs as an independent Claude process inside a tmux pane. The TmuxBackend has two modes:

**Running inside tmux** (the Leader itself is in tmux):
- Directly splits the current window
- Leader occupies 30% on the left, Teammates occupy 70% on the right
- Uses the user's own tmux session

**Running outside tmux** (regular terminal):
- Creates an independent tmux session named `claude-swarm`
- Uses an isolated socket (`claude-swarm-{PID}`) to avoid conflicts with the user's tmux
- All Teammates are distributed equally (no Leader pane)

```typescript
// constants.ts
SWARM_SESSION_NAME = 'claude-swarm'
SWARM_VIEW_WINDOW_NAME = 'swarm-view'

// Independent socket includes PID to avoid multi-instance conflicts
function getSwarmSocketName(): string {
  return `claude-swarm-${process.pid}`
}
```

The TmuxBackend has an elegant **pane creation lock** (`acquirePaneCreationLock()`) to prevent race conditions when creating multiple Teammates in parallel. After creating a pane, there is also a 200ms wait (`PANE_SHELL_INIT_DELAY_MS`) to allow the shell to finish initialization (loading `.bashrc`, starship prompt, etc.).

### iTerm2 (Native Splits)

Similar to tmux but uses iTerm2's native split functionality. Detection checks for any of three environment variables:

```typescript
// detection.ts
const termProgram = process.env.TERM_PROGRAM     // 'iTerm.app'
const hasItermSessionId = !!process.env.ITERM_SESSION_ID
const terminalIsITerm = env.terminal === 'iTerm.app'
```

The iTerm2 backend controls iTerm2 via AppleScript (`osascript`), which is built into macOS and requires no additional installation. However, the `it2` CLI must be installed and configured separately; if iTerm2 is detected but `it2` is unavailable, the system displays a setup guide (`It2Setup.tsx`, a 379-line React component—showing just how complex this onboarding flow is).

---

## Unified Backend Abstraction

The three backends are abstracted through two layers of interfaces:

**PaneBackend** (low-level—terminal pane operations):

```typescript
type PaneBackend = {
  readonly type: BackendType
  readonly displayName: string
  readonly supportsHideShow: boolean    // tmux supports, iTerm2 may not
  isAvailable(): Promise<boolean>
  createTeammatePaneInSwarmView(name, color): Promise<CreatePaneResult>
  sendCommandToPane(paneId, command): Promise<void>
  setPaneBorderColor(paneId, color): Promise<void>
  setPaneTitle(paneId, name, color): Promise<void>
  rebalancePanes(windowTarget, hasLeader): Promise<void>
  killPane(paneId): Promise<boolean>
  hidePane(paneId): Promise<boolean>     // Hide but do not kill
  showPane(paneId, target): Promise<boolean>
}
```

**TeammateExecutor** (high-level—Teammate lifecycle):

```typescript
type TeammateExecutor = {
  readonly type: BackendType
  isAvailable(): Promise<boolean>
  spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>
  sendMessage(agentId: string, message: TeammateMessage): Promise<void>
  terminate(agentId: string, reason?: string): Promise<boolean>  // Graceful shutdown
  kill(agentId: string): Promise<boolean>                        // Force kill
  isActive(agentId: string): Promise<boolean>
}
```

This allows the Leader to remain agnostic about whether a Teammate is in tmux, iTerm2, or the same process—the interface is identical. `PaneBackendExecutor` (354-line `PaneBackendExecutor.ts`) adapts PaneBackend into the TeammateExecutor interface, a classic adapter pattern.

Note the distinction between `terminate` and `kill`: `terminate` is "please stop" (sends a shutdown request to the mailbox; the Teammate can refuse), while `kill` is "stop immediately" (directly aborts the AbortController or kills the pane).

---

## Communication: The Mailbox System

Teammates communicate through a file-system-based mailbox (Mailbox)—whether they are on the same-process, tmux, or iTerm2 backend:

```typescript
type TeammateMessage = {
  text: string
  from: string         // Sender name
  color?: string       // Sender color
  timestamp?: string
  summary?: string     // 5-10 character summary, displayed in UI preview
}
```

### Mailbox Polling Mechanism

When idle, a Teammate enters a 500ms polling loop (`waitForNextPromptOrShutdown()`) checking three message sources:

1. **In-memory pendingUserMessages**: messages sent directly to the Teammate by the user through the UI
2. **File-system mailbox**: messages from other Teammates or the Leader
3. **Task list**: whether there are unclaimed tasks in the team-shared task list

The polling priority design is interesting (`inProcessRunner.ts` lines 806-818):

```
Shutdown request > Leader message > Other Teammate messages > Task list
```

This priority ensures that:
- The Leader's shutdown command is not drowned out by a flood of inter-Teammate messages
- The Leader's work instructions take priority over Teammate chatter
- If there are no direct messages, the Teammate proactively claims work from the task list

### Task Claiming Mechanism

Teammates do not just passively wait for messages; they actively claim work from the shared task list:

```typescript
// inProcessRunner.ts
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )
  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
}
```

`claimTask()` uses an atomic operation to ensure the same task is not claimed by two Teammates simultaneously. Once claimed, its status is immediately set to `in_progress`, so the UI reflects it in real time.

> 📚 **Course Connection**: The atomicity of task claiming is the classic critical-section problem from **operating systems** courses—when multiple Teammates concurrently inspect the same task list, the "check + claim" must be an atomic operation; otherwise, a race condition can occur where two Teammates claim the same task simultaneously. The `blockedBy` field implements dependency relations similar to topological sorting in **compiler theory**—a task can only be executed after all its dependencies are completed.

---

## InProcessRunner: The 1,552-Line Core Engine

`inProcessRunner.ts` is the heart of the entire Swarm system, driving the complete lifecycle of an in-process Teammate. Its core is a `while` loop (starting at line 1048) with the following structure:

```
while (!aborted && !shouldExit) {
  1. Create per-turn AbortController (Escape stops only current turn)
  2. Check if context compaction is needed (auto-compact)
  3. Run runAgent() inside teammateContext
  4. Collect messages, update progress
  5. Mark as idle, send idle notification
  6. Wait for next message or shutdown request
  7. Set next turn's prompt based on message type
}
```

### Context Compaction

Teammates are long-running—they do not exit after completing a single task like a normal subagent. This means the conversation history keeps growing. Before each turn, the system checks the token count and performs context compaction if it exceeds the threshold:

```typescript
const tokenCount = tokenCountWithEstimation(allMessages)
if (tokenCount > getAutoCompactThreshold(toolUseContext.options.mainLoopModel)) {
  // Create isolated toolUseContext to avoid interfering with main session UI
  const isolatedContext = {
    ...toolUseContext,
    readFileState: cloneFileStateCache(toolUseContext.readFileState),
    onCompactProgress: undefined,   // Do not trigger Leader's compaction progress UI
    setStreamMode: undefined,
  }
  const compactedSummary = await compactConversation(allMessages, isolatedContext, ...)
}
```

Note the `cloneFileStateCache()` call: compaction operations need to read file state but must not pollute the Leader's file-state cache. This is the isolation challenge brought by same-process execution—when two "people" share an office, each must have their own filing cabinet.

### Message Formatting

Messages from the Leader or other Teammates are wrapped in XML format to ensure the model correctly identifies the source:

```typescript
function formatAsTeammateMessage(from, content, color?, summary?): string {
  return `<teammate-message teammate_id="${from}" color="${color}" summary="${summary}">
${content}
</teammate-message>`
}
```

This is consistent with the message format received by tmux Teammates, ensuring that regardless of which backend a Teammate runs on, the message format is identical.

### System Prompt Construction

A Teammate's system prompt has three modes (`inProcessRunner.ts` lines 923-969):

1. **default**: Full main agent system prompt + teammate addendum + custom agent instructions
2. **replace**: Fully replaced by custom prompt
3. **append**: Full main prompt + teammate addendum + appended custom prompt

Regardless of mode, the system ensures the Teammate has the tools essential for team collaboration:

```typescript
tools: agentDefinition?.tools
  ? [...new Set([
      ...agentDefinition.tools,
      SEND_MESSAGE_TOOL_NAME,    // Must be able to send messages
      TEAM_CREATE_TOOL_NAME,     // Must be able to create sub-teams
      TEAM_DELETE_TOOL_NAME,
      TASK_CREATE_TOOL_NAME,     // Must be able to manipulate task list
      TASK_GET_TOOL_NAME,
      TASK_LIST_TOOL_NAME,
      TASK_UPDATE_TOOL_NAME,
    ])]
  : ['*'],  // If no tool list specified, grant all tools
```

This design ensures that even if a custom agent declares only a few tools, it can still respond to shutdown requests, send messages, and coordinate tasks.

---

## Teammate System Prompt Addendum

`teammatePromptAddendum.ts` is only 18 lines, but every line is critical:

```typescript
export const TEAMMATE_SYSTEM_PROMPT_ADDENDUM = `
# Agent Teammate Communication

IMPORTANT: You are running as an agent in a team. To communicate with anyone on your team:
- Use the SendMessage tool with \`to: "<name>"\` to send messages to specific teammates
- Use the SendMessage tool with \`to: "*"\` sparingly for team-wide broadcasts

Just writing a response in text is not visible to others on your team -
you MUST use the SendMessage tool.

The user interacts primarily with the team lead. Your work is coordinated
through the task system and teammate messaging.
`
```

This paragraph solves a fundamental problem: an LLM's "natural instinct" is to output text directly as a reply, but in Swarm mode, a Teammate's text output is not seen by anyone (unless the user actively checks that Teammate's transcript). It **must** use the SendMessage tool to actually communicate with others. This is similar to a remote worker who is used to speaking face-to-face and needs to be explicitly told, "You must post on Slack for others to see."

---

## Teammate Model Selection

`teammateModel.ts` is only 10 lines, but reveals an important default configuration:

```typescript
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_6_CONFIG[getAPIProvider()]
}
```

When the user does not explicitly configure a Teammate model, Claude Opus 4.6 is used by default. Note the `getAPIProvider()` call—this ensures that enterprise users on Bedrock, Vertex, or Foundry also receive the correct model ID. The code comment marks this with `@[MODEL LAUNCH]` to remind engineers that this fallback needs updating whenever a new model is released.

---

## Permission Synchronization: The Leader Is the Sole Permission Center

This is one of the most complex subsystems in the Swarm architecture, involving cooperation between two files: `leaderPermissionBridge.ts` (a lean 54-line bridge) and `permissionSync.ts` (the full 928-line synchronization mechanism).

### Basic Principle

In Swarm mode, a Teammate cannot independently pop up a permission confirmation dialog. There are two reasons:
1. tmux/iTerm2 Teammates run in independent terminals; the user may not even be looking at that pane
2. in-process Teammates share the same UI thread as the Leader, so permission dialogs would conflict

All permission decisions are routed back to the Leader—this is the "single control plane" design.

### Leader Permission Bridge

`leaderPermissionBridge.ts` implements a minimal bridge using module-level variables:

```typescript
let registeredSetter: SetToolUseConfirmQueueFn | null = null
let registeredPermissionContextSetter: SetToolPermissionContextFn | null = null

// Registered at REPL startup
export function registerLeaderToolUseConfirmQueue(setter): void {
  registeredSetter = setter
}

// Called when Teammate needs permission
export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return registeredSetter
}
```

Why use module-level variables instead of a more "formal" architecture? Because the Leader's REPL is a React component (Ink), while the in-process Teammate's Runner is a pure TypeScript function. React state setters cannot be passed into non-React code through conventional DI. This bridge is the span between the React world and plain TypeScript.

### Two Paths for Permission Requests

`createInProcessCanUseTool()` (`inProcessRunner.ts` lines 128-451, a single 323-line function!) implements the complete permission-checking logic for Teammates:

**Path 1: Leader UI bridge available** (standard path for in-process Teammates)

```
Teammate needs permission
  → Check hasPermissionsToUseTool(): if allow/deny, return directly
  → If 'ask', and it's a bash command, try classifier auto-approval first
  → Still needs human approval → add request to Leader's ToolUseConfirm queue via Bridge
  → Leader UI pops up permission dialog (with workerBadge identifying which Teammate)
  → User acts → returned to Teammate via Promise resolve
```

The `workerBadge` in the permission dialog shows the Teammate's name and color, letting the user know which "construction crew" the permission request came from:

```typescript
workerBadge: identity.color
  ? { name: identity.agentName, color: identity.color }
  : undefined,
```

**Path 2: Mailbox fallback** (for tmux/iTerm2 Teammates or when Bridge is unavailable)

```
Teammate needs permission
  → Create SwarmPermissionRequest (with zod schema validation)
  → Write to Leader's file-system mailbox
  → Poll own mailbox every 500ms waiting for response
  → Leader detects request → user acts in Leader UI
  → Leader writes to Teammate's mailbox
  → Teammate reads response → continues execution
```

### File-System Permission Storage

Permission requests and responses are stored on disk with the following directory structure:

```
~/.claude/teams/{teamName}/permissions/
  pending/             # Pending requests
    perm-1711234567-abc1234.json
  resolved/            # Resolved requests
    perm-1711234567-abc1234.json
```

File locks (`lockfile.lock()`) guarantee atomicity. This design allows permission requests to survive process crashes—because the state is on disk, not in memory.

### Permission Update Write-Back

When the user selects "Always allow" in the Leader UI, that permission rule needs to be synchronized back to the Teammate. But there is a subtle issue here (`inProcessRunner.ts` lines 275-279):

```typescript
// Preserve the leader's mode to prevent workers'
// transformed 'acceptEdits' context from leaking back
// to the coordinator
setToolPermissionContext(updatedContext, { preserveMode: true })
```

A Teammate's permission mode may differ from the Leader's (for example, the Teammate may be in `acceptEdits` mode). When writing back permission rules, the Leader's own mode must be preserved; otherwise, the Teammate's mode would "pollute" the Leader.

---

## Teammate Initialization Sequence

`teammateInit.ts` handles Teammate startup setup, with three core steps:

### Step 1: Inherit Team-Level Path Permissions

```typescript
if (teamFile.teamAllowedPaths && teamFile.teamAllowedPaths.length > 0) {
  for (const allowedPath of teamFile.teamAllowedPaths) {
    const ruleContent = allowedPath.path.startsWith('/')
      ? `/${allowedPath.path}/**`    // Absolute path → //path/**
      : `${allowedPath.path}/**`     // Relative path → path/**
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, {
        type: 'addRules',
        rules: [{ toolName: allowedPath.toolName, ruleContent }],
        behavior: 'allow',
        destination: 'session',
      }),
    }))
  }
}
```

### Step 2: Register Stop Hook (Idle Notification)

When a Teammate's session stops (whether normally completed or interrupted), it needs to notify the Leader that it is idle:

```typescript
addFunctionHook(setAppState, sessionId, 'Stop', '', async (messages) => {
  // Mark self as inactive
  void setMemberActive(teamName, agentName, false)
  // Send idle notification to Leader
  const notification = createIdleNotification(agentName, {
    idleReason: 'available',
    summary: getLastPeerDmSummary(messages),
  })
  await writeToMailbox(leadAgentName, {
    from: agentName,
    text: jsonStringify(notification),
    timestamp: new Date().toISOString(),
    color: getTeammateColor(),
  })
  return true  // Do not block Stop flow
})
```

The hook timeout is 10 seconds—if disk I/O is too slow and the notification write times out, it is abandoned without blocking the shutdown flow.

### Step 3: Environment Variable and CLI Flag Propagation

When a Teammate runs as an independent process in tmux (not in-process), `spawnUtils.ts` ensures the Teammate inherits the correct configuration:

```typescript
// Environment variables that must be propagated
const TEAMMATE_ENV_VARS = [
  'CLAUDE_CODE_USE_BEDROCK',      // API provider
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',           // Custom API endpoint
  'CLAUDE_CONFIG_DIR',            // Config directory
  'CLAUDE_CODE_REMOTE',           // CCR mode flag
  'HTTPS_PROXY', 'https_proxy',   // Proxy settings
  'SSL_CERT_FILE',                // TLS certificate
  // ...
]
```

Forgetting to propagate these variables would cause the Teammate to default to the first-party API—a disaster for enterprise users on Bedrock or Vertex (GitHub issue #23561 was exactly this bug).

CLI flag propagation is equally important, but with a safety constraint:

```typescript
// Plan mode takes precedence over bypass permissions
if (planModeRequired) {
  // Do not inherit bypass permissions
} else if (permissionMode === 'bypassPermissions') {
  flags.push('--dangerously-skip-permissions')
}
```

If the Leader is in `--dangerously-skip-permissions` mode, but a Teammate is marked `planModeRequired`, that Teammate **will not** inherit the skip-permissions flag. Plan mode's safety constraint takes precedence over convenience.

---

## Terminal Layout Management

`teammateLayoutManager.ts` is a UI-level abstraction that delegates layout operations to the currently detected backend:

```typescript
async function getBackend(): Promise<PaneBackend> {
  return (await detectAndGetBackend()).backend  // Auto-cached
}

export async function createTeammatePaneInSwarmView(
  teammateName: string,
  teammateColor: AgentColorName,
): Promise<{ paneId: string; isFirstTeammate: boolean }> {
  const backend = await getBackend()
  return backend.createTeammatePaneInSwarmView(teammateName, teammateColor)
}
```

### Color Management

Each Teammate is assigned a unique color, selected round-robin from a palette:

```typescript
const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

export function assignTeammateColor(teammateId: string): AgentColorName {
  const existing = teammateColorAssignments.get(teammateId)
  if (existing) return existing  // Idempotent: same Teammate always gets same color
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!
  teammateColorAssignments.set(teammateId, color)
  colorIndex++
  return color
}
```

This color is used not only for tmux pane borders but also propagated into messages (`TeammateMessage.color`) and permission dialogs (`workerBadge.color`), allowing the user to quickly identify different Teammates across all interaction surfaces.

---

## Reconnection Mechanism

`reconnection.ts` handles two scenarios:

### First Startup

Reads team info from CLI arguments (`getDynamicTeamContext()`), synchronously computing the initial teamContext:

```typescript
export function computeInitialTeamContext(): AppState['teamContext'] | undefined {
  const context = getDynamicTeamContext()  // CLI args → dynamicTeamContext
  if (!context?.teamName || !context?.agentName) return undefined

  const teamFile = readTeamFile(teamName)
  const isLeader = !agentId  // No agentId means Leader

  return {
    teamName, teamFilePath,
    leadAgentId: teamFile.leadAgentId,
    selfAgentId: agentId,
    selfAgentName: agentName,
    isLeader,
    teammates: {},
  }
}
```

This function is designed to be **synchronous** (note that `readTeamFile` is synchronous I/O) because it is called from `main.tsx` and must complete **before** the first React render. If it were asynchronous, teamContext would be undefined during the first frame, causing a flash.

### Session Recovery

When the user restores a previously interrupted Teammate session, the context is rebuilt from the teamName/agentName stored in the transcript:

```typescript
export function initializeTeammateContextFromSession(
  setAppState, teamName, agentName
): void {
  const teamFile = readTeamFile(teamName)
  const member = teamFile.members.find(m => m.name === agentName)
  setAppState(prev => ({
    ...prev,
    teamContext: {
      teamName, teamFilePath,
      leadAgentId: teamFile.leadAgentId,
      selfAgentId: member?.agentId,
      selfAgentName: agentName,
      isLeader: false,
      teammates: {},
    },
  }))
}
```

If the member has already been removed from the team file (for example, because the Leader cleaned up the team), the code does not crash—it simply logs a debug message and continues.

---

## Real-World Memory Case Study

```typescript
// types.ts comment
// BQ analysis (round 9, 2026-03-20) showed ~20MB RSS per agent at 500+ turn sessions
// and ~125MB per concurrent agent in swarm bursts.
// Whale session 9a990de8 launched 292 agents in 2 minutes and reached 36.8GB.
// The dominant cost is this array holding a second full copy of every message.
```

This is why `TEAMMATE_MESSAGES_UI_CAP = 50` exists—the UI retains only the latest 50 messages per Teammate. The full conversation history lives in the `allMessages` local variable (inside inProcessRunner's while loop), and disk transcripts in JSONL format serve as persistent backups.

Number breakdown:
- **20MB / agent**: Resident memory (RSS) per agent at 500-turn conversations
- **125MB / agent**: Memory per agent during concurrent swarm bursts (higher because GC cannot keep up)
- **292 agents**: a user actually launched this many agents within 2 minutes
- **36.8GB**: Peak RSS, enough to exhaust most developer machines

Solutions besides the UI cap (50 messages) include:
- Clearing Leader messages before passing to Teammate (the `messages: []` mentioned earlier)
- Resetting contentReplacementState during context compaction
- Retaining only the final message on completion/failure: `messages: task.messages?.length ? [task.messages.at(-1)!] : undefined`

This is a classic "new feature brings new scale problems" scenario: nobody expected a user to launch 292 agents in 2 minutes, but the system must handle it.

---

## Full Lifecycle Panorama

Putting all the components together, the complete lifecycle of an in-process Teammate is:

```
1. Leader calls TeamCreateTool
   → registry.ts detects available backend
   → InProcessBackend.spawn() calls spawnInProcessTeammate()
   → Create TeammateContext (AsyncLocalStorage)
   → Create independent AbortController
   → Register in AppState.tasks
   → Register Perfetto tracing

2. InProcessBackend.spawn() continues
   → startInProcessTeammate() launches execution loop (fire-and-forget)
   → runInProcessTeammate() enters while loop

3. Each loop iteration:
   → Create per-turn AbortController
   → Check if context compaction is needed
   → runWithTeammateContext() isolates context
     → runWithAgentContext() sets analysis context
       → runAgent() executes normal agent loop
         → When permission needed, routes to Leader via createInProcessCanUseTool()
   → Update progress, collect messages
   → Mark as idle
   → sendIdleNotification() notifies Leader

4. Wait for next instruction:
   → waitForNextPromptOrShutdown() polls
     → Check pendingUserMessages
     → Check file-system mailbox (priority: shutdown > leader > peer)
     → Check shared task list

5. Termination:
   → terminate(): send shutdown request → Teammate decides whether to exit
   → kill(): directly abort AbortController → update status to 'killed'
   → Normal completion: loop exits → update status to 'completed'
   → All paths lead to: cleanup Perfetto, evict task, emit SDK event
```

---

## Cross-Instance Plan Mode Support

Each Teammate can be independently configured with `planModeRequired`. Once set, that Teammate must enter Plan mode (read-only analysis) first and receive Leader approval before beginning implementation.

```
PLAN_MODE_REQUIRED_ENV_VAR = 'CLAUDE_CODE_PLAN_MODE_REQUIRED'
```

This variable is set when generating the Teammate process, ensuring the Teammate knows from startup that it must go through a Plan phase first. In in-process mode, `planModeRequired` is stored directly in `TeammateIdentity`:

```typescript
permissionMode: planModeRequired ? 'plan' : 'default',
```

A Teammate in Plan mode will not skip permission checks even if the Leader is in `bypassPermissions` mode—this is the "plan mode safety first" design mentioned earlier.

---

## Code Landmarks

- `src/utils/swarm/inProcessRunner.ts`, 1,552 lines: Core engine of the Teammate execution loop
  - Lines 128-451: `createInProcessCanUseTool()`, 323-line permission-checking logic
  - Lines 883-1534: `runInProcessTeammate()`, main loop
  - Lines 689-868: `waitForNextPromptOrShutdown()`, mailbox polling
- `src/utils/swarm/spawnInProcess.ts`, 328 lines: Teammate creation and teardown
- `src/utils/swarm/leaderPermissionBridge.ts`, 54 lines: Permission bridge between React and non-React code
- `src/utils/swarm/permissionSync.ts`, 928 lines: File-system-based permission request/response synchronization
- `src/utils/swarm/teammateLayoutManager.ts`, 107 lines: UI layout abstraction layer
- `src/utils/swarm/backends/types.ts`, 311 lines: Dual-layer interface definitions for `PaneBackend` + `TeammateExecutor`
- `src/utils/swarm/backends/InProcessBackend.ts`, 339 lines: In-process backend TeammateExecutor implementation
- `src/utils/swarm/backends/TmuxBackend.ts`, 764 lines: Tmux pane management
- `src/utils/swarm/backends/registry.ts`, 464 lines: Backend auto-detection and caching
- `src/utils/swarm/backends/detection.ts`, 128 lines: tmux/iTerm2 environment detection
- `src/utils/swarm/reconnection.ts`, 119 lines: Session reconnection context recovery
- `src/utils/swarm/teammateInit.ts`, 129 lines: Teammate startup hook registration
- `src/utils/swarm/teammateModel.ts`, 10 lines: Default model selection (Opus 4.6)
- `src/utils/swarm/teammatePromptAddendum.ts`, 18 lines: Teammate must use SendMessage tool to communicate
- `src/utils/swarm/spawnUtils.ts`, 146 lines: CLI flag and environment variable propagation
- `src/utils/swarm/constants.ts`, 33 lines: Swarm system constants
- `src/utils/swarm/teamHelpers.ts`, team file read/write and member management
- `src/tasks/InProcessTeammateTask/types.ts`, 121 lines: Complete `InProcessTeammateTaskState` definition + `TEAMMATE_MESSAGES_UI_CAP = 50`

---

## Three Collaboration Channels

The real complexity of multi-agent collaboration lies not in spawning (creating sub-instances) but in **control**—different scenarios require different communication semantics. The system has three fundamentally different collaboration channels:

| Channel | Semantics | Mechanism | Scenario |
|---------|-----------|-----------|----------|
| **pendingMessages real-time injection** | "You're still running; I'm adding instructions" | Directly inject into the running Agent's message queue | Leader adds tasks to a running teammate |
| **Mailbox post-stop recovery** | "You stopped; I'll tell you when you come back" | Write to file-system `.mailbox/` directory; teammate reads on next `waitForNextPromptOrShutdown()` | Teammate processes backlogged messages while idle |
| **SendMessageTool cross-session** | "You're not my teammate, but I have a message for you" | Route via `peerAddress.ts` to `uds:` or `bridge:` execution host | Cross-session communication between independent Claude instances (see Part3 Ch23 Peer/Session discovery layer) |

> 💡 **Plain English**: The first is like speaking face-to-face (real-time), the second is like leaving a sticky note on the desk (asynchronous), and the third is like sending an inter-departmental email (cross-organization). They cannot substitute for one another—you wouldn't email a colleague standing right in front of you, nor would you speak face-to-face to someone at a different company.
