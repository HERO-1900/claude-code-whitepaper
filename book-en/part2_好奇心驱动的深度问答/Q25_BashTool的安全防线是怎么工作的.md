# How Do BashTool's Eight Layers of Security Defenses Work?

BashTool is the single component with the largest attack surface in Claude Code—30 files and 22,987 lines of code build an eight-layer security defense. This section dismantles each layer's implementation mechanism and how they collaborate, directly from the source code.

> **Source locations**: `src/tools/BashTool/` (18 files), `src/utils/bash/` (23 files)

> 🌍 **Industry Context**: How to safely let AI execute shell commands is the core challenge of all AI coding tools. **CodeX (OpenAI)** v0.118.0 implements OS-level egress rules, replacing the early fragile environment-variable controls; its security model gained the inherent advantage of memory safety after the Rust rewrite (95.6%). **Aider** does not auto-execute commands by default—each one requires explicit user confirmation, which is safe but sacrifices fluidity. **Cursor**'s terminal integration runs inside VS Code's restricted environment, relying on the editor's permission model rather than independent command-level security analysis. **Windsurf**'s Cascade mode allows the AI to execute commands, but user confirmation serves as the primary gate. In security research, both Google's Project Naptime and Trail of Bits have explored sandboxed execution for AI agents. Claude Code's eight-layer defense-in-depth is one of the heaviest-weight solutions among comparable tools—the investment of 22,987 lines of security code far exceeds other products. The reason for this heavy investment is that Claude Code runs on the user's real operating system (not in a container), and its goal is to let the AI safely execute commands **without confirmation** in most cases (auto mode). This requires a security system fine-grained enough to distinguish between a "safe `git status`" and a "dangerous `rm -rf /`"—rather than simply blocking everything or allowing everything.

---

## The Problem

If Claude Code is like a city, BashTool is the city's construction crew—it is the most dangerous and the most useful department. It can execute any shell command: installing dependencies, compiling code, manipulating files, even `rm -rf /`. Among the 40 built-in tool directories, only BashTool can directly execute arbitrary system commands, making it the single component with the largest attack surface in the entire system.

How large is this "construction crew"? The source code alone spans two directories, 30 files, and 22,987 lines (`tools/BashTool/` with 15 files and 10,894 lines + `utils/bash/` with 15 files and 12,093 lines). For comparison, the combined code size of FileEditTool and FileReadTool is less than a quarter of BashTool's. Why does a "execute command" tool need so much more code than an "edit file" tool? Because executing commands isn't the hard part—**executing commands safely** is.

---

## You Might Think…

You might think BashTool's security strategy is simply "ask the user whether to continue before running"—a simple confirmation dialog. Or you might think it works like a traditional sandbox, isolating danger behind a single container layer.

In reality, Claude Code's BashTool builds eight lines of defense-in-depth, from AST parsing to OS-level sandboxing. Each has a clear security responsibility, and all follow the same core principle: **fail-closed (default deny)**. If any layer cannot determine that a command is safe, it does not let it through—it asks the user for confirmation.

> 💡 **Plain English**: BashTool's security defenses are like **eight airport security checkpoints**—Checkpoint 1: X-ray scanning luggage (AST parsing of command structure) → Checkpoint 2: Security officer checking the prohibited-items list (semantic safety checks) → Checkpoint 3: Explosives trace detector (injection detection) → Checkpoint 4: ID and boarding-pass verification (permission rule matching) → Checkpoint 5: Checking whether the destination is legitimate (path constraints) → Checkpoint 6: Recognizing trusted-traveler fast lanes (read-only commands auto-approved) → Checkpoint 7: Final approval (permission mode judgment) → Checkpoint 8: Metal detector at the jet bridge (OS-level sandbox). If any checkpoint says "no," you don't board the plane.

---

## How It Actually Works

### Architecture Overview: From Command String to System Execution

When Claude generates a bash command, it must pass through these eight layers of defense before it can actually execute on your machine:

```
User/AI generates command
    |
    v
[Layer 1] AST-level command parsing — tree-sitter parses the command into a syntax tree
    |
    v
[Layer 2] Semantic safety checks — checks the command's "meaning," intercepting dangerous operations like eval/zmodload
    |
    v
[Layer 3] Injection-detection validator chain — 20+ validators scan for injection attack patterns one by one
    |
    v
[Layer 4] Command permission matching — checks against user-defined allow/deny/ask rules
    |
    v
[Layer 5] Path constraint validation — checks whether file paths the command operates on are within the allowed scope
    |
    v
[Layer 6] Read-only command identification — identifies side-effect-free commands and auto-approves them
    |
    v
[Layer 7] Mode and classifier — makes the final decision based on current permission mode and AI classifier
    |
    v
[Layer 8] OS-level sandbox — hard isolation via seatbelt (macOS) / seccomp (Linux)
    |
    v
  Execute command
```

Below, we penetrate each layer to see what problem each one solves.

---

### Layer 1: AST-Level Command Parsing—Understand First, Judge Second

> Source locations: `utils/bash/bashParser.ts` (4,436 lines), `utils/bash/ast.ts` (2,679 lines), `utils/bash/parser.ts` (230 lines)
>
> 📖 **Deep Dive**: This section is an overview. For the complete Bash AST parser architecture (the four-layer pipeline of 35,000+ lines of code, the full list of 24 safety checks, and the differential-attack defense mechanisms), see **Part 3 "Complete Analysis of the Bash AST Parser"**.

**Why do we need an AST?** Because regular expressions don't understand bash. Look at this example:

```bash
echo "hello; rm -rf /"    # Safe: semicolon is inside quotes, part of the string
echo hello; rm -rf /       # Dangerous: semicolon is outside quotes, a command separator
```

To a regular expression, both lines "contain `rm -rf /`." But only by understanding bash's quoting syntax can we distinguish their true meanings.

Claude Code therefore embeds a **pure TypeScript implementation of a bash parser** (`bashParser.ts`). This is not calling an external tool—it is a tree-sitter-bash-compatible AST generator built from scratch, including a complete tokenizer, heredoc handling, and UTF-8 byte-offset calculation. The source comments say it has been validated against a "golden corpus of 3,449 inputs."

> 📚 **Course Connection**: AST (Abstract Syntax Tree) parsing is core content in **compiler theory courses**. The bash parser here implements a complete pipeline of lexical analysis (tokenizer) → syntactic analysis (parser) → AST construction. The limits `PARSE_TIMEOUT_MS = 50` and `MAX_NODES = 50,000` correspond to **parse complexity control** discussed in compiler courses—preventing malicious inputs from causing exponential parse time (similar to ReDoS attacks on regular expressions). The whitelist architecture (explicit allowlist) is a classic application of the **default deny** principle in security engineering.

The parser has two hard safety valves:

- **50ms timeout ceiling** (`PARSE_TIMEOUT_MS = 50`)—prevents maliciously crafted commands (such as `(( a[0][0][0]... ))` with 2,800 layers of nested subscripts) from hanging the parser
- **50,000 node budget** (`MAX_NODES = 50_000`)—prevents OOM

If the parser times out or exceeds memory, it returns a dedicated `PARSE_ABORTED` symbol rather than `null`. This distinction is critical: `null` means "the parser is not loaded" (fallback to the old path), while `PARSE_ABORTED` means "the parser is loaded but refused this input" (directly judged as too-complex, requiring user confirmation). These two cases were once conflated—adversarial inputs were routed to the old code path missing some checks, a bug later fixed in security audits.

The core output of parsing is `ParseForSecurityResult`:

```typescript
type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }    // Parse succeeded
  | { kind: 'too-complex'; reason: string }            // Contains structures that cannot be statically analyzed
  | { kind: 'parse-unavailable' }                      // Parser unavailable
```

**The design philosophy is written in the file-header comment of `ast.ts`:**

> *"The key design property is FAIL-CLOSED: we never interpret structure we don't understand. If tree-sitter produces a node we haven't explicitly allowlisted, we refuse to extract argv and the caller must ask the user."*

This is an **explicit allowlist** architecture: the code maintains a set of known-safe AST node types (`STRUCTURAL_TYPES`: program, list, pipeline, redirected_statement), and only nodes of these types are traversed recursively. Any node not on the whitelist—including `command_substitution`, `process_substitution`, `subshell`, `if_statement`, `for_statement`, and 16 others—immediately returns `too-complex`.

**Variable scope tracking** is also completed at this layer. `ast.ts` maintains a `varScope: Map<string, string>`, tracking variables that have been assigned in the current command sequence. When a `$VAR` reference is encountered, if that variable was assigned earlier, it is replaced with the tracked value; otherwise, it is rejected. This solves legitimate scenarios like `NOW=$(date) && jq --arg now "$NOW" ...` that require variable expansion.

Even more elegant is **scope isolation in pipelines** (`ast.ts` around lines 500–565): commands connected by `&&` and `;` share variable scope (because they execute sequentially), but commands connected by `||`, `|`, and `&` reset scope (because they are conditional/parallel, so variables may not exist). The comments give a specific attack scenario:

```bash
true || FLAG=--dry-run && cmd $FLAG
```

If scope were passed through linearly, `$FLAG` would be parsed as `--dry-run`, but in actual execution the right side of `||` does not run (because `true` already succeeded), so `$FLAG` is empty. This is a precise security-semantic difference.

---

### Layer 2: Semantic Safety Checks—Checking the Command's "Meaning"

> Source location: `checkSemantics()` in `utils/bash/ast.ts` (around lines 2213–2679)

The AST parser answers "what is the structure of this command?" The semantic checker answers "what is this command trying to do?"

`checkSemantics()` receives the parsed `SimpleCommand[]` and checks whether each command's argv[0] (command name) falls into a dangerous category. This layer does three critical things:

**First, stripping safe wrapper commands.** An attacker could use `timeout 5 eval "rm -rf /"` to disguise the truly executed command. `checkSemantics` recursively strips `time`, `nohup`, `timeout`, `nice`, `env`, and `stdbuf` wrappers, exposing the real wrapped command underneath. The stripping of each wrapper goes through precise flag enumeration—for example, `timeout` supports GNU long options like `--foreground`, `--kill-after=N`, `--signal=TERM`, and short options like `-k`, `-s`, `-v`. Any unrecognized flag causes a fail-closed, because an unrecognized flag means the wrapped command may not be correctly located.

A March 2026 security audit (SAST Mar 2026) also found an issue: the previous code only skipped `--long` flags, so `timeout -k 5 10 eval ...` was not stripped correctly. The fix comment is right in the source:

```
// SECURITY (SAST Mar 2026): the previous loop only skipped `--long`
// flags, so `timeout -k 5 10 eval ...` broke out with name='timeout'
// and the wrapped eval was never checked.
```

**Second, intercepting eval-like builtin commands.** Once wrappers are stripped and the true argv[0] is exposed, `checkSemantics` checks whether it is one of the following "eval equivalents":

- `eval`—directly executes a string
- `source` / `.`—loads and executes a file
- `trap`—executes code when a signal fires
- `enable`—dynamically loads/unloads shell builtins
- `hash`—can manipulate the command lookup table
- `coproc`—creates a coprocess

**Third, intercepting Zsh-specific dangerous commands.** Because BashTool runs in the user's default shell (many macOS users use zsh), the code maintains a `ZSH_DANGEROUS_COMMANDS` set (`bashSecurity.ts` around lines 43–74) containing 23 zsh-specific dangerous commands:

- `zmodload`—entry point to the zsh module system, capable of loading `zsh/mapfile` (array-assignment-based stealth file I/O), `zsh/system` (fine-grained file control via sysopen/syswrite), `zsh/zpty` (pseudo-terminal command execution), `zsh/net/tcp` (network exfiltration via ztcp), `zsh/files` (builtin rm/mv/ln that bypass binary checks)
- `emulate`—an eval equivalent when used with the `-c` flag
- module-level commands like `sysopen`, `sysread`, `syswrite`, `sysseek`, `zpty`, `ztcp`, `zsocket`

---

### Layer 3: Injection-Detection Validator Chain—Defense-in-Depth with 20+ Validators

> Source location: `tools/BashTool/bashSecurity.ts` (2,592 lines)

This is the single largest defensive layer in the entire security system by lines of code. It consists of 4 **early validators** and 18 **main validators**, forming a rigorous validation pipeline.

#### Early Validators (short-circuit path)

| Validator | Function | Short-circuit behavior |
|-----------|----------|------------------------|
| `validateEmpty` | Empty command passes directly | allow |
| `validateIncompleteCommands` | Detects incomplete command fragments (starting with tab, `-`, `&&`) | ask |
| `validateSafeCommandSubstitution` | Allows safe heredoc forms like `$(cat <<'EOF'...'EOF')` | allow |
| `validateGitCommit` | Allows simple commits like `git commit -m 'msg'` | allow |

The implementation of `validateGitCommit` is worth a deep look. It began as a simple optimization—so that `git commit -m "fix typo"` wouldn't require user confirmation. But the comments record at least five security hardenings:

1. **Backtick attack**: `git commit ; curl evil.com -m 'x'`—the `.*?` in the regex would swallow the semicolon
2. **Backslash attack**: `git commit -m "test\"msg" && evil`—the backslash would cause quote-boundary misalignment
3. **Redirection attack**: `git commit --allow-empty -m 'payload' > ~/.bashrc`—if `validateGitCommit` returned `allow`, `validateRedirections` would be skipped
4. The current implementation uses `[^;&|\`$<>()\n\r]*?` before `-m` (excluding all shell metacharacters) and performs separate metacharacter and redirection checks on the remainder

#### Main Validator Chain (18 validators)

Each validator returns one of three results: `passthrough` (no issue, continue), `ask` (needs user confirmation), or `allow` (safe to approve).

The complete list and the attack categories they detect:

| # | Validator | Detection content |
|---|-----------|-------------------|
| 1 | `validateJqCommand` | jq's `system()` function executes arbitrary commands |
| 2 | `validateObfuscatedFlags` | Hidden flags inside quotes (e.g., `rm "-rf"` is equivalent to `rm -rf`) |
| 3 | `validateShellMetacharacters` | `;`, `\|`, `&`, and other metacharacters inside quotes |
| 4 | `validateDangerousVariables` | Variables next to redirects/pipes (`$VAR > file`) |
| 5 | `validateCommentQuoteDesync` | `#` comments desynchronizing with quote state, causing parse differences |
| 6 | `validateQuotedNewline` | Newlines inside quotes (may cause line-level processing to drop content) |
| 7 | `validateCarriageReturn` | `\r` causing shell-quote / bash parsing differences |
| 8 | `validateNewlines` | Unquoted newlines that may separate multiple commands |
| 9 | `validateIFSInjection` | `$IFS` variable bypassing regex validation |
| 10 | `validateProcEnvironAccess` | `/proc/*/environ` reading sensitive environment variables |
| 11 | `validateDangerousPatterns` | `$()`, `` ` ``, `<()`, `>()`, `${}`, `=cmd`, and 10 other substitution patterns |
| 12 | `validateRedirections` | Input/output redirection to arbitrary files |
| 13 | `validateBackslashEscapedWhitespace` | `\ ` backslash-escaped spaces causing word-boundary differences |
| 14 | `validateBackslashEscapedOperators` | `\;` differently interpreted by shell-quote and bash |
| 15 | `validateUnicodeWhitespace` | `\u00A0` (NBSP) and other Unicode whitespace invisible in the terminal but treated as characters by bash |
| 16 | `validateMidWordHash` | `'x'#cmd`—quote adjacent to `#`, after quote stripping `#` becomes a comment hiding subsequent content |
| 17 | `validateBraceExpansion` | `{a,b}` brace expansion may expand into unexpected filenames |
| 18 | `validateZshDangerousCommands` | The 23 zsh dangerous commands mentioned above |
| 19 | `validateMalformedTokenInjection` | Shell-quote malformed-token injection reported in HackerOne #3482049 |

**The validator execution order is not arbitrary.** Comments explicitly explain why certain validators must run before others. For example, `validateCommentQuoteDesync` must run before `validateNewlines`, because the scenario it detects causes the latter's quote tracking to fail. `validateQuotedNewline` must also run before `validateNewlines`—it detects newlines inside quotes, while `validateNewlines` is designed to ignore newlines inside quotes.

**Even more subtle is the distinction between "misparsing" and "non-misparsing" validators.** The code divides validators into two categories:

- **Misparsing validators** (default): They detect parsing differences between shell-quote and bash, and their `ask` results carry the `isBashSecurityCheckForMisparsing: true` flag
- **Non-misparsing validators** (`validateNewlines` and `validateRedirections`): They detect normal shell features, not parsing differences

This distinction affects how the permission system treats them: a misparsing `ask` is handled more strictly by the permission system. And the code ensures that **a non-misparsing validator's `ask` does not short-circuit subsequent misparsing validators**—this was a bug exposed by a real attack:

```
// SECURITY: We must NOT short-circuit when a non-misparsing validator
// returns 'ask' if there are still misparsing validators later in the list.
// payload: `cat safe.txt \; echo /etc/passwd > ./out`
// validateRedirections fires first (non-misparsing) → 
// validateBackslashEscapedOperators would have caught \; (misparsing)
```

The fix introduces `deferredNonMisparsingResult`—a non-misparsing `ask` result is deferred while the remaining misparsing validators continue to run; only if no misparsing issues are found is the deferred result returned.

---

### Layer 4: Command Permission Matching—the allow/deny/ask Rule Engine

> Source location: `tools/BashTool/bashPermissions.ts` (2,621 lines)

Commands that have passed the first three layers are matched here against user-defined permission rules. Rules come in three formats:

- **Exact match**: `Bash(git commit -m "fix")`—matches only this specific command
- **Prefix match**: `Bash(npm run:*)`—matches any command starting with `npm run`
- **Wildcard match**: `Bash(git *)`—shell-style globbing

`bashToolHasPermission()` is the entry point for this layer. It checks in the following priority order:

1. **Check deny rules first**—deny takes precedence over everything
2. **Then check ask rules** (including the AI classifier, which uses Claude Haiku to judge whether a command matches a natural-language deny/ask rule)
3. **Finally check allow rules**

**Safe environment-variable stripping** is a key mechanism in this layer. So that `NODE_ENV=prod npm run build` can match the `Bash(npm run:*)` rule, the system strips "safe" environment-variable prefixes. But which environment variables are "safe"?

`bashPermissions.ts` maintains a `SAFE_ENV_VARS` whitelist (around lines 378–430) containing 37 variables—`NODE_ENV`, `RUST_LOG`, `PYTHONUNBUFFERED`, and others. The comments **explicitly list variables that must NEVER be added to the whitelist**:

> *SECURITY: These must NEVER be added to the whitelist: PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_\* (execution/library loading), PYTHONPATH, NODE_PATH (module loading), GOFLAGS, RUSTFLAGS, NODE_OPTIONS (code execution flags), HOME, TMPDIR, SHELL, BASH_ENV (affect system behavior)*

There is also a set of `ANT_ONLY_SAFE_ENV_VARS` (around lines 447–497, 50 variables) available only to Anthropic internal users (`USER_TYPE === 'ant'`). The comments warn in all caps:

> *SECURITY: These env vars are stripped before permission-rule matching... This is INTENTIONALLY ANT-ONLY and MUST NEVER ship to external users.*

**Safe wrapper stripping** (`stripSafeWrappers`, around lines 524–600) also happens at this layer. It uses regexes to precisely match flag patterns for `timeout`, `time`, `nice`, `nohup`, and `stdbuf`. Each regex has detailed security comments—for example, the `timeout` regex explains why flag values must use the `[A-Za-z0-9_.+-]` whitelist rather than `[^ \t]+`:

> *Previously `[^ \t]+` matched `$ ( ) \` | ; &` — `timeout -k$(id) 10 ls` stripped to `ls`, matched Bash(ls:\*), while bash expanded $(id) during word splitting BEFORE timeout ran.*

**Compound command ceiling**: when `splitCommand` produces more than 50 subcommands (`MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50`), the system falls back directly to `ask`. The comment explains why:

> *CC-643: On complex compound commands, splitCommand_DEPRECATED can produce a very large subcommands array (possible exponential growth). Each subcommand then runs tree-sitter parse + ~20 validators + logEvent, and with memoized metadata the resulting microtask chain starves the event loop — REPL freeze at 100% CPU.*

50 was not chosen arbitrarily—"legitimate user commands don't split that wide."

---

### Layer 5: Path Constraint Validation—Controlling Which Files a Command Can Touch

> Source location: `tools/BashTool/pathValidation.ts` (1,303 lines)

This layer solves the following problem: even if a command itself is allowed (e.g., the user set `Bash(rm:*)`), that doesn't mean `rm -rf /` is okay.

`pathValidation.ts` defines dedicated path extractors (`PATH_EXTRACTORS`) for 33 commands (`cd`, `ls`, `find`, `rm`, `mv`, `cp`, `cat`, `grep`, `sed`, `git`, `jq`, etc.), extracting file paths from command arguments and verifying whether those paths are within the allowed working directory.

**Dangerous removal path detection** (`checkDangerousRemovalPaths`) is a hard guard: regardless of what allow rules the user has set, `rm`/`rmdir` operations targeting critical system directories like `/`, `/etc`, `/usr`, `/home`, `/tmp` are forcibly routed to `ask`, and no "save rule" suggestion is offered—because the system does not want to encourage users to save rules for dangerous commands.

**sed commands** have a separate validation module (`sedValidation.ts`, 684 lines + `sedEditParser.ts`, 322 lines). This is because sed has a unique security model: `sed -i 's/foo/bar/g' file.txt` is a file-editing operation that needs path checking, but `sed 's/foo/bar/g'` (without `-i`) is just a stream processor that modifies no files. `sedEditParser.ts` implements a complete sed command parser capable of distinguishing these two cases.

---

### Layer 6: Read-Only Command Identification—Auto-Approving Side-Effect-Free Commands

> Source location: `tools/BashTool/readOnlyValidation.ts` (1,990 lines)

The goal of this layer is: for read-only commands (commands that do not modify system state), skip permission confirmation so Claude can work fluidly.

`readOnlyValidation.ts` is the third-largest file in BashTool (after `bashPermissions.ts` and `bashSecurity.ts`), maintaining a massive whitelist of read-only commands. Take `git` as an example: `GIT_READ_ONLY_COMMANDS` includes `status`, `log`, `diff`, `show`, `branch` (without `-D`), `stash list`, and more than a dozen other subcommands.

But the definition of "read-only" is more complex than you'd think. The `-l`/`--list-details` flags for `fd` and `fdfind` are excluded from the safe-flag whitelist; the comment explains:

> *SECURITY: -l/--list-details EXCLUDED — internally executes `ls` as subprocess (same pathway as --exec-batch). PATH hijacking risk if malicious `ls` is on PATH.*

Every command's whitelist undergoes flag-level fine-grained validation. The `validateFlags()` function parses every argument of the command, checking whether it is in the safe-flag set. This is not simple string matching—it distinguishes no-value flags (`-v`), value-following flags (`-n 10`), fused flags (`-vvv`), and the `--` terminator.

---

### Layer 7: Mode and Classifier—Final Decision by Permission Mode

> Source locations: `tools/BashTool/modeValidation.ts` (115 lines), classifier integration in `bashPermissions.ts`

Claude Code has 6 permission modes (`default`, `plan`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `auto`), each imposing different constraints on BashTool.

`modeValidation.ts` implements mode-aware permission logic. For example, in `acceptEdits` mode, filesystem-operation commands (`mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed`) are automatically allowed—because the user has already explicitly authorized editing operations.

The AI classifier (`bashClassifier.ts`) is another elegant component: it uses the Claude Haiku model to judge whether a bash command matches a deny/ask rule described by the user in natural language. For example, a user might set "do not execute any commands that modify the database"—a rule impossible to match with simple regexes, requiring the AI to understand command semantics.

---

### Layer 8: OS-Level Sandbox—the Final Hard Isolation

> Source location: `tools/BashTool/shouldUseSandbox.ts` (153 lines)

The first seven layers are all "static analysis"—checks performed before command execution. The eighth layer is runtime hard isolation.

`shouldUseSandbox()` decides whether a command needs to run inside a sandbox. The sandbox uses OS-native mechanisms: `seatbelt` (`sandbox-exec`) on macOS, and `seccomp-bpf` on Linux. The sandbox restricts capabilities at the system-call level—even if all seven preceding layers are bypassed, the sandbox can still block dangerous operations like writing to protected paths or accessing the network.

> 📚 **Course Connection**: Both `seatbelt` and `seccomp-bpf` are examples of **MAC (Mandatory Access Control)** from operating-system courses. `seccomp-bpf` intercepts system calls at the kernel level via a BPF (Berkeley Packet Filter) program, belonging to the category of **kernel security modules**. macOS's `sandbox-exec` uses Scheme-language configuration files to define access policies—a form of **declarative security policy**. Compared to the imperative checking of the first seven layers, this embodies the classic OS security design principle of **separation of policy and mechanism**.

The sandbox has three "exception" mechanisms:

1. **`dangerouslyDisableSandbox` parameter**—Claude can request to disable the sandbox, but it only takes effect if `areUnsandboxedCommandsAllowed()` returns true
2. **`excludedCommands` setting**—users can configure certain commands to skip the sandbox (e.g., commands that need network access)
3. **Compound-command splitting**—for `docker ps && curl evil.com`, the system splits and checks each subcommand separately, preventing one excluded command from smuggling another dangerous command out of the sandbox

A comment in the source is worth quoting:

> *NOTE: excludedCommands is a user-facing convenience feature, not a security boundary. It is not a security bug to be able to bypass excludedCommands — the sandbox permission system (which prompts users) is the actual security control.*

This illustrates the core idea of the eight-layer defense: each layer knows it is not infallible; true security comes from depth and overlap.

---

### Supporting Infrastructure

#### Heredoc Handling—a Minefield of Shell Syntax Security

> Source location: `utils/bash/heredoc.ts` (733 lines)

Heredocs (`<<EOF...EOF`) are one of the hardest problems in bash security analysis. The shell-quote library parses `<<` as two separate `<` redirection operators, completely destroying heredoc semantics.

`heredoc.ts` implements a complete heredoc extraction and restoration mechanism: before handing text to shell-quote for parsing, heredocs are replaced with randomized-salt placeholders (`__HEREDOC_0_a1b2c3d4__`), then restored after parsing. The random salt prevents collision attacks when the command contains a literal placeholder string.

The code distinguishes between **quoted heredocs** (`<<'EOF'`, `<<\EOF`—body is plain text, no variable expansion) and **unquoted heredocs** (`<<EOF`—`$()`, `` ` ``, `${}` in the body are executed by the shell). Security validators only strip the body of quoted heredocs—the body of an unquoted heredoc must go through the full security check chain.

Before extraction, there is a series of "paranoid pre-validations" (verbatim from the source: *paranoid pre-validation*):

- Abandon extraction upon encountering `$'...'` or `$"..."` (ANSI-C quotes interfere with quote tracking)
- Abandon extraction upon encountering backticks (backtick nesting rules are too complex, and backticks can act as `shell_eof_token` in bash source make_cmd.c:606, prematurely closing a heredoc)
- Abandon extraction upon encountering unclosed `((` (the `<<` in `(( x = 1 << 2 ))` is a bitwise-shift operator, not a heredoc)

#### Shell Quote Security

> Source locations: `utils/bash/shellQuote.ts` (304 lines), `utils/bash/shellQuoting.ts` (128 lines)

`shellQuote.ts` wraps the `shell-quote` library's parse/quote functions with error handling and security hardening. The core security function is `hasMalformedTokens()` (around lines 117–160), which detects malformed tokens produced when shell-quote misparses a command:

- Unbalanced braces: `echo {"hi":"hi;evil"}` parsed by shell-quote produces `{hi:"hi"` with unbalanced braces
- Unpaired quotes: shell-quote silently drops unmatched `"` or `'`, causing `;` to be interpreted as an operator

`shellQuoting.ts` handles safe quoting for heredocs and multiline strings. It detects Windows CMD syntax like `>nul` and automatically rewrites it to `/dev/null` (`rewriteWindowsNullRedirect`), because Git Bash would create a file named `nul`—a Windows reserved device name that is "extremely hard to delete and breaks git add . and git clone" (quoted from issue #4928).

#### Pipeline Command Security

> Source location: `utils/bash/bashPipeCommand.ts` (294 lines)

`rearrangePipeCommand()` solves a subtle problem: when BashTool executes a pipeline command via `eval`, the stdin redirection (`< /dev/null`) applies to the entire pipeline rather than the first command. The fix is to rearrange `cmd1 | cmd2` into `cmd1 < /dev/null | cmd2`.

But this rearrangement itself carries security risks—shell-quote and bash parse some inputs differently, and reconstructing the command may change semantics. The code gives up on rearrangement and falls back to quoting the entire command if any of the following are present:

- Backticks (shell-quote handles them poorly)
- `$()` (shell-quote parses the parentheses as independent operators)
- `$VAR` (shell-quote expands variables to empty strings)
- Control structures (`for`/`while`/`if`)
- Newlines (shell-quote treats newlines as spaces)
- Matching `hasShellQuoteSingleQuoteBug` (the `\'` parsing difference inside single quotes)

#### ShellSnapshot—Controlling the Execution Environment

> Source location: `utils/bash/ShellSnapshot.ts` (582 lines)

ShellSnapshot is not a security audit log—it is an **environment control mechanism**. Every time BashTool executes a command, the shell environment needs to include the user's functions, aliases, and shell options, while also injecting Claude Code's own tool integrations.

ShellSnapshot does the following:

1. Extract functions, aliases, and shell options from the user's `.bashrc`/`.zshrc` (filtering out completion functions starting with `_`, but keeping helper functions starting with `__` such as `__pyenv_init`)
2. Inject ripgrep integration—if the system lacks `rg`, create a shell function pointing to the built-in ripgrep binary
3. Inject `find`/`grep` integration—replace system versions with built-in `bfs` (fast find) and `ugrep` (fast grep)
4. **Clear aliases that might override these functions**—`unalias find 2>/dev/null || true` must execute before the function definitions, because "bash expands aliases before function lookup"

`createArgv0ShellFunction()` uses bun's internal `ARGV0` dispatch mechanism: the bun binary decides which embedded tool to run based on argv[0] (rg, bfs, ugrep), and the shell function sets argv[0] via `exec -a <name>` or `ARGV0=<name>`.

#### Command Registry

> Source locations: `utils/bash/registry.ts` (53 lines), `utils/bash/commands.ts` (1,339 lines)

`registry.ts` is the registry center for command specifications. It dynamically loads command specs (flag definitions, subcommand structures, etc.) from `@withfig/autocomplete` (the Fig command-completion library), with LRU caching. The built-in `specs/` directory (8 files, including index.ts) defines custom specs for `alias`, `nohup`, `pyright`, `sleep`, `srun`, `time`, and `timeout`, overriding or supplementing information missing from the Fig library.

`commands.ts` implements command splitting—breaking compound commands (`cmd1 && cmd2 | cmd3`) into lists of subcommands. This is the data foundation of the entire security system—each subcommand passes through permission checks independently.

Security considerations in the splitting process are extremely dense. Even "placeholder generation" uses `crypto.randomBytes(8)` to prevent injection attacks:

```typescript
// Security: This is critical for preventing attacks where a command like
// `sort __SINGLE_QUOTE__ hello --help __SINGLE_QUOTE__` could inject arguments.
const salt = randomBytes(8).toString('hex')
```

Line-continuation handling (`\<newline>`) distinguishes odd and even backslashes: an odd number of backslashes is a line continuation (stripped), while an even number is an escaped backslash plus a newline command separator (preserved). The comments explain why a space must NOT be added:

> *SECURITY: We must NOT add a space here - shell joins tokens directly without space. Adding a space would allow bypass attacks like `tr\<newline>aceroute` being parsed as `tr aceroute` (two tokens) while shell executes `traceroute` (one token).*

---

## The Trade-Offs Behind This Design

### Trade-off 1: Security Depth vs. Response Speed

22,987 lines of security code means every command undergoes substantial checks. Claude Code's strategy is layered short-circuiting:

- Empty commands return at the first validator (zero overhead)
- `git commit -m "..."` returns at the 4th early validator (skipping 18 main validators)
- Read-only commands pass directly at Layer 6 (skipping the permission-confirmation UI)
- Tree-sitter parsing has a 50ms timeout ceiling

### Trade-off 2: The Cost of Fail-Closed—False Positives

Default deny means legitimate commands may also be blocked. For example, commands containing `${}` (legitimate parameter expansion) trigger `validateDangerousPatterns`. `MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` means if you write an extremely long `&&` chain, the system will ask for confirmation rather than attempting to analyze it.

This is an explicit trade-off—better to ask the user one extra time than to let one dangerous command through.

### Trade-off 3: Dual Parser Parallelism—Legacy and Tree-Sitter Transition

The code is full of `_DEPRECATED` suffixes—`splitCommand_DEPRECATED`, `bashCommandIsSafe_DEPRECATED`. The entire system is migrating from the old regex+shell-quote path to the new tree-sitter path. But the migration is not a hard cutover:

- The tree-sitter path lives behind the `TREE_SITTER_BASH` feature flag
- `TREE_SITTER_BASH_SHADOW` mode can run both paths simultaneously, logging differences but using the old path as the source of truth
- The old path is kept as a fallback—if tree-sitter is unavailable (e.g., WASM fails to load)

This "shadow testing" strategy ensures the new path is sufficiently validated in production before the switch is flipped.

### Trade-off 4: HackerOne-Driven Hardening

Comments repeatedly cite HackerOne report numbers (e.g., `#3482049`), showing that these validators are not derived from theory—they are responses to real attacks. Every SECURITY comment includes the attack vector, the attack principle, and the fix. This makes the code both an implementation and a security knowledge base.

---

## 23 Safety Checks: An Underestimated Number

Looking across the eight layers of defense, if we tally all independent safety checks—4 early validators, 18 main validators, plus the final OS-level sandbox verdict—BashTool implements **23 safety checks** in total. This number itself is evidence of engineering depth: not just "we did safety checks," but an exhaustive enumeration of 23 attack surfaces.

Several standout checks are especially noteworthy:

- **Zero-width character injection detection** (`validateUnicodeWhitespace`): Detects invisible Unicode characters (such as the "zero-width space"—invisible to the eye but present in the text). These characters are completely invisible in the terminal, but bash treats them as legitimate characters rather than whitespace separators, allowing attackers to use this "invisible ink" to hide malicious parameters.
- **Zsh extension trick protection** (`validateBraceExpansion` + `validateZshDangerousCommands`): The default shell on Mac (Zsh) has "shortcut" syntaxes (such as brace expansion `{a,b}`, which automatically becomes two commands) that attackers might use to bypass security checks. The system blocks each of the 23 Zsh-specific dangerous commands one by one.
- **Native client authentication**: Claude Code's underlying communication includes built-in "digital fingerprint" verification—ensuring that the client talking to Anthropic's servers is indeed the genuine Claude Code client, not a forged impostor. This is equivalent to adding a physical lock on top of application-layer security checks.

> 🌍 **Community Perspective | @anthropic_security_review** — "23 checks is not paranoia — it's the minimum surface area coverage for a tool that runs arbitrary shell commands on a real OS."

---

## If You Remember Only One Thing

BashTool's security doesn't rely on a single wall—it relies on **eight layers of defenses made from different materials, stacked together**—from syntactic parsing (Layer 1) to OS sandboxing (Layer 8), with each layer assuming the previous ones might be breached. The core principle is carved at the beginning of `ast.ts`: **fail-closed—we never interpret structure we don't understand**. Across 22,987 lines of code, every SECURITY comment is a scar from a real attack. This is not over-engineering—this is the security price a system must pay for allowing AI to execute arbitrary shell commands.
