Who Is That AI Quietly Taking Notes in the Background During Your Session?

You may never have noticed, but while you work, Claude Code is quietly running an independent "note-taking" AI instance in the background. It automatically distills the key points of your conversation, task progress, and encountered errors into a structured `session-memory.md` file, so that the AI can recall "where we left off" the next time you open the project. This chapter unpacks the trigger mechanism, note structure, and engineering design of the SessionMemory system.

> 💡 **Plain English**: It's like having a dedicated note-taker at a meeting—you just discuss, and they capture the key points so you can quickly catch up next time.

### 🌍 Industry Context

"Enabling AI to automatically accumulate contextual memory while working" is a shared pursuit of AI coding tools and agent frameworks, but implementations vary significantly:

- **Cursor (Long-term Memory / Memories)**: Introduced memory features in late 2024, extracting key information through manual user tagging or automatic AI extraction, stored in the cloud. However, unlike Claude Code, it does not run an independent background AI instance to continuously take notes; it leans more toward "key fact extraction" rather than "session progress tracking."
- **Aider (chat history + repo map)**: Persists conversation history to a `.aider.chat.history.md` file, but this is a raw, direct record of the conversation without AI summarization or structured organization. Aider's repo map feature maintains a cache of the codebase structure, but this is code comprehension rather than session memory.
- **Windsurf (Cascade Memory)**: Claims to have cross-session "memory" capabilities, but the specific implementation is not publicly disclosed, and the documentation does not describe an independent background extraction mechanism similar to SessionMemory.
- **LangChain / LangGraph (Memory modules)**: Offers multiple memory implementations—`ConversationBufferMemory` (full retention), `ConversationSummaryMemory` (AI summarization), and `EntityMemory` (entity tracking). LangChain's `ConversationSummaryMemory` is the most similar to Claude Code's SessionMemory, as both use an LLM call to compress conversation history, but LangChain executes synchronously, whereas Claude Code executes asynchronously in the background.
- **ChatGPT (Memory)**: OpenAI's memory feature extracts user preferences and key facts from conversations and persists them across sessions. However, it is a cloud service rather than a local file, giving users a different level of granular control over memory content.

The unique aspects of Claude Code's SessionMemory are: (1) it runs asynchronously in the background without blocking the main conversation; (2) the output is a structured local Markdown file that users can directly view and edit; and (3) it reuses prompt cache via `runForkedAgent` to minimize costs. This "using an independent AI instance as a background scribe" model is currently relatively rare among AI coding tools.

---

## The Question

If you've ever looked closely at the `~/.claude/projects/` directory, you might have noticed a `session-memory.md` file in there. Who wrote it? When was it written? And what does it contain?

---

## How It Actually Works

While you work, Claude Code secretly runs a **background note-taking AI**.

### The Mechanism

Every time you send a message and wait for the AI to finish replying, the system checks whether it needs to "extract memory":

```
shouldExtractMemory(messages):
  1. Have tokens exceeded the initialization threshold? (If not, no need to take notes yet)
  2. Have tokens grown beyond the threshold since the last extraction?
  3. Have tool calls exceeded the threshold?
  4. Is the current AI NOT executing tools? (Don't interrupt during tool execution)
  
  Conditions met → trigger extractSessionMemory()
```

Note a crucial detail: **the token growth threshold is a necessary condition and cannot be bypassed**—even if tool call counts exceed the threshold, if tokens haven't grown enough, extraction will not occur. This prevents high-frequency, low-cost tool calls (such as multiple Glob queries) from meaninglessly triggering note-taking. Condition 4, "the current AI is not executing tools," acts as a natural breakpoint capture—the information gain is highest when the model has just finished a piece of work and entered the conversation phase.

When conditions are met, the system launches a `runForkedAgent`—an independent AI instance whose sole task is to **use the Edit tool to update the session-memory.md file**.

### Note Structure

The generated note file has 10 fixed sections:

```markdown
# Session Title
_5-10 word description of this session_

# Current State
_What is currently being done? What's next?_

# Task specification
_What did the user ask to build? What design decisions were made?_

# Files and Functions
_Which files matter? What do they contain?_

# Workflow
_What commands are typically run? In what order?_

# Errors & Corrections
_What errors occurred? How were they fixed? Which approaches failed?_

# Codebase and System Documentation
_What are the important system components? How do they work?_

# Learnings
_What worked? What didn't? What should be avoided?_

# Key results
_If the user requested specific output, the full result lives here_

# Worklog
_What was done at each step? A minimal summary_
```

When updating, the note-taking AI **can only modify** the content below each section heading—section names (`# ...`) and italic instruction lines (`_..._`) cannot be modified or deleted. All Edit operations must be executed in parallel, and then the AI must stop immediately.

#### The Original Note Template (DEFAULT_SESSION_MEMORY_TEMPLATE)

**Source**: `services/SessionMemory/prompts.ts` → `DEFAULT_SESSION_MEMORY_TEMPLATE` (lines 11-41)

This is the actual template text written into `session-memory.md`. The italic lines below each section heading are "writing instructions" for the note-taking AI, not content for the user:

```markdown
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and 
should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, 
repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
```

**Design highlights**: Note that the `# Session Title` instruction says "Super info dense, no filler"—this isn't a generic "please write a title" prompt, but an explicit demand for high information density and zero fluff. The `# Errors & Corrections` instruction specifically asks to record "What approaches failed and should not be tried again?"—this is the key to preventing the same mistakes in future sessions, and it represents the core value of this system's "lessons learned" memory. Users can replace this default template by placing a custom template at `~/.claude/session-memory/config/template.md`.

#### The Original Update Prompt (getDefaultUpdatePrompt)

**Source**: `services/SessionMemory/prompts.ts` → `getDefaultUpdatePrompt()` (lines 43-80)

This is the complete task instruction received by the note-taking AI. Note that the very first sentence is a disclaimer—preventing the AI from recording these "note-taking instructions" themselves into the notes:

```
IMPORTANT: This message and these instructions are NOT part of the actual user conversation. 
Do NOT include any references to "note-taking", "session notes extraction", or these update 
instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message as well as 
system prompt, claude.md entries, or any past session summaries), update the session notes file.

The file {{notesPath}} has already been read for you. Here are its current contents:
<current_notes_content>
{{currentNotes}}
</current_notes_content>

Your ONLY task is to use the Edit tool to update the notes file, then stop. You can make multiple 
edits (update every section as needed) - make all Edit tool calls in parallel in a single message. 
Do not call any other tools.

CRITICAL RULES FOR EDITING:
- The file must maintain its exact structure with all sections, headers, and italic descriptions intact
-- NEVER modify, delete, or add section headers (the lines starting with '#' like # Task specification)
-- NEVER modify or delete the italic _section description_ lines (these are the lines in italics 
   immediately following each header - they start and end with underscores)
-- The italic _section descriptions_ are TEMPLATE INSTRUCTIONS that must be preserved exactly as-is 
   - they guide what content belongs in each section
-- ONLY update the actual content that appears BELOW the italic _section descriptions_ within each 
   existing section
-- Do not add any new sections, summaries, or information outside the existing structure
- Do not reference this note-taking process or instructions anywhere in the notes
- It's OK to skip updating a section if there are no substantial new insights to add. Do not add 
  filler content like "No info yet", just leave sections blank/unedited if appropriate.
- Write DETAILED, INFO-DENSE content for each section - include specifics like file paths, function 
  names, error messages, exact commands, technical details, etc.
- For "Key results", include the complete, exact output the user requested (e.g., full table, full 
  answer, etc.)
- Do not include information that's already in the CLAUDE.md files included in the context
- Keep each section under ~2000 tokens/words - if a section is approaching this limit, condense it 
  by cycling out less important details while preserving the most critical information
- Focus on actionable, specific information that would help someone understand or recreate the work 
  discussed in the conversation
- IMPORTANT: Always update "Current State" to reflect the most recent work - this is critical for 
  continuity after compaction

Use the Edit tool with file_path: {{notesPath}}

STRUCTURE PRESERVATION REMINDER:
Each section has TWO parts that must be preserved exactly as they appear in the current file:
1. The section header (line starting with #)
2. The italic description line (the _italicized text_ immediately after the header - this is a 
   template instruction)

You ONLY update the actual content that comes AFTER these two preserved lines. The italic description 
lines starting and ending with underscores are part of the template structure, NOT content to be 
edited or removed.

REMEMBER: Use the Edit tool in parallel and stop. Do not continue after the edits. Only include 
insights from the actual user conversation, never from these note-taking instructions. Do not delete 
or change section headers or italic _section descriptions_.
```

💡 **Plain English**: This instruction is like a handoff guide given to a **new intern**—"You are only responsible for filling in the content cells of the form; the headers and instructions must not be touched; if a cell has nothing to write, leave it blank, don't write 'none'; each cell must not exceed 2000 words, so trim it yourself if it gets too long; most importantly: do not fill this 'how to fill out the form' guide into the form itself."

**Analysis of Five Key Design Decisions**:

| Rule | Code/Prompt Wording | Engineering Rationale |
|------|---------------------|----------------------|
| Cannot modify section headers or italic instructions | "NEVER modify, delete, or add section headers" | Ensures file format stability, supporting programmatic parsing |
| Allowing blanks, not mandatory filling | "It's OK to skip updating a section" | Prevents AI from generating low-quality filler content just to have something there |
| 2000 tokens per section limit | `MAX_SECTION_LENGTH = 2000` | Prevents infinite section growth, keeping total file within 12000-token budget |
| Must update Current State | "Always update 'Current State'... this is critical for continuity after compaction" | This is the core breakpoint information for resuming work after compression |
| `{{variableName}}` template variables | `substituteVariables()` single-pass substitution | Prevents user content containing `{{variableName}}` from being corrupted by double-substitution |

Note that the `sectionReminders` appended at the end of the prompt are dynamically added: when any section exceeds 2000 tokens or the total file exceeds 12000 tokens, the system automatically appends a warning at the end of the prompt saying "Your section X is too long and must be compressed." This is an automatic self-regulating mechanism—no human intervention is needed, and the file is automatically pruned during each update.

### Engineering Highlights of This Design

**The note-taking AI reuses the prompt cache from the main request.** Using the same `runForkedAgent` + `CacheSafeParams` pattern as speculative execution—this minimizes the extra cost of note-taking to only processing the newly added tokens.

> 📚 **Course Connection**: The `sequential()` serialization mechanism directly maps to the **mutual exclusion and synchronization** chapter in an *Operating Systems* course. This is essentially a simplified producer-consumer problem—multiple "note-taking trigger events" (producers) compete for the same `session-memory.md` file (critical resource), and `sequential()` acts as a mutex, ensuring only one write operation is executing at any given moment. This is lighter than using a file lock (`flock`) because all operations occur within the same Node.js process; JavaScript's single-threaded event loop naturally avoids true concurrent writes, and `sequential()` solves the **logical serialization of asynchronous operations** problem.

**`sequential()` prevents concurrent writes.** If the previous note-taking process hasn't finished, a new trigger will queue and wait, avoiding content corruption from concurrent file writes.

**Only runs on the main REPL thread.** During sub-agent, teammate, or speculation execution, the note-taking AI does not work. This prevents noise: it only records the main-line conversation, not the internal state of auxiliary agents.

### Purpose of the Notes

This file can be read by the AutoMem (automatic memory) system and become context for future sessions. When you reopen a project, the AI already knows where you left off—that's the value of SessionMemory.

### Related Thresholds (Remotely Configurable via GrowthBook)

- `minimumMessageTokensToInit`: How many tokens must accrue before the first extraction
- `minimumTokensBetweenUpdate`: Minimum token growth required between two extractions
- `toolCallsBetweenUpdates`: Minimum number of tool calls required between two extractions

The entire feature is controlled by the `tengu_session_memory` GrowthBook feature gate.

---

## Engineering Value of This Design

**It turns "AI watching AI and taking notes" into a reliable background service.**

Three key decisions ensure reliability:
1. `sequential()` — serialization, preventing concurrency
2. Threshold checks — preventing extraction after every AI reply (cost control)
3. Only updating content, not structure — keeping the file format stable across multiple updates

---

## Limitations and Critique

- **Uncontrollable note quality**: The note-taking AI uses the Sonnet model, which may miss critical details or produce inaccurate summaries for highly technical conversations
- **Only records main-line conversation**: The work of sub-agents, speculations, and other auxiliary threads is not recorded, yet these auxiliary efforts may contain important exploration results
- **Difficult threshold tuning**: `minimumMessageTokensToInit` and `minimumTokensBetweenUpdate` are remotely configured via GrowthBook, but optimal values vary by user work mode—fast-paced debugging sessions and slow-paced architecture discussions require different trigger frequencies

---

## Code Landmarks

- `src/services/SessionMemory/sessionMemory.ts`, line 272: `extractSessionMemory` function (full logic)
- `src/services/SessionMemory/sessionMemory.ts`, line 134: `shouldExtractMemory()` trigger logic
- `src/services/SessionMemory/prompts.ts`, line 11: `DEFAULT_SESSION_MEMORY_TEMPLATE` template content
- `src/services/SessionMemory/prompts.ts`, line 43: `getDefaultUpdatePrompt()` prompt (containing detailed rules)
