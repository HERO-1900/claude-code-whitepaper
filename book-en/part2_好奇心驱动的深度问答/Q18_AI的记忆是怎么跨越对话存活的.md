# How Does AI Memory Survive Across Conversations?

An in-depth analysis of Claude Code's Memory persistence system—how user preferences survive across conversations via the `MEMORY.md` index file, the write/load/validate mechanisms for all four memory types, and the risks of memory errors plus their mitigations.

> 🌍 **Industry Context**: AI memory persistence is a shared challenge across all programming assistants, yet each vendor's approach differs significantly. **ChatGPT** stores its Memory feature on OpenAI's servers; users cannot directly edit the underlying data or control its location—this is the "cloud-hosted" approach. **Cursor** stores project-level instructions via `.cursorrules` (later renamed `.cursor/rules`), but this is static configuration rather than dynamically learned memory. **Aider** uses `.aider.conf.yml` and convention files, which are likewise manual configurations rather than AI-autonomous memory. **GitHub Copilot** provides project-level context through `.github/copilot-instructions.md`, and added a Memory feature in 2025 that remains primarily cloud-based. **Windsurf** has `.windsurfrules`, similar to Cursor. Claude Code's approach is unique: entirely local filesystem + Markdown format + AI-autonomous read/write + structured categorization (four types) + validation mechanisms. This "AI self-managed local file memory" approach offers advantages in transparency and controllability (users can directly view and edit memory with an editor), but it also means memory quality depends entirely on the LLM's judgment.

---

## The Question

You tell Claude Code today, "I'm a backend engineer; tests must hit a real database." Tomorrow you open a new conversation, and Claude automatically adjusts its tone—test suggestions no longer mention mocks. How does it "remember"? Where are these memories stored? Could it one day misremember and cause problems?

---

> **[Diagram placeholder 2.18-A]**: Architecture diagram — Memory system's two-layer structure (`MEMORY.md` index → standalone memory files), annotated with four types, truncation limits, and injection timing.

> **[Diagram placeholder 2.18-B]**: Flow diagram — Full memory lifecycle (write → index → load → validate → expire/update).

## You Might Think…

"It must be stored in some database or cloud server, right?" That's a reasonable guess. After all, ChatGPT's Memory lives on OpenAI's servers. Or perhaps you imagine a config file—a JSON field with key-value pairs.

> 💡 **Plain English**: The AI memory system is like a **video game save file**. The current conversation's state = in-game progress in memory (gone when you close it). The conversation history = a save file (you can load it and resume). The Memory system = permanent achievements and character stats (persist across saves, carried over even when you start a new game). Information like "you are a backend engineer" is stored as a "permanent achievement," automatically loaded the next time you start a conversation.

---

## How It Actually Works

Claude Code's memory system is entirely based on the **local filesystem**—structured memories stored as Markdown files, categorized via frontmatter metadata, indexed by `MEMORY.md`, and driven by prompt engineering to guide the AI's read/write behavior. There is no database, no cloud sync, no vector search. Yet it has four memory types, six exclusion rules, path safety validation, eval-driven prompt optimization, and a log mode inspired by WAL (Write-Ahead Log) design.

### Section 1: Four Types of Memory—Not Everything Deserves to Be Remembered

The system defines four strictly distinguished memory types (`memoryTypes.ts:14-19`):

| Type | Purpose | Example |
|------|---------|---------|
| **user** | User profile | "User is a data scientist focused on observability" |
| **feedback** | Behavioral guidance | "Tests must hit a real database; no mocks" |
| **project** | Project context | "Merge freeze starts March 5 for mobile release" |
| **reference** | External pointer | "Pipeline bugs are tracked in Linear's INGEST project" |

Each type has different "when to save" rules, as well as different **content structure requirements**. The `feedback` and `project` types mandate `**Why:**` and `**How to apply:**` lines—because simply remembering "don't mock the database" isn't enough; you also need to know **why** (last time mocked tests passed but the production migration failed) and **how to apply it** (in all integration test scenarios).

But even more important is **what not to remember**. `memoryTypes.ts:183-195` lists five exclusion rules:

1. Code patterns, architecture, file paths—derive from the code itself.
2. Git history—`git log` is the authoritative source.
3. Debugging solutions—the fix is in the code; context is in the commit message.
4. Content already in `CLAUDE.md`—avoid duplication.
5. Ephemeral task details—only useful in the current conversation.

The most critical sentence (`memoryTypes.ts:193-194`):

> "These exclusions apply **even when the user explicitly asks you to save**."

Even if the user says, "Help me remember this file's architecture," the system will refuse—because architecture should be derived from the code itself, not from a potentially stale memory. This is a rare example of an "AI says no to the user" design.

### Section 2: Two-Layer Architecture—Index and Entity Separation

The physical storage structure of memories:

```
~/.claude/projects/<sanitized-path>/memory/
  ├── MEMORY.md          ← Index file (one pointer per line)
  ├── user_role.md       ← Standalone memory file
  ├── feedback_testing.md
  └── project_deadline.md
```

Each memory file has frontmatter metadata:

```markdown
---
name: Database Testing Rule
description: Integration tests must hit a real database, no mocks
type: feedback
---

Tests must hit a real database, no mocks.

**Why:** Last quarter, all mocked tests passed, but the production migration failed. The mock/prod divergence masked a broken migration script.

**How to apply:** All database-related test scenarios. If the test framework defaults to mocks, explicitly replace them with real connections.
```

`MEMORY.md` is the index—each entry is one line pointing to the corresponding file:

```markdown
- [Database Testing Rule](feedback_testing.md) — Integration tests must hit a real database
- [User Role](user_role.md) — Backend engineer, focused on observability
```

Why not write all memories directly into one file? Because `MEMORY.md` is **injected into the context window at the start of every session**—its size directly impacts per-conversation token costs. Standalone files, on the other hand, are **loaded on demand**—only fetched when relevant.

### Section 3: 200 Lines and 25KB—The Physical Limits of Memory

```typescript
// src/memdir/memdir.ts, lines 34-38
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
```

`MEMORY.md` has a **dual truncation** mechanism (`memdir.ts:57-103`):

1. Exceeds 200 lines → truncated by line count.
2. Exceeds 25KB → truncated at the last newline before the limit (never mid-character).
3. After truncation, a warning is appended: `"> WARNING: MEMORY.md is too large. Only part of it was loaded."`

The 200-line limit means: if you have Claude remember one new thing every day, you'll hit the ceiling in roughly 6-7 months. At that point, older entries will be truncated out of view—though the standalone files still exist on disk, their index pointers are no longer visible, so the AI won't know to read them.

This is a pragmatic design trade-off: the more memories, the higher the token cost per conversation. Two hundred lines is roughly 3,000–5,000 tokens, which is already substantial for a system prompt.

### Section 4: Memories Lie—The "Verify Before Recommending" Mechanism

> 📚 **Course Connection**: The problem of memory drift is essentially a variant of **cache consistency** from database courses. Memory files act as a cache of the codebase's state—when the "source data" (code) is modified, the "cache" (memory) may become stale. The "verify before recommending" mechanism is analogous to HTTP conditional requests (`If-Modified-Since`): don't blindly trust the cache; first check whether the source data has changed. In distributed systems, this corresponds to a "read-your-writes" consistency guarantee.

This is the most instructive design in the entire Memory system.

A memory says, "There's a `validateAuth()` function in `auth.ts`." But since that memory was written, the code was refactored: the function was renamed to `verifyToken()`, and the file moved to `middleware/auth.ts`. If the AI blindly quotes the stale memory, the user will see a function that doesn't exist—this is worse than having no memory at all.

The `TRUSTING_RECALL_SECTION` in `memoryTypes.ts:240-256` forces the AI to validate before referencing a memory:

- Memory mentions a file path → **first check whether the file exists**
- Memory mentions a function name or flag → **first grep to confirm it's still there**
- If the user is about to act on your recommendation → **you must verify first**

The highlight is the comment in `memoryTypes.ts:228-236`—it records the concrete eval (evaluation test) score changes:

> "H1 (verify function/file claims): 0/2 → 3/3 via appendSystemPrompt"

This prompt was originally placed somewhere in the system prompt; the eval result was 0/2 (both test cases failed—the AI directly quoted a stale function name from memory without verifying). After moving it to `appendSystemPrompt` (closer to the end of the conversation), the eval became 3/3 (all three tests passed).

This means **the position of a prompt within the system message** significantly impacts AI behavior—later instructions are more likely to be followed (because they fall closer to the model's attention focus). This isn't theoretical speculation; it's an engineering conclusion backed by eval data.

### Section 5: Path Safety—Preventing a Malicious Repository from Stealing Your SSH Keys

The memory directory path is derived from a sanitized project path. But what if a malicious Git repository sets `autoMemoryDirectory: '~/.ssh'` in `.claude/settings.json` (project-level settings)?

Claude Code would create memory files in `~/.ssh/`—meaning **a malicious repository gains the ability to write files to a sensitive directory**.

The comment in `paths.ts:175-177` directly calls out this security risk:

> "projectSettings (.claude/settings.json committed to the repo) is intentionally excluded — a malicious repo could otherwise set autoMemoryDirectory: '~/.ssh' and gain silent write access to sensitive directories"

Therefore, project-level settings (committed in the repo, modifiable by a malicious PR) are **completely excluded** from memory path configuration. Only user-level settings (`~/.claude/settings.json`) can modify the memory directory.

In addition, `validateMemoryPath()` in `paths.ts:109-150` rejects six categories of dangerous paths:

1. Relative paths (`../foo`) — prevent path traversal.
2. Root or near-root paths (`/`, `/a`) — prevent overwriting system directories.
3. Windows drive roots (`C:\`).
4. UNC paths (`\\server\share`) — prevent network path injection.
5. Null bytes — prevent path truncation in syscalls (a classic security vulnerability vector).
6. Tilde expansion restrictions: `~/`, `~/.`, `~/..` are not expanded — prevent matching the entire `$HOME`.

### Section 6: Git Worktree Sharing—The Hidden Bridge in Swarm Mode

```typescript
// src/memdir/paths.ts, lines 200-205
// Uses findCanonicalGitRoot so all worktrees of the same repo
// share one auto-memory directory
```

When multiple Claude instances operate in Swarm mode (each in its own git worktree), they share **the same memory directory**. This means:

- The main agent remembers, "This project's CI runs on GitHub Actions."
- A sub-agent in a worktree can immediately access that memory.
- All agents maintain a consistent understanding of project context.

This is achieved through `findCanonicalGitRoot()`—no matter which worktree you're in, it finds the canonical git repository root and maps it to the same memory directory.

### Section 7: KAIROS Mode—From Logs to Distilled Memory Cycles

> 📚 **Course Connection**: The KAIROS mode's "append logs first, organize asynchronously later" architecture is a faithful mapping of the **WAL (Write-Ahead Log)** pattern from database courses. PostgreSQL's WAL, Redis's AOF (Append Only File), and Kafka's log storage all follow the same principle: writes are append-only (O(1) complexity, no lock contention), and background asynchronous compaction reorganizes the log into a structured index. Once you understand this pattern, you'll see it everywhere from databases to message queues to filesystems.

In standard mode, the AI actively maintains the `MEMORY.md` index. But in KAIROS (Assistant) mode, the strategy is completely different (`memdir.ts:318-370`):

- **Does not maintain** the `MEMORY.md` index.
- **Appends** to date-named log files: `memory/logs/YYYY/MM/YYYY-MM-DD.md`.
- Format: short timestamped entries, append-only.
- The **nightly `/dream` skill** distills logs into topic files + updates `MEMORY.md`.

This borrows the **WAL (Write-Ahead Log)** concept from databases:

1. Writes only append to a log (fast, low contention).
2. Background async processes reorganize the log into structured storage (`/dream` distillation).
3. Reads prioritize structured storage (`MEMORY.md` + topic files); the log is a "last resort."

A noteworthy detail: the date path uses a **pattern** (`YYYY/MM/YYYY-MM-DD`) rather than today's literal date. Why? Because the memory prompt is cached via `systemPromptSection('memory', ...)`—if the template hardcoded "2026-04-02," the cache would expire on April 3 (prompt cache miss = extra token cost). Using a pattern keeps the template permanently static; the model retrieves the current date from the `date_change` attachment.

### Section 8: Background Extract Agent—The Second AI You Didn't Know About

`paths.ts:58-77` reveals a mechanism most users don't know exists:

```
feature flag: EXTRACT_MEMORIES
GrowthBook gate: tengu_passport_quail
```

When this feature is enabled, **after every conversation turn** a background agent scans new messages and extracts content worth remembering. If the main agent already wrote a memory during that conversation, the background agent skips that range—to avoid duplication.

This means even if the main agent is busy writing code and forgets to save a memory, the background agent will preserve important context for you. The cost is extra token consumption—one additional LLM call per conversation turn.

---

## The Philosophy Behind It

The design philosophy of the Memory system can be summarized in one sentence: **Memory is a costly resource, not a free feature.**

1. **Token cost**. Every memory consumes context window space. The 200-line limit isn't a technical constraint; it's an economic decision—beyond this volume, the token cost of memory exceeds the value it provides.
2. **Accuracy cost**. Stale memory is more dangerous than no memory. The "verify before recommending" mechanism and drift caveat (`MEMORY_DRIFT_CAVEAT`: "If a recalled memory conflicts with current information, trust what you observe now") acknowledge the inherent unreliability of memory.
3. **Security cost**. Allowing an AI to write to the filesystem opens an attack surface. Path validation and the `projectSettings` exclusion are the insurance purchased against that cost.
4. **Cognitive cost**. Four types + exclusion rules + Why/How structure = the AI must make categorical judgments every time it writes a memory. These judgments aren't always correct (an LLM might save redundant information), but structured is better than unstructured.

The deepest insight comes from the eval comments—Anthropic isn't "designing" AI behavior; it's **measuring and optimizing** it. Every paragraph and position in the prompt has corresponding eval tests, and score changes are directly recorded in code comments. This is a methodology that treats AI behavior tuning as an experimental science rather than an intuitive art.

---

## Code Landmarks

- `src/memdir/memoryTypes.ts`, lines 14-19: `MEMORY_TYPES = ['user','feedback','project','reference']`
- `src/memdir/memoryTypes.ts`, lines 183-195: Five exclusion rules
- `src/memdir/memoryTypes.ts`, lines 193-194: Exclusions apply even when user explicitly requests saving
- `src/memdir/memoryTypes.ts`, lines 201-202: `MEMORY_DRIFT_CAVEAT` drift warning
- `src/memdir/memoryTypes.ts`, lines 228-236: Eval result comment (0/2 → 3/3)
- `src/memdir/memoryTypes.ts`, lines 240-256: `TRUSTING_RECALL_SECTION` verify-before-recommending
- `src/memdir/memoryTypes.ts`, lines 261-271: Frontmatter format template
- `src/memdir/memdir.ts`, lines 34-38: `ENTRYPOINT_NAME`, `MAX_ENTRYPOINT_LINES=200`, `MAX_ENTRYPOINT_BYTES=25000`
- `src/memdir/memdir.ts`, lines 57-103: Dual truncation logic
- `src/memdir/memdir.ts`, lines 116-117: `DIR_EXISTS_GUIDANCE`
- `src/memdir/memdir.ts`, lines 318-370: `buildAssistantDailyLogPrompt()` KAIROS mode
- `src/memdir/paths.ts`, lines 30-55: `isAutoMemoryEnabled()` five-step priority chain
- `src/memdir/paths.ts`, lines 58-77: `isExtractModeActive()` + `tengu_passport_quail`
- `src/memdir/paths.ts`, lines 109-150: `validateMemoryPath()` six dangerous path rejections
- `src/memdir/paths.ts`, lines 175-177: `projectSettings` exclusion (malicious repo prevention)
- `src/memdir/paths.ts`, lines 200-205: Git worktree shared memory directory

---

## Directions for Further Inquiry

1. **`findRelevantMemories.ts`**: When loading standalone memory files on demand, what algorithm determines "relevance"? Keyword matching or semantic similarity?
2. **`memoryScan.ts`** and **`memoryAge.ts`**: What are the scanning and aging policies for memories? How long must a memory go unreferenced before it's suggested for cleanup?
3. **Team Memory scope decisions**: Feedback defaults to private, project leans toward team—how were these defaults determined?
4. **Extract Memories cost analysis**: What's the ROI of the extra LLM call per turn in token cost versus memory value?
5. **KAIROS `/dream` distillation implementation**: What's the specific logic for distilling logs into topic files? How are continuous topics across multiple days handled?

---

*Quality self-check:*
- [x] Coverage: deep read of three core files—`memdir.ts`, `memoryTypes.ts`, `paths.ts`
- [x] Fidelity: all constants, line numbers, and eval scores are from source code
- [x] Readability: WAL analogy builds KAIROS intuition; SSH theft scenario builds security intuition
- [x] Consistency: follows standard Q&A chapter structure
- [x] Critical: identifies the cost of the 200-line limit and the risk of memory quality depending on LLM judgment
- [x] Reusable: eval-driven prompt optimization methodology and path safety validation patterns are broadly applicable
