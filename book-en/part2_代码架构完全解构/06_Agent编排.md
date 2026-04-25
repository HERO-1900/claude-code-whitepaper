# Doppelgänger: Agent Orchestration and Multi-Instance Coordination

When a single Claude instance is no longer enough, the system can "clone" sub-agents to work in parallel. This chapter dissects the creation mechanisms, resource isolation strategies, and Scratchpad communication patterns of the three Agent types (Task, Forked, and Coordinator), revealing the engineering challenges of distributed AI collaboration.

---

## Prologue: From Solo Studio to Company

Running a restaurant alone means buying groceries, cooking, serving, and cashiering all by yourself—low efficiency but simple. As business picks up, you hire chefs, waiters, and cashiers—higher efficiency, but now you need **management**: who does what, how to coordinate, and who to blame when things go wrong.

Claude Code started as "one person doing everything." But Anthropic's team soon realized some tasks were too large, too slow, or too independent for a single AI instance to handle. So they introduced a **multi-agent architecture**—one Claude can "clone" itself into multiple Claudes working in parallel.

But "cloning" brings all the classic problems of distributed systems: resource isolation, task communication, failure handling, and lifecycle management. How does Claude Code solve them? The answer is a meticulously designed **Agent orchestration system**.

> 🌍 **Industry Context: The Multi-Agent Orchestration Landscape in 2025–2026**
>
> Multi-agent collaboration is not a new concept—it has decades of academic history (from distributed AI in the 1980s to Multi-Agent Systems research in the 2000s). In 2026, as large language model capabilities crossed a critical threshold, multi-agent frameworks have moved from experimental deployments to production-grade "Agent Swarm" implementations:
>
> | Framework/Product | Orchestration Model | Core Design Philosophy |
> |-----------|---------|-------------|
> | **CrewAI** | Role-Based | Each agent has a role, goal, and backstory; agents collaborate through defined "workflows" |
> | **AutoGen** (Microsoft) | Conversation-Based | Agents collaborate through multi-round conversations; emphasizes "programmable conversation" paradigm |
> | **OpenAI Swarm** | Handoff-Based | Lightweight framework where agents explicitly transfer control via `handoff()`; emphasizes simplicity and predictability |
> | **Cursor Agent** | Background Agents | Fully pivoted in late 2025: cloud VMs clone codebases, multiple agents execute refactors in parallel and merge as PRs, supporting 5 concurrent subtasks |
> | **Kimi Code** | Agent Swarm | Based on K2.5 1T MoE model; coordinator can dynamically instantiate up to 100 isolated concurrent sub-agents, highest parallelism in the industry |
> | **CodeX (OpenAI)** | Parallel Multi-Agent Async Communication | v0.118.0 introduced mailbox communication mechanism for async multi-background-process interaction; underlying Rust rewrite (95.6%) |
> | **Devin** | Manage Devins (Multi-tier Management) | Abandoned pure autonomy route; main agent decomposes tasks into multiple isolated VM sub-agents, with human-in-the-loop fine control |
> | **GLM (Z.ai)** | Z Code Platform (Complex Systems Engineering Engine) | 744B parameter GLM-5.1 trained on domestic Ascend 910B chips; built-in localized knowledge base retrieval engine for private deployment in restricted network environments |
> | **Claude Code** | Coordinator-Worker Model | Main agent decomposes tasks → workers execute in parallel → results aggregated; three-level isolation guarantees safety |
>
> Claude Code's uniqueness **does not lie in inventing multi-agent orchestration**—CrewAI and AutoGen systematized this paradigm earlier. Its contribution is twofold:
> 1. **Fine-grained isolation levels**: Three isolation modes (in_process / local_agent / remote_agent) provide a full spectrum from "shared memory" to "complete isolation," which is rare among peers
> 2. **Deep integration into the developer toolchain**: Not a generic agent framework, but meticulously optimized for the specific scenario of "code development" (agent specialization, worktree isolation, shared MCP connections, etc.)
>
> In short: CrewAI and AutoGen are generic multi-agent "operating systems"; Claude Code is a deeply vertical multi-agent "application."

> **🔑 OS Analogy:** The Agent system is like **project management** in a company. Agent = employee, Coordinator = project manager, Scratchpad = team shared document (like a Lark doc), Task Notification = work group chat message.
>
> 💡 **Plain English**: Agent orchestration is like a **food delivery platform's dispatch system**—the main Claude is the dispatch center, and each agent is a delivery rider handling different orders independently. Coordinator mode is when the dispatch center upgrades to a "station manager"—they don't deliver food themselves, only assign orders, track progress, and aggregate feedback. The Scratchpad is a shared message board where riders report traffic conditions to each other.

---

## 1. Seven "Process" Types

`Task.ts` defines seven task types—each corresponding to a different execution model:

| Type | Meaning | Isolation Level | Execution Location |
|------|------|---------|---------|
| `local_agent` | Local sub-agent | Independent message history + shared process | Local machine |
| `local_bash` | Bash subprocess | Independent process | Local machine |
| `remote_agent` | Remote agent | Complete isolation | Remote machine |
| `in_process_teammate` | In-process teammate | Shared process + independent messages | Local machine |
| `local_workflow` | Local workflow | — | Local machine |
| `monitor_mcp` | MCP monitor | — | Local machine |
| `dream` | Dream mode | — | Unconfirmed |

**Three Isolation Modes**:

```
┌─── Lightest isolation: in_process_teammate ──────────────┐
│  Shared process memory                                    │
│  Shared MCP connections                                   │
│  Independent message history                              │
│  Communication via Task Notification                      │
└───────────────────────────────────────────────────────────┘

┌─── Medium isolation: local_agent ─────────────────────────┐
│  Independent message history                              │
│  Independent permission context                           │
│  Shared process (optional independent worktree)           │
│  Optional CLAUDE.md loading                               │
└───────────────────────────────────────────────────────────┘

┌─── Complete isolation: remote_agent ──────────────────────┐
│  Independent process                                      │
│  Independent machine                                      │
│  Communication via Bridge protocol                        │
└───────────────────────────────────────────────────────────┘
```

> **🔑 OS Analogy:** `in_process_teammate` is like a colleague in the same office (sharing the desk and filing cabinet); `local_agent` is like a different department in the same building (each has their own office but shares building facilities); `remote_agent` is like an outsourced company (completely separate office location).

> 📚 **Course Connection:** The three isolation levels precisely correspond to three layers of containerization technology: `in_process_teammate` = **thread-level isolation** (shared address space, like multiple threads in one process); `local_agent` = **namespace-level isolation** (Docker container—independent file system and permissions, but shared kernel); `remote_agent` = **VM-level isolation** (completely independent virtual machine, communicating through network protocols). The stronger the isolation, the higher the security, but the greater the communication overhead—this is the classic trade-off of distributed systems.

---

## 2. Agent Lifecycle

### 2.1 Creation (fork)

When the AI calls the `Agent` tool:

```
AgentTool.call()
  → Parse parameters (prompt, model, isolation, cwd)
  → Initialize MCP servers (reuse existing + create new)
  → Build sub-agent queryLoop parameters
  → Start AsyncGenerator (sub-loop begins beating)
  → Parent agent continues working (non-blocking)
```

**Key Parameters**:

| Parameter | Purpose | Default |
|------|------|--------|
| `prompt` | Sub-agent's task description | Required |
| `model` | Model to use | Inherited from parent |
| `isolation` | Isolation mode (`worktree`) | None (shared working directory) |
| `cwd` | Working directory | Inherited from parent |
| `subagent_type` | Agent type (Explore/Plan/verification/claude-code-guide/statusline-setup/general-purpose) | general-purpose |

### 2.2 `omitClaudeMd`: Saving Tokens for Read-Only Agents

`Explore` (code search) and `Plan` (design) type agents are both read-only—they don't modify files. For both agent types, the system sets `omitClaudeMd=true`, skipping CLAUDE.md loading.

**Why**: CLAUDE.md can be thousands of tokens. If a task needs to launch 5 parallel read-only agents, and each loads CLAUDE.md, that's 5x token waste. The team estimates this optimization **saves 5–15 GTok (billion tokens) per week** (this figure comes from source code comments, reflecting Anthropic's internal estimate at global user scale). The Plan Agent's comment further explains: "Plan is read-only and can Read CLAUDE.md directly if it needs conventions"—it doesn't need conventions preloaded, but can still read them manually when necessary.

**Analogy**: When sending a courier to deliver a letter, you don't need to give them the complete company handbook. Just tell them the address.

> 📚 **Course Connection:** The essence of the `omitClaudeMd` optimization is analogous to **Link-Time Optimization (LTO)** in compilers. LTO's core idea is that not every compilation unit needs the full symbol table; the linker prunes unused code in the final stage. Similarly, `omitClaudeMd` prunes "context that this agent doesn't need" at agent startup—an Explore Agent doesn't modify files, so code conventions and commit guidelines in CLAUDE.md are useless to it. This is a form of **prompt-level dead code elimination**.

### 2.3 In-Flight Communication

How does an agent communicate with its parent while running?

**Downstream communication** (parent → child): Via the `SendMessage` tool sending follow-up instructions.

**Upstream communication** (child → parent): Via Task Notification XML format:

```xml
<task-notification task-id="abc123" status="completed">
  Sub-agent has completed the task. Results are as follows:
  ...
</task-notification>
```

This XML is injected into the parent agent's message history as a "user message"—from the parent agent's perspective, "the user told me the sub-agent finished."

**Lateral communication** (child ↔ child): Via the **Scratchpad** (`tengu_scratch`)—a shared file that all agents can read and write. This is the only shared state between agents.

### 2.4 Auto-Backgrounding

`getAutoBackgroundMs()` is **not unconditionally enabled**. It only returns 120,000ms (2 minutes) when the environment variable `CLAUDE_AUTO_BACKGROUND_TASKS` is truthy, or the GrowthBook feature gate `tengu_auto_background_agents` is on—after which the sub-agent automatically switches to background execution, no longer blocking the parent. Otherwise it returns 0 (auto-backgrounding disabled). This means the feature may be off in most user environments and requires explicit enablement.

### 2.5 Termination

An agent can be terminated by:
- Natural completion (`queryLoop` returns `stop`)
- Parent agent calling `TaskStop`
- Reaching the `max_turns` limit
- User Ctrl+C interrupt

---

## 3. Coordinator Mode: The Cluster Scheduler

When `CLAUDE_CODE_COORDINATOR_MODE=1` is set, the main Claude instance becomes a **Coordinator**—it doesn't do tasks directly, but assigns them to **Workers** (sub-agents) and synthesizes their results.

> 📚 **Course Connection:** The Coordinator-Worker pattern is essentially the **process scheduler + IPC (inter-process communication)** in operating systems. The Coordinator is the scheduler—deciding which worker executes what task, when to start, and when to terminate; workers communicate via Task Notifications (like signals/pipes) and Scratchpad (like shared memory). If you've studied the `fork()` + `wait()` + `pipe()` combo in OS courses, Coordinator mode is its AI-era equivalent.

### 3.1 The Coordinator's ~250-Line System Prompt

`coordinatorMode.ts` is 369 lines total (including imports/exports/helpers), with `getCoordinatorSystemPrompt()` taking up roughly 250 lines—a system prompt built from TypeScript template strings that defines Coordinator behavior. Among the most interesting rules:

**Anti-Lazy-Delegation Rule**:
> "Never write 'based on your findings, fix the bug' or 'based on the research, implement it.' Those phrases push synthesis onto the agent instead of doing it yourself."

This tells the Coordinator: you are a manager, not an absentee owner. You cannot push the "understand the problem" work onto workers—you must understand it yourself, then give precise instructions.

**Continue vs. Spawn Decision Matrix**:

| Scenario | Choice | Rationale |
|------|------|------|
| Need to continue from previous result | Continue (SendMessage) | Reuse existing context |
| Brand new independent subtask | Spawn (Agent) | Independent context, avoids pollution |
| Multiple independent subtasks need parallelism | Spawn × N | Exploit concurrency |
| A task failed and needs retry | Spawn (new one) | Clean retry, avoids error-context influence |

**Four-Stage Workflow** (Section 4 "Task Workflow" as defined in source):
1. **Research**: Workers explore the codebase in parallel, investigate the problem, gather information
2. **Synthesis**: **The Coordinator itself** reads worker findings, understands the problem, and formulates a concrete implementation spec
3. **Implementation**: Workers execute modifications and commits according to the Coordinator's precise spec
4. **Verification**: Workers verify correctness—run tests, type checks, adversarial probes

### 3.2 Scratchpad: The Shared Whiteboard

The Coordinator and workers share a file (Scratchpad) for recording:
- Global context (project background, known constraints)
- Task assignments and progress of each worker
- Cross-worker discoveries that need to be shared

> **🔑 OS Analogy:** The Scratchpad is like a team's **shared whiteboard**—any member can write on it and read what others have written, with information visible in real time.

> 📚 **Course Connection:** The Scratchpad is essentially a **lock-free shared memory segment**. In distributed systems courses, this corresponds to the "shared-state consistency" problem. Claude Code chooses the simplest solution: single file + full read/write operations (no incremental updates). This implicitly adopts a Last-Writer-Wins (LWW) consistency strategy—similar to LWW-Registers in CRDTs. The benefit is zero coordination overhead; the cost is potential loss of intermediate state during concurrent writes. For AI agent collaboration (low write frequency, low conflict probability), this trade-off is reasonable.

---

## 4. Swarm Mode: The Real Cluster

Swarm mode goes further than Coordinator—multiple Claude Code **instances** run in different terminals, coordinated through the Teammate mechanism.

### 4.1 Three Backends

| Backend | Implementation | Use Case |
|------|------|---------|
| tmux | One tmux pane per teammate | Linux/macOS terminal |
| iTerm2 | One iTerm2 tab per teammate | macOS |
| in-process | All teammates in the same process | Performance-sensitive scenarios |

### 4.2 The Real Bug: 292 Teammates

A code comment documents a real incident: during one test, 292 teammates launched within 2 minutes, total RSS reached 36.8GB, and the system crashed. This led to the introduction of the `TEAMMATE_MESSAGES_UI_CAP=50` limit.

**What this bug illustrates**: Resource management in multi-agent systems is not a later optimization—it's a core design issue. An unbounded `fork()` loop (a fork bomb) can bring any operating system to its knees.

---

## 5. Agent Specialization

Not all agents are the same. The system predefines several specialized agent types:

| Type | Tool Control Method | Purpose |
|------|--------|------|
| `general-purpose` | All tools | General tasks |
| `Explore` | `disallowedTools` blacklist: disables Agent/ExitPlanMode/FileEdit/FileWrite/NotebookEdit | Code search and research |
| `Plan` | `disallowedTools` blacklist: same as Explore (blocks all write tools) | Design plans |
| `verification` | `disallowedTools` blacklist: disables Agent/ExitPlanMode/FileEdit/FileWrite/NotebookEdit | Adversarial verification—"try to break it, not confirm it works" |
| `statusline-setup` | `tools` whitelist: Read + Edit | Configure status line |
| `claude-code-guide` | `tools` whitelist: Glob/Grep/Read/WebFetch/WebSearch | Answer Claude Code usage questions |

**Two Tool Control Methods**: The system supports `tools` (whitelist—only listed tools allowed) and `disallowedTools` (blacklist—listed tools forbidden, rest allowed). Explore/Plan/verification use blacklists to exclude write tools; claude-code-guide/statusline-setup use whitelists to expose only necessary tools. The advantage of blacklist mode: when new tools are added to the system, the agent automatically gains permission without needing individual updates.

**Why Specialize**:
1. **Security**: Explore agents cannot modify files—even if the AI "wants" to, FileEdit/FileWrite are on the `disallowedTools` blacklist and the call will be rejected
2. **Performance**: Smaller toolset means fewer tool schemas in the system prompt, saving tokens
3. **Prompt Precision**: A specialized agent's system prompt can be more targeted—"you are an agent that only searches" is easier for the AI to follow than "you can do anything"
4. **Adversarial Design**: The verification agent's system prompt is ~130 lines, specifically designed to counteract LLM "verification avoidance" tendencies—it explicitly lists common lazy excuses ("The code looks correct based on my reading"), requires every check to have actual command execution output, and reading code alone doesn't count as PASS

> **🔑 OS Analogy:** This is like **badge access control** in a company—you don't give every employee a master key, but precisely grant the permissions they need: finance can enter the finance room, engineers can enter the server room, visitors can only enter the lobby. Principle of least privilege.

### 5.1 Deep Dive: The Verification Agent's 130-Line Adversarial Prompt

> 💡 **Plain English**: If other agents are like "engineers" in a company—responsible for getting things done—then the Verification Agent is more like a "quality inspector"—specifically tasked with finding flaws. And not just any inspector, but one who **will catch you slacking off**.

The Verification Agent's system prompt (`verificationAgent.ts`) is one of the most unique prompt designs in all of Claude Code. It doesn't simply say "please verify the code is correct"; it's a complete **anti-laziness engineering** system—because LLMs naturally tend to avoid real verification by "reading the code and saying everything looks fine."

**Opening Tone—Role is "Breaker," Not "Confirmer":**

> *"Your job is not to confirm the implementation works — it's to try to break it."*

**Two Known Failure Modes** (behavioral patterns Anthropic distilled from real usage):

> *"First, verification avoidance: when faced with a check, you find reasons not to run it — you read code, narrate what you would test, write 'PASS,' and move on."*

> *"Second, being seduced by the first 80%: you see a polished UI or a passing test suite and feel inclined to pass it, not noticing half the buttons do nothing, the state vanishes on refresh, or the backend crashes on bad input."*

**6-Item "Lazy Excuse" Recognition Checklist**—making the AI recognize its own rationalization tendencies:

| Excuse | Original Text | Correct Action |
|------|------|---------|
| "The code looks correct" | *"The code looks correct based on my reading"* | Reading is not verification. Run it. |
| "Tests already pass" | *"The implementer's tests already pass"* | The implementer is also an LLM. Verify independently. |
| "This is probably fine" | *"This is probably fine"* | "Probably" is not "verified." Run it. |
| "Let me check the code first" | *"Let me start the server and check the code"* | No. Start the server and hit the endpoint. |
| "I don't have a browser" | *"I don't have a browser"* | Have you checked for MCP browser tools? |
| "This would take too long" | *"This would take too long"* | Not your call to make. |

**Validation Strategy by Change Type**—covering 11 scenarios (frontend/backend/cli/infrastructure/library/bugfix/mobile/data-pipeline/db-migration/refactor/other), each with concrete verification steps. For example:

- **Frontend change**: *"Start dev server → check your tools for browser automation → curl a sample of page subresources (image-optimizer URLs) since HTML can serve 200 while everything it references fails"*
- **Bug fix**: *"Reproduce the original bug → verify fix → run regression tests → check related functionality for side effects"*

**Adversarial Probe Checklist**:

> *"Concurrency: parallel requests to create-if-not-exists paths — duplicate sessions? lost writes?"*
> *"Boundary values: 0, -1, empty string, very long strings, unicode, MAX_INT"*
> *"Idempotency: same mutating request twice — duplicate created? error? correct no-op?"*

**Mandatory Output Format**—every check must include the actual command executed and its output; "I read the code" style PASS is not accepted:

```
### Check: [what you're verifying]
**Command run:**     [exact command executed]
**Output observed:** [actual terminal output — copy-paste, not paraphrased]
**Result: PASS** (or FAIL — with Expected vs Actual)
```

The prompt ends with a machine-parseable fixed format: `VERDICT: PASS` or `VERDICT: FAIL` or `VERDICT: PARTIAL`.

The engineering value of this design is: **it's not telling the AI "be careful"—it's telling the AI "here's how you'll be lazy, and why that's wrong."** This is "metacognitive prompt engineering"—making the AI explicitly aware of its own cognitive biases.

---

## 6. MCP Server Sharing Between Agents

`runAgent.ts:95-218` handles MCP server initialization when an agent starts. The rules are:

```
Parent agent's MCP clients
  ├── Already connected clients → child agent reuses directly (shared connection)
  └── Clients needing creation → child agent creates independently
```

**Sharing MCP connections** avoids the overhead of each sub-agent re-establishing connections. But it also means a sub-agent's MCP operations may affect the parent agent's connection state.

**`strictPluginOnlyCustomization` check** (lines 117-127): If enterprise policy has strict plugin control enabled, the child agent can only use policy-allowed MCP servers—even if the parent agent has more MCP connections.

---

## 7. Competitive Comparison: Agent Orchestration Models

Multi-agent orchestration wasn't invented by Claude Code; it's a shared direction of AI engineering in 2025. The following comparison focuses on **design differences in the orchestration model itself**:

| Dimension | Claude Code (Coordinator-Worker) | CrewAI (Role-Based) | AutoGen (Conversation-Based) | OpenAI Swarm (Handoff-Based) |
|------|------|------|------|------|
| **Scheduling** | Centralized: Coordinator assigns tasks | Centralized: workflow defines execution order | Decentralized: agents autonomously converse | Semi-centralized: agents explicitly handoff |
| **Agent Specialization** | Hard isolation at toolset level (six built-in types: Explore/Plan/verification/claude-code-guide/statusline-setup/general-purpose) | Soft isolation at role-description level (relying on prompt differentiation) | No built-in specialization mechanism | No built-in specialization mechanism |
| **Resource Isolation** | Three-level isolation (in-process/local/remote) | No isolation (same process) | No isolation (same process) | No isolation (same process) |
| **Communication** | Task Notification + Scratchpad file | Task output as next agent's input | Multi-round message passing | Function return values + context variables |
| **Concurrency** | Native support (multiple workers in parallel) | Limited (Sequential/Hierarchical) | Limited (mainly serial conversation) | No native concurrency |
| **Guardrails** | Anti-lazy-delegation rule, resource caps, permission isolation | Depends on user definition | Depends on user definition | Minimalist design, no built-in guards |

**Key Insights**:

- **Claude Code's core advantage is isolation granularity**. CrewAI, AutoGen, and Swarm agents all run in the same process with no real resource isolation. Claude Code's three-level isolation design (especially worktree-level file system isolation) achieves finer-grained resource isolation than known open-source agent frameworks
- **Claude Code's core weakness is generality**. It's a system deeply optimized for "code development," not a general agent framework. You wouldn't use it to orchestrate customer-service agents or data-analysis agents—where CrewAI and AutoGen excel
- **Swarm goes to the opposite extreme**. OpenAI's Swarm deliberately pursues minimalism (single file, no state management, no concurrency), reading more like a teaching example than a production system. Claude Code and Swarm represent two extremes of agent orchestration: maximum flexibility vs. maximum simplicity

---

## 8. Design Trade-offs

### Strengths

Note: The following evaluations are relative to Claude Code's own design goals (a multi-agent coding assistant), not claims of industry-first inventions.

1. **Seven task types** cover the full spectrum from lightweight (`in_process_teammate`) to heavyweight (`remote_agent`)—not "one size fits all." This granularity of isolation is rare among coding tools
2. **The Coordinator's ~250-line prompt** proves Anthropic treats multi-agent as a first-class citizen—not simply "call an API to spawn a sub-instance"
3. **The anti-lazy-delegation rule** is a practical discovery in LLM engineering—AI managers have the same "passing the buck" tendency as human managers, and need to be explicitly prohibited in the prompt. This lesson is valuable for all multi-agent framework developers
4. **`omitClaudeMd` saves an estimated 5–15 GTok per week**—this optimization comes from real-world observation of agent call volumes, not theoretical estimation
5. **Agent specialization** (Explore/Plan/verification/general-purpose, etc.) implements the principle of least privilege—each agent has only the capabilities it needs
6. **CacheSafeParams mechanism** ensures sub-agents share the parent agent's prompt cache—by passing identical systemPrompt, userContext, systemContext, toolUseContext, and parent conversation context (`forkContextMessages`), the sub-agent's API request can hit the parent agent's cache, dramatically reducing redundant token consumption
7. **Forked sub-agents inherit the parent agent's full conversation context**—`initialMessages` is assembled from `forkContextMessages` (parent conversation history) + `promptMessages` (new task). The sub-agent doesn't start from zero, but builds on the parent agent's existing knowledge
8. **120-second auto-backgrounding** (requires env var or feature gate) balances "waiting for results" and "not being blocked"—most subtasks finish within 2 minutes; those that exceed it auto-background

### Costs and Limitations

However, the complexity of the multi-agent architecture also brings significant risks:

1. **Complexity of seven task types**—developers need to understand each type's isolation semantics, communication style, and resource constraints
2. **The Scratchpad is a lock-free shared file**—concurrent writes may cause data loss (though probability is low in practice)
3. **Coordinator prompt relies on AI compliance**—"don't be lazy and delegate" is a *suggestion*, not an *enforcement* mechanism
4. **The 292-teammate bug** shows the system lacks global resource limits—currently there's only the UI-level `TEAMMATE_MESSAGES_UI_CAP`, with no kernel-level process count limit
5. **MCP connection sharing** increases implicit dependency of sub-agents on the parent agent—the parent agent exiting first may cause sub-agent MCP calls to fail
6. **Single-user boundary**—CC's multi-agent orchestration is designed entirely around single-user scenarios; an agent's context and output cannot be shared among team members. The community has already begun filling this gap: @jiayuan_jy's Multica project (950 likes, 310K views) makes agents "first-class citizens" in a team task board—assigning issues to agents just like assigning them to coworkers, with execution status visible to everyone in real time. This points to the natural evolution of multi-agent architecture from "solo doppelgänger" to "team collaboration infrastructure"

---

## 9. Code Locations

Here are the precise source locations for the key concepts in this chapter:

| Concept | File | Line | Description |
|------|------|------|------|
| Seven TaskTypes | `src/Task.ts` | :6-13 | `local_bash`, `local_agent`, `remote_agent`, `in_process_teammate`, `local_workflow`, `monitor_mcp`, `dream` |
| Task ID generation | `src/Task.ts` | :78-106 | Prefix + 8-digit base36 random ID (`36^8 ≈ 2.8 trillion`), brute-force resistant |
| Sub-agent runner | `src/utils/forkedAgent.ts` | :489 | `runForkedAgent()`—builds CacheSafeParams to ensure sub-agent shares parent agent's prompt cache |
| Sub-agent context isolation | `src/utils/forkedAgent.ts` | :345 | `createSubagentContext()`—clones readFileState, denialTrackingState, isolating mutable state |
| Coordinator system prompt | `src/coordinator/coordinatorMode.ts` | :111-369 | `getCoordinatorSystemPrompt()`—file is 369 lines total, function body is ~250 lines of system prompt (including TypeScript concatenation logic) |
| Coordinator worker context | `src/coordinator/coordinatorMode.ts` | :80-108 | `getCoordinatorUserContext()`—injects worker available tool list and Scratchpad path |
| Verification Agent | `src/tools/AgentTool/built-in/verificationAgent.ts` | Full file | ~130-line adversarial verification prompt, including failure mode recognition, excuse checklist, VERDICT output format |
| CacheSafeParams | `src/utils/forkedAgent.ts` | :57-68 | Key parameter set for sub-agent sharing parent agent's prompt cache (systemPrompt/userContext/systemContext/toolUseContext/forkContextMessages) |
| Auto-backgrounding condition | `src/tools/AgentTool/AgentTool.tsx` | :72-77 | `getAutoBackgroundMs()`—only returns 120000 when env var or feature gate is enabled |

---

> **[Chart placeholder 2.6-A]**: Spectrum of isolation levels for seven task types—from in_process_teammate to remote_agent
> **[Chart placeholder 2.6-B]**: Coordinator four-stage workflow sequence diagram—Research→Synthesis→Implementation→Verification
> **[Chart placeholder 2.6-C]**: Agent communication topology diagram—downstream/upstream/lateral three communication paths
> **[Chart placeholder 2.6-D]**: Agent specialization toolset matrix—available tools for each agent type
