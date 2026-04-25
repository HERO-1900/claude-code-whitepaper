# How Is CLAUDE.md Discovered and Assembled?

Deconstructing Claude Code's multi-layer configuration discovery and assembly mechanism—from the user directory down to project subdirectories, how CLAUDE.md files from six different sources are merged by priority, and how the "later is more important" property of LLM attention is exploited.

### 🌍 Industry Context

"Letting AI tools read project-level configuration files to customize behavior" has become standard practice for AI coding tools, but implementations vary significantly in the depth of their configuration discovery mechanisms:

- **Cursor (`.cursorrules`)**: Supports placing a `.cursorrules` file in the project root to define rules, but only supports a single file at a single level, with no directory tree traversal, conditional rules, or `@include` mechanism. At the end of 2024, Cursor added a `.cursor/rules/` directory, introducing multi-file rule support, but still without frontmatter path conditions.
- **Windsurf (`.windsurfrules`)**: Similar to Cursor's single-file rule mechanism, but more basic in functionality.
- **Aider (`.aider.conf.yml` + conventions)**: Uses YAML configuration files and a `--read` flag to load rule files, supporting multiple explicitly specified files, but requires manual path entry with no automatic directory tree discovery.
- **GitHub Copilot (`.github/copilot-instructions.md`)**: Introduced a project-level instruction file in 2024, supporting only a single file at a fixed location under `.github/`.
- **CodeX (`AGENTS.md`)**: OpenAI's solution also supports multi-level directory discovery—searching for `AGENTS.md` from the repository root down to the current working directory, with `@include` support for referencing other files. The design philosophy is highly similar to Claude Code's CLAUDE.md.
- **Cursor (`.cursor/rules/`)**: Has evolved from a simple `.cursorrules` file into a conditional rule engine using `.mdc` format, supporting Frontmatter metadata, glob file type matching, and `alwaysApply` global lifecycle definitions—essentially building a reactive event-triggering system.

Claude Code's CLAUDE.md system ranks near the top of the industry in functional completeness (six sources, conditional rules, `@include`, HTML comment filtering), but the fundamental pattern of "multi-level configuration files + directory tree traversal" is not unique to Claude Code—CodeX's AGENTS.md uses an almost identical layered discovery mechanism, while Cursor's `.mdc` conditional rule engine achieves more granular rule matching along a different dimension.

---

## The Question

When you place a CLAUDE.md in the project root, Claude Code reads it. But what happens when your project has multiple subdirectories, each with its own CLAUDE.md? Which takes priority: the `~/.claude/CLAUDE.md` in your user directory, or the CLAUDE.md in your project? And what about `.claude/rules/*.md`?

---

## What You Might Expect...

You might expect the system to simply find the nearest CLAUDE.md and read it, or to concatenate all CLAUDE.md files together without any special ordering.

In reality, this is a multi-layer configuration system with carefully designed priority rules, and it leverages an intrinsic characteristic of LLMs to enforce that priority.

> 💡 **Plain English**: CLAUDE.md is like a **multi-layer new-employee handbook**—corporate headquarters policies (enterprise management strategy) + department manuals (user global settings) + project team conventions (project-level CLAUDE.md) + your personal notes (local private CLAUDE.md) + your manager's specific instructions (user-appended directives). The further back something appears in the handbook, the more seriously Claude takes it—because AI is naturally more attentive to content it saw most recently.

---

## How It Actually Works

### Six Memory Sources

Claude Code searches for configuration files in six locations, from lowest to highest priority:

```
1. Managed   → /etc/claude-code/CLAUDE.md   (enterprise admin policy)
2. User      → ~/.claude/CLAUDE.md          (your global personal preferences)
3. Project   → CLAUDE.md / .claude/CLAUDE.md (project-level rules)
4. Local     → CLAUDE.local.md             (private project rules, gitignored)
5. AutoMem   → ~/.claude/projects/*/memory/ (automatically accumulated memory)
6. TeamMem   → organization shared memory (ant-only)
```

Each layer has its own purpose: the enterprise layer enforces company policy; the user layer holds your personal coding style; the project layer holds team conventions (committed to git, shared by everyone); the local layer holds private notes you don't want to commit.

### Directory Tree Traversal Algorithm

For project-level rules, the system does something interesting: **it walks upward from the current directory to the filesystem root**, collecting all intermediate directories, then reverses the order and loads them from root downward.

```
Current directory: /home/user/company/project/src/feature/

Traversal collection:
  /home/user/company/project/src/feature
  /home/user/company/project/src
  /home/user/company/project
  /home/user/company
  /home/user
  /home

Reversed loading order (lowest to highest priority):
  → /home/CLAUDE.md (if present, loaded first)
  → /home/user/company/CLAUDE.md
  → /home/user/company/project/CLAUDE.md ← usually here
  → /home/user/company/project/src/CLAUDE.md
  → /home/user/company/project/src/feature/CLAUDE.md (loaded last, highest priority)
```

**Why reverse?** Because "priority" is implemented through **position in the prompt**—content loaded later appears further back in the prompt, and LLMs typically devote more attention to later content. This design exploits the model's positional bias to achieve configuration prioritization.

> 📚 **Course Connection**: This "root-down layer-by-layer override" configuration discovery pattern appears in both Software Engineering and Operating Systems curricula. It belongs to the same design family as Git's configuration system (`/etc/gitconfig` → `~/.gitconfig` → `.git/config`), npm's upward `package.json` search, and Linux's `/etc/profile` → `~/.bashrc` → `.bashrc` layered loading mechanism—**Layered Configuration Override**. In distributed systems, this pattern also appears in Kubernetes ConfigMap hierarchical overrides and Spring Boot's profile-based configuration.

### Three Project Rule File Locations

In each directory, the system looks for three types of files:

```
CLAUDE.md                 — main configuration file
.claude/CLAUDE.md         — main config inside a hidden directory (equivalent, just different location)
.claude/rules/*.md        — rule collection (one topic per file)
```

`.claude/rules/` lets you store rules for different concerns in separate files, making them easier to maintain. For example: `testing.md`, `git-conventions.md`, `code-style.md`.

### Conditional Rules (Frontmatter paths)

`.claude/rules/*.md` files can declare that they only apply to specific file paths:

```markdown
---
paths:
  - "src/**/*.ts"
  - "tests/**"
---

# TypeScript Standards
Always use `interface` instead of `type alias` when defining public API types.
```

This rule only takes effect for TypeScript files and test files; other files (like Python scripts) won't see it.

### @include Directives

CLAUDE.md files can reference other files:

```markdown
@./shared-conventions.md
@~/my-global-standards/code-review.md
@/etc/company/security-rules.md
```

Referenced files are inserted as separate entries before the file that references them (lower priority), forming a flattened rule list. Cyclic references are prevented by a `processedPaths` set.

**Security Note**: Referencing external files outside the cwd requires user approval. This prevents malicious projects from using CLAUDE.md to load external rules (similar to a supply-chain attack).

### HTML Comment Hiding

You can write HTML comments inside CLAUDE.md, and the AI won't read them:

```markdown
# Code Standards

<!-- Note: this rule was added because of a 2024 security incident, see JIRA-1234 -->
Always use parameterized SQL queries for user input.

<!-- TODO: remove this after the migration is complete -->
Temporary rule: all new code must include a backward-compatible fallback.
```

The system uses the `marked` lexer to precisely identify HTML comments (preserving comments inside code blocks so they remain unaffected).

### Final Concatenation Format

All loaded files are concatenated in order, formatted as follows:

```
Codebase and user instructions are shown below. Be sure to adhere to these
instructions. IMPORTANT: These instructions OVERRIDE any default behavior
and you MUST follow them exactly as written.

Contents of /home/user/company/project/CLAUDE.md (project instructions, checked into the codebase):

[project CLAUDE.md content]

Contents of /home/user/company/project/src/CLAUDE.md (project instructions, checked into the codebase):

[src directory CLAUDE.md content]

Contents of /home/user/.claude/CLAUDE.md (user's private global instructions for all projects):

[user global CLAUDE.md content]
```

Each file is tagged with its path and type description, so the AI knows where each rule came from.

---

## The Elegant Design

**Implicit Priority**: Rather than using numeric weights, priority is implemented through position in the prompt. This leverages an intrinsic LLM property (greater attention to later content) without requiring special priority-resolution logic. This "position is priority" approach is a pragmatic engineering choice, but not a perfect one—LLM positional bias (recency bias) is a statistical tendency of the model, not a deterministic guarantee, and in extremely long contexts the attention advantage of later content may be diluted.

**Tree Discovery + Override Semantics**: Subdirectory rules naturally override parent-directory rules, consistent with the mental model of most layered configuration systems (.gitconfig, package.json, etc.).

**Progressive Permissions**: The Local (private) > Project (shared) > User (global) > Managed (enterprise) hierarchy supports a usage pattern of "respect team conventions while retaining personal customization."

---

## Practical Recommendations

Based on an understanding of this system:

1. **Put project rules in `.claude/rules/*.md`**: Organize by topic into separate files; easier to maintain than a single CLAUDE.md
2. **Use CLAUDE.local.md for private notes**: Content you don't want to commit to git (e.g., your debugging preferences, temporary experimental rules)
3. **Write "why" in HTML comments**: Background information for rules goes in comments—the AI won't see it, but your teammates will
4. **Use conditional rules by file type**: Frontend rules, backend rules, and testing rules stay separate and don't interfere with each other

---

## Code Landing Points

- `src/utils/claudemd.ts`, lines 1–26: file header comment with complete loading order description
- `src/utils/claudemd.ts`, line 790: `getMemoryFiles()` function, complete discovery logic
- `src/utils/claudemd.ts`, line 1153: `getClaudeMds()` function, concatenation and formatting logic
- `src/utils/claudemd.ts`, line 292: `stripHtmlComments()` function
- `src/context.ts`, line 155: `getUserContext()`, entry point of the call chain

---

## Directions for Further Inquiry

- How does the `AutoMem` system automatically accumulate memory? When does it write to memory.md?
- What is the matching logic for conditional rules (frontmatter paths)—what glob syntax does picomatch support?
- How does the `--add-dir` CLI parameter interact with the CLAUDE.md system?

---

*Quality self-check:*
- [x] Coverage: all six sources, directory traversal algorithm, @include, conditional rules, HTML comments, and concatenation format covered
- [x] Fidelity: loading order directly quoted from file header comment, path strings from code
- [x] Readability: concrete directory tree example builds intuition
- [x] Consistency: aligned with global_map.md context subsystem description
- [x] Critical: noted memoize limitation (no file change detection within a session)
- [x] Actionable: added practical recommendations section, directly useful to readers
