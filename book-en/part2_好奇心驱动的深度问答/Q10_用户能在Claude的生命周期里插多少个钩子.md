How Many Hooks Can a User Insert into Claude's Lifecycle?

Claude Code's Hooks system is the core of its extensibility—it allows you to inject custom logic at almost every critical node: tool calls, session start/end, permission decisions, AI turn completion, and more. From simple shell scripts to full multi-turn AI agents, Hooks are far more capable than most people imagine. This chapter provides a complete inventory of 27 event nodes, 4 execution types, and exit-code semantics.

> 💡 **Plain English**: It's like notification settings for a parcel locker—you get a text when the package arrives, another when it's picked up, and you can customize how those notifications are delivered.

### 🌍 Industry Context

Hook/plugin systems are the bedrock of extensibility for developer tools, and AI coding assistants are gradually building out their own lifecycle hook frameworks:

- **Cursor**: Custom behavior is supported indirectly through the VS Code extension API (e.g., `onDidSaveTextDocument` events), but these are IDE-level hooks, not AI-agent-lifecycle hooks. Cursor does not provide hooks for AI-specific nodes such as turn completion or permission requests.
- **Aider**: No hook system is offered. Users can configure commit and lint behavior through CLI flags like `--auto-commits` and `--lint-cmd`, but these are predefined behaviors, not programmable hooks.
- **Windsurf**: Also built on the VS Code extension ecosystem; it has no independent AI lifecycle hook system.
- **CodeX (OpenAI)**: As of v0.118.0, behavior constraints before and after tool calls can be defined via configuration files. Its open-source skill library (with native Figma/Linear integrations) represents the "predefined capability extension" path. However, it does not offer user-programmable shell hooks or agent-type hooks.
- **LangChain / LangGraph (Callbacks)**: Provides a rich callback system—`on_llm_start`, `on_tool_start`, `on_tool_end`, `on_chain_error`, etc. LangChain's callbacks are conceptually the closest to Claude Code's Hooks, but they are aimed at developers building agent applications rather than end users customizing workflows.
- **Git Hooks**: Claude Code's hook system clearly borrows its design philosophy from Git's hook mechanism—running custom logic via shell scripts at specific event nodes and using exit codes to control flow (when Git's `pre-commit` hook returns non-zero, the commit is blocked, sharing the same lineage as Claude Code's `exit 2` blocking semantics).

Claude Code's 27 event nodes + 4 execution types (`command` / `prompt` / `agent` / `http`) form the broadest hook system among AI coding tools. The `type: "agent"` hook in particular—launching an independent AI to validate results—is a capability other tools currently lack. But it is worth recognizing that such a rich hook system also brings higher learning costs and debugging complexity.

---

## The Question

Claude Code has a "hooks" system you can configure in `settings.json`. But how deep does this system really go? What can you actually do with it?

---

## The Answer: 27 Event Nodes, 4 Execution Types

> **[Chart reserved 2.10-A]**: Claude lifecycle diagram—a complete visualization of where the 27 event nodes sit on the session timeline, colored by category: Tools / Permissions / AI Turns / Session / Swarm, etc.

The full list of hook events is far larger than most people realize.

### Three Nodes in the Tool Lifecycle

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo 'about to run bash'" }] }],
    "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "eslint $CLAUDE_FILE_PATHS" }] }],
    "PostToolUseFailure": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "notify_failure.sh" }] }]
  }
}
```

`PostToolUse` is the most common—automatically running a linter after a file edit is far more reliable than asking the AI to do it manually every time.

### Session Entry and Exit

```
SessionStart  — when the session starts (distinguishes startup / resume / clear / compact)
SessionEnd    — when the session ends (1500ms timeout, much shorter than tool timeouts)
```

The 1500ms timeout for `SessionEnd` is intentional: Claude Code cannot wait indefinitely for a user's teardown script on exit. If your script needs more time, you can override it with an environment variable:

```bash
CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000
```

### Two Insertion Points in the Permission Flow

```
PermissionDenied  — the auto-mode classifier rejected a tool call
PermissionRequest — the permission dialog is about to be shown
```

The `PermissionRequest` node is especially useful: you can return `hookSpecificOutput` to completely replace manual user confirmation:

```json
{ "hookSpecificOutput": { "decision": "allow" } }
```

This lets enterprise users manage permissions through their own approval systems rather than relying on Claude's built-in dialog.

### Gatekeepers for AI Turns

```
Stop        — Claude is about to finish its current turn (exit 2 = block, causing Claude to continue)
StopFailure — the turn ended due to an API error (fire-and-forget, output ignored)
```

The `Stop` hook is the ideal place to "verify the AI has completed the task." But if a plain shell command isn't enough, you can use a hook of **agent** type:

```json
{
  "Stop": [{
    "hooks": [{
      "type": "agent",
      "prompt": "Verify that all tests pass and all TODO comments have been addressed. $ARGUMENTS"
    }]
  }]
}
```

This launches a full multi-turn AI agent (up to 50 turns), reads the transcript, inspects the codebase, and returns `{ ok: true/false, reason: "..." }`. If `ok: false`, Claude receives the failure reason and keeps working.

---

## Exit-Code Semantics: A Dual-Track System

> **[Chart reserved 2.10-B]**: Exit-code semantics reference table—rows: exit codes (0 / 2 / other non-zero), columns: different hook events, cell content: corresponding effect (allow / block from model / block from user / ignore)

> 📚 **Course Connection**: The design of exit-code semantics maps to the **Inter-Process Communication** (IPC) and **signal mechanisms** chapters in an Operating Systems course. In Unix/POSIX systems, process exit codes (0–255) are the most basic form of communication between parent and child processes—the `wait()` system call retrieves the child exit code via the `WEXITSTATUS` macro. POSIX only mandates `exit 0` (success) and non-zero (failure); the Bash manual defines exit 2 as "misuse of shell builtins," but this is not a universal convention. Claude Code's choice of exit 2 for "block" semantics is primarily a pragmatic engineering decision: it needed a small integer that would not conflict with exit 1 (general error)—not a direct inheritance of any Unix tradition.

The most counter-intuitive design: **exit code 2 and other non-zero exit codes mean completely different things**.

| Exit Code | Effect |
|-----------|--------|
| 0 | Success; stdout may be passed to Claude |
| **2** | **Block** — stderr is shown to Claude, and the operation is aborted |
| 1, 3, 4... | Non-blocking error — stderr is shown only to the user |

The core idea is to distinguish between two kinds of failure: exit 1 means "the hook script itself failed" (should not affect Claude's behavior), whereas exit 2 means "the hook intentionally blocked this operation" (the error message needs to reach the AI model). The value 2 was chosen simply because it is the smallest integer that does not conflict with the generic error code 1.

Concrete example (`PreToolUse`):
- `exit 0`: hook finishes, tool proceeds, stdout/stderr not displayed
- `exit 2`: stderr is passed to Claude, Claude sees the error, and the tool call is blocked
- `exit 1`: stderr is shown only to the user, and the tool still executes (Claude never knows what happened)

---

## Security: All Hooks Require Workspace Trust

A comment in the codebase explains the backstory:

```typescript
// ALL hooks require workspace trust because they execute arbitrary commands
// from .claude/settings.json.
//
// Historical vulnerabilities that prompted this check:
// - SessionEnd hooks executing when user declines trust dialog
// - SubagentStop hooks executing when subagent completes before trust
```

This references a real vulnerability history—it was discovered that a `SessionEnd` hook could still run even when the user declined the trust dialog. The current design is ironclad: no matter the hook or the timing, `hasTrustDialogAccepted() === true` is mandatory.

---

## An Undocumented Node: FileChanged

```json
{
  "FileChanged": [{
    "matcher": ".envrc|.env",
    "hooks": [{ "type": "command", "command": "direnv allow && direnv exec . env > $CLAUDE_ENV_FILE" }]
  }]
}
```

This hook lets you watch for file changes and modify the environment variables available to subsequent Bash commands via `CLAUDE_ENV_FILE`. When `.envrc` changes, the hook automatically updates the environment Claude can see—essentially a Claude Code version of direnv.

---

## The Full Map of 27 Events

```
Tool Layer      PreToolUse, PostToolUse, PostToolUseFailure
Permission      PermissionDenied, PermissionRequest
User Input      UserPromptSubmit, Notification
Session         SessionStart, SessionEnd
AI Turn         Stop, StopFailure
Subagent        SubagentStart, SubagentStop
Compaction      PreCompact, PostCompact
Configuration   Setup, ConfigChange, InstructionsLoaded
Teamwork        TeammateIdle, TaskCreated, TaskCompleted
MCP             Elicitation, ElicitationResult
Filesystem      WorktreeCreate, WorktreeRemove, CwdChanged, FileChanged
```

Almost every meaningful system node has a corresponding hook. Judging from the commit history, hook event nodes were added incrementally as features evolved (early versions only had tool-layer and session-layer hooks), but the overall architecture reserved a unified registration and dispatch mechanism for extension from the start.

---

## Limitations and Critique

- **Counter-intuitive exit-code semantics**: `exit 2` means block (shown to the model) while any other non-zero exit code means non-blocking error (shown only to the user). This convention is easy for newcomers to get backwards when writing hook scripts.
- **Agent-type hook costs are opaque**: A `type: "agent"` Stop hook can run up to 50 turns of AI reasoning, but users configuring this have little visibility into how much extra token consumption it will incur.
- **Trust model is overly binary**: All hooks depend on the global `hasTrustDialogAccepted()` state; there is no finer-grained mechanism to trust one hook but not another.

---

## Code Locations

- `src/hooks/` — top-level Hooks system directory
- `src/services/hooks/` — Hooks service-layer implementation
- `src/utils/hooks.ts`, lines 330–350: `HookResult` type (four outcomes)
- `src/utils/hooks/hooksConfigManager.ts`, lines 26–265: `getHookEventMetadata()` (descriptions and matchers for all events)
- `src/utils/hooks/execAgentHook.ts`, line 36: `execAgentHook()` (full implementation of the multi-turn AI hook)
- `src/utils/hooks.ts`, lines 286–296: `shouldSkipHookDueToTrust()` (trust check)
- `src/utils/hooks.ts`, lines 167–182: `getSessionEndHookTimeoutMs()` (SessionEnd timeout)
