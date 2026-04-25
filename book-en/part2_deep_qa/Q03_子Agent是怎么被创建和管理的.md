# How Are Sub-Agents Created and Managed?

Sub-agents are not simply reused API calls—they are complete Claude instances with independent message histories, toolsets, and permission contexts. This section disassembles the creation, communication, and lifecycle management of sub-agents at the source-code level.

### 🌍 Industry Context: The Evolution of Multi-Agent Architecture in AI Programming Tools

Multi-agent collaboration is the fastest-evolving direction in AI engineering from 2024 to 2026. By 2026, the industry has fully transitioned from "single-agent serial" to "agent swarm and parallel orchestration," with significantly divergent approaches across vendors:

- **Cursor**: Has completely transformed from its early single-machine serial architecture, heavily launching **Background Agents**. For heavy tasks, Cursor creates cloud VM clones consistent with the local codebase state; multiple cloud agents execute refactoring, run tests, and automatically debug errors in parallel, eventually merging changes back to the local branch via pull requests. Developers can monitor up to five concurrent sub-tasks in the background panel.
- **Kimi Code**: Implements the industry's first truly production-deployed **Agent Swarm**. Based on the K2.5 1T MoE model, it introduces a specially reinforced orchestrator. Faced with complex tasks, it can dynamically instantiate **up to 100 isolated concurrent sub-agents**, independently handling file generation, browser retrieval, and local computation. This is currently the highest-concurrency multi-agent implementation.
- **CodeX (OpenAI)**: Version v0.118.0 has shifted from single-threaded responses to "**Parallel Agent Workflows**." It introduces a mailbox communication mechanism allowing different background processes to interact asynchronously. The underlying codex-rs has been completely rewritten in Rust (Rust code accounts for 95.6%).
- **Devin**: Has abandoned unrealistic "fully hands-off human" idealism, launching a core feature called **Manage Devins**—the main agent receives high-level business requirements, decomposes them, and instantiates sub-agents deployed in independent isolated VMs (Managed Devins), paired with deep **human-in-the-loop** fine-grained control.
- **Aider**: Still fundamentally a single-agent architecture, but achieves decoupled responsibilities through the new **Architect mode**—a reasoning-strong Architect model drafts high-level refactoring plans, and a low-cost Editor model executes file reads and writes. The community-led AiderDesk adds parallel agent capabilities and MCP ecosystem mounting to Aider.
- **Cline**: v3.58 introduces a **native sub-agent mechanism**, showing remarkable autonomy in Act mode, capable of traversing the file tree, reading and writing files, and running environment scripts.
- **OpenClaw (formerly Clawdbot)**: Fully open source (MIT), adopting a seamless closed-loop architecture of "perceive-plan-act-observe," with WhatsApp/Telegram as the primary interaction entry points, supporting cross-region device wakeup and remote execution.
- **GLM (Z.ai)**: GLM-5.1 has 744 billion parameters, fully trained on domestic Ascend 910B chip clusters. The Z Code platform includes a deeply localized knowledge-base retrieval engine, making it the preferred choice for enterprises building privatized AI programming foundations in restricted network environments.
- **LangChain / LangGraph**: Provides a general multi-agent framework (`AgentExecutor`, `StateGraph`), supporting supervisor-worker mode. Claude Code's Coordinator mode is conceptually similar to LangGraph's supervisor mode, but the implementation differs—LangGraph uses a graph state machine, while Claude Code is prompt-driven.
- **AutoGen (Microsoft)**: A framework specifically designed for multi-agent conversation, where agents collaborate through message passing. The difference from Claude Code is that AutoGen's inter-agent communication is an explicit message queue, whereas Claude Code uses generator chain propagation.

Claude Code's sub-agent design—**each sub-task is a complete AI reasoning-loop instance, not a simplified single-shot API call**—takes a unique "heavyweight instance + lightweight communication" path among multi-agent implementations. Compared to Kimi Code's hundred-level concurrent Agent Swarm or Cursor's cloud VM clones, Claude Code focuses more on each sub-agent's reasoning depth and tool completeness rather than extreme concurrency. Its Coordinator mode shares similar design intent with academic multi-agent research (e.g., CAMEL, MetaGPT), but leans more toward engineering practicality.

---

## The Question

The "sub-agent" in Claude Code is not just a metaphor. When the AI dispatches a sub-task via AgentTool, what actually happens behind the scenes? What is its relationship with the parent AI instance?

> 💡 **Plain English**: A sub-agent is like a **delivery rider dispatched by a food-distribution center**—the main Claude is the distribution center, and each sub-agent is an independent rider. The rider has their own navigation (message history), their own electric scooter (toolset), and independently delivers their own order (sub-task). After delivery, they return to the distribution center to report the result. Riders communicate with each other through a shared message board (Scratchpad).

---

## You Might Think…

You might think a sub-agent is just a simpler API call—starting a new conversation with different prompt words and waiting for the result to come back. Or you might think there is some complex message-queue protocol between the parent and child agents.

The reality is more interesting than that.

---

## How It Actually Works

### A Sub-Agent Is a Complete AI Main-Loop Instance

Each sub-agent is started through the `runAgent()` function, which itself is also an **AsyncGenerator**—the same design as `query()`. It will:

1. Generate a unique **AgentId** (not a session ID)
2. Create an independent **file-state cache** (preventing file-read state interference between parent and child)
3. Based on the agent definition, decide whether to connect to a dedicated **MCP server** (each agent definition can declare its required MCP tools in the frontmatter)
4. Build an independent **ToolUseContext** (tool execution context), but with `setAppState` designed as a **no-op**—a sub-agent cannot directly modify the parent process's UI state
5. Call `query()` to run the complete AI main loop

In other words, the sub-agent has full tool-calling capability, full context-compression mechanism, and full permission system—it is not a "lite version," but a complete AI reasoning loop.

> 📚 **Course Connection · Operating Systems**: The creation process of a sub-agent is highly analogous to the `fork()` system call in OS courses—the parent process creates a child process that inherits the parent's environment (file descriptors, environment variables), but has its own address space and execution context. Mapped here: the sub-agent inherits the parent agent's toolset and permission context, but has an independent message history (address space) and file-state cache (preventing mutual interference). The design of `setAppState` being a no-op is similar to how a child process cannot directly modify the parent process's memory—it requires IPC (inter-process communication). Here, the generator `yield` chain is the implementation of IPC.

### Parent-Child Communication: Streaming Messages

Every message produced by the sub-agent (including intermediate streaming events) is passed to the tool that called it via `yield`, and then propagated to the parent agent's main loop. This is a pure **generator chain**—no message queue, no extra process. The parent agent sees the sub-agent's progress in real time, in a streaming fashion.

### Sub-Agent Isolation Levels

Sub-agents have three isolation options at the filesystem level:

**Default (shared filesystem):** The sub-agent and parent agent operate in the same working directory; file modifications are visible to both. Suitable for ordinary tasks.

**Worktree isolation:** Before spawning the sub-agent, the system creates an independent git worktree branch. All file modifications by the sub-agent live in this branch without affecting the main branch. After the sub-agent finishes, you can choose to merge or discard. Suitable for "experimental" tasks (e.g., "try implementing this feature").

**Remote (ant-only):** Runs in a remote CCR environment with complete network isolation.

### A Clever Token-Saving Optimization

Read-only agents (such as Explore and Plan types) set `omitClaudeMd: true`, meaning their system prompts do not contain the contents of CLAUDE.md—because commit conventions and lint rules are completely useless for an agent that is "just reading code."

This optimization saves roughly 5–15 GTok/week (5–15 billion tokens per week). This number reflects the fact that the system creates tens of millions of Explore/Plan sub-agents every day; even saving a few hundred tokens each adds up to enormous cost savings.

---

## Coordinator Mode: AI as Project Manager

Coordinator mode is a higher-level abstraction over the sub-agent system. When `CLAUDE_CODE_COORDINATOR_MODE=1`, the main Claude instance's system prompt is replaced with a 350+ line "project-manager behavior specification."

In this mode, the main AI's toolbox is:
- `AgentTool` — spawn a new Worker
- `SendMessageTool` — send a continuation to a running Worker
- `TaskStopTool` — terminate a Worker that has gone off track

> 📚 **Course Connection · Distributed Systems**: Coordinator mode is the classic **Master-Worker architecture** (a core topic in distributed-systems courses). The Master (Coordinator) is responsible for task decomposition and scheduling; Workers execute independently and report results. `TaskStopTool` corresponds to task cancellation in distributed systems, and `<task-notification>` message callbacks correspond to worker heartbeat/result reporting. This pattern appears in MapReduce and Spark's Driver-Executor model.

When a Worker completes its task, the result is disguised as a "user message" in `<task-notification>` XML format. The Coordinator AI sees this message, parses the result, synthesizes it, and then decides the next step.

### Why Disguise the Result as a "User Message"?

Because the Anthropic API message format only has three roles: `system`, `assistant`, and `user`. There is no dedicated "tool callback" role. Wrapping Worker results as user messages with special XML tags is the minimal viable scheme for "asynchronous agent communication" within the existing API constraints.

### The Most Interesting Rule in the Coordinator Prompt

The prompt contains a specific prohibition:

> "Never write 'based on your findings' or 'based on the research.' These phrases delegate understanding to the worker instead of doing it yourself."

This rule targets a known weakness of LLMs—the model likes to use vague "based on xxx" phrases to shift the burden of comprehension onto others, rather than truly synthesizing information and making judgments. This rule forces the Coordinator AI to perform the synthesis itself, and then write precise implementation specifications for the Worker that include specific file paths and line numbers.

---

## The Trade-Offs Behind This Design

**Advantages:** Sub-agent isolation makes parallel execution safe (each has an independent file-state cache, so they don't interfere with one another); the generator-chain design allows streaming output to propagate naturally; the Coordinator's prompt-driven approach lets coordination strategy be adjusted without code changes.

**Costs:**
- The `setAppState` no-op design adds complexity (there is a `setAppStateForTasks` bypass for "global infrastructure" operations that must be carefully managed)
- Coordinator behavior depends on a 350-line prompt, which is essentially "writing architectural constraints into the prompt"—difficult to maintain as the system evolves
- The `<task-notification>` disguise scheme, while simple, makes the semantics of message history ambiguous: not every "user message" is from the real user

---

## What You Can Learn From This

**When you need to execute multiple tasks in parallel and in isolation in an AI application, "each task is a complete AI main loop" has better scalability than "each task is a simplified API call."**

The former allows sub-agents to have their own tool calls, their own context management, and their own multi-step reasoning; the latter confines sub-tasks to single-shot Q&A, unable to complete work requiring multi-step decision-making.

Claude Code chose the former, accepting the resulting complexity (isolation, state management, message routing), in exchange for the sub-agent's ability to independently complete arbitrarily complex tasks. This is an important architectural choice in AI engineering.

---

## Code Landing Spots

- `src/tools/AgentTool/runAgent.ts`, lines 248–400: complete signature and initialization logic of `runAgent()`
- `src/tools/AgentTool/AgentTool.tsx`, lines 80–99: AgentTool's input schema definition (includes all parameters)
- `src/coordinator/coordinatorMode.ts`, lines 111–369: complete system prompt for Coordinator mode
- `src/Task.ts`: Task type definition
- `src/tools/AgentTool/runAgent.ts`, lines 388–396: `omitClaudeMd` optimization logic

---

## Core Code Snippet

The key entry point for sub-agent creation is `runAgent()`, an AsyncGenerator that receives a complete context and starts an independent `queryLoop`:

```typescript
// src/tools/AgentTool/runAgent.ts — sub-agent launch signature (simplified)
export async function* runAgent({
  agentDefinition,      // Agent definition (name, description, system prompt)
  promptMessages,       // Initial messages (task instruction passed from parent agent)
  toolUseContext,       // Tool context (inherits parent agent's toolset)
  canUseTool,           // Permission-check function
  isAsync,              // Whether to execute asynchronously
  forkContextMessages,  // Parent agent's message history (used for prompt-cache sharing)
  querySource,          // Source identifier (distinguishes main agent / sub-agent)
  availableTools,       // Precomputed tool pool (avoids circular dependencies)
  allowedTools,         // Explicitly authorized tool list
  maxTurns,             // Maximum turn limit
  // ...
}: RunAgentParams): AsyncGenerator<Message> {
  // 1. Create an independent AbortController (sub-agent can be cancelled individually)
  // 2. Clone fileStateCache (isolate file state to prevent parent-child interference)
  // 3. Create independent denialTrackingState (permission-denial count is independent)
  // 4. Call query() to start an independent query loop
  // 5. yield each message back to the parent agent
}
```

Key design: the sub-agent shares the parent agent's prompt cache via `forkContextMessages`, avoiding duplicate charges.

---

## Directions for Further Inquiry

- After a Worker completes its task, how does the Coordinator decide whether to "continue the same Worker" or "spawn a new Worker"? (→ see Section 5 "Writing Worker Prompts" in the Coordinator prompt)
- When multiple Workers write the same file in parallel, how does the system handle conflicts? (→ see the concurrency-safety design of the tool system)
- What is the `dream` TaskType? (→ open question, pending deeper analysis)

---

*Quality self-check:*
- [x] Coverage: runAgent, AgentTool, Coordinator, and Task types are all covered
- [x] Fidelity: key claims are supported by code locations and data
- [x] Readability: builds a complete picture starting from "what is a sub-agent"
- [x] Consistency: aligned with global_map.md
- [x] Critical: identifies the complexity of setAppState no-op and the prompt-maintenance challenge
- [x] Reusability: linked chapters are listed
