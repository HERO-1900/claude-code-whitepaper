# How Do Deep Link and Teleport Connect Across Devices?

Click a link in your browser, and Claude Code opens in your terminal. Or "teleport" your local code to a cloud sandbox so a remote AI can work on it—these two boundary-crossing "teleportation" features solve the core problem of how to securely pass intent across trust boundaries. This chapter dissects Deep Link's URI security validation, three-platform protocol registration, twelve-terminal adaptation matrix, and Teleport's Git Bundle three-tier fallback strategy.

> 💡 **Plain English**: It's like AirDrop—seamlessly passing sessions between different devices.

> 🌍 **Industry Context**: Deep Link (launching a local app from the browser) is a mature technique on mobile, but rare in CLI developer tools. **VS Code** supports the `vscode://` protocol for opening files and installing extensions, and **JetBrains Toolbox** supports the `jetbrains://` protocol for opening projects—these are the closest precedents among desktop IDEs. **Cursor** and **Windsurf**, as VS Code forks, inherit the `vscode://` mechanism, but lack deep-link designs for AI prompt prefilling. As for remote code teleportation (Teleport), **GitHub Codespaces** and **Gitpod** achieve cloud development environments through containerization, but they transfer a full Git clone of the repository, not Claude Code's lightweight "Git bundle three-tier fallback" strategy. **Aider** and **CodeX** currently have no browser-based remote control capability (CodeX supports parallel agent workflows but targets the local terminal). **OpenClaw** implements cross-region device wakeup and remote execution through messaging apps (WhatsApp/Telegram), representing a terminal-free cross-device connection solution. The unique aspect of Claude Code's Deep Link + Teleport combination is that it implements cross–trust-boundary intent passing for a **terminal tool** (not a GUI IDE), which introduces additional security challenges—there is no OS-level URL confirmation dialog, so the system must build its own security banner.

---

## The Problem

You clicked a `claude-cli://open?q=fix+the+login+bug&repo=myorg/myapp` link in your browser. Your terminal suddenly pops up, Claude Code has already opened the correct project directory, and the input box is prefilled with "fix the login bug," waiting for you to press Enter. Or, you ran a `/remote` command, your local code was packaged and uploaded to the cloud, and a remote Claude began working for you. How do these two boundary-crossing "teleports" actually work?

---

> **[Chart placeholder 2.21-A]**: Architecture diagram — Deep Link complete call chain (browser → OS → trampoline process → terminal detection → new terminal window → Claude Code launch)

> **[Chart placeholder 2.21-B]**: Architecture diagram — Teleport Git Bundle transfer flow (local stash → bundle → upload → remote session → sandbox)

## You Might Think…

"Isn't Deep Link just a URL scheme? Register it and you're done. And Teleport—isn't it just uploading code to the cloud?" You might assume these are simple plumbing tasks.

---

## Here's How It Actually Works

The Deep Link system spans 6 source files and 1,388 lines of code, covering URI parsing, security validation, protocol registration (macOS/Linux/Windows), terminal detection (12 terminal emulators), shell injection defense, and a complete security alert banner system. The Teleport system spans 4 files and 955 lines of code, implementing a Git bundle three-tier fallback strategy, cloud session management, environment selection, and a retry-aware API communication layer. Together, these two systems solve one core problem: **how to safely pass intent across trust boundaries**.

### Section 1: Deep Link — URI Parsing and the Security Guard

Deep Link uses the custom protocol `claude-cli://` (`parseDeepLink.ts:23`). A complete URI looks like this:

```
claude-cli://open?q=fix+tests&repo=owner/repo&cwd=/path/to/project
```

The `parseDeepLink` function (`parseDeepLink.ts:84-153`, 70 lines) parses this URI, but it is **primarily a security validator**, not a parser. Every parameter undergoes layered checks:

**q (query text)**:
- Upper limit of 5,000 characters (`MAX_QUERY_LENGTH`) — why 5000? Because Windows cmd.exe's command-line limit is 8,191 characters. Subtract the fixed overhead of `cd /d <cwd> && claude.exe --deep-link-origin --prefill "<q>"`, then account for cmd.exe's `%→%%` escape expansion, and ~5000 is the safe ceiling (the comment at `parseDeepLink.ts:57-69` explains this calculation in detail)
- ASCII control-character check (`containsControlChars`) — newlines and carriage returns act as command separators in shells; a query containing `\n rm -rf /` could lead to command injection
- Unicode sanitization (`partiallySanitizeUnicode`) — filters ASCII smuggling characters and hidden prompt-injection payloads

**cwd (working directory)**:
- Must be an absolute path (starting with `/` or a Windows drive letter)
- Upper limit of 4,096 characters (Linux PATH_MAX)
- Same control-character checks apply

**repo (repository identifier)**:
- Strictly matches the `owner/repo` format (`REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/`) — only alphanumerics, dots, hyphens, underscores, and exactly one slash are allowed. This prevents path-traversal attacks

The design philosophy is **reject rather than truncate** — if the query is too long, throw an error instead of clipping the first 5000 characters. Truncation changes semantics; a carefully crafted malicious query could hide the critical "also cat ~/.ssh/id_rsa" beyond the cutoff point.

### Section 2: Protocol Registration — Three Platforms, Three Completely Different Approaches

`registerProtocol.ts` (348 lines) is the complete cross-platform protocol registration implementation (a common need in desktop app development; VS Code, Slack, and others have similar mechanisms). The three platforms couldn't be more different:

**macOS (`registerMacos`, `registerProtocol.ts:75-138`)**:
Creates a minimal `.app` trampoline bundle at `~/Applications/Claude Code URL Handler.app`. The bundle's `Info.plist` declares `CFBundleURLSchemes` (URL scheme registration), but its executable is not a real program — it is a **symbolic link** pointing to the `claude` binary (`registerProtocol.ts:128`).

> 📚 **Course Connection**: Protocol registration on the three platforms is a practical application of **inter-process communication (IPC)** and **registry/service discovery** mechanisms from operating-systems courses. macOS LaunchServices, the Linux XDG MIME system, and the Windows registry represent three different "service registration and discovery" paradigms. Symbolic links (symlinks) are a foundational concept in filesystem courses — here they are cleverly exploited for their "signature inheritance" property to bypass code-signature checks.

Why use a symlink instead of copying? Because macOS endpoint-security tools (like Santa) check the signature of the executable file. A new, unsigned executable would be blocked. A symlink pointing to the already-signed `claude` binary requires no additional signing.

After registration, `lsregister -R` is called (`registerProtocol.ts:132-133`) to tell LaunchServices to re-index — otherwise macOS won't know about the new URL scheme handler.

**Linux (`registerLinux`, `registerProtocol.ts:144-180`)**:
Creates a `.desktop` file under `$XDG_DATA_HOME/applications/`, then registers it as the scheme handler with `xdg-mime default`. On headless systems (WSL, Docker), the absence of `xdg-mime` is not an error — a headless environment has no browser to click links from.

**Windows (`registerWindows`, `registerProtocol.ts:185-209`)**:
Three `reg add` commands write to the registry at `HKEY_CURRENT_USER\Software\Classes\claude-cli` — the standard Windows URL scheme registration flow.

All three platforms also share a **self-healing check** (`isProtocolHandlerCurrent`, `registerProtocol.ts:263-290`): on every launch, the system verifies that the registration is valid and points to the correct binary. If the binary path has changed (e.g., after an update moved the install location), it automatically re-registers. The check reads the OS registration artifacts directly (symlink target, `.desktop` file contents, registry values) without relying on any cache file — so cross-machine config sync won't cause false positives.

On failure, there's a 24-hour backoff (`registerProtocol.ts:314-326`): if registration fails due to EACCES or ENOSPC, a marker file is written to `~/.claude/.deep-link-register-failed`, and no retries are attempted for 24 hours, avoiding the same error on every startup. The marker is placed in `~/.claude` (not `~/.claude.json`) because `~/.claude.json` might sync across machines (e.g., through a dotfiles repo), whereas registration state is per-machine.

There's also a gating layer: `ensureDeepLinkProtocolRegistered` (`registerProtocol.ts:298-348`) only proceeds if two preconditions are met — the user hasn't disabled it via settings (`disableDeepLinkRegistration`), and the GrowthBook feature flag `tengu_lodestone_enabled` is on. This means the Deep Link feature can be remotely toggled.

### Section 3: protocolHandler — Trampoline Process Logic

`protocolHandler.ts` (136 lines) is the entry point for `claude --handle-uri <url>`. Its workflow:

1. Parse the URI (calling `parseDeepLink`)
2. Resolve the working directory (`resolveCwd`): explicit cwd takes precedence → repo lookup (MRU local clone) → fallback to home
3. If the source is a repo, read the mtime of `.git/FETCH_HEAD` (`readLastFetchTime`, `banner.ts:88-102`) — FETCH_HEAD is per-worktree; if the current directory is a worktree, the system checks both the main repo and the worktree, taking the newer one
4. Launch a terminal (`launchInTerminal`), passing the precomputed `lastFetchMs` flag

Repo path resolution (`resolveCwd`, `protocolHandler.ts:117-136`) has a forgiving design: if `?repo=myorg/myapp` can't find a matching local clone, **it doesn't error** — it silently falls back to the home directory. A web link might reference a repo the user hasn't cloned, but that shouldn't prevent Claude Code from opening.

There's also a macOS-specific entry: `handleUrlSchemeLaunch` (`protocolHandler.ts:84-105`) handles the case where macOS passes the URL through the .app bundle via Apple Event. It detects URL scheme launch (as opposed to terminal `open` command) by checking `__CFBundleIdentifier === MACOS_BUNDLE_ID`, then uses the NAPI module `url-handler-napi`'s `waitForUrlEvent(5000)` to wait for the Apple Event, up to 5 seconds.

### Section 4: Terminal Launcher — The Pain of Adapting 12 Terminals

When the OS invokes `claude --handle-uri <url>`, that process **has no terminal** — it was launched directly by LaunchServices. So it has to open a terminal window itself.

`terminalLauncher.ts` (557 lines, the largest single file) adapts to 12 terminal emulators:

| Platform | Supported Terminals |
|----------|---------------------|
| macOS | iTerm2, Ghostty, Kitty, Alacritty, WezTerm, Terminal.app |
| Linux | ghostty, kitty, alacritty, wezterm, gnome-terminal, konsole, xfce4-terminal, mate-terminal, tilix, xterm |
| Windows | Windows Terminal, PowerShell, cmd.exe |

Detection priority follows user preference: stored preference → `TERM_PROGRAM` environment variable → `mdfind` via Spotlight → traverse `/Applications` → fallback to default terminal.

But the most critical distinction is the **security path classification**. The file header comment (`terminalLauncher.ts:199-212`) explicitly labels two categories of paths:

**Pure argv paths (safe)**: Ghostty, Alacritty, Kitty, WezTerm, all Linux terminals, Windows Terminal. User input is passed as elements of an argv array; spaces, quotes, and shell metacharacters are fully protected by argv boundaries — **zero interpretation**.

**Shell-string paths (require shell escaping)**: iTerm2, Terminal.app (because AppleScript's `write text` is fundamentally shell-interpreted), PowerShell, cmd.exe. User input must be escaped via `shellQuote` / `psQuote` / `cmdQuote`.

The `cmdQuote` implementation (`terminalLauncher.ts:553-557`) is especially noteworthy: cmd.exe does **not** use `CommandLineToArgvW`-style backslash escaping — it uses the `"` character to toggle quoting state. An embedded `"` breaks out of the quoted region, exposing `&`, `|`, `<`, `>` to cmd.exe interpretation. So `cmdQuote`'s strategy is to **simply delete all `"` characters** (not escape them) — because there is no safe way to represent a literal double quote in cmd.exe.

### Section 5: Security Banner — The Last Line of Defense

When a deep link launches Claude Code, the user sees a warning banner (`banner.ts`, 123 lines):

```
This session was opened by an external deep link in ~/projects/myapp
The prompt below was supplied by the link — review carefully before pressing Enter.
```

Why is this needed? Because Linux's `xdg-open` and browsers' "always allow" settings can dispatch links silently — there is no OS-level confirmation. A malicious link could prefill an arbitrary prompt; if the user hits Enter without reading, dangerous actions could be executed.

The banner has several subtle security details:

- Overly long prompts (> 1,000 characters) trigger a special warning: "scroll to review the **entire** prompt" — because malicious instructions may hide after line 60, where the user can't see them
- If cwd was resolved via `?repo=`, the banner also shows the time of the last `git fetch` — if it's been more than 7 days, it appends a "CLAUDE.md may be stale" warning. Because `CLAUDE.md` may contain project-level instructions, a stale `CLAUDE.md` might be missing new security rules
- Path display uses `tildify()` — `/Users/USERNAME/projects` becomes `~/projects`, letting the user instantly recognize the working directory

### Section 6: Teleport — "Teleporting" Code to the Cloud

The Teleport system implements a "remote Claude Code session" — your code runs in a cloud sandbox, Claude works there, and results are synced back.

**Git Bundle Three-Tier Fallback** (`gitBundle.ts`, 292 lines) — this progressive degradation strategy is known in distributed systems courses as **graceful degradation**, a core pattern of resilient service design:

```
--all (all refs) → HEAD (current branch only) → squashed-root (history-less snapshot)
```

`_bundleWithFallback` (`gitBundle.ts:50-146`) implements this chain:

1. First try `git bundle create --all` — includes all branches and tags. If it exceeds the size limit (default 100MB, adjustable via GrowthBook), degrade
2. `git bundle create HEAD` — pack only the current branch history. If still too large, degrade further
3. **Squashed root** — use `git commit-tree` to create a parentless (orphan) commit containing only the current tree snapshot, zero history. This is the last resort

There's also a clever WIP (Work In Progress) handling: before bundling, the system runs `git stash create` (`gitBundle.ts:193-199`) to create an **implicit stash that doesn't touch the working directory** — it doesn't change `refs/stash`, doesn't change your index, it merely creates a dangling commit. Then `git update-ref refs/seed/stash` makes it reachable, so the bundle can include your uncommitted changes.

Security cleanup is thorough too: the `finally` block (`gitBundle.ts:279-291`) deletes temporary files and the `refs/seed/stash` and `refs/seed/root` refs. It even cleans up once **at the very beginning** of the function (`gitBundle.ts:164-167`) — handling stale refs left behind by a previous crash.

**Session API** (`api.ts`, 466 lines):

The `prepareApiRequest` function (`api.ts:181-198`) is the entry guard for all API calls — it checks OAuth token presence and organization UUID. The error message specifically notes "API key authentication is not sufficient" — because remote sessions require OAuth authentication with a Claude.ai account, not an API key.

Requests come with exponential backoff retry (`axiosGetWithRetry`, `api.ts:47-81`): 2s → 4s → 8s → 16s, for 4 retries (5 total attempts). The retry decision is precise (`isTransientNetworkError`, `api.ts:24-41`):
- No response (network disconnect, DNS failure, timeout) → retry
- 5xx (server error) → retry
- 4xx (auth failure, param error) → **do not retry**, because these are not transient errors

`sendEventToRemoteSession` (`api.ts:362-417`) sends user messages to a remote session, supporting rich content (`RemoteMessageContent` can be plain text or an array of content blocks). Timeout is 30 seconds — the comment notes that CCR worker cold starts take about 2.6 seconds, so 30 seconds is a generous window reserved for cold-start containers.

The session data model is also noteworthy (`api.ts:84-143`): `SessionContext` contains `sources` (Git repos or knowledge bases), `outcomes` (Git branch outputs), `custom_system_prompt` (custom system prompt), and `seed_bundle_file_id` (uploaded bundle file ID). This structure allows a session to reference both code repositories and knowledge bases simultaneously, and output to a specific Git branch upon completion — a complete "task input → execution → output" abstraction.

**Environment Management** (`environments.ts` + `environmentSelection.ts`, 198 lines):

Supports three environment types: `anthropic_cloud` (Anthropic-hosted), `byoc` (Bring Your Own Cloud), and `bridge` (bridge mode). The `getEnvironmentSelectionInfo` function (`environmentSelection.ts:24-77`) resolves the default environment ID from the five-layer priority of the settings system, and traverses the settings sources to find "which layer configured this environment" — useful for the UI to explain "why this environment was selected."

`createDefaultCloudEnvironment` (`environments.ts:76-120`) creates a default Anthropic cloud environment, preinstalled with Python 3.11 and Node 20.

### Section 7: City Analogy — The Teleportation System

If we compare Claude Code to a city, Deep Link and Teleport together form the **city's teleportation system**.

Deep Link is the **inbound portal**: from the outside world (browser, other apps) into the city. The portal has strict security — every package (URL parameter) goes through an X-ray machine (security validation). Packages over 5 kg (5000 characters) are refused entry; those carrying dangerous goods (control characters) are confiscated on the spot. After entry, the system arranges transportation (terminal detection) to take you to the right destination (working directory) without requiring you to make any decisions.

But arrivals see a prominent banner: "You entered through an external portal — please inspect the instructions you carry before acting." This prevents someone from slipping malicious instructions inside a teleported package.

Teleport is the **outbound portal**: sending the city's "things" (code) to a parallel world (cloud sandbox). Before teleporting, all luggage is packed (Git bundle). If the luggage is too heavy, it is progressively trimmed — first discard side branches (HEAD-only), then discard history (squashed-root), keeping only a snapshot of the current state. The portal also quietly slips in whatever you're currently editing but haven't saved yet (WIP stash) — without disturbing your work, but ensuring the Claude on the other side sees the latest state.

Both portals rely on the city's identity authentication system (OAuth) — without a valid ID (access token), neither portal lets you through.

---

## The Trade-Offs Behind This Design

**Why doesn't Deep Link launch Claude Code directly, but instead goes through a terminal?** Because Claude Code is a terminal application — it needs a TTY to render the UI and receive input. The `claude --handle-uri` process launched by the OS has no TTY, so it must first open a terminal, and then launch Claude Code inside that terminal. This "trampoline" design adds a layer, but guarantees the user always sees a normal terminal experience.

**Why does cmdQuote delete double quotes instead of escaping them?** Because cmd.exe has no safe double-quote escaping mechanism. `\"` doesn't work in cmd.exe (it's not a backslash-escape system), and `""` works in some contexts but not others. Deletion is the only deterministically safe choice — the cost is that double quotes in the query are lost, but that's far better than command injection.

**Why doesn't the Git bundle include untracked files?** `git stash create` naturally only handles modifications to tracked files. Including untracked files (`--include-untracked`) would increase stash size and might include `.env`, `node_modules`, and other content that shouldn't be teleported. This is a balance between security and practicality.

**Why persist terminal preference?** Because the Deep Link handler runs in a headless context (LaunchServices launch), where the `TERM_PROGRAM` environment variable is absent. `terminalPreference.ts` remembers the terminal you use during normal interactive sessions (writing to global config), so the headless handler knows which terminal to open.

---

## Code Landmarks

- `src/utils/deepLink/parseDeepLink.ts`, lines 84-153: URI parsing and security validation
- `src/utils/deepLink/registerProtocol.ts`, lines 75-138: macOS protocol registration (.app trampoline)
- `src/utils/deepLink/registerProtocol.ts`, lines 263-290: Self-healing check (`isProtocolHandlerCurrent`)
- `src/utils/deepLink/protocolHandler.ts`, lines 84-105: macOS URL scheme launch entry
- `src/utils/deepLink/terminalLauncher.ts`: 12-terminal emulator adaptation
- `src/utils/deepLink/banner.ts`: Security alert banner system
- `src/utils/claudeInChrome/` — Chrome browser extension integration
- `src/utils/teleport/gitBundle.ts`, lines 50-146: Git bundle three-tier fallback strategy
- `src/utils/teleport/api.ts`, lines 181-198: `prepareApiRequest()` OAuth entry guard
- `src/utils/teleport/environments.ts`: Three environment type management

---

## Limitations and Critique

- **Fragile terminal adaptation**: 12 terminals each have different launch mechanisms and escaping rules; new terminals (e.g., Warp, Rio) require manual adaptation and cannot be auto-discovered
- **cmdQuote drops double quotes**: The Windows cmd.exe security compromise silently deletes double quotes from user queries, potentially altering semantics
- **Git bundle excludes untracked files**: Newly created files that haven't been `git add`ed won't be teleported to the cloud; users may be confused about why the remote Claude can't see certain files

---

## If You Remember Only One Thing

The core problem Deep Link and Teleport solve is **passing intent across trust boundaries** — a URL from the browser must pass five layers of security checks before becoming a prefilled prompt in the terminal, and a local repository must go through three tiers of degraded packaging before it can safely appear in a cloud sandbox. Every layer of "teleportation" is not simple data hauling; it is **precision engineering that prioritizes security while minimizing user friction**.
