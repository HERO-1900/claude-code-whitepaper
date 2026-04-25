# How Does MagicDocs Automatically Maintain Documentation?

Manually maintaining documentation is one of the most painful chores for developers—code changes, but the docs often lag behind. MagicDocs activates a background subagent with just two lines of Markdown front matter, letting documentation update itself in the gaps between your work: newly added modules get recorded, outdated descriptions get corrected, and you might never even notice it happened. This chapter unpacks the complete lifecycle of this "automatic archive"—from detection, registration, and triggering to safe isolation.

> 💡 **Plain English**: Like an auto-updating encyclopedia—when the content changes, the documentation changes with it.

> 🌍 **Industry Context**: Automated documentation maintenance is a cutting-edge direction not yet widely adopted in AI coding tools. **GitHub Copilot** (Agent Mode is now fully GA, with built-in Explore/Plan/Task agents) and **Cursor** (which has launched Background Agents for cloud-based parallel execution) have dramatically enhanced their capabilities, but neither offers a built-in documentation auto-sync mechanism. **Aider** supports editing multiple files in a conversation (including docs), but requires the user to explicitly specify them and does not maintain them automatically in the background. **Windsurf (Codeium)**'s Cascade mode can sense documentation in context, but likewise lacks a "background subagent auto-update" layer. Traditional doc automation tools such as **Swagger/OpenAPI** (generating API docs from code annotations) and **TypeDoc/JSDoc** (generating reference docs from type signatures) are template-driven, code-extraction approaches that cannot understand conversational context or design decisions. MagicDocs is differentiated because it listens to **conversation context** rather than code structure—closer to the paradigm of "meeting minutes auto-synced to a document," a novel alternative to traditional doc generation.

---

## The Problem

You create a Markdown file in your project and write `# MAGIC DOC: Architecture Overview` as the first line. After that, you work as usual—modifying code, discussing design, refactoring modules. Hours later, you open the file and find that it has **updated itself**: new modules are recorded, outdated descriptions are corrected, and even the formatting is neater. No one manually edited it. How is this possible? What mechanism powers this "automatic archive"?

---

> **[Chart placeholder 2.19-A]**: Architecture diagram — MagicDocs complete workflow (file read → header detection → registration tracking → post-sampling hook → subagent update)

> **[Chart placeholder 2.19-B]**: Sequence diagram — lifecycle of a MagicDocs update (from conversation idle to subagent completing the edit)

## You Might Think…

"Auto-updating docs? It's probably just summarizing the chat history and appending it to the end of the file at the end of each turn, right?" Or maybe you guess it uses some template engine to extract comments from the code and auto-generate documentation.

---

## Here's How It Actually Works

MagicDocs is far more sophisticated than "append a summary." It is a **complete background subagent system**—detecting magic headers with regular expressions, auto-registering via file-read listeners, triggering via a post-sampling hook when the conversation is idle, and executing edits through a tightly permission-restricted Sonnet subagent that sees your full conversation context. The entire system spans just 2 source files (`magicDocs.ts` at 254 lines + `prompts.ts` at 127 lines), yet covers the full lifecycle from discovery, registration, triggering, updating, and safe isolation.

### Section 1: The "Magic Header"—Two Lines of Text Activate the Whole System

Everything starts with a regular expression (`magicDocs.ts:33`):

```
/^#\s*MAGIC\s+DOC:\s*(.+)$/im
```

This pattern matches `# MAGIC DOC: [Title]` at the top of a file. But detection doesn't stop there—the system also looks for an optional line of italicized text after the header (`magicDocs.ts:35`):

```
/^[_*](.+?)[_*]\s*$/m
```

This italicized line is the **document-level custom instruction**. For example, you could write:

```markdown
# MAGIC DOC: API Changelog
_Only record breaking changes to public APIs; ignore internal refactors_
```

The `detectMagicDocHeader` function (`magicDocs.ts:52-81`) parses these two parts and returns a `{ title, instructions? }` object. It allows one blank line between the header and the italic instruction (`afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/)`); this lenient matching tolerates different Markdown formatting styles.

This is not a simple "tag"—it is a **two-layer configuration protocol**: the title defines the document's identity, and the italicized line defines its update strategy. All it takes is two lines of plain Markdown text—no config files, no frontmatter, no YAML.

### Section 2: Auto-Registration—"Read It, Track It"

MagicDocs does not require you to manually register which files need maintenance. It relies on an elegant **file-read listener pattern**.

At initialization (`initMagicDocs`, `magicDocs.ts:242-254`), the system does two things:

1. **Register a file-read listener**: calling `registerFileReadListener`, which fires a callback whenever any tool reads a file
2. **Register a post-sampling hook**: triggering update logic after every AI sampling completes

Whenever Claude reads any file via `FileReadTool`, the listener automatically checks whether the content contains a magic header. If it matches, it calls `registerMagicDoc(filePath)` to begin tracking—storing the file path in a `Map<string, MagicDocInfo>` (`magicDocs.ts:42`).

This means: **you don't need to do anything extra**. As long as Claude reads a file with a magic header during the conversation—whether because you asked it to, or because it stumbled upon it while searching code—that file is added to the auto-maintenance list.

The registration logic includes a critical idempotency guard (`magicDocs.ts:89`): `if (!trackedMagicDocs.has(filePath))`—the same file is registered only once. But when the hook fires, it always **re-reads the latest file content** and re-detects the header and instructions, so you can modify the italicized instruction line at any time to change the update policy.

There is also a hidden restriction: the entire MagicDocs feature is **only available to Anthropic internal users** (`magicDocs.ts:243`):

```typescript
if (process.env.USER_TYPE === 'ant') {
```

This signals an internal early-access experiment—the feature is fully implemented but not yet publicly released.

### Section 3: Trigger Timing—"Only Update When the Conversation Is Idle"

MagicDocs updates are **not** triggered every time a file is modified. Instead, it uses a carefully designed post-sampling hook (`magicDocs.ts:217-240`) with three layers of filtering conditions:

**Condition 1: Only trigger on the main thread**

```typescript
if (querySource !== 'repl_main_thread') {
  return
}
```

Sampling from a subagent does not trigger MagicDocs updates—otherwise the MagicDocs update subagent would itself trigger MagicDocs updates, leading to infinite recursion.

**Condition 2: Only trigger when the conversation is idle**

```typescript
const hasToolCalls = hasToolCallsInLastAssistantTurn(messages)
if (hasToolCalls) {
  return
}
```

If the AI's last response included tool calls, it is still "at work"—it may need to invoke more tools. Only when the AI replies with plain text (no tool calls) does it mean a unit of work has finished, making it a safe moment to update.

**Condition 3: There must be docs that need updating**

```typescript
if (docCount === 0) {
  return
}
```

If no MagicDocs have been registered, skip immediately.

This "update when idle" strategy means MagicDocs never interrupts your workflow. It is a true background task—quietly integrating new information into the documentation during the gaps in your conversation with Claude.

> 📚 **Course Connection**: MagicDocs's trigger mechanism is a classic **event-driven architecture** (software engineering). The post-sampling hook corresponds to the Observer Pattern, and the file-read listener is a variant of pub-sub. The `sequential()` wrapper solves a **concurrency control** problem (operating systems)—essentially acting as a mutex, ensuring serial access to the shared resource (the document file) and preventing race conditions.

The entire hook is also wrapped with `sequential()` (`magicDocs.ts:217`), which means even if multiple samplings complete in rapid succession, updates are queued and executed serially—preventing the race condition of two subagents editing the same file simultaneously.

### Section 4: The Subagent—A Least-Privilege Editor

The actual update is performed by a **subagent**—created via the `runAgent` function, running the Sonnet model. This subagent's configuration is extremely minimal (`magicDocs.ts:99-109`):

```typescript
function getMagicDocsAgent(): BuiltInAgentDefinition {
  return {
    agentType: 'magic-docs',
    tools: [FILE_EDIT_TOOL_NAME], // Only Edit is allowed
    model: 'sonnet',
    source: 'built-in',
  }
}
```

Note the **principle of least privilege** design (the Principle of Least Privilege is a foundational concept in operating system security):

1. **Only one tool**: `FILE_EDIT_TOOL_NAME` (the `Edit` tool). It cannot read files, execute commands, or search code—it can only edit
2. **Only one editable file**: the `canUseTool` callback (`magicDocs.ts:172-193`) further restricts the subagent so that even when using the Edit tool, it is only allowed to edit the current MagicDoc's path. Editing any other file is rejected
3. **Sonnet instead of Opus**: a lighter model is chosen because documentation updates do not require the strongest reasoning capabilities

What does the subagent see when it runs? The key lies in `forkContextMessages: messages` (`magicDocs.ts:201`)—it sees **your full conversation history**. This means it knows what you discussed, what code you changed, and what decisions you made. But it does not simply "summarize the conversation"—the prompt instructs it to extract **information relevant to the document's topic** from the dialogue.

There is also a clever pre-update step: the system clones the `FileStateCache` and then deletes the current document's cache entry (`magicDocs.ts:124-125`). Why? Because `FileReadTool` has deduplication logic—it returns a `file_unchanged` stub if the file content hasn't changed. But MagicDocs needs the **actual content** to re-detect the header and instructions, so it must bypass this cache.

### Section 5: Prompt Engineering—"Not a Log, but a Living Document"

The prompt template in `prompts.ts` (128 lines) is the key to MagicDocs's quality. It does not simply say "update this file"; it defines a complete **documentation philosophy**:

**Core principle—"Keep current, don't record history"**:

> "Keep the document CURRENT with the latest state of the codebase - this is NOT a changelog or history"
> "Update information IN-PLACE to reflect the current state - do NOT append historical notes"

This is the fundamental difference between MagicDocs and a traditional changelog: it maintains a **snapshot of truth**, not a timeline. If an API endpoint changes from `/v1/users` to `/v2/users`, the document is updated in place with no footnote saying "it used to be v1."

**What to write and what not to write**:

The prompt explicitly lists DOs and DON'Ts:

- **DO**: high-level architecture, non-obvious patterns, key entry points, important design decisions, references to related files
- **DON'T**: things obvious from the code, exhaustive function listings, step-by-step implementation details, low-level code mechanics

This distinction reflects an important insight: **good documentation bridges the gap between code and understanding**, rather than repeating the code.

**Priority of custom instructions**:

If the file has an italicized instruction line, the prompt emphasizes it heavily (`prompts.ts:108-115`):

> "These instructions take priority over the general rules below."

This means your custom instructions can override the default documentation philosophy—if you say in your instructions "record all API change history," the system will respect your choice even if it contradicts the default principle.

**Variable substitution mechanism**:

The prompt uses `{{variable}}` template syntax (`prompts.ts:81-93`), avoiding two bugs through single-pass replacement:
1. `$` backreference corruption—using a replacement function instead of a string prevents `$1` from being interpreted
2. double substitution—user content that happens to contain `{{varName}}` won't be replaced a second time

There is also a hidden extension point: you can place a custom prompt template at `~/.claude/magic-docs/prompt.md` (`prompts.ts:66-76`), completely replacing the default update logic. This is an escape hatch for power users.

### Section 6: City Metaphor—The Auto-Updating Archive

If Claude Code is a city, MagicDocs is its **auto-updating city archive**.

A traditional archive needs a dedicated archivist—someone does something, then manually goes to the archive to register it. MagicDocs's archive is different: it has an invisible observer constantly listening to conversations happening across the city. When a conversation wraps up and the city grows quiet, the observer dispatches a specialized archivist (the subagent) with the full conversation transcript to update the relevant records.

The archivist follows strict rules:
- Can only modify files marked as "magic archives" (least privilege)
- Can only update, not create or delete (only the Edit tool)
- Must keep the archive reflecting the current state, leaving no historical traces (living-document philosophy)
- If the first-line marker on an archive is removed, the archivist stops managing that file (automatically drops from tracking)

The most elegant detail is that italicized instruction line—it is like a sticky note on the archive cabinet: "This archive only records breaking changes." The archivist re-reads this note every time it opens the cabinet, so you can swap it out anytime.

---

## The Trade-Offs Behind This Design

**Why not have the main model update directly?** Because a MagicDocs update is a "side effect"—it should not consume the user's paid main-model quota, nor should it appear in the conversation flow. Using a separate Sonnet subagent makes the process completely imperceptible to the user and less expensive.

**Why only give it the Edit tool?** More tools mean a larger attack surface. If the subagent could execute Bash commands, a carefully crafted MagicDoc content could use prompt injection to make the subagent run arbitrary code. Edit-only plus path restriction contains the blast radius to "at worst, one document file gets corrupted."

**Why not update in real time?** Real-time updates would mean a subagent could fire after every tool call, slowing down the main conversation's response speed. "Update when idle" is a classic **batch-vs-real-time trade-off**—sacrificing immediacy for zero interference.

**Why only open to internal users?** The `USER_TYPE === 'ant'` gate indicates a feature still being validated. Automatically modifying user files is a high-risk operation—if the subagent misinterprets context, or if the prompt has flaws, it might write incorrect information. The team is building confidence internally before a public release.

**Why use plain Markdown instead of a database?** A MagicDoc is just an ordinary Markdown file: it can be tracked by Git, reviewed in PRs, and manually edited. This means it is fully integrated into the developer's existing workflow—auto-generated and hand-written content coexist, both protected by version control.

---

## Code Locations

- `src/services/MagicDocs/magicDocs.ts`, line 33: `detectMagicDocHeader()` magic-header regex
- `src/services/MagicDocs/magicDocs.ts`, line 89: `registerMagicDoc()` idempotent registration
- `src/services/MagicDocs/magicDocs.ts`, lines 99-109: `getMagicDocsAgent()` subagent definition (Edit tool only)
- `src/services/MagicDocs/magicDocs.ts`, line 217: `sequential()`-wrapped post-sampling hook
- `src/services/MagicDocs/magicDocs.ts`, lines 242-254: `initMagicDocs()` initialization entry point
- `src/services/MagicDocs/prompts.ts`, lines 66-76: custom prompt-template escape hatch
- `src/services/MagicDocs/prompts.ts`, lines 81-93: `{{variable}}` template variable substitution

---

## Limitations and Critiques

- **Internal-only**: The `USER_TYPE === 'ant'` gate means external users cannot use this feature at all, making it impossible to validate its robustness across large-scale, diverse projects
- **Single-document perspective**: The subagent updates one document at a time and cannot perceive information overlap or conflict between multiple MagicDocs—if two documents cover the same module, they may produce inconsistent descriptions
- **Depends on conversation quality**: The quality of documentation updates depends entirely on the depth and accuracy of the main conversation; if the conversation itself contains misunderstandings, those errors will be "automated" into the document

---

## If You Remember Only One Thing

MagicDocs is not a "documentation generator"—it is a **background-running dedicated documentation-maintenance subagent**, activated by two lines of Markdown header, working automatically when the conversation is idle, holding only the Edit key, and allowed to open only its own assigned archive cabinet. It proves a design philosophy: **the best documentation system is not the one that helps you write faster, but the one you don't have to write at all.**
