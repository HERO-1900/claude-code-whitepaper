# Agent and Task Systems: A Complete Analysis

The Agent and task system is Claude Code's parallel computing architecture — when Claude needs to "clone itself," it creates truly independent AI instances. From the lifecycle management of a single subagent, to multi-Worker orchestration in Coordinator mode, to progress tracking for asynchronous background tasks, this system transforms a single AI conversation into a distributed work system ("distributed" means breaking a large task into smaller pieces and assigning them to multiple independent workers that execute simultaneously — much like a large company splitting a project across different departments to advance in parallel). This chapter analyzes the complete chain of Agent creation and execution, three isolation models, the ~250-line Coordinator system prompt, and the DreamTask memory consolidation mechanism.

> **Source code locations**: `src/tasks/`, `src/tools/AgentTool/` (14 files), `src/buddy/`

> 💡 **Plain English**: The Agent task system is like a logistics dispatch center — local deliveries are LocalAgents (same-city shipping, shared warehouse), cross-city freight is RemoteAgent (independent warehouse, fully isolated), and nighttime inventory is DreamTask (organizing memory archives when no one is around). The dispatch center (Coordinator) decides which packages go out in parallel and which must be handled sequentially.

### 🌍 Industry Context: Multi-Agent Orchestration in AI Coding Tools

Multi-agent collaboration has been the fastest-evolving competitive frontier in AI tools from 2024–2026. By 2026, the industry has fully shifted to the Agent Swarm paradigm, with significantly different approaches across vendors:

- **Kimi Code**: Implemented the industry's first production-grade **Agent Swarm** — the coordinator can dynamically instantiate ("spin up") **up to 100 isolated, concurrently running subagents**, far exceeding the parallelism of other tools. This is the competing solution closest in philosophy to Claude Code's Coordinator, but with the largest gap in scale.
- **CodeX (OpenAI)**: Version v0.118.0 introduced **parallel multi-agent asynchronous communication** and a mailbox mechanism (Mailbox), supporting unattended CI/CD event-stream remediation. Its underlying Rust rewrite (95.6%) delivers extremely high concurrency performance.
- **Cursor**: Launched **Background Agents** — agents that run refactors in parallel inside cloud VMs and eventually merge via PR. Developers can monitor up to 5 concurrent subtasks simultaneously — a full pivot from single-agent serial execution to cloud-based multi-agent parallelism.
- **Devin**: Introduced **Manage Devins** — the main agent decomposes tasks and instantiates subagents deployed in isolated VMs (Managed Devins), with fine-grained Human-in-the-loop control.
- **Aider**: Still fundamentally a single-agent architecture, but its **Architect mode** achieves reasoning/edit separation via AST-level Repo Map. The community project AiderDesk adds parallel agent capabilities and MCP ecosystem mounting.
- **GitHub Copilot**: Agent Mode is now fully GA, with built-in **Explore, Plan, and Task** dedicated agents that can autonomously interpret intent and iteratively fix code. An enterprise MCP registry supports asynchronous task-stream integration.
- **LangGraph (LangChain)**: Provides a graph-structured agent orchestration framework supporting conditional branching, parallel fan-out, and state sharing. Claude Code's Coordinator prompt directly maps its Research→Synthesis→Implementation→Verification four-stage workflow onto a LangGraph directed graph.
- **AutoGen (Microsoft)**: A multi-agent conversation framework emphasizing message passing between agents and role-based division of labor. Similarities exist with Claude Code's `<task-notification>` message callback mechanism.

Claude Code's Coordinator mode is relatively mature in engineering implementation — the `getCoordinatorSystemPrompt()` function (`coordinatorMode.ts:111-369`) defines detailed orchestration rules through an approximately 250-line template string (including the Continue vs. Spawn decision matrix), placing it on the "heavy prompt" route in the industry. By contrast, frameworks like LangGraph and AutoGen lean toward the "heavy code" route (orchestration logic lives in code rather than the prompt).

---

## Overview

When Claude needs to "clone itself," it is not spinning up a thread in its own mind — it is literally creating an independent AI instance. The Agent and task system is Claude Code's **parallel computing architecture**: from the lifecycle management of a single subagent, to multi-Worker orchestration in Coordinator mode, to progress tracking for asynchronous background tasks — it transforms a single AI conversation into a distributed work system. At its core are an approximately 250-line Coordinator system prompt and a carefully designed isolation model.

---

> **[Chart placeholder 3.10-A]**: Agent lifecycle diagram — the complete chain from `AgentTool.call()` to `runAgent()`

> **[Chart placeholder 3.10-B]**: Coordinator workflow — Research→Synthesis→Implementation→Verification four stages

---

## 1. Agent Creation and Execution

### 1.1 AgentTool Entry Point

`AgentTool.tsx` is the entry point for all subagents. When the model calls it, it provides:

```typescript
// AgentTool.tsx:82-101
baseInputSchema = z.object({
  description: z.string(),      // 3-5 word summary
  prompt: z.string(),           // full task description
  subagent_type: z.string(),    // dedicated agent type (optional)
  model: z.enum(['sonnet','opus','haiku']),  // model override (optional)
  run_in_background: z.boolean()  // background execution (optional)
})
// Multi-agent mode extra params: name, team_name, mode
// Isolation mode: isolation: 'worktree' | 'remote'
// Working directory override: cwd (KAIROS feature gate)
```

### 1.2 The runAgent Core Loop

`runAgent()` (`runAgent.ts:248+`) is an **AsyncGenerator** (an asynchronous generator — a "report as you go" programming pattern where the subagent streams each step's result back to the parent immediately, rather than returning everything at once):

```
AgentTool.call() → runAgent()
  → createAgentId()                    — unique identifier
  → initializeAgentMcpServers()        — connect agent-dedicated MCPs
  → Promise.all([getUserContext(), getSystemContext()])  — fetch context in parallel
  → createSubagentContext()            — build isolated ToolUseContext
  → for await (message of query())     — run main AI loop
      → yield message                  — stream back to parent agent
  → cleanup: MCP connections, worktree, Perfetto trace
```

### 1.3 Agent MCP Servers

`initializeAgentMcpServers()` (`runAgent.ts:95-218`) handles MCP servers dedicated to the agent. There are two reference styles:

- **String reference** (`"server-name"`): looks up an existing configuration and shares the parent connection (memoized result of `connectToServer`)
- **Inline definition** (`{ name: config }`): creates a new connection, cleaned up when the agent ends

**Critical security check — `strictPluginOnlyCustomization`** (`runAgent.ts:117-127`): when an enterprise admin enables `strictPluginOnlyCustomization` to lock down MCPs, the system distinguishes two classes of agents:

- **Admin-trusted agents** (sourced from plugin, built-in, or policySettings): allowed to use MCPs, because their frontmatter MCP configuration is part of the admin-approved security surface.
- **User-defined agents**: completely skipped, unable to connect to any MCP server.

The source comment explains why they are not all rejected:

> Plugin, built-in, and policySettings agents are admin-trusted — their frontmatter MCP is part of the admin-approved surface. Blocking them breaks plugin agents that legitimately need MCP.

The implications of this design are worth contemplating: in an enterprise-locked environment, the capability boundary of user-defined agents is strictly narrowed — they cannot access external APIs, databases, or any service exposed through MCP. This is an explicit trust-tiering model: admin-trusted agents may reach the outside world; user-created agents are limited to built-in tools. This design chooses security over flexibility, which is critical for enterprise deployments — it prevents unapproved agents from exfiltrating code or performing unauthorized operations via MCP servers.

## 2. Isolation Models

### 2.1 Three Levels of Isolation

> 💡 **Why is isolation needed?** If two subagents modify the same file simultaneously, they will overwrite each other's work — like two people drawing on the same whiteboard at the same time. Isolation gives each subagent its own private "workshop."

| Mode | Mechanism | Filesystem | Network | Plain English |
|------|-----------|------------|---------|---------------|
| Default | Shared working directory | Shared | Shared | Colleagues in the same office sharing all files |
| `worktree` | Independent git worktree | Isolated branch | Shared | Separate private offices, but sharing the same network (a worktree is Git's "parallel working directory," letting multiple people work on different branches of the same repo simultaneously) |
| `remote` (ant-only) | CCR remote environment | Fully isolated | Isolated | Working in a branch office in a different city (Anthropic-internal only) |

### 2.2 Context Isolation

`createSubagentContext()` (`forkedAgent.ts`) builds the subagent's execution context:

- **`setAppState` → no-op**: the subagent cannot modify the parent process's UI state
- **`setAppStateForTasks`**: an exception that bypasses the no-op — used for "global infrastructure" operations such as task registration
- **`cloneFileStateCache`**: the subagent receives an independent copy of the file state cache
- **Independent conversation history**: the subagent does not inherit the parent agent's message history (unless via `forkContextMessages`)

### 2.3 The omitClaudeMd Optimization

Explore and Plan agents set `omitClaudeMd: true` — their system context does not include CLAUDE.md content. A comment reveals the scale:

> Omitting this saves roughly **5–15 GTok/week** (5–15 billion tokens per week)

💡 **How big is that number?** A typical user conversation with Claude consumes a few thousand to a few tens of thousands of tokens. Five to fifteen billion tokens is equivalent to hundreds of thousands or even millions of typical conversations — this number reveals the astronomical compute cost of operating Claude Code at scale, and explains why "save wherever possible" optimizations like this matter so much.

## 3. Task Types

### 3.1 Seven TaskTypes

```typescript
type TaskType =
  | 'local_bash'           // subprocess launched by the Bash tool
  | 'local_agent'          // local subagent (default path)
  | 'remote_agent'         // agent in a CCR remote environment
  | 'in_process_teammate'  // in-process teammate (swarm mode)
  | 'local_workflow'       // workflow task
  | 'monitor_mcp'          // MCP monitoring task
  | 'dream'                // background memory consolidation task (see Section 6 DreamTask)
```

### 3.2 Auto-Backgrounding

`getAutoBackgroundMs()` (`AgentTool.tsx:72-77`):

```typescript
function getAutoBackgroundMs(): number {
  if (isEnvTruthy(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) 
      || getFeatureValue_CACHED_MAY_BE_STALE('tengu_auto_background_agents', false)) {
    return 120_000;  // auto-background after 120 seconds
  }
  return 0;
}
```

A foreground agent automatically moves to the background after running for more than 2 minutes — the user does not need to wait for long-running tasks.

## 4. Coordinator Mode

### 4.1 Enabling Conditions

`isCoordinatorMode()` (`coordinatorMode.ts:36-41`): requires the `COORDINATOR_MODE` feature gate plus the `CLAUDE_CODE_COORDINATOR_MODE` environment variable. On session resume, `matchSessionMode()` automatically matches the previous mode.

### 4.2 The Coordinator System Prompt

`getCoordinatorSystemPrompt()` (`coordinatorMode.ts:111-369`) is a 259-line TypeScript function containing roughly 250 lines of template string — this is the Coordinator's **complete orchestration manual**. Note: these 259 lines are TypeScript code (including variable interpolation like `${AGENT_TOOL_NAME}`, conditional logic, and string concatenation); the final plain-text line count sent to the model is slightly lower.

> 📚 **Course Connection (Distributed Systems / Operating Systems)**: Coordinator mode adopts the classic **Master-Worker architecture** — the Coordinator plays the Scheduler, and the Workers play the Executors. The four-stage workflow (Research→Synthesis→Implementation→Verification) is essentially the standard software-engineering "investigate → design → implement → verify" pipeline, structured in the Coordinator's context as parallel task orchestration. The concurrency rule "read-only tasks may run freely in parallel; write tasks on the same file must be serial" is conceptually similar to a database **Readers-Writer Lock** — but a critical difference must be noted: database RW locks are deterministic, code-level mutual-exclusion guarantees, whereas the Coordinator's concurrency control relies entirely on prompt instructions and is therefore probabilistic (dependent on whether the LLM follows the instructions). This "soft constraint" is an inherent characteristic of the heavy-prompt approach.

The orchestration manual returned by this function defines:

**Role Definition** (Section 1):
> You are a **coordinator**. Your job is to help the user achieve their goal, direct workers, synthesize results, and communicate with the user. Answer questions directly when possible — don't delegate work that you can handle without tools.

**Available Tools** (Section 2):
- `Agent` — create a new Worker
- `SendMessage` — continue an existing Worker
- `TaskStop` — stop a Worker

**Worker Result Format** (Section 2): Worker output is returned to the Coordinator as a **user message** in `<task-notification>` XML:

```xml
<task-notification>
  <task-id>{agentId}</task-id>
  <status>completed|failed|killed</status>
  <summary>{status summary}</summary>
  <result>{Agent final text}</result>
  <usage>
    <total_tokens>N</total_tokens>
    <tool_uses>N</tool_uses>
    <duration_ms>N</duration_ms>
  </usage>
</task-notification>
```

**Four-Stage Workflow** (Section 4):

| Stage | Executor | Purpose |
|-------|----------|---------|
| Research | Workers (parallel) | Investigate the codebase and understand the problem |
| Synthesis | **Coordinator** | Read findings, understand the problem, write implementation spec |
| Implementation | Workers | Make precise changes according to the spec |
| Verification | Workers | Verify the changes are effective |

**Concurrency Management Rules**:
- Read-only tasks (research) → free parallelization
- Write tasks (implementation) → serialized for the same file set
- Verification → may run in parallel with implementations touching different file regions

### 4.3 "Never write 'based on your findings'"

The most striking rule in the prompt (`coordinatorMode.ts:259`):

> Never write "based on your findings" or "based on the research." These phrases delegate understanding to the worker instead of doing it yourself. You never hand off understanding to another worker.

This targets a known LLM weakness: **lazy delegation**. Models tend to evade genuine synthesis with a phrase like "based on your findings." This rule forces the Coordinator to understand Worker findings itself before giving the next Worker a precise implementation spec.

### 4.4 Continue vs. Spawn Decision Matrix

The prompt provides a detailed decision matrix (`coordinatorMode.ts:284-293`):

| Scenario | Choice | Rationale |
|----------|--------|-----------|
| Research happens to cover the files that need editing | Continue | Worker already has file context |
| Research is broad but implementation is narrow | Spawn | Avoid exploration noise |
| Fixing a failure or extending recent work | Continue | Worker has error context |
| Verifying code written by another Worker | Spawn | Verifier needs a fresh perspective |
| First implementation used the wrong approach | Spawn | Avoid anchoring effect |

**"Anchoring-Effect Avoidance" — The Most Ingenious LLM Engineering Insight**

The last row of the decision matrix — "first implementation used the wrong approach → Spawn → avoid anchoring effect" — is the most original design insight in the chapter and deserves elaboration.

In cognitive psychology, the **anchoring effect** is the tendency to rely too heavily on the first piece of information encountered. LLMs exhibit similar behavior: after seeing a failed attempt in the context window, the model's attention distribution biases toward the existing code pattern even when that pattern is wrong. This causes "patching" to continue along the wrong path rather than fundamentally changing approach.

The source comment (`coordinatorMode.ts:290`) says:
> Wrong-approach context pollutes the retry; clean slate avoids anchoring on the failed path

By spawning a new Worker, the Coordinator is essentially **combating LLM attention bias at the engineering layer**: the new Worker has a clean context window, unpolluted by previous failed attempts. This reveals a counter-intuitive LLM engineering principle: **sometimes forgetting context is better than keeping it**. In traditional software engineering, more context is always better; but in LLM agent systems, wrong context can be worse than no context.

This principle is valuable for all multi-agent framework designers — it implies that context management is not just about *what to retain*, but equally about *what to discard*.

### 4.5 Scratchpad: Cross-Worker Indirect Communication Mechanism

`getCoordinatorUserContext()` (`coordinatorMode.ts:80-108`): when the `tengu_scratch` gate is enabled, the Coordinator and Workers share a scratchpad directory for durable cross-worker knowledge sharing:

> Workers can read and write here without permission prompts. Use this for durable cross-worker knowledge — structure files however fits the work.

In Claude Code's architecture, Workers cannot communicate directly — all information must be relayed through the Coordinator (star topology). This ensures controllability, but also creates a bottleneck: the Coordinator's context window becomes the sole channel for information transfer.

Scratchpad opens an **indirect communication path that bypasses the Coordinator**. Through the shared filesystem, Worker A can write research findings to a scratchpad file, and Worker B can read it directly during implementation — no Coordinator paraphrasing needed, and no consumption of the Coordinator's context window.

> 💡 **Plain English**: Imagine a project team where all communication must be forwarded by the project manager. Scratchpad is like the office's public whiteboard — team members can write information on it, and others can read it directly without asking the manager to relay every message.

In distributed systems, this corresponds to the classic pattern of **using a shared filesystem as an IPC mechanism**. The prompt deliberately does not prescribe file organization ("structure files however fits the work"), leaving naming conventions and content formats to the LLM's discretion — another hallmark of the heavy-prompt approach: even the IPC protocol is improvised by the LLM.

Notably, this design introduces an open question: what happens if two Workers write the same scratchpad file simultaneously? The prompt offers no conflict-resolution strategy, and filesystem-level last-write-wins semantics could lead to information loss. In practice, because the Coordinator typically staggers write-task scheduling, this issue may rarely arise — but it reveals the inherent risk of "soft constraint" concurrency control.

## 5. Observability Integration

### 5.1 Perfetto Trace

Each agent registers with the Perfetto tracing system when `isPerfettoTracingEnabled()` is true, and unregisters on exit. This allows agent hierarchical relationships to be visualized in Chrome's tracing tools.

### 5.2 Analytics

Key lifecycle events of an agent are logged via `logEvent()`:
- `tengu_coordinator_mode_switched` — mode switch
- Agent creation, completion, failure, and other lifecycle events

### 5.3 Proactive Integration

`AgentTool.tsx:59` reveals an interesting integration:

```typescript
const proactiveModule = feature('PROACTIVE') || feature('KAIROS') 
  ? require('../../proactive/index.js') : null;
```

The PROACTIVE and KAIROS feature gates control some kind of proactive behavior system — likely the agent's autonomous task-discovery capability.

## 6. DreamTask: The Memory Organizer That Works While You Sleep

DreamTask is the most special type in the task system — it **does not execute user requests**, but automatically organizes AI memory in the background.

### 6.1 What Is DreamTask

> 📚 **Course Connection (Operating Systems)**: DreamTask's triggering mechanism (time threshold + session threshold + lock) is highly analogous to **garbage collector** (GC) scheduling strategies in operating systems — GC also triggers background consolidation when specific conditions are met (memory pressure, idle cycles). The file-lock + mtime mechanism as distributed coordination is akin to a simplified **distributed mutual exclusion lock** (a filesystem version of the Redlock algorithm).

🏙 **City metaphor**: If other task types are municipal departments working during the day, DreamTask is the **nighttime archivist** — while you are unaware, it turns scattered notes accumulated across many conversations into an orderly knowledge base.

**Source code**: `src/tasks/DreamTask/DreamTask.ts` (157 lines) + `src/services/autoDream/autoDream.ts`

### 6.2 Triggering Mechanism: Three Thresholds

DreamTask does not run at arbitrary times. It has strict trigger conditions, checked in order of increasing cost (`autoDream.ts`):

| Threshold | Condition | Rationale |
|-----------|-----------|-----------|
| Time gate | ≥ 24 hours since last consolidation | Avoid frequent triggers wasting API calls |
| Session gate | ≥ 5 new sessions since last consolidation | Ensure enough new information is worth consolidating |
| Lock gate | No other process is currently consolidating | Prevent concurrent conflicts |

There is also scan throttling (`SESSION_SCAN_INTERVAL_MS = 10 minutes`): even if the time gate has passed but the session gate has not been met, the scan will not repeat within 10 minutes.

### 6.3 Execution Flow

1. Launch an **isolated sub-AI** via `runForkedAgent()`, using the dedicated `/dream` prompt
2. The sub-AI executes four stages: orient → gather → consolidate → prune
3. DreamTask state transitions from `starting` → `updating` (when the first file edit is detected)
4. The UI displays progress in real time via `addDreamTurn()`, keeping at most the most recent 30 turns (`MAX_TURNS = 30`)
5. Upon completion, a system message is inserted into the chat to notify the user

### 6.4 Security Design

- **Lock mechanism**: `consolidationLock.ts` uses file mtime as a distributed lock; on kill, it rolls back mtime so the next session can retry
- **Excluding current session**: the current session ID is filtered out during scanning, avoiding "consolidating work in progress"
- **Disabled in KAIROS/Remote modes**: not run in KAIROS mode or remote mode, because those scenarios have their own memory management

### 6.5 Why This Matters

DreamTask solves a fundamental problem: **AI memory is fragmented**. Each conversation produces only scattered files (`memory/*.md`), which become chaotic over time. DreamTask periodically merges, deduplicates, and organizes these fragments into coherent knowledge — just like humans consolidate daytime memories during sleep.

## 7. The Orchestration Paradigm Debate: Heavy Prompt vs. Heavy Code

Claude Code's Coordinator chooses a relatively uncommon path in the multi-agent orchestration space: **putting almost all orchestration logic into the prompt rather than writing it in code**. The entire four-stage workflow, Continue vs. Spawn decision matrix, concurrency management rules, and Worker prompt writing guidelines — all are defined in natural language inside a single template string. At the code level there is almost no hardcoded orchestration logic (no state machine, no directed graph, no explicit phase-transition conditions).

> 💡 **Plain English**: Imagine two ways to run a company. The "heavy code" route is like writing a detailed policy manual — every process has explicit approval nodes, conditional branches, and exception handling. The "heavy prompt" route is more like giving a very capable project manager a detailed memo — tell him the principles and examples, and let him judge the specific scheduling himself.

**Comparison of the two approaches**:

| Dimension | Heavy Prompt (Claude Code) | Heavy Code (LangGraph/AutoGen) |
|-----------|---------------------------|-------------------------------|
| Orchestration definition | Natural language prompt | Graph structure / state machine in code |
| Flexibility | Extremely high — LLM can adapt orchestration strategy at runtime based on context | Medium — graph structure is static, conditional branches must be predefined |
| Testability | Low — prompt behavior depends on the LLM, making deterministic tests difficult | High — code paths can be covered by unit tests |
| Traceability | Low — orchestration decisions happen inside the LLM, making it hard to audit "why Continue instead of Spawn" | High — every state transition is recorded in code |
| Version control | Prompt diffs are natural language — reviewers struggle to assess impact | Code diffs have explicit semantics |
| Context cost | ~250 lines of prompt consume context window; in dense orchestration scenarios, the Coordinator's context is quickly filled by `<task-notification>` | Orchestration logic does not consume context window |
| Adaptability | LLM can improvise strategy based on task complexity (e.g., skip Research and go straight to Implement) | All possible paths must be predefined in code |

**Why did Claude Code choose this path?** Several key constraints underlie the choice:

1. **Iteration speed**: prompt changes do not require recompilation and redeployment. Anthropic's Coordinator team can alter orchestration behavior by adjusting natural language — critical for a rapidly iterating product.
2. **Dependence on LLM capability**: Claude Code's underlying models (Claude 3.5 Sonnet/Opus) have strong enough instruction-following ability to make "defining orchestration rules in natural language" feasible. If the base model were weaker at instruction following, this route would not work.
3. **Task diversity**: Programming tasks span enormous complexity — from "fix a typo" to "refactor an entire module." A code-defined directed graph struggles to cover all possible task patterns, whereas an LLM can improvise orchestration strategy based on the specific characteristics of the task.

**Possibility of a hybrid approach**: these two routes are not mutually exclusive. A theoretically better approach would use **code for deterministic scheduling logic** (e.g., concurrency control — the same file set cannot have two Workers writing simultaneously) and **prompt for judgment-based decisions** (e.g., Continue vs. Spawn). Currently Claude Code puts both in the prompt — including concurrency control rules that should arguably be deterministic. This means the system's correctness depends to some extent on the LLM's adherence to instructions, a risk worth noting.

---

## 8. Design Trade-offs and Assessment

**Strengths**:
1. The AsyncGenerator pattern makes agent output **observable in real time** — the parent agent can see the subagent's progress as it happens
2. The Coordinator prompt's "Never hand off understanding" rule is an effective countermeasure against a known LLM weakness — similar anti-lazy-delegation designs appear in other frameworks (e.g., AutoGen's "GroupChatManager" requires the summarizer to understand rather than paraphrase)
3. `<task-notification>` XML disguised as a user message — unifies input format while supporting multi-agent communication
4. The Continue vs. Spawn decision matrix gives the model clear branch criteria
5. The `omitClaudeMd` optimization for read-only agents shows the team cares about token economics at the system level
6. The three-tier isolation model (shared → worktree → remote) covers all scenarios from simple to secure

**Costs**:
1. The ~250-line prompt essentially places "architecture logic inside the prompt" — difficult to test and difficult to trace the reason for changes (detailed analysis in Section 7)
2. `setAppState` no-op + `setAppStateForTasks` bypass is a **controlled leak** — each usage point needs audit
3. Workers cannot see the Coordinator's conversation, meaning every spawn requires full context reconstruction
4. The `dream` TaskType's four-stage structure is entirely prompt-controlled — at the code level only the coarse-grained `starting` and `updating` phases are distinguished
5. The auto-background 120-second threshold is hardcoded — different task types might need different thresholds

---

*Quality self-check:*
- [x] Coverage: Agent lifecycle + isolation model + 7 TaskTypes + Coordinator system prompt + observability
- [x] Fidelity: Coordinator prompt quotes come entirely from the actual content of `coordinatorMode.ts`
- [x] Depth: analysis of the "anti-lazy-delegation" rule as an LLM weakness, Continue vs. Spawn decision matrix
- [x] Critical: points out the fragility of using prompts as architecture, hardcoded auto-background threshold
