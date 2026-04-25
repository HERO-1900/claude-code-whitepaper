# Complete Analysis of the Skill Loading Infrastructure

This chapter analyzes Claude Code's Skill plugin loading mechanism, covering the full chain from built-in skills and user-defined Markdown files to MCP remote skills: discovery, metadata parsing, and on-demand loading.

---

> **🌍 Industry Background**: Plugin/skill extension mechanisms are one of the core competitive advantages of AI coding tools. **Cursor** uses `.cursorrules` files (plain-text prompts) for project-level behavior customization, but it does not support parameterized invocation or remote skill loading. **Aider** customizes behavior through `.aider.conf.yml` and command-line arguments, without an independent plugin system. **GitHub Copilot** supports third-party extensions through Copilot Extensions (based on GitHub Apps), using a heavyweight OAuth + API approach. **Windsurf** uses `.windsurfrules` files, similar to Cursor's plain-text approach. What makes Claude Code's Skill system unique is that it uses **Markdown + YAML frontmatter** as a unified format, while supporting both local files and MCP remote loading. This balances lightweight publishing (you can publish a skill by hand-writing a `.md` file) with extensibility (the MCP protocol can connect remote services). This design philosophy of "prompts as plugins" is forming a new paradigm among AI-native tools.

---

## Chapter Guide

Skill is the plugin mechanism used in Claude Code 2.1.88 to extend AI capabilities. Each Skill is essentially a Markdown file (containing YAML frontmatter metadata and a Markdown body prompt). When the user invokes it through a `/skill-name` slash command or Claude decides to call it automatically, the Skill's content is injected into the conversation as context.

**Technical analogy (OS perspective)**: The Skill loading system is like the **dynamic library loader (DLL/SO)** in an operating system. There are built-in libraries (bundled skills, similar to libc), user-installed libraries (the `.md` files in directories, similar to libraries under `/usr/lib`), and libraries from remote repositories (MCP skills, similar to packages from an apt source). The loader is responsible for discovery, metadata parsing (`frontmatter ≈ ELF header`), dependency resolution (`allowed-tools ≈ symbol resolution`), and on-demand loading (`getPromptForCommand ≈ dlopen`).

> 💡 **Plain English**: Skill is like a **mobile App Store**. There are built-in apps (bundled skills, like Calculator and Weather), third-party apps (user-written `.md` files or ones loaded from MCP), and each app has an instruction sheet (frontmatter metadata). Once installed, it can be used (loaded and executed), and different sources have different trust levels (built-in > local > MCP).

## File Structure

| File | Size | Responsibility |
|------|------|------|
| `loadSkillsDir.ts` | 34KB | Core loader: directory scanning, frontmatter parsing, command construction |
| `bundledSkills.ts` | 7.5KB | Built-in skill registration framework: skills compiled into the binary |
| `mcpSkillBuilders.ts` | 1.6KB | MCP skill adapter: a registry to break circular dependencies |
| `bundled/` directory | 17+ files | Concrete built-in skill implementations (including auxiliary content files) |

Including the skill files under `bundled/` (17 skill registrations + auxiliary files), the Skill subsystem totals about 20+ files.

## 1. Skill Source Categories

### 1.1 Six sources (including one deprecated compatibility path)

`loadSkillsDir.ts` lines 67-75 define the source types for skills:

```typescript
export type LoadedFrom =
  | 'commands_DEPRECATED'  // Legacy /commands directory (deprecated, kept for backward compatibility)
  | 'skills'               // .claude/skills/ directory
  | 'plugin'               // Skills provided by plugins
  | 'managed'              // Enterprise-managed skills
  | 'bundled'              // Built-in skills compiled into the binary
  | 'mcp'                  // Skills provided by MCP servers
```

The type definition includes six sources. Among them, `commands_DEPRECATED` is the compatibility entry point for the old `/commands` directory. It is still handled in the code (the loading logic scans that directory and marks the source accordingly), but it is no longer recommended. The five active sources are `skills`, `plugin`, `managed`, `bundled`, and `mcp`.

### 1.2 Directory hierarchy

Skill files are stored by hierarchy, with higher-priority levels overriding lower-priority ones:

```typescript
export function getSkillsPath(
  source: SettingSource | 'plugin',
  dir: 'skills' | 'commands',
): string {
  switch (source) {
    case 'policySettings':    return join(getManagedFilePath(), '.claude', dir)
    case 'userSettings':      return join(getClaudeConfigHomeDir(), dir)
    case 'projectSettings':   return `.claude/${dir}`
    case 'plugin':            return 'plugin'
    default:                  return ''
  }
}
```

Priority from highest to lowest: enterprise policy -> project-level -> user-level -> plugin -> built-in.

## 2. Frontmatter Parsing

### 2.1 Core parsing function

`parseSkillFrontmatterFields` (lines 185-265) is the most important function in the entire Skill system. It extracts all metadata from the YAML frontmatter:

```typescript
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  resolvedName: string,
  descriptionFallbackLabel: 'Skill' | 'Custom command' = 'Skill',
): {
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: ReturnType<typeof parseUserSpecifiedModel> | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  hooks: HooksSettings | undefined
  executionContext: 'fork' | undefined
  agent: string | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
}
```

A typical Skill Markdown file has frontmatter like this:

```yaml
---
name: Code Review
description: Review code for bugs and style issues
when_to_use: When the user asks for a code review or mentions PR review
allowed-tools: [Read, Grep, Glob]
argument-hint: <file-or-directory>
arguments: [path]
model: sonnet
effort: high
context: fork
user-invocable: true
---

You are a code review expert. Analyze the following code...
```

### 2.2 Key field handling details

**description fallback chain** (lines 208-214):

```typescript
const validatedDescription = coerceDescriptionToString(
  frontmatter.description, resolvedName,
)
const description =
  validatedDescription ??
  extractDescriptionFromMarkdown(markdownContent, descriptionFallbackLabel)
```

If the frontmatter does not include `description`, the system extracts the first paragraph from the Markdown body as the description.

**model inheritance semantics** (lines 222-227):

```typescript
const model =
  frontmatter.model === 'inherit'
    ? undefined                              // Inherit the main loop's model
    : frontmatter.model
      ? parseUserSpecifiedModel(frontmatter.model as string)
      : undefined                            // Unspecified also inherits
```

`model: inherit` is an explicit declaration: "use the current conversation's model." It has the same effect as omitting the `model` field.

**effort validation** (lines 228-235):

```typescript
const effortRaw = frontmatter['effort']
const effort = effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
if (effortRaw !== undefined && effort === undefined) {
  logForDebugging(
    `Skill ${resolvedName} has invalid effort '${effortRaw}'. ` +
    `Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
  )
}
```

`effort` supports predefined levels (such as `low`, `medium`, `high`) or integer values.

**agent field: specifying the sub-Agent type**

The frontmatter supports an `agent` field (`agent?: string`), and `BundledSkillDefinition` has a corresponding definition as well. The type comment in `command.ts` explicitly describes its purpose:

```typescript
// Agent type to use when forked (e.g., 'Bash', 'general-purpose')
// Only applicable when context is 'fork'
agent?: string
```

When a skill declares `context: fork`, it runs in an independent sub-Agent (with its own context and token budget). The `agent` field further specifies the **type** of that sub-Agent, for example `'Bash'` for an Agent focused on Shell execution, or `'general-purpose'` for a general Agent. This implies that Claude Code internally maintains definitions for multiple Agent types, and different types may come with different toolsets, system prompts, or behavior strategies. Combined with the existence of the `scheduleRemoteAgents.ts` skill, the `agent` field is a key interface in Claude Code's multi-Agent architecture: a Skill can do more than inject a prompt; it can also declaratively specify which Agent type should execute it, effectively routing tasks to executors.

**Inconsistent frontmatter naming styles (design observation)**

It is worth noting that the frontmatter fields mix three different naming styles:

| Naming style | Example fields |
|----------|----------|
| kebab-case | `allowed-tools`, `argument-hint`, `user-invocable`, `disable-model-invocation` |
| snake_case | `when_to_use` |
| camelCase | `userInvocable` (in `BundledSkillDefinition`) |

This is not a trivial code-style issue. It suggests that the Skill schema may be the product of multiple iteration cycles and multiple developers gradually adding fields, without unified governance over naming conventions. This is common in a fast-moving product (pragmatism over consistency), but as the number of fields grows (there are already 15+ fields), the inconsistency raises the cognitive load for Skill authors: is it `user-invocable` or `userInvocable`? `when_to_use` or `when-to-use`? A JSON Schema could mitigate this with aliases, but a pure frontmatter approach lacks that mechanism.

### 2.3 Path matching (Skill Paths)

The `parseSkillPaths` function (lines 159-178) supports gitignore-style path patterns:

```typescript
function parseSkillPaths(frontmatter: FrontmatterData): string[] | undefined {
  if (!frontmatter.paths) return undefined

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match everything), treat as unspecified
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return undefined
  }
  return patterns
}
```

This lets a skill declare that it should only be active under specific directories. For example, `paths: src/components/**` means it is only available in the components directory.

## 3. Command Construction Pipeline

### 3.1 createSkillCommand

The `createSkillCommand` function (lines 270-399) assembles the parsed metadata into an executable `Command` object:

```typescript
export function createSkillCommand({
  skillName, displayName, description, markdownContent,
  allowedTools, source, baseDir, loadedFrom, hooks, ...
}): Command {
  return {
    type: 'prompt',
    name: skillName,
    description,
    allowedTools,
    isHidden: !userInvocable,
    progressMessage: 'running',

    async getPromptForCommand(args, toolUseContext) {
      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent

      // 1. Replace argument placeholders
      finalContent = substituteArguments(finalContent, args, true, argumentNames)

      // 2. Replace ${CLAUDE_SKILL_DIR}
      if (baseDir) {
        const skillDir = process.platform === 'win32'
          ? baseDir.replace(/\\/g, '/') : baseDir
        finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
      }

      // 3. Replace ${CLAUDE_SESSION_ID}
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g, getSessionId()
      )

      // 4. Execute inline Shell commands (non-MCP sources only)
      if (loadedFrom !== 'mcp') {
        finalContent = await executeShellCommandsInPrompt(
          finalContent, toolUseContext, `/${skillName}`, shell
        )
      }

      return [{ type: 'text', text: finalContent }]
    },
  }
}
```

### 3.2 Variable substitution system

The Skill body supports three kinds of variable substitution:

| Variable | Meaning | Example |
|------|------|------|
| `$1`, `$2`, `${argName}` | User-supplied arguments | `/review $1` -> `/review src/app.ts` |
| `${CLAUDE_SKILL_DIR}` | The directory containing the skill file | Reference a companion file in the same directory |
| `${CLAUDE_SESSION_ID}` | Current session ID | Used for log correlation |

### 3.3 MCP security isolation

Notice the security restriction in lines 372-376:

```typescript
// Security: MCP skills are remote and untrusted — never execute inline
// shell commands (!`…` / ```! … ```) from their markdown body.
if (loadedFrom !== 'mcp') {
  finalContent = await executeShellCommandsInPrompt(...)
}
```

Skills loaded from MCP are **not allowed to execute inline Shell commands**. This is because MCP servers are remote and untrusted. If they were allowed to embed Shell commands inside Skill content, that would effectively give the remote server arbitrary code execution privileges.

### 3.4 Security analysis of inline Shell execution

`executeShellCommandsInPrompt` is the **most powerful and most dangerous feature** in the entire Skill system. It upgrades Skill from a "static prompt template" to an "executable prompt." The Skill body can embed Shell commands (lines prefixed with `!` or `` ```! ``` `` code blocks), which are executed automatically during loading and have their output inlined into the prompt.

```typescript
// Two syntax patterns in promptShellExecution.ts
const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g    // Code block: ```! command ```
const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm          // Inline: !`command`
```

**This means that a Skill file is functionally equivalent to an executable program.** A Markdown file placed under `.claude/skills/` can:

1. **Execute arbitrary code through inline Shell commands**: `!`git log --oneline -5`` runs directly during loading
2. **Request tool access through `allowed-tools`**: for example, access to BashTool, file read/write, and so on
3. **Register lifecycle hooks through the `hooks` field**: run extra logic when specific events fire

**Security defense analysis**

The code does include permission checks. Before executing each command, `executeShellCommandsInPrompt` calls `hasPermissionsToUseTool`:

```typescript
const permissionResult = await hasPermissionsToUseTool(
  shellTool, { command }, context,
  createAssistantMessage({ content: [] }), '',
)
if (permissionResult.behavior !== 'allow') {
  throw new MalformedCommandError(
    `Shell command permission check failed for pattern "${match[0]}": ...`
  )
}
```

But the **supply-chain risk** deserves attention: if an open-source project's `.claude/skills/` directory contains a malicious Skill file (similar to a malicious Action in `.github/workflows`), a user might clone the repository and execute malicious commands without realizing it. This trust model is similar to Git hooks (`.git/hooks/`), except that Git hooks require manual activation, while a Skill file may be automatically recommended by Claude once its path matches.

**Analogy to GitHub Actions `run:` steps**: the `run:` field in GitHub Actions YAML can execute Shell commands, and the community has built a mature auditing toolchain around that (Dependabot, CodeQL scans for workflow files, etc.). The Shell execution capability in Skill files is essentially the same in nature, but it currently lacks similar static analysis and auditing mechanisms. Skill behavior is not statically analyzable, because the output of Shell commands can affect the final prompt content.

> 💡 **Plain English**: A normal Skill is like a recipe. It tells the chef (Claude) how to cook. But a Skill with `!` Shell commands is like a recipe that "goes to the grocery store by itself first." Before it is used, it runs some actions on its own. That is convenient (it can fetch environment information dynamically), but it also means you need to trust that the recipe author is not doing anything harmful during the "shopping" step.

## 4. Built-in Skill System (Bundled Skills)

### 4.1 Registration framework

`bundledSkills.ts` provides registration and management for built-in skills:

```typescript
export type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  files?: Record<string, string>  // Attached reference files
  getPromptForCommand: (args: string, context: ToolUseContext) =>
    Promise<ContentBlockParam[]>
}
```

The registration interface uses the same "register at startup" pattern found elsewhere inside Claude Code (such as `registerPostSamplingHook()`). Definitions are pushed into a global registry during module initialization:

```typescript
export function registerBundledSkill(definition: BundledSkillDefinition): void {
  const command: Command = {
    type: 'prompt',
    name: definition.name,
    source: 'bundled',
    loadedFrom: 'bundled',
    // ...
  }
  bundledSkills.push(command)
}
```

### 4.2 Extraction of companion files

Built-in skills can include reference files (the `files` field). These files are extracted to disk on first invocation:

```typescript
if (files && Object.keys(files).length > 0) {
  skillRoot = getBundledSkillExtractDir(definition.name)
  let extractionPromise: Promise<string | null> | undefined
  const inner = definition.getPromptForCommand
  getPromptForCommand = async (args, ctx) => {
    extractionPromise ??= extractBundledSkillFiles(definition.name, files)
    const extractedDir = await extractionPromise
    const blocks = await inner(args, ctx)
    if (extractedDir === null) return blocks
    return prependBaseDir(blocks, extractedDir)
  }
}
```

This uses Promise memoization (`extractionPromise ??= ...`). Multiple concurrent invocations only trigger one extraction.

### 4.3 Safe writes

File writes use a secure mode that defends against symlink attacks (lines 176-193):

```typescript
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const SAFE_WRITE_FLAGS = process.platform === 'win32'
  ? 'wx'                                          // Windows uses a string flag
  : fsConstants.O_WRONLY | fsConstants.O_CREAT |
    fsConstants.O_EXCL | O_NOFOLLOW               // Unix uses numeric flags

async function safeWriteFile(p: string, content: string): Promise<void> {
  const fh = await open(p, SAFE_WRITE_FLAGS, 0o600)
  try {
    await fh.writeFile(content, 'utf8')
  } finally {
    await fh.close()
  }
}
```

It uses `O_EXCL` (fail if the file exists) + `O_NOFOLLOW` (reject symlinks) + `0o600` (owner read/write only) + `0o700` directory permissions. The comment explains the design: "The per-process nonce in getBundledSkillsRoot() is the primary defense against pre-created symlinks/dirs." The random directory name is the primary defense, while filesystem flags provide additional protection.

> **📚 Course connection**: This code is a textbook case of **filesystem security** from an Operating Systems course. The `O_EXCL | O_NOFOLLOW` combination defends against the classic **TOCTOU (Time-of-Check to Time-of-Use) race attack**: an attacker inserts a symlink in the window between checking that a file does not exist and creating the file, redirecting writes to a sensitive target such as `/etc/passwd`. `O_EXCL` merges the check and create operations into a single atomic step, `O_NOFOLLOW` rejects symlink dereferencing, and the random directory name (nonce) prevents the attacker from predicting the target path. This is a classic **Defense in Depth** strategy.

### 4.4 Concrete built-in skills

The `bundled/` directory contains 17 built-in skill registrations (10 always registered, 7 controlled by feature flags or runtime conditions):

| File | Skill name | Purpose | Registration condition |
|------|--------|------|----------|
| `updateConfig.ts` | update-config | Update configuration | Always registered |
| `keybindings.ts` | keybindings | Keyboard shortcut configuration | Always registered |
| `verify.ts` | verify | Code verification | Always registered |
| `debug.ts` | debug | Debugging assistance | Always registered |
| `loremIpsum.ts` | lorem-ipsum | Generate test data | Always registered |
| `skillify.ts` | skillify | Turn an operation into a Skill | Always registered |
| `remember.ts` | remember | Memory management | Always registered |
| `simplify.ts` | simplify | Code simplification review | Always registered |
| `batch.ts` | batch | Batch processing | Always registered |
| `stuck.ts` | stuck | Assistance when stuck | Always registered |
| `dream.ts` | dream | Dream feature | `KAIROS` / `KAIROS_DREAM` feature flag |
| `hunter.ts` | hunter | Review artifacts | `REVIEW_ARTIFACT` feature flag |
| `loop.ts` | loop | Repeated task execution | `AGENT_TRIGGERS` feature flag |
| `scheduleRemoteAgents.ts` | schedule | Remote Agent scheduling | `AGENT_TRIGGERS_REMOTE` feature flag |
| `claudeApi.ts` | claude-api | Claude API / SDK usage guidance | `BUILDING_CLAUDE_APPS` feature flag |
| `claudeInChrome.ts` | claude-in-chrome | Chrome extension integration | `shouldAutoEnableClaudeInChrome()` |
| `runSkillGenerator.ts` | run-skill-generator | Skill generator | `RUN_SKILL_GENERATOR` feature flag |

Note: the `bundled/` directory also contains auxiliary files such as `index.ts` (registration entry), `claudeApiContent.ts`, and `verifyContent.ts`. These are not standalone skills; they provide content data for the corresponding skills. Skills controlled by feature flags use dynamic `require()` for lazy loading, avoiding unnecessary code loading when the feature is disabled.

## 4.5 Original prompt text of three key built-in skills

The essence of built-in skills (bundled skills) is not just the registration framework, but also their concrete prompts such as `SIMPLIFY_PROMPT`, `SKILLIFY_PROMPT`, and `buildPrompt()`. These are the original-text evidence of how Claude Code uses prompt engineering to implement "self-reflection," "workflow capture," and "scheduled loops."

---

### 4.5.1 SIMPLIFY_PROMPT: a code quality workflow with three parallel review Agents

**Source location**: `src/skills/bundled/simplify.ts`, lines 4-53

The `/simplify` skill is the core of Claude Code's self-review mechanism. Its prompt shows how a single Skill can drive three parallel Agents to review code from independent dimensions:

```
# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run `git diff` (or `git diff HEAD` if there are staged changes) to see what changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool to launch all three agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props (flexShrink, alignItems, etc.) already provide the needed behavior
7. **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that), narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. Also: if a wrapper function takes an updater/reducer callback, verify it honors same-reference returns (or whatever the "no change" signal is) — otherwise callers' early-return no-ops are silently defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).
```

**Chinese analysis**: The design of `SIMPLIFY_PROMPT` reveals the precise mechanism by which Claude Code uses prompts to drive Agent collaboration:

1. **Division of labor for three parallel Agents**: the three review Agents are assigned clearly separated, non-overlapping review dimensions: code reuse (is the code reinventing the wheel?), code quality (does it contain bad patterns?), and efficiency (does it introduce performance problems?). This split is not arbitrary. Each dimension is an independent perspective that human code reviewers genuinely care about, and there is almost no information dependency among them, which makes them naturally suitable for parallel execution.
2. **"Pass each agent the full diff"**: the prompt requires the full diff to be passed to each Agent instead of having them read files on their own. This ensures that all three Agents review the code based on the same information, avoiding inconsistencies caused by different read timing.
3. **Aggregation strategy in Phase 3**: `If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.` The intent of this sentence is: **do not let Claude fall into the trap of arguing with sub-Agent findings**. If one of the review Agents reports something that may be a false positive, Claude should skip it directly rather than spending time explaining why it is not a problem. That is more efficient.
4. **Precision of the code quality prohibitions**: every item in Agent 2's checklist is a precise anti-pattern description (for example, "Stringly-typed code: using raw strings where constants, enums already exist"), not vague advice such as "write good code." This indicates that these rules come from real code review experience, not theoretical deduction.

---

### 4.5.2 SKILLIFY_PROMPT: a meta-prompt for turning a session into a reusable skill

**Source location**: `src/skills/bundled/skillify.ts`, lines 22-156

`/skillify` is Claude Code's most "metacognitive" built-in skill. It asks Claude to review the current session, extract a reusable workflow, and write it as a new Skill file. It is only available to Anthropic internal users (registration is skipped when `process.env.USER_TYPE !== 'ant'`).

```
# Skillify {{userDescriptionBlock}}

You are capturing this session's repeatable process as a reusable skill.

## Your Session Context

Here is the session memory summary:
<session_memory>
{{sessionMemory}}
</session_memory>

Here are the user's messages during this session. Pay attention to how they steered the process, to help capture their detailed preferences in the skill:
<user_messages>
{{userMessages}}
</user_messages>

## Your Task

### Step 1: Analyze the Session

Before asking any questions, analyze the session to identify:
- What repeatable process was performed
- What the inputs/parameters were
- The distinct steps (in order)
- The success artifacts/criteria (e.g. not just "writing code," but "an open PR with CI fully passing") for each step
- Where the user corrected or steered you
- What tools and permissions were needed
- What agents were used
- What the goals and success artifacts were

### Step 2: Interview the User

You will use the AskUserQuestion to understand what the user wants to automate. Important notes:
- Use AskUserQuestion for ALL questions! Never ask questions via plain text.
- For each round, iterate as much as needed until the user is happy.
- The user always has a freeform "Other" option to type edits or feedback -- do NOT add your own "Needs tweaking" or "I'll provide edits" option. Just offer the substantive choices.

**Round 1: High level confirmation**
- Suggest a name and description for the skill based on your analysis. Ask the user to confirm or rename.
- Suggest high-level goal(s) and specific success criteria for the skill.

**Round 2: More details**
- Present the high-level steps you identified as a numbered list. Tell the user you will dig into the detail in the next round.
- If you think the skill will require arguments, suggest arguments based on what you observed. Make sure you understand what someone would need to provide.
- If it's not clear, ask if this skill should run inline (in the current conversation) or forked (as a sub-agent with its own context). Forked is better for self-contained tasks that don't need mid-process user input; inline is better when the user wants to steer mid-process.
- Ask where the skill should be saved. Suggest a default based on context (repo-specific workflows → repo, cross-repo personal workflows → user). Options:
  - **This repo** (`.claude/skills/<name>/SKILL.md`) — for workflows specific to this project
  - **Personal** (`~/.claude/skills/<name>/SKILL.md`) — follows you across all repos

**Round 3: Breaking down each step**
For each major step, if it's not glaringly obvious, ask:
- What does this step produce that later steps need? (data, artifacts, IDs)
- What proves that this step succeeded, and that we can move on?
- Should the user be asked to confirm before proceeding? (especially for irreversible actions like merging, sending messages, or destructive operations)
- Are any steps independent and could run in parallel? (e.g., posting to Slack and monitoring CI at the same time)
- How should the skill be executed? (e.g. always use a Task agent to conduct code review, or invoke an agent team for a set of concurrent steps)
- What are the hard constraints or hard preferences? Things that must or must not happen?

You may do multiple rounds of AskUserQuestion here, one round per step, especially if there are more than 3 steps or many clarification questions. Iterate as much as needed.

IMPORTANT: Pay special attention to places where the user corrected you during the session, to help inform your design.

**Round 4: Final questions**
- Confirm when this skill should be invoked, and suggest/confirm trigger phrases too. (e.g. For a cherrypick workflow you could say: Use when the user wants to cherry-pick a PR to a release branch. Examples: 'cherry-pick to release', 'CP this PR', 'hotfix.')
- You can also ask for any other gotchas or things to watch out for, if it's still unclear.

Stop interviewing once you have enough information. IMPORTANT: Don't over-ask for simple processes!

### Step 3: Write the SKILL.md

Create the skill directory and file at the location the user chose in Round 2.

Use this format:

```markdown
---
name: {{skill-name}}
description: {{one-line description}}
allowed-tools:
  {{list of tool permission patterns observed during session}}
when_to_use: {{detailed description of when Claude should automatically invoke this skill, including trigger phrases and example user messages}}
argument-hint: "{{hint showing argument placeholders}}"
arguments:
  {{list of argument names}}
context: {{inline or fork -- omit for inline}}
---

# {{Skill Title}}
Description of skill

## Inputs
- `$arg_name`: Description of this input

## Goal
Clearly stated goal for this workflow. Best if you have clearly defined artifacts or criteria for completion.

## Steps

### 1. Step Name
What to do in this step. Be specific and actionable. Include commands when appropriate.

**Success criteria**: ALWAYS include this! This shows that the step is done and we can move on. Can be a list.

IMPORTANT: see the next section below for the per-step annotations you can optionally include for each step.

...
```

**Per-step annotations**:
- **Success criteria** is REQUIRED on every step. This helps the model understand what the user expects from their workflow, and when it should have the confidence to move on.
- **Execution**: `Direct` (default), `Task agent` (straightforward subagents), `Teammate` (agent with true parallelism and inter-agent communication), or `[human]` (user does it). Only needs specifying if not Direct.
- **Artifacts**: Data this step produces that later steps need (e.g., PR number, commit SHA). Only include if later steps depend on it.
- **Human checkpoint**: When to pause and ask the user before proceeding. Include for irreversible actions (merging, sending messages), error judgment (merge conflicts), or output review.
- **Rules**: Hard rules for the workflow. User corrections during the reference session can be especially useful here.

**Step structure tips:**
- Steps that can run concurrently use sub-numbers: 3a, 3b
- Steps requiring the user to act get `[human]` in the title
- Keep simple skills simple -- a 2-step skill doesn't need annotations on every step

**Frontmatter rules:**
- `allowed-tools`: Minimum permissions needed (use patterns like `Bash(gh:*)` not `Bash`)
- `context`: Only set `context: fork` for self-contained skills that don't need mid-process user input.
- `when_to_use` is CRITICAL -- tells the model when to auto-invoke. Start with "Use when..." and include trigger phrases. Example: "Use when the user wants to cherry-pick a PR to a release branch. Examples: 'cherry-pick to release', 'CP this PR', 'hotfix'."
- `arguments` and `argument-hint`: Only include if the skill takes parameters. Use `$name` in the body for substitution.

### Step 4: Confirm and Save

Before writing the file, output the complete SKILL.md content as a yaml code block in your response so the user can review it with proper syntax highlighting. Then ask for confirmation using AskUserQuestion with a simple question like "Does this SKILL.md look good to save?" — do NOT use the body field, keep the question concise.

After writing, tell the user:
- Where the skill was saved
- How to invoke it: `/{{skill-name}} [arguments]`
- That they can edit the SKILL.md directly to refine it
```

**Chinese analysis**: SKILLIFY_PROMPT is the prompt in Claude Code that most clearly demonstrates "metacognition." It asks the AI to carry out a structured retrospective on work it just completed:

1. **The `{{sessionMemory}}` and `{{userMessages}}` template variables**: these placeholders are replaced at runtime with real session content (`skillify.ts` lines 190-193). `sessionMemory` comes from `getSessionMemoryContent()`, while `userMessages` is a filtered extraction of user messages. This means Skillify is a **context-aware meta-prompt**. It is not static; it injects the actual content of the current session at runtime.
2. **Four rounds of structured interviewing (`AskUserQuestion`)**: Skillify does not generate a Skill file directly. Instead, it uses four rounds of interviews to guide the user in clarifying the details: high-level confirmation (name/description) -> step details -> success criteria for each step -> trigger conditions. This multi-round dialogue strategy ensures that the generated Skill accurately reflects the user's real needs rather than the AI's subjective guesswork.
3. **"Pay special attention to places where the user corrected you"**: this instruction asks the AI to treat the user's **corrections** during the session as key information to be distilled into the Skill, because such corrections often reflect the user's implicit preferences and boundary conditions. These are the hardest constraints to express explicitly in a Skill file, but also the most important.
4. **"Success criteria is REQUIRED on every step"**: SKILLIFY_PROMPT emphasizes that every step must have explicit success criteria. This reflects Anthropic's philosophy of workflow automation: a good automated workflow should not just know "what was done," but also "how to tell whether this step succeeded," so it can stop promptly on failure rather than blindly continuing.
5. **Available only to internal users** (`skillify.ts` lines 159-161): `if (process.env.USER_TYPE !== 'ant') return`. Skillify is currently an internal-only Anthropic feature. This suggests that the capability of "letting AI automatically capture workflows and generate new Skills" is still in an internal testing phase and has not yet been released externally.

---

### 4.5.3 `buildPrompt()` in loop.ts: a natural-language parsing engine for scheduled loops

**Source location**: `src/skills/bundled/loop.ts`, `buildPrompt()` function (lines 25-72)

The `/loop` skill implements the ability to "have Claude repeat a task periodically" (for example, checking CI status every 5 minutes). Its core is the `buildPrompt()` function, which generates a prompt containing complete natural-language parsing rules and time-expression conversion logic:

```
# /loop — schedule a recurring prompt

Parse the input below into `[interval] <prompt…>` and schedule it with CronCreate.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches `^\d+[smhd]$` (e.g. `5m`, `2h`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with `every <N><unit>` or `every <N> <unit-word>` (e.g. `every 20m`, `every 5 minutes`, `every 2 hours`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — `check every PR` has no interval.
3. **Default**: otherwise, interval is `10m` and the entire input is the prompt.

If the resulting prompt is empty, show usage `/loop [interval] <prompt>` and stop — do not call CronCreate.

Examples:
- `5m /babysit-prs` → interval `5m`, prompt `/babysit-prs` (rule 1)
- `check the deploy every 20m` → interval `20m`, prompt `check the deploy` (rule 2)
- `run tests every 5 minutes` → interval `5m`, prompt `run tests` (rule 2)
- `check the deploy` → interval `10m`, prompt `check the deploy` (rule 3)
- `check every PR` → interval `10m`, prompt `check every PR` (rule 3 — "every" not followed by time)
- `5m` → empty prompt → show usage

## Interval → cron

Supported suffixes: `s` (seconds, rounded up to nearest minute, min 1), `m` (minutes), `h` (hours), `d` (days). Convert:

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| `Nm` where N ≤ 59   | `*/N * * * *`     | every N minutes                          |
| `Nm` where N ≥ 60   | `0 */H * * *`     | round to hours (H = N/60, must divide 24)|
| `Nh` where N ≤ 23   | `0 */N * * *`     | every N hours                            |
| `Nd`                | `0 0 */N * *`     | every N days at midnight local           |
| `Ns`                | treat as `ceil(N/60)m` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. `7m` → `*/7 * * * *` gives uneven gaps at :56→:00; `90m` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.

## Action

1. Call CronCreate with:
   - `cron`: the expression from the table above
   - `prompt`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - `recurring`: `true`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after 7 days, and that they can cancel sooner with CronDelete (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

[user's input here]
```

**Chinese analysis**: `buildPrompt()` is a special case of "**prompt as compiler**" design:

1. **Embedding parser rules inside the prompt**: a traditional implementation would write regular expressions in TypeScript to parse input like "5m /babysit-prs." `loop.ts` chooses a different path: it writes the parsing rules into the prompt and lets the AI parse the natural-language input. This means the parsing logic has higher tolerance for natural-language edge cases, such as recognizing that the "every" in "check every PR" is not a time interval.
2. **The edge case `check every PR`**: the prompt explicitly lists the counterexample "`check every PR` has no interval" to prevent the AI from misinterpreting "every PR" as a time interval. Making boundary cases explicit like this is more reliable than relying on the model's "common sense."
3. **The Interval -> cron conversion table**: the prompt embeds a full conversion table from time intervals to cron expressions, including instructions for cases that "do not divide cleanly" ("pick the nearest clean interval and tell the user"). This hands mathematical boundary-case handling to the AI instead of hardcoding it in TypeScript.
4. **"Then immediately execute the parsed prompt now"**: execute once immediately after creating the scheduled task. This is strong UX design. The user does not have to wait for the first cron cycle to see an effect. Immediate execution gives instant feedback and validates that the task configuration is correct.
5. **Dynamic prompt generation** (`buildPrompt(args: string)` line 26): `buildPrompt()` takes the user input `args` as a parameter and embeds it into the final `## Input` section of the prompt. This is a "data-instruction separation" design pattern: the body of the prompt is fixed parsing instructions, and the user input is data. The two are clearly separated. Structurally, this is similar to parameterized SQL queries (which prevent SQL injection): separate instructions from data so that data is not misinterpreted as instructions.

**Comparison of the three built-in skills**:

| Skill | Prompt role | Number of sub-Agents | Key design characteristics |
|------|-----------|--------------|-------------|
| `/simplify` | Orchestrator | 3 parallel review Agents | Dimension separation + parallelism + aggregated fixes |
| `/skillify` | Metacognitive guide | 0 (inline execution) | Four-round interview + context injection + Skill file generation |
| `/loop` | Natural-language parser + scheduler | 0 (calls the `CronCreate` tool) | Rules embedded in prompt + immediate execution + cron conversion |

These three skills demonstrate three different uses of the Skill system: using prompts to drive multi-Agent parallelism (`simplify`), using prompts to capture interactive workflows (`skillify`), and using prompts to implement natural-language DSL parsing (`loop`).

---

## 5. MCP Skill Bridging

### 5.1 The circular dependency problem

The existence of `mcpSkillBuilders.ts` is purely to solve a circular dependency problem. As the comment says:

```typescript
/**
 * Write-once registry for the two loadSkillsDir functions that MCP skill
 * discovery needs. This module is a dependency-graph leaf: it imports nothing
 * but types, so both mcpSkills.ts and loadSkillsDir.ts can depend on it
 * without forming a cycle (client.ts → mcpSkills.ts → loadSkillsDir.ts → …
 * → client.ts).
 */
```

Dependency chain: `client.ts → mcpSkills.ts → loadSkillsDir.ts → ... → client.ts`. A direct import would create a cycle. The solution is to decouple the shared functions via a registry pattern:

```typescript
export type MCPSkillBuilders = {
  createSkillCommand: typeof createSkillCommand
  parseSkillFrontmatterFields: typeof parseSkillFrontmatterFields
}

let builders: MCPSkillBuilders | null = null

export function registerMCPSkillBuilders(b: MCPSkillBuilders): void {
  builders = b
}

export function getMCPSkillBuilders(): MCPSkillBuilders {
  if (!builders) {
    throw new Error(
      'MCP skill builders not registered — loadSkillsDir.ts has not been evaluated yet',
    )
  }
  return builders
}
```

Registration happens during module initialization in `loadSkillsDir.ts`. Because `commands.ts` statically imports `loadSkillsDir.ts`, the registration completes before any MCP server connection is established.

> **📚 Course connection**: This strategy for breaking circular dependencies is a real-world application of the **Dependency Inversion Principle (DIP)** from Software Engineering. By introducing a dependency-free "registry" leaf module, the direct dependency is converted into indirect runtime registration. In essence, this is the **Service Locator Pattern**. It belongs to the same family of techniques used by Java Spring's IoC container and Angular's dependency injection when resolving circular dependencies.

### 5.2 The trap of dynamic import

The comment also mentions a Bun packaging limitation:

```typescript
// The non-literal dynamic-import approach ("await import(variable)") fails at
// runtime in Bun-bundled binaries — the specifier is resolved against the
// chunk's /$bunfs/root/… path, not the original source tree
```

In a Bun-packaged binary, `await import(variablePath)` fails because path resolution points to the virtual filesystem (`$bunfs/root`) rather than the source tree. Literal dynamic imports can work, but they are tracked by dependency analysis tools (dependency-cruiser), creating fresh circular dependency warnings.

## 6. File Deduplication Mechanism

### 6.1 Deduplication based on realpath

`loadSkillsDir.ts` lines 118-124 detect duplicate files by resolving symlinks:

```typescript
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}
```

The comment cites a specific issue (#13893): "Uses realpath to resolve symlinks, which is filesystem-agnostic and avoids issues with filesystems that report unreliable inode values (e.g., inode 0 on some virtual/container/NFS filesystems, or precision loss on ExFAT)"

The original implementation may have used inodes for deduplication, but some filesystems (ExFAT, NFS, containerized virtual filesystems) report unreliable inode values (possibly 0 or overflow), so the code switched to `realpath`.

### 6.2 Token estimation

```typescript
export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}
```

Only the frontmatter is included in token estimation, not the full content, because skill content is loaded lazily and only read when invoked.

## 7. Hooks Integration

Skills can define `hooks` through frontmatter:

```typescript
function parseHooksFromFrontmatter(
  frontmatter: FrontmatterData,
  skillName: string,
): HooksSettings | undefined {
  if (!frontmatter.hooks) return undefined
  const result = HooksSchema().safeParse(frontmatter.hooks)
  if (!result.success) {
    logForDebugging(`Invalid hooks in skill '${skillName}': ${result.error.message}`)
    return undefined
  }
  return result.data
}
```

Validation is performed with a Zod schema. Malformed `hooks` are ignored quietly (logged for debugging, but not treated as an error).

## Critical Analysis

### Strengths

1. **Unified Markdown format**: using frontmatter + Markdown as the skill description format is a mature and practical choice (already proven by static site generators like Hugo and Jekyll). It is human-readable, version-control friendly, and easy to write, while frontmatter provides structured metadata.
2. **Layered overrides**: the hierarchy of enterprise policy > project > user > built-in satisfies enterprise compliance requirements while still giving individual users substantial room for customization.
3. **MCP security isolation**: prohibiting skills loaded from MCP from executing inline Shell commands is the correct security decision.
4. **Lazy loading**: full content is only read when a skill is invoked, reducing startup memory and I/O overhead.
5. **Secure file writes**: the defense combination of `O_EXCL | O_NOFOLLOW` + random directory names is highly professional.

### Weaknesses

1. **Monolithic single file**: `loadSkillsDir.ts` is 34KB and includes too many responsibilities: parsing, loading, building, deduplication, Hooks handling, and more. It should be split.
2. **Residual `commands_DEPRECATED` support**: the old `/commands` directory is still supported (the `LoadedFrom` type still includes `commands_DEPRECATED`), and there is no clear plan for when this compatibility burden will be removed.
3. **Lack of version compatibility handling**: frontmatter does not have standardized version handling. Although there is a `version` field, there is no visible version-based compatibility check.
4. **Second-class status of MCP skills**: MCP skills cannot execute Shell commands and cannot use `${CLAUDE_SKILL_DIR}`. These restrictions are security-driven, but if the MCP server is trusted (for example, an internal enterprise server), the user has no way to override them.
5. **The smell of circular dependencies**: the existence of `mcpSkillBuilders.ts` indicates that the dependency relationships between modules need refactoring. Using a runtime registry to break compile-time circular dependencies works, but it adds an implicit "registration order" constraint. If an MCP server connects before `loadSkillsDir.ts` is loaded, the system will throw.
