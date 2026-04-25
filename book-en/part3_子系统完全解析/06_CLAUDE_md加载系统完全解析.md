# Complete Analysis of the CLAUDE.md Loading System

CLAUDE.md is Claude Code's "repository-level instruction system"—it lets users and teams write project conventions, coding standards, and tool preferences in Markdown files, which Claude automatically loads at the start of every conversation. But "loading a Markdown file" is far more complex than it sounds—the system must handle multi-level lookups ranging from enterprise-wide policies to project subdirectories, recursive `@include` file references, frontmatter conditional rules, security validation for different sources, token cost optimization, and interaction with the Hooks and Memory systems. This chapter provides a complete analysis of the loading chain, search paths, merge strategy, and security boundaries.

> **Source locations**: Core logic is spread across multiple files:
> - `src/utils/claudemd.ts` (lowercase m) — file discovery, `@include` processing, cache management
> - `src/context.ts` — `getUserContext()` entry point, yoloClassifier cache injection
> - `src/utils/memory/types.ts` — `MemoryType` type definitions
> - `src/utils/frontmatterParser.ts` — YAML frontmatter parsing, conditional rule glob expansion
> - `src/utils/config.ts` — `getMemoryPath()`, path calculations for each level
> - `src/utils/settings/managedPath.ts` — enterprise managed paths (`/etc/claude-code/`, etc.)

> 💡 **Plain English**: CLAUDE.md is like the project handbook a new hire reads before starting—from the company headquarters' mandatory compliance manual (`Managed`, equivalent to IT-department-distributed policies that employees cannot delete or modify), to personal global work habits (`User`), to departmental project conventions (`Project`), to private personal notes (`Local`), collected and layered along the way. The new hire (Claude) reads through all of these handbooks before starting work each time. And the `@include` directive is like a "see Appendix A" reference in a handbook—one file can reference others and automatically expand them.

> 🌍 **Industry Context**: "Project-level instruction files" have become a standard feature in AI coding tools, but products vary greatly in implementation depth. **Cursor** supports `.cursor/rules/` for multi-file rules, frontmatter conditional rules (based on glob-matched file types), and rule activation modes like `alwaysApply` / `autoAttach` / `agentRequested`. **Aider**'s `.aider.conf.yml` is primarily tool configuration rather than AI behavior instructions. **GitHub Copilot** supports `.github/copilot-instructions.md` as a project-level instruction, but only a single level with no user-level or subdirectory layering. **Windsurf** has a similar `.windsurfrules` file. **CodeX (OpenAI)** supports `codex.md` and `AGENTS.md`, with a design inspired by Claude Code's multi-level loading. **Cline**'s `.clinerules` and **Roo Code**'s `.roo/rules/` also support multi-file rules directories and conditional rules. Claude Code's CLAUDE.md system is the most comprehensive in terms of hierarchy depth (Managed → User → Project → Local), and its `@include` recursive file reference is unique among comparable products. But the difference between Claude Code and Cursor is no longer "has it vs. doesn't have it"—it's about specific design choices: Claude Code's upward directory traversal vs. Cursor's flat rules directory, Claude Code's full concatenation vs. Cursor's conditional activation model.

---

## Overview

CLAUDE.md is Claude Code's "repository-level instruction system"—it lets users and teams write project conventions, coding standards, and tool preferences in Markdown files, which Claude automatically loads at the start of every conversation. But "loading a Markdown file" is far more complex than it sounds—the system must handle multi-level lookups, recursive `@include` references, security validation, token cost optimization, and interaction with the Memory system.

---

> **[Chart placeholder 3.6-A]**: Lookup chain diagram — CLAUDE.md loading order across the four types from Managed → User → Project → Local, plus `.claude/rules/` rules directory and `@include` recursive expansion

---

## 1. The Four MemoryTypes and Discovery Algorithm

### 1.1 The Four Types: Managed / User / Project / Local

The source in `memory/types.ts` defines the complete MemoryType type system:

```typescript
// src/utils/memory/types.ts
export const MEMORY_TYPE_VALUES = [
  'User',      // user global instructions
  'Project',   // project-level instructions (checked into the repo)
  'Local',     // local private instructions (gitignored)
  'Managed',   // enterprise management policies (deployed by sysadmins)
  'AutoMem',   // automatic memory
  // 'TeamMem' — team memory (controlled by feature flag)
] as const
```

The file-header comment in `claudemd.ts` explicitly defines the loading order and priority of the four core types:

```
Loading order (earlier to later, later = higher priority):
1. Managed (enterprise policy) — e.g., /etc/claude-code/CLAUDE.md
2. User (user global instructions) — ~/.claude/CLAUDE.md
3. Project (project instructions) — CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md
4. Local (local private instructions) — CLAUDE.local.md
```

> 💡 **Plain English**: These four layers are like a company's policy system—Managed is the compliance document from headquarters (mandatory for all employees, cannot be deleted); User is your personal work-habits memo; Project is the department's project standard manual (shared by the whole team); Local is your own private annotation on top of the project standards (not submitted to the team's shared documents).

### 1.2 Managed Type: Enterprise Policy Injection

**This is the most significant layer from a security perspective.** The Managed type loads from system-level paths deployed by IT administrators via MDM (Mobile Device Management) or endpoint management tools:

```typescript
// src/utils/settings/managedPath.ts
export const getManagedFilePath = memoize(function (): string {
  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/ClaudeCode'
    case 'windows':
      return 'C:\\Program Files\\ClaudeCode'
    default:
      return '/etc/claude-code'  // Linux
  }
})
```

The Managed layer has two key design characteristics:

1. **Loads first** (lowest priority in position, but this "lowest" still means its content is seen by the model)
2. **Cannot be excluded** — the `isClaudeMdExcluded` function explicitly skips the Managed type:

```typescript
function isClaudeMdExcluded(filePath: string, type: MemoryType): boolean {
  // Managed, AutoMem, TeamMem types are not affected by exclusion rules
  if (type !== 'User' && type !== 'Project' && type !== 'Local') {
    return false
  }
  // ...check claudeMdExcludes config
}
```

This means enterprise administrators can inject **non-overridable, non-excludable** global policies through `/etc/claude-code/CLAUDE.md` and `/etc/claude-code/.claude/rules/*.md`—for example, "do not generate code involving competitors" or "all output must comply with company coding standards." Users cannot bypass these policies via the `claudeMdExcludes` configuration.

### 1.3 CLAUDE.local.md: Private Project Configuration

`CLAUDE.local.md` is the explicitly designed fourth type in the source—placed in the project directory but **excluded by gitignore**, existing only on the developer's local machine. The source comment clearly states:

> "CLAUDE.local.md is gitignored so it only exists in the main repo"

This solves a common practical problem: developers want project-level personal preference configurations (e.g., "I prefer functional style," "use vim keybindings") without committing those preferences to the team repository or having them altered by a malicious PR. `CLAUDE.local.md` exists in the same directory alongside `CLAUDE.md`, and is discovered and loaded synchronously during upward traversal:

```typescript
// At each directory level, search for both Project and Local files simultaneously
for (const dir of dirs.reverse()) {
  // ...
  // Project file
  const projectPath = join(dir, 'CLAUDE.md')
  result.push(...(await processMemoryFile(projectPath, 'Project', ...)))
  
  // Local file (private project instructions)
  if (isSettingSourceEnabled('localSettings')) {
    const localPath = join(dir, 'CLAUDE.local.md')
    result.push(...(await processMemoryFile(localPath, 'Local', ...)))
  }
}
```

### 1.4 Multi-Level Search Paths

Loading CLAUDE.md is not as simple as reading a single file—it collects content from **multiple locations**:

```
Complete search path (in loading order):

1. Managed level:
   - /etc/claude-code/CLAUDE.md (or platform-equivalent path)
   - /etc/claude-code/.claude/rules/*.md

2. User level:
   - ~/.claude/CLAUDE.md
   - ~/.claude/rules/*.md

3. Project level (from git-root toward cwd, level by level):
   - <dir>/CLAUDE.md
   - <dir>/.claude/CLAUDE.md
   - <dir>/.claude/rules/*.md (unconditional rules)

4. Local level (traversed in sync with Project):
   - <dir>/CLAUDE.local.md
```

All discovered content is assembled into a large system prompt injection in a specific order.

### 1.5 Security: Guarding Against Malicious CLAUDE.md

Project-level CLAUDE.md (checked into the repository) can be modified by a malicious PR. The system applies different trust levels to CLAUDE.md from different sources:

- **Managed** (`/etc/claude-code/CLAUDE.md`): fully trusted (administrator-deployed system policy)
- **User global** (`~/.claude/CLAUDE.md`): fully trusted (created by the user)
- **Local** (`CLAUDE.local.md`): fully trusted (local private file, not under version control)
- **Project-level** (`CLAUDE.md` in the repo): restricted trust (may be modified by a PR)
- **Path settings in project settings**: **completely untrusted** for Memory paths (prevents `autoMemoryDirectory: '~/.ssh'` attacks; see the Memory system analysis)

### 1.6 The `.claude/rules/` Rules Directory and Frontmatter Conditional Rules

In addition to a single CLAUDE.md file, users can place multiple `.md` files under `.claude/rules/`. This lets teams organize standards by topic:

```
.claude/rules/
  ├── coding-style.md     — coding style
  ├── testing-policy.md   — testing requirements  
  ├── security-rules.md   — security constraints
  └── tsx-conventions.md  — only applies to .tsx files (conditional rule)
```

**Key distinction**: rule files are divided into **unconditional rules** and **conditional rules**. Conditional rules specify their scope through the `paths` field in YAML frontmatter:

```markdown
---
paths: "*.tsx, src/components/**"
---

# TSX Component Coding Standards
- Use functional components
- Props must define a TypeScript interface
```

The `paths` field supports glob patterns, including brace expansion (e.g., `*.{ts,tsx}`). The source `parseFrontmatterPaths` function parses frontmatter, and the `processMdRules` function distinguishes the two types via the `conditionalRule` parameter:

```typescript
// Unconditional rules: files without frontmatter paths, always loaded
result.push(...files.filter(f => (conditionalRule ? f.globs : !f.globs)))
// Conditional rules: files with frontmatter paths, only loaded when matched
```

Conditional rule matching is implemented by `processConditionedMdRules`—the target file path is matched against the rule file's glob patterns, and only matching rules are injected into the context. This allows a rule to say "this coding standard only applies to `*.tsx` files," avoiding wasted tokens from irrelevant rules.

> 💡 **Plain English**: Unconditional rules are like general regulations that all employees must follow. Conditional rules are like specialized standards that "only apply to frontend engineers"—they are loaded only when relevant files are being processed.

### 1.7 Loading Order and Assembly Strategy

> 📚 **Course Connection**: Multi-level configuration lookup and merge strategies are an extension of the "environment variable inheritance" and "path resolution" concepts from **operating systems** courses. Child processes inherit parent environment variables but can override them—similar to CLAUDE.md's layered model. The design choice of "full concatenation without conflict resolution" corresponds to one of two schools in **software engineering** configuration management: **declarative merging** (e.g., CSS cascading rules, later declarations override earlier ones) vs. **full concatenation** (let the consumer decide priority). Claude Code chose the latter because LLMs have the ability to "understand context" and can autonomously judge which rule is more specific—but this also means conflict resolution responsibility is pushed onto an inherently nondeterministic component (see Section 7 for analysis of design trade-offs).

All CLAUDE.md sources are not simply concatenated—the system assembles them into the final system prompt injection in the following order:

```
Assembly order (earlier to later, later = higher model attention):
1. Managed CLAUDE.md + .claude/rules/*.md (enterprise policy)
2. User CLAUDE.md + ~/rules/*.md (user global)
3. Project CLAUDE.md / .claude/CLAUDE.md / .claude/rules/*.md (level by level, from git-root toward cwd)
4. Local CLAUDE.local.md (level by level, in sync with Project)
```

When each source is injected, it carries a **source annotation and type description**, so Claude knows the origin and nature of each instruction:

```typescript
const description =
  file.type === 'Project'
    ? ' (project instructions, checked into the codebase)'
    : file.type === 'Local'
      ? " (user's private project instructions, not checked in)"
      : " (user's private global instructions for all projects)"
```

**Key design**: Assembly is **full concatenation** rather than "later overrides earlier." This means if the user level says "use 2-space indentation" and the project level says "use 4-space indentation," Claude will **see both** contradictory instructions simultaneously. The system does not resolve conflicts—Claude itself must judge which context is more specific (usually the more local instruction takes precedence). By contrast, Cursor has an explicit priority model (`alwaysApply` > `autoAttach` > manual) where users can predict which rule will take effect.

### 1.8 Boundary Conditions of the Search Path

**Monorepo scenario**: In a monorepo, `<git-root>` is the outermost repository root. If you are working in `packages/frontend/src/`, the system searches:
- `packages/frontend/src/CLAUDE.md` (and `CLAUDE.local.md`)
- `packages/frontend/CLAUDE.md` (and `CLAUDE.local.md`)
- `packages/CLAUDE.md` (and `CLAUDE.local.md`)
- `<git-root>/CLAUDE.md` (and `CLAUDE.local.md`)

This lets each sub-package have its own CLAUDE.md while inheriting general standards from the project root.

**Non-git directories**: If the current directory is not inside a git repository, `<git-root>` detection fails, and the system only loads Managed and User levels plus files in the current directory.

**Symbolic links**: The system uses `safeResolvePath()` to resolve paths—for symlinks, it resolves to the real path, and records both the original and resolved paths in `processedPaths` to prevent the same file from being loaded twice.

**Git worktree deduplication**: The source contains dedicated worktree handling logic. When a worktree is nested inside the main repo (e.g., `.claude/worktrees/<name>/`), upward traversal passes through both the worktree root and the main repo root, which would load the same CLAUDE.md twice. The source detects this with `isNestedWorktree` and skips Project-type files in the main repo, while still loading `CLAUDE.local.md` (because it is gitignored and has no copy in the worktree):

```typescript
const skipProject =
  isNestedWorktree &&
  pathInWorkingPath(dir, canonicalRoot) &&
  !pathInWorkingPath(dir, gitRoot)
```

### 1.9 Caching Strategy and Invalidation

CLAUDE.md files are **not** monitored in real time via a filesystem watcher. The actual implementation uses `memoize` caching:

```typescript
export const getMemoryFiles = memoize(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    // ...entire file discovery and loading logic
  }
)
```

The cache is only cleared when specific events occur:

- **`clearMemoryFileCaches()`**: Pure correctness cache invalidation—used for worktree switching, settings sync, `/memory` dialog, and similar scenarios. Does not trigger the `InstructionsLoaded` hook.
- **`resetGetMemoryFilesCache(reason)`**: Cache reset with hook triggering—used for compaction and other audit-required scenarios. After reset, the next load triggers the `InstructionsLoaded` hook and reports the loading reason.

```typescript
export function clearMemoryFileCaches(): void {
  getMemoryFiles.cache?.clear?.()
}

export function resetGetMemoryFilesCache(
  reason: InstructionsLoadReason = 'session_start',
): void {
  nextEagerLoadReason = reason
  shouldFireHook = true
  clearMemoryFileCaches()
}
```

**Important clarification**: This is not "file watching with hot reload." If a user manually edits CLAUDE.md mid-session, the change **does not take effect automatically**—it only reloads on the next conversation round after the cache is explicitly cleared (e.g., by a compaction event). The `InstructionsLoaded` hook is a **fire-and-forget observation event** triggered after loading completes, not a file-change trigger. This is a performance-vs.-freshness trade-off: for typical scenarios where CLAUDE.md changes rarely during a long session, caching avoids repeated filesystem traversal on every conversation turn.

---

## 2. The `@include` Directive System

### 2.1 Syntax and Design

`@include` is the **most engineering-complex feature** in the entire CLAUDE.md loading system. It lets a CLAUDE.md file reference other files, upgrading the instruction system from a "single configuration file" to a "configuration file graph." The file-header comment in `claudemd.ts` details its specification:

```
Memory @include directive:
- Syntax: @path, @./relative/path, @~/home/path, or @/absolute/path
- @path (without prefix) is treated as a relative path (same as @./path)
- Works in leaf text nodes only (not inside code blocks or code strings)
- Included files are added as separate entries before the including file
- Circular references are prevented by tracking processed files
- Non-existent files are silently ignored
```

Example usage:

```markdown
# Project Standards

@./shared/coding-standards.md
@./shared/api-conventions.md
@~/my-global-rules/security.md

## Project-Specific Rules
- Use pnpm instead of npm
- Test coverage must be at least 80%
```

### 2.2 Implementation Mechanism

`@include` parsing relies on a complete Markdown lexer pipeline:

1. **Lexical analysis**: Uses the `marked` library's `Lexer` to parse Markdown content into a token stream (with `gfm: false` to prevent `~/path` from being parsed as strikethrough syntax)
2. **Path extraction**: The `extractIncludePathsFromTokens` function recursively traverses the token tree, extracting `@path` references only from `text` type nodes—**@path inside code blocks and code spans is skipped**
3. **Path resolution**: Supports four path formats (`@path`, `@./path`, `@~/path`, `@/path`), resolved to absolute paths via the `expandPath` function
4. **Recursive processing**: The `processMemoryFile` function recursively loads referenced files, appending the referenced file results after the referrer

```typescript
const MAX_INCLUDE_DEPTH = 5

export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  // Prevent circular references + depth limit
  const normalizedPath = normalizePathForComparison(filePath)
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return []
  }
  processedPaths.add(normalizedPath)
  
  // Read and parse file (one lex pass handles both HTML comment stripping and @include extraction)
  const { info: memoryFile, includePaths } =
    await safelyReadMemoryFileAsync(filePath, type, resolvedPath)
  
  const result: MemoryFileInfo[] = [memoryFile]
  
  // Recursively process each @include reference
  for (const resolvedIncludePath of includePaths) {
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) continue  // external references require approval
    
    const includedFiles = await processMemoryFile(
      resolvedIncludePath, type, processedPaths, includeExternal,
      depth + 1, filePath,  // pass parent
    )
    result.push(...includedFiles)
  }
  return result
}
```

### 2.3 Security Boundaries

The `@include` directive has strict security controls:

1. **File type whitelist**: Only text files are allowed (`.md`, `.txt`, `.json`, `.ts`, `.py`, and 90+ other extensions). Binary files (images, PDFs, etc.) are automatically skipped. This prevents `@./logo.png` from injecting binary data into the context.

2. **Internal vs. external reference distinction**: `pathInOriginalCwd()` checks whether the referenced path is inside the working directory. External references (e.g., `@~/personal-rules.md` or `@/etc/some-config`) require `hasClaudeMdExternalIncludesApproved` to be true in the project configuration before they are loaded.

3. **Circular reference detection**: The `processedPaths` Set tracks all processed file paths (including post-symlink-resolution paths), preventing infinite loops like A includes B includes A.

4. **Depth limit**: `MAX_INCLUDE_DEPTH = 5`, preventing overly deep nesting chains from consuming excessive tokens and load time.

> 💡 **Plain English**: The `@include` security design is like inter-library loan—you can reference other books in your own library (internal references), but referencing materials from another library (external references) requires special approval. And non-text materials (images, videos) are banned to prevent invalid content from getting mixed in.

This is one of the **most security-conscious design decisions** in the entire system, because it prevents a serious attack vector: a malicious CLAUDE.md could reference sensitive files via `@~/.ssh/id_rsa` or `@~/.aws/credentials`, exposing their contents to the AI model.

### 2.4 HTML Comment Stripping

The source contains a complete `stripHtmlComments` implementation that uses the marked lexer to strip HTML comments at the block level while preserving comments inside code blocks:

```typescript
export function stripHtmlComments(content: string): {
  content: string; stripped: boolean
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false }
  }
  return stripHtmlCommentsFromTokens(new Lexer({ gfm: false }).lex(content))
}
```

This lets users write human-readable notes in CLAUDE.md with `<!-- this is only for humans -->` that **will not be loaded by the AI**. A clever optimization: the `parseMemoryFileContent` function performs **only one** lex pass, simultaneously completing HTML comment stripping and `@include` path extraction, avoiding duplicate parsing.

---

## 3. The `claudeMdExcludes` Exclusion Mechanism

The source contains complete exclusion logic, letting users exclude specific CLAUDE.md paths via the `claudeMdExcludes` configuration. Notably, it handles the macOS `/tmp` -> `/private/tmp` symlink issue:

```typescript
function resolveExcludePatterns(patterns: string[]): string[] {
  const expanded: string[] = patterns.map(p => p.replaceAll('\\', '/'))
  for (const normalized of expanded) {
    if (!normalized.startsWith('/')) continue
    // Resolve symlinks, preserving both original and resolved patterns
    const resolvedDir = fs.realpathSync(dirToResolve).replaceAll('\\', '/')
    if (resolvedDir !== dirToResolve) {
      expanded.push(resolvedDir + normalized.slice(dirToResolve.length))
    }
  }
  return expanded
}
```

If a user writes `/tmp/project/CLAUDE.md` as an exclusion pattern, the actual file path might be `/private/tmp/project/CLAUDE.md`—bidirectional resolution ensures both sides match.

**Key limitation**: `Managed` and `AutoMem` types are **not** affected by `claudeMdExcludes`. This means enterprise policies cannot be excluded by developers.

---

## 4. The yoloClassifier Cache Injection Pattern

> 📚 **Course Connection**: This is a classic case from **software engineering** courses of "using dependency injection to break circular dependencies." A needs B's output, but B's module indirectly depends on A—the solution is to introduce an independent cache intermediary, allowing both to safely access shared data.

The yoloClassifier (automatic permission classifier) needs to read CLAUDE.md content to determine permission policy. But if yoloClassifier directly imported `claudemd.ts`, it would create a module circular dependency: `permissions/filesystem → permissions → yoloClassifier → claudemd.ts → permissions/filesystem`.

The solution in the source is **not** to "bypass yoloClassifier at load time," but rather to **indirectly pass data through a cache intermediary**. In `context.ts`'s `getUserContext()`:

```typescript
// context.ts, lines 170-176
const claudeMd = shouldDisableClaudeMd
  ? null
  : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
// Cache for the auto-mode classifier (yoloClassifier.ts reads this
// instead of importing claudemd.ts directly, which would create a
// cycle through permissions/filesystem → permissions → yoloClassifier).
setCachedClaudeMdContent(claudeMd || null)
```

In other words: after `getUserContext()` loads CLAUDE.md, it calls `setCachedClaudeMdContent()` to write the content into an independent cache module. yoloClassifier reads from this cache instead of directly importing `claudemd.ts`. This is a classic **dependency injection pattern**—using a lightweight cache intermediary (in `bootstrap/state.ts`) to break the module-level circular dependency while ensuring yoloClassifier always has access to the latest CLAUDE.md content.

---

## 5. The Init Command

The `/init` command can automatically generate an initial CLAUDE.md for a project—Claude analyzes the project structure (package.json, Makefile, CI config, etc.) and generates coding conventions and tool preferences suitable for that project.

Generation process:
1. Scan key configuration files in the project root (`package.json`, `Makefile`, `Cargo.toml`, `.github/workflows/`, `tsconfig.json`, etc.)
2. Identify the project's tech stack, build system, and testing framework
3. Use AI to generate a structured CLAUDE.md containing: build commands, test commands, coding style, directory structure explanation
4. Write to `<git-root>/CLAUDE.md`

**Note**: `/init` will not overwrite an existing CLAUDE.md—if the file already exists, it prompts the user to confirm whether to append or replace.

---

## 6. Relationship with the Memory System

CLAUDE.md and the Memory system (`~/.claude/memory/`) are two independent but complementary instruction sources:

| Property | CLAUDE.md | CLAUDE.local.md | Memory |
|----------|-----------|-----------------|--------|
| Scope | Project-level / User-level | Project-level (private) | User-level |
| Editing method | Manual file editing | Manual file editing | AI writes via `/memory` command |
| Content type | Project conventions, coding standards | Personal project preferences | User preferences, feedback records |
| Git tracking | Project-level can be committed | Not committed (gitignored) | Not committed (user private) |
| Excludable | Yes (claudeMdExcludes) | Yes | N/A |

The two are merged in the final system prompt, but there is no explicit priority relationship between them—Claude must autonomously judge which instruction is more applicable to the current context.

---

## 7. Design Trade-offs and Assessment

### Excellent Design Choices

1. **The four MemoryType layers** give distinct roles (enterprise admin, individual user, project team, individual developer) their own instruction spaces, with clear security boundaries—Managed cannot be excluded, and Local is not under version control
2. **The `@include` directive system** upgrades instructions from a single file to a file graph, unique among comparable products (Cursor, Copilot, and Windsurf's instruction files all lack a similar reference mechanism), and has robust security controls (depth limit, cycle detection, external reference approval, file type whitelist)
3. **Frontmatter conditional rules** let rules precisely target specific file types, avoiding token waste—"this TSX standard is only loaded when processing .tsx files"
4. **The InstructionsLoaded hook** provides enterprise auditability, reporting the source type, load reason (`session_start` / `compact` / `include`), and parent file path for every loaded file
5. **Integration with prompt cache** means the extra token cost under normal usage approaches zero

### Costs and Risks

1. **Uncertainty of full concatenation**: When two contradictory rules coexist, users have no deterministic guarantee of which will take effect. In enterprise scenarios, "LLM self-judgment" equals nondeterministic policy enforcement. Compared to Cursor's explicit priority model, Claude Code's approach has a predictability disadvantage
2. **"Ambient authority" risk of upward traversal**: The source's `while (currentDir !== parse(currentDir).root)` traverses from CWD all the way up to the filesystem root. In deeply nested directories, if some parent directory happens to contain a leftover CLAUDE.md, it will be silently loaded—difficult to trace
3. **Cache vs. freshness tension**: The `memoize` cache means content is only loaded once per session (unless explicitly cleared). If a user edits CLAUDE.md mid-session, the change does not take effect automatically. This conflicts with the user expectation of "save and apply"
4. **`@include` token explosion risk**: In a large monorepo, if every sub-package's CLAUDE.md includes shared rules, the include chain can quickly accumulate a massive token count. `MAX_INCLUDE_DEPTH = 5` limits depth but not total volume
5. **`tengu_paper_halyard` feature flag**: The `getClaudeMds` function in the source has a feature flag that can skip all Project and Local type content—hinting that Anthropic is internally experimenting with a "do not load project-level instructions" mode, and the CLAUDE.md system design may still be evolving

---

*Quality self-check:*
- [x] Coverage: Four MemoryTypes (Managed/User/Project/Local), `@include` directive system, frontmatter conditional rules, security boundaries, yoloClassifier cache injection, caching strategy, claudeMdExcludes, HTML comment stripping, worktree deduplication
- [x] Fidelity: Based on source analysis of claudemd.ts, context.ts, memory/types.ts, frontmatterParser.ts, managedPath.ts
- [x] Critical analysis: Identifies uncertainty of full concatenation, ambient authority from upward traversal, cache-vs-freshness tension, token explosion risk, and feature-flag evolution signal
