# The Bash AST Parser: A Complete Analysis

BashTool is Claude Code's most frequently used tool—it executes every shell command in the user's environment. But "can execute" does not mean "should execute": a seemingly harmless `cd /tmp && git status` can execute arbitrary code via a bare repo attack. To strike a balance between "letting the AI operate freely" and "preventing catastrophic commands," Anthropic invested **35,000+ lines of code** to build a pure TypeScript Bash AST parser and security analysis pipeline. This is the largest single subsystem in Claude Code by code volume—10× larger than the `queryLoop` (3,024 lines) and 8× larger than the entire memory system (~4,000 lines).

> **Source locations**: `src/utils/bash/` (parser core, 12,000+ lines), `src/tools/BashTool/` (security integration, 23,000+ lines), `src/utils/permissions/` (permission rules, 9,400+ lines)

> 💡 **Plain English**: Imagine a customs security checkpoint—every incoming traveler (shell command) must pass through an X-ray machine (AST parser). The X-ray machine doesn't open luggage and inspect items one by one; instead, it uses radiation to "see through" the internal structure. If it spots something suspicious (a dangerous command pattern), the security officer (permission system) stops the traveler and asks, "Are you sure you want to bring this in?" If the X-ray machine can't see inside the luggage at all (parse failure), it stops the traveler anyway—better to err on the side of caution than to let a threat through.

### 🌍 Industry Context: Command Security in AI Coding Tools

Shell command execution is the central security challenge for AI coding tools, and different products tackle it in vastly different ways:

- **Cursor**: Relies on user approval popups (Allow/Deny) without deep command analysis. Fast, but with a thin security boundary—users can easily "slip" and approve dangerous commands.
- **GitHub Copilot Workspace**: Executes in cloud containers, solving security through physical isolation but sacrificing access to the local file system.
- **Aider**: Fully trusts the user environment with no command interception. Geared toward advanced developers, but risky in enterprise settings.
- **CodeX (OpenAI)**: v0.118.0 implements OS-level egress rules, and a Rust rewrite brings memory safety, but command analysis granularity falls short of Claude Code's AST-level approach.
- **Windsurf (Codeium)**: Cloud execution + local sync, with command security handled server-side.

Claude Code's unique approach is **local execution + AST-level static analysis**—not relying on containers, the cloud, or Rust memory safety, but instead making fine-grained security decisions by "understanding command structure." The core trade-offs of this approach run through the entire chapter:

- **vs. container isolation (Copilot/Windsurf)**: More flexible and available offline, but safety depends on the correctness of the parser
- **vs. OS-level controls (CodeX)**: More granular (can distinguish between a "safe `git diff`" and a "dangerous `git push --force`"), but the parser itself can become an attack surface
- **vs. pure approval mode (Cursor/Aider)**: Smarter (the AI can autonomously execute safe commands), but engineering complexity is orders of magnitude higher

---

## Overview

This chapter unfolds in the following order: Section 1 presents the full system picture—the complete pipeline from command input to execution or rejection; Section 2 dives into the pure TypeScript lexer and parser implementation; Section 3 analyzes the FAIL-CLOSED AST security analyzer; Section 4 presents the full checklist of 24 security checks; Section 5 explains the code implementation of the Git safety protocol; Section 6 analyzes the permission rules system; Section 7 discusses performance safeguards; Section 8 dissects differential attack defenses; Section 9 summarizes the design philosophy and limitations.

> ⚠️ **Scope note**: This chapter analyzes the community-released source code of Claude Code 2.1.88 (recovered from `cli.js.map`). The file `bashParser.ts` (pure TS parser) may be a fallback for an internal tree-sitter-bash WASM module—controlled by the Feature Flag `TREE_SITTER_BASH` to select which path to use. The internal Anthropic build may use tree-sitter's C/WASM bindings for higher performance. This chapter analyzes the pure TS path, which is also the path actually used by users of the publicly distributed version.

---

> **[Diagram placeholder 3.18-A]**: Bash AST parser pipeline panorama — command input → lexical analysis → syntax tree construction → AST security analysis → 24 checks → permission decision → execution / rejection

> **[Diagram placeholder 3.18-B]**: FAIL-CLOSED security model — allowed node type whitelist vs. unknown node type → too-complex → user confirmation

---

## 1. System Panorama: From Command to Verdict

When the AI invokes BashTool, the command string passes through a layered analysis pipeline, where each layer can make a "reject" decision:

```
Input: bash command string (e.g., "cd /tmp && git status")
  │
  ▼
┌─────────────────────────────────────────────┐
│ Layer 1: bashParser.ts — Pure TS Lexer+Parser│
│  · 50ms timeout + 50,000 node budget        │
│  · Produces tree-sitter-bash-compatible AST │
│  · Failure → PARSE_ABORTED sentinel value   │
└─────────────────┬───────────────────────────┘
                  │ TsNode syntax tree
                  ▼
┌─────────────────────────────────────────────┐
│ Layer 2: ast.ts — FAIL-CLOSED Security Analyzer│
│  · Pre-checks: control chars / Unicode      │
│    whitespace / Zsh syntax                  │
│  · AST traversal: only whitelist node types │
│  · Unknown node → too-complex (user confirm)│
│  · Output: SimpleCommand[] or too-complex   │
└─────────────────┬───────────────────────────┘
                  │ SimpleCommand[]
                  ▼
┌─────────────────────────────────────────────┐
│ Layer 3: bashSecurity.ts — 24 Security Checks│
│  · Check argv for dangerous patterns        │
│  · Each check has a unique analytics ID     │
│  · Any check fails → marked unsafe          │
└─────────────────┬───────────────────────────┘
                  │ safety flag
                  ▼
┌─────────────────────────────────────────────┐
│ Layer 4: bashPermissions.ts — Permission Decision│
│  · Match user-configured permission rules   │
│  · Git Safety Protocol (cd+git compound cmd)│
│  · Read-only command validation             │
│    (readOnlyValidation.ts)                  │
│  · Path validation (pathValidation.ts)      │
└─────────────────┬───────────────────────────┘
                  │ allow / deny / ask
                  ▼
            Execute or trigger permission prompt
```

> 💡 **Plain English**: This is like airport security with four checkpoints—the first is the X-ray machine (turning luggage into structured information), the second is the structural analyst (looking for "unrecognized objects" and stopping the passenger if found), the third is the prohibited-items checklist (24 checks, one by one), and the fourth is the customs officer (making the final allow/deny decision based on your identity and destination).

### 1.1 Code Distribution by Layer

| Layer | Core File | Lines | Responsibility |
|------|-----------|-------|----------------|
| Parser layer | `bashParser.ts` | 4,436 | Pure TS lexer + parser |
| | `heredoc.ts` | 733 | Heredoc extraction / recovery |
| | `commands.ts` | 1,339 | Command splitting / redirect classification |
| | `ParsedCommand.ts` | 318 | IParsedCommand interface |
| | `ShellSnapshot.ts` | 582 | Shell state snapshot |
| | Other utils/bash/ | ~4,685 | Pipes / completions / quotes / registry / specs |
| **Parser layer subtotal** | | **~12,093** | |
| Security analysis layer | `ast.ts` | 2,679 | FAIL-CLOSED AST traversal |
| Security check layer | `bashSecurity.ts` | 2,592 | 24 security checks |
| Permission decision layer | `bashPermissions.ts` | 2,621 | Permission rule matching + Git safety protocol |
| | `readOnlyValidation.ts` | 1,990 | Read-only command whitelist |
| | `pathValidation.ts` | 1,303 | Path extraction / validation |
| | `sedValidation.ts` | 684 | sed script validation |
| | Other BashTool/ | ~1,569 | Prompts / helpers / sandbox decisions |
| | `permissions/` directory | 9,409 | Rule parsing / classifier / rejection tracking |
| **Security + Permission subtotal** | | **~23,588** | |
| **Total** | | **~35,681** | |

Nearly **8%** of Claude Code's total codebase (35,681 lines out of ~420,000) is dedicated to "understanding and validating a single bash command." This proportion far exceeds most people's intuition—and it reflects a core engineering judgment: **in an AI coding tool, "executing commands safely" is far more important than "making commands run faster."**

---

## 2. The Pure TypeScript Parser (bashParser.ts)

### 2.1 Why Not Use tree-sitter Directly?

tree-sitter is the industry-standard incremental parser framework, with a mature Bash grammar definition. Claude Code's internal build does use tree-sitter via `feature('TREE_SITTER_BASH')`, but the open-source version chose a pure TypeScript rewrite. The reasons:

1. **Zero-dependency deployment**: tree-sitter requires C/WASM compilation artifacts, increasing npm package size and platform compatibility issues
2. **Fully auditable security**: Pure TS code can be completely audited; WASM binaries are opaque
3. **UTF-8 byte offsets**: Security analysis requires precise byte-level position information, but JS string indices and UTF-8 byte offsets differ. Pure TS allows exact control over this mapping
4. **Predictable performance budgets**: 50ms timeout + 50K node limit—the behavior of these constraints is fully predictable in a pure TS implementation

### 2.2 Lexer Architecture

The lexer is the parser's first step—it slices the command string into meaningful lexical units (tokens):

```typescript
// Lexer state (core data structure in bashParser.ts)
type Lexer = {
  src: string            // raw command text
  len: number            // text length
  i: number              // JS string index (character position)
  b: number              // UTF-8 byte offset (byte position)
  heredocs: HeredocPending[]  // pending heredocs
  byteTable: Uint32Array | null  // lazily-initialized UTF-8 lookup table
}
```

**Key design: dual-track position tracking**

JavaScript strings use UTF-16 encoding, but tree-sitter AST nodes use UTF-8 byte offsets. The parser must maintain both positions simultaneously:

```typescript
// ASCII fast path (char index == byte index)
// Non-ASCII requires extra byte computation
function advance(L: Lexer): void {
  const c = L.src.charCodeAt(L.i)
  L.i++
  if (c < 0x80) L.b++          // ASCII: 1 byte
  else if (c < 0x800) L.b += 2  // 2-byte UTF-8
  else if (c >= 0xd800 && c <= 0xdbff) { L.b += 4; L.i++ }  // surrogate pair: 4 bytes
  else L.b += 3                  // 3-byte UTF-8
}
```

> 💡 **Plain English**: Think of a book with mixed Chinese and English text—English letters take 1 slot (ASCII = 1 byte), Chinese characters take 3 slots (3 bytes), and emojis take 4 slots (4 bytes). The indexing system must record both "the Nth character" and "the Nth byte" because downstream security analysis needs byte-level precision to locate suspicious fragments.

### 2.3 Token Types

The token types recognized by the lexer cover the core constructs of Bash syntax:

| Token Type | Meaning | Example |
|-----------|---------|---------|
| `WORD` | Ordinary word (command name / argument) | `ls`, `-la`, `file.txt` |
| `NUMBER` | File descriptor | `2` (in `2>&1`) |
| `OP` | Operator | `&&`, `\|\|`, `\|`, `;`, `>`, `>>` |
| `NEWLINE` | Newline | `\n` |
| `DQUOTE` | Double-quoted string | `"hello $world"` |
| `SQUOTE` | Single-quoted string | `'literal text'` |
| `ANSI_C` | ANSI-C quoting | `$'escape\n'` |
| `DOLLAR` | Variable expansion | `$VAR` |
| `DOLLAR_PAREN` | Command substitution | `$(command)` |
| `DOLLAR_BRACE` | Parameter expansion | `${VAR:-default}` |
| `DOLLAR_DPAREN` | Arithmetic expansion | `$((1+2))` |
| `BACKTICK` | Backtick command substitution | `` `command` `` |
| `LT_PAREN` | Process substitution (input) | `<(sort file)` |
| `GT_PAREN` | Process substitution (output) | `>(tee log)` |

### 2.4 Syntax Tree Construction

The nodes produced by the parser are compatible with the tree-sitter-bash AST format, so downstream security analysis code (`ast.ts`) doesn't need to care about the parser's specific implementation:

```
TsNode structure:
{
  type: string        // node type (e.g., 'command', 'pipeline', 'list')
  text: string        // raw text
  startIndex: number  // UTF-8 start byte offset
  endIndex: number    // UTF-8 end byte offset
  children: TsNode[]  // child nodes
  namedChildren: TsNode[]  // named child nodes
}
```

### 2.5 Heredoc Handling

Heredoc is one of the most complex syntactic constructs in Bash—it allows multi-line text to be inlined into a command. The parser has a dedicated `heredoc.ts` (733 lines) to handle this:

```typescript
// Supported heredoc formats (heredoc.ts)
const HEREDOC_START_PATTERN =
  /(?<!<)<<(?!<)(-)?[ \t]*(?:(['"])(\\?\w+)\2|\\?(\w+))/

// <<WORD    — basic heredoc
// <<'WORD'  — single quotes (no variable expansion)
// <<"WORD"  — double quotes
// <<-WORD   — strip leading tabs
// <<\WORD   — escaped delimiter
```

**Security handling strategy**: Heredoc content is first extracted and replaced with a placeholder, preventing `$`, `` ` ``, and other characters inside it from being misidentified as command substitution during parsing. The original content is restored after parsing completes.

---

## 3. The FAIL-CLOSED Security Analyzer (ast.ts)

`ast.ts` (2,679 lines) is the security core of the entire pipeline—it traverses the syntax tree, extracts structured command information, and chooses to "close" (reject) rather than "open" (allow) whenever it encounters any uncertainty.

### 3.1 Core Principle: Explicit Whitelist

```typescript
// Security model in ast.ts

// These node types are traversed (structural containers)
const STRUCTURAL_TYPES = new Set([
  'program', 'list', 'pipeline', 'redirected_statement'
])

// These are command separators
const SEPARATOR_TYPES = new Set([
  '&&', '||', '|', ';', '&', '|&', '\n'
])

// These node types are explicitly marked as dangerous
const DANGEROUS_TYPES = new Set([
  'command_substitution',   // $(...)
  'process_substitution',   // <(...)
  'expansion',              // ${...}
  'simple_expansion',       // $VAR
  'brace_expression',       // {a,b,c}
  'subshell',              // (...)
  'compound_statement',     // { ...; }
  'for_statement',          // for x in ...; do ...; done
  'while_statement',        // while ...; do ...; done
  // ... more
])

// Key principle: any node type NOT in the whitelist → tooComplex()
// "We never interpret a structure we do not understand. If tree-sitter
//  produces a node we have not explicitly whitelisted, we refuse to extract argv."
```

> 💡 **Plain English**: Think of drug approval—not listing "all harmful ingredients" and excluding them (which would miss unknown toxins), but listing "all proven-safe ingredients" and only allowing those. Any new, unverified ingredient is treated as "potentially harmful" by default. This is the difference between FAIL-CLOSED (default closed) and FAIL-OPEN (default open).

### 3.2 Output Types

```typescript
// Three possible outputs from ast.ts
type ParseForSecurityResult =
  | {kind: 'simple', commands: SimpleCommand[]}  // successfully extracted
  | {kind: 'too-complex', reason: string, nodeType?: string}  // cannot be safely analyzed
  | {kind: 'parse-unavailable'}  // parser unavailable (fallback to shell-quote)

// Command structure on success
type SimpleCommand = {
  argv: string[]              // fully de-quoted argument list
  envVars: {name, value}[]    // leading env vars (e.g., NO_COLOR=1)
  redirects: Redirect[]       // redirects (>, >>, <, etc.)
  text: string               // original source text (for UI display)
}

type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string             // target path or placeholder
  fd?: number               // file descriptor (0/1/2)
}
```

### 3.3 Placeholder System: Safely Tracking Variables

When a command contains variable expansion or command substitution, the parser doesn't simply reject it outright—it uses placeholders to track them:

```typescript
const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'
const VAR_PLACEHOLDER = '__TRACKED_VAR__'

// Example:
// NOW=$(date) && jq --arg now "$NOW" ...
//   → argv: ['jq', '--arg', 'now', '__TRACKED_VAR__']
//   Safe: because the source of $NOW is known (from $(date))
//
// x=$(cmd) && echo $x
//   → argv: ['echo', '__CMDSUB_OUTPUT__']
//   Safe: if the inner cmd separately passes security checks
```

This design avoids the excessive conservatism of "rejecting all variable expansions across the board"—the system can distinguish between "safe variable passing" and "malicious command injection."

---

## 4. The 24 Security Checks (bashSecurity.ts)

`bashSecurity.ts` (2,592 lines) performs 24 security checks on the extracted `SimpleCommand[]`. Each check has a unique analytics ID for monitoring and alerting:

| ID | Check Name | What It Detects | Attack Scenario Example |
|----|------------|-----------------|------------------------|
| 1 | INCOMPLETE_COMMANDS | Syntax errors / incomplete commands | Exploiting parser differences to bypass checks |
| 2 | JQ_SYSTEM_FUNCTION | jq's @sh/@json/@uri filters | jq executing system-level functions |
| 3 | JQ_FILE_ARGUMENTS | jq file argument patterns | Reading sensitive files through jq |
| 4 | OBFUSCATED_FLAGS | Flags hidden via quotes / wildcards | `gi"t" pu"sh"` bypassing git push interception |
| 5 | SHELL_METACHARACTERS | `$`, `` ` ``, `[`, `*`, `?`, `{`, `\|`, `&`, `;` | Injecting additional commands |
| 6 | DANGEROUS_VARIABLES | `LD_*`, `DYLD_*`, `PATH`, `IFS`, etc. | Hijacking library loading / command lookup |
| 7 | NEWLINES | Newlines inside arguments | Multi-line expansion bypassing single-line checks |
| 8 | COMMAND_SUBSTITUTION | `$()`, backticks, `<>()` | Nested command execution |
| 9 | INPUT_REDIRECTION | `<`, `<<`, `<&` | Injecting standard input |
| 10 | OUTPUT_REDIRECTION | `>`, `>>`, `>&`, `&>` | Overwriting sensitive files |
| 11 | IFS_INJECTION | Word splitting via $IFS | `cat$IFS/etc/passwd` |
| 12 | GIT_COMMIT_SUBSTITUTION | Variable expansion in git commit | Executing commands inside commit messages |
| 13 | PROC_ENVIRON_ACCESS | Reading `/proc/PID/environ` | Stealing process environment variables (including secrets) |
| 14 | MALFORMED_TOKEN_INJECTION | Quoting parser vulnerabilities | Exploiting shell-quote library bugs |
| 15 | BACKSLASH_ESCAPED_WHITESPACE | `\ ` and `\<newline>` | Obfuscating command boundaries |
| 16 | BRACE_EXPANSION | `{a,b,c}` patterns | Path traversal `{/etc/passwd,/etc/shadow}` |
| 17 | CONTROL_CHARACTERS | 0x00-0x1F, 0x7F | Invisible character obfuscation |
| 18 | UNICODE_WHITESPACE | Invisible Unicode whitespace | NBSP / zero-width spaces obfuscating command boundaries |
| 19 | MID_WORD_HASH | `#` in the middle of a word | `cmd#evil` obfuscating comments |
| 20 | ZSH_DANGEROUS_COMMANDS | zmodload, emulate, zpty, ztcp | Zsh-specific dangerous operations |
| 21 | BACKSLASH_ESCAPED_OPERATORS | `\|`, `\&`, etc. | Obfuscating pipes / background operators |
| 22 | COMMENT_QUOTE_DESYNC | Quote / comment state desync | Exploiting parser/bash comment interpretation differences |
| 23 | QUOTED_NEWLINE | Newlines inside strings | Multi-line strings bypassing single-line checks |
| 24 | *(reserved)* | *(reserved)* | *(future extension)* |

> 💡 **Plain English**: This is like the airport security prohibited-items list—not vaguely saying "dangerous items aren't allowed," but explicitly listing 24 categories (knives, liquids, lighters, batteries...), each with specific detection methods and criteria. And the list reserves slot 24 for easy expansion when new threats are discovered.

### 4.1 A Few Checks Worth Deep-Diving

**Check #4 — OBFUSCATED_FLAGS**

This check prevents attackers from hiding dangerous flags by splitting them with quotes:

```bash
# Normal command—would be intercepted by the "git push" rule
git push --force

# Obfuscation attempt—shell still executes "git push --force" after quote removal
gi"t" pu"sh" --fo"rce"

# Check #4 reconstructs the full token at the AST level, seeing through obfuscation
```

**Check #11 — IFS_INJECTION**

IFS (Internal Field Separator) is the word-splitting variable in Bash. By default it's space/tab/newline, but if modified:

```bash
# Normal case: IFS is a space
echo hello world  # → echo "hello" "world"

# IFS injection: if IFS is set to /
IFS=/ && cat$IFS"etc"$IFS"passwd"
# Bash sees: cat /etc/passwd

# Check #11 detects any use of $IFS
```

**Check #18 — UNICODE_WHITESPACE**

Invisible Unicode whitespace characters can make a command "look" different from what it actually executes:

```
# What the eye sees (using NBSP instead of space):
git\u00A0push  # looks like two words: "git push"

# What Bash actually executes (NBSP is not a word separator):
"git\u00A0push"  # treated as one word—may bypass "git push" interception rules

# Check #18 rejects any command containing Unicode whitespace
```

---

## 5. The Git Safety Protocol

Git safety is the most finely grained part of Claude Code's command security—because git is the most frequently used developer command, yet also one of the tools with the largest attack surface.

### 5.1 The cd + git Compound Command Attack

`bashPermissions.ts` contains a critical piece of security logic specifically to detect the "cd into a directory and then run a git command" pattern:

```typescript
// bashPermissions.ts ~:2200-2225
// Problem: cd /malicious/dir && git status
// Looks harmless, but if /malicious/dir is a carefully crafted
// bare git repo (containing a malicious core.fsmonitor script),
// git status will automatically execute that script—arbitrary code execution!

if (compoundCommandHasCd) {
  const hasGitCommand = subcommands.some(cmd =>
    isNormalizedGitCommand(cmd)
  )
  if (hasGitCommand) {
    return {
      reason: 'Compound commands with cd and git require ' +
              'approval to prevent bare repository attacks'
    }
  }
}
```

**Why is `cd && git status` dangerous?**

1. The attacker places `HEAD`, `objects/`, and `refs/` files under `/tmp/innocent-looking-dir/`
2. Git sees these files and treats it as a bare git repo
3. The attacker sets `core.fsmonitor = "malicious-script.sh"` in `.git/config` (or the repo's own config)
4. `git status` **automatically executes** `malicious-script.sh` while checking file changes
5. Result: a seemingly read-only `git status` becomes arbitrary code execution

**Detection logic**:

```typescript
// Identify "normalized" git commands (stripping safe wrappers)
function isNormalizedGitCommand(cmd: SimpleCommand): boolean {
  // Direct git command
  if (cmd.argv[0] === 'git') return true

  // With env prefix: NO_COLOR=1 git ...
  if (cmd.envVars.length > 0 && cmd.argv[0] === 'git') return true

  // Via xargs: xargs git ...
  if (cmd.argv[0] === 'xargs' && cmd.argv[1] === 'git') return true

  // Stripping safe wrappers: nice/stdbuf/nohup/timeout/time git ...
  const SAFE_WRAPPERS = ['nice', 'stdbuf', 'nohup', 'timeout', 'time']
  // ... recursively strip, then check if it's git
}
```

### 5.2 Read-Only Git Command Whitelist

Not all git commands require user confirmation—read-only commands like `git status`, `git log`, and `git diff` can be safely auto-executed. `readOnlyValidation.ts` (1,990 lines) maintains a finely tuned whitelist:

```typescript
// readOnlyValidation.ts — Git read-only command definitions
const GIT_READ_ONLY_COMMANDS = {
  'diff': {
    safeFlags: {
      '--cached': 'none',      // flag takes no argument
      '--stat': 'none',
      '--name-only': 'none',
      '--word-diff': 'string', // flag takes a string argument
      '-U': 'number',          // flag takes a number argument
      // ... more safe flags
    },
    additionalCommandIsDangerousCallback(raw, args) {
      // Reject: git diff < file.patch (input redirection)
      // Reject: piping to a write command
    }
  },
  'log': { /* similar structure */ },
  'status': { /* similar structure */ },
  'show': { /* similar structure */ },
  'branch': { /* only --list etc. read-only flags allowed */ },
  'remote': { /* only viewing allowed, not add/remove */ },
  'blame': { /* similar structure */ },
  // ... more
}
```

> 💡 **Plain English**: This is like a library's permission system—"borrowing" (read-only) and "altering the collection" (write) are entirely different permission levels. `git log` is just browsing history (borrowing), so it can come and go freely; `git push --force` overwrites the remote repo (altering the collection), so it requires administrator confirmation. And the granularity isn't just "git log is safe"—it's "git log --format='%H' is safe" vs. "git log --format='%(trailers:key=Signed-off-by)' may be unsafe," down to each individual flag.

### 5.3 Sed Validator

`sed` is another command that needs special handling—it can both read and write files, and its safety level depends on the specific sed script:

```typescript
// sedValidation.ts (684 lines) + sedEditParser.ts (322 lines)
// Parse sed scripts to determine if they are "read-only viewing" or "file modification"

// Safe (read-only): sed -n '5p' file.txt    → print line 5
// Dangerous (write): sed -i 's/old/new/g' file.txt → in-place edit
// Complex (needs confirmation): sed -e 'w /tmp/stolen' file.txt → write to another file
```

---

## 6. The Permission Rules System

Permission rules are the "negotiation interface" between the user and the security system—users can configure rules to authorize certain commands to run automatically.

### 6.1 Rule Format

```
Bash(command:args)    — exact match
Bash(command:*)       — command-level wildcard
Bash(*)               — allow all (dangerous!)
```

### 6.2 Rule Matching Logic

The `permissions/` directory (9,409 lines) implements rule parsing, storage, matching, and suggestions:

```typescript
// Matching example
Rule: Bash(git:*)
Command: git log --oneline    → ✅ match, auto-execute
Command: git push --force     → ✅ match, auto-execute (dangerous!)
Command: npm install          → ❌ no match

Rule: Bash(curl:https://)
Command: curl https://api.example.com  → ✅ prefix match
Command: curl http://evil.com          → ❌ protocol mismatch
```

### 6.3 Rejection Tracking

The permission system doesn't just make a binary decision—it also tracks user rejections to improve future permission suggestions:

```typescript
// If the user repeatedly rejects the same category of command, the system will:
// 1. Increase confidence for that category (ask less frequently)
// 2. Consider user preferences when suggesting rules
// 3. Report rejection patterns to analytics (anonymized)
```

---

## 7. Performance Safeguards

Parsing a bash command should not block user interaction. The system sets multiple layers of performance protection:

### 7.1 Parser Layer

```typescript
// bashParser.ts
PARSE_TIMEOUT_MS = 50      // 50ms wall-clock timeout
MAX_NODES = 50_000         // maximum 50,000 AST nodes produced

// On timeout, returns PARSE_ABORTED (not null)
// PARSE_ABORTED is a Symbol used to distinguish "parse failure" from "parse timeout"
```

> 💡 **Plain English**: Like a timed exam—if the X-ray machine hasn't finished scanning a bag after 50ms (perhaps the luggage has an extremely complex structure mimicking a bomb), it immediately marks it as "suspicious" and sends it for manual inspection, rather than making the entire security line wait.

### 7.2 Security Analysis Layer

```typescript
// ast.ts
MAX_COMMAND_LENGTH = 10_000           // excessively long commands rejected outright
MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50  // prevent exponential compound commands
```

### 7.3 Fallback Strategy

When the pure TS parser is unavailable (or disabled by feature flag):

```
Parser unavailable
  → ast.ts returns {kind: 'parse-unavailable'}
  → bashSecurity.ts falls back to traditional regex + shell-quote library
  → bashPermissions.ts uses simpler permission checks
```

The fallback path sacrifices analysis precision for availability—better than not being able to execute commands at all.

---

## 8. Differential Attack Defenses

A "differential attack" exploits differences in how the parser and actual Bash understand the same command to bypass security checks. The pre-checks in `ast.ts` are specifically designed to defend against such attacks:

### 8.1 Control Characters (Check #17)

```
Attack: embed 0x00 (NULL) in the command
Bash behavior: silently drops NULL characters, executes the remainder
Parser behavior: may truncate at NULL, thinking the command has ended
Result: parser thinks the command is safe, but Bash actually executes hidden trailing commands

Defense: detect 0x00-0x1F, 0x7F → immediately return too-complex
```

### 8.2 Unicode Whitespace (Check #18)

```
Attack: use NBSP (U+00A0) instead of ordinary spaces
Bash behavior: NBSP is not a word separator, so the entire content is treated as one word
Parser behavior: may treat NBSP as a space, splitting it into two words
Result: parser sees "git push" (two words), but Bash executes "git\xa0push" (one word)

Defense: detect Unicode whitespace characters → immediately return too-complex
```

### 8.3 Zsh-Specific Syntax

On macOS, Claude Code runs in a zsh environment, but the parser is built for Bash syntax. Some zsh extensions can cause differences:

```
~[name]  — zsh dynamic directory expansion (no such syntax in bash)
=cmd     — zsh equals expansion (expands to /usr/bin/cmd)
brace expansion inside quotes  — supported in zsh, not in bash

Defense: detect these zsh-specific syntax constructs → return too-complex
```

---

## 9. Design Philosophy and Limitations

### 9.1 Three Design Principles

1. **FAIL-CLOSED over FAIL-OPEN**: When uncertain, reject rather than allow. Better to ask the user one more time than to let a dangerous command through.

2. **Whitelist over Blacklist**: Instead of listing "all dangerous commands" and excluding them (which misses things), list "all known-safe patterns" and only allow those.

3. **Static Analysis over Runtime Interception**: Analyze command structure before execution, not during—because some commands cannot be safely interrupted once they start.

### 9.2 Limitations

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Static analysis only** | Does not execute commands or track runtime state | Cannot detect attacks that depend on runtime state (e.g., `eval $user_input`) |
| **Limited expansion handling** | globs and parameter expansions are marked too-complex | Commands containing `*`, `${VAR}` are intercepted and asked about, even if actually safe |
| **Single-command granularity** | Each command is analyzed independently | Cannot detect cross-command attack chains (e.g., first command modifies PATH, second command exploits modified PATH) |
| **Classifier is closed-source** | Anthropic has an internal ML classifier assisting decisions | The open-source version lacks learned security analysis, relying only on rule-based analysis |
| **Parser coverage** | The pure TS rewrite may not cover all Bash edge cases | Extremely complex Bash syntax (e.g., nested heredoc + process substitution) may fail to parse |

### 9.3 Why Is This System Worth 35,000 Lines of Code?

35,000 lines of code—larger than many complete web applications—all dedicated to "understanding and validating a single shell command." Is this investment reasonable?

From Claude Code's perspective, **absolutely reasonable**:

- BashTool is the only tool that can directly affect the user's file system
- A single mistaken `rm -rf /` is enough to cause irreversible data loss
- The unpredictability of AI-generated commands (even more in need of safety checks than manual input)
- Hard enterprise requirements for security and compliance

These 35,000 lines are the security cornerstone of Claude Code as "an AI that can act autonomously on your machine." Without them, BashTool would be nothing more than a dangerous `exec()` call.

---

## 10. Critique and Reflection

### 10.1 Engineering Complexity vs. Security Benefit

35,000 lines of safety code are themselves an attack surface—parser bugs could be exploited to bypass security checks. This is the "guardian's paradox": the more complex the guardian system, the higher the probability that it itself becomes a vulnerability.

Anthropic mitigates this risk through:
- FAIL-CLOSED design ensures parser bugs cause false positives (over-blocking), not false negatives (under-blocking)
- 50ms timeout prevents DoS-style attacks
- Dual-track fallback (pure TS + shell-quote) provides redundancy

### 10.2 User Experience Cost

The cost of FAIL-CLOSED is frequent permission confirmation popups. When users run complex bash scripts (with variable expansion, pipes, loops), almost every command triggers a confirmation. This can lead to:

- **User fatigue**: repeatedly clicking "Allow" creates a reflex response, dulling security judgment
- **Productivity loss**: complex operations require multiple manual confirmations
- **Circumvention motivation**: users tend to configure overly permissive rules (e.g., `Bash(*)`), undermining the safety design

> 🔑 **Deep insight**: The Bash AST parser is where the tension between "security" and "usability" is most concentrated in Claude Code—it proves that in the era of AI autonomous action, "understanding commands" is more important than "executing commands." The investment of 35,000 lines is not over-engineering, but an honest answer to a fundamental question: **When AI can run any command on your computer, what level of safety assurance do you need?**
