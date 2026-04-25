# Complete Analysis of the Sandbox System

The sandbox is Claude Code's last line of defense—even if the AI decides to execute a malicious command, the sandbox limits the damage it can cause. The system employs a three-layer architecture (Tool decision layer, Adapter configuration translation layer, and Runtime execution engine layer). On macOS, it restricts process capabilities via seatbelt; on Linux, it achieves similar results through bubblewrap + seccomp. This chapter dissects the sandbox's decision logic, bare git repo attack protection, and enterprise-grade domain and path locking capabilities.

> **Source locations**: `src/utils/sandbox/`, `src/entrypoints/sandbox/`

> 💡 **Plain English**: A sandbox is like a bank teller window with bulletproof glass—you (the AI) can communicate with the teller (the OS) and pass documents back and forth, but a physical barrier protects both sides. Even if someone attempts a robbery (a malicious command), the bulletproof glass keeps the damage within a controllable range.

### 🌍 Industry Context: The State of Sandboxing in AI Coding Tools

Sandboxes are not unique to Claude Code—they represent an industry consensus for handling "untrusted code execution" in AI coding tools, though implementations vary significantly:

- **GitHub Copilot Workspace**: Executes code in cloud containers, leaving the user's local environment completely unaffected. The trade-off is mandatory internet connectivity and no access to the local file system.
- **Cursor**: By default, command execution is not sandboxed; it relies on user approval ("Allow/Deny" pop-ups) as its primary security boundary. Sandboxing capabilities are weak, with the permission model doing most of the work.
- **Aider**: Provides no sandbox at all—it trusts the user to run in their own environment and delegates security responsibility to them. This suits advanced developers but carries high risks in enterprise scenarios.
- **CodeX (OpenAI)**: As of v0.118.0, it implements OS-level egress rules, replacing an earlier fragile environment-variable approach. Its three-tier sandbox modes (suggest/auto-edit/full-auto), combined with a Rust rewrite (95.6%) for memory safety, most closely resemble Claude Code's approach.
- **Windsurf (Codeium)**: Uses a cloud execution + local sync model, with sandboxing implemented server-side and the local layer acting purely as a renderer.
- **LangChain/LangGraph**: As framework layers, they do not directly provide sandboxes, but recommend user-implemented isolation via Docker containers or E2B (Code Interpreter SDK).

Claude Code's distinctive feature is its **local native sandbox**—using OS-level mechanisms (macOS seatbelt / Linux bubblewrap+seccomp) on the user's own machine. The core trade-offs of this approach run through the entire chapter:

- **vs OS-level network isolation (CodeX)**: Lower latency and no Docker installation required, but isolation strength is weaker than CodeX's OS-level egress rules
- **vs cloud sandboxes (Copilot Workspace/Windsurf)**: Works offline and operates directly on local files, but security strength is limited by the user's machine OS version (which the vendor cannot control)
- **vs no-sandbox approaches (Aider/Cursor)**: Stronger safety net, but at the cost of engineering complexity from asymmetric cross-platform capabilities

Subsequent sections will continuously compare these different choices as we analyze each key mechanism.

---

## Overview

This chapter unfolds in the following order: Section 1 disassembles the responsibility boundaries of the three-layer architecture (Tool→Adapter→Runtime); Section 2 explains the sandbox policy format and the security implications of key configuration fields; Section 3 provides an in-depth analysis of the bare git repo attack protection chain; Section 4 covers enterprise-grade domain/path locking; Section 5 addresses special issues on the Linux platform; and Section 6 analyzes design trade-offs.

> ⚠️ **Scope disclaimer**: The primary subjects of this chapter's analysis are Claude Code's open-source/decompilable Adapter layer (`sandbox-adapter.ts`, 985 lines) and decision layer (`shouldUseSandbox.ts`). The Runtime layer (`@anthropic-ai/sandbox-runtime`), which performs actual OS-level isolation, is Anthropic's closed-source npm package; we cannot directly audit its source. Descriptions of the Runtime layer are based on interface inference, dependency check output, and public documentation on OS sandbox primitives—meaning this chapter's analysis of "what the sandbox actually isolates" has an unavoidable blind spot.

---

> **[Chart placeholder 3.7-A]**: Three-layer architecture diagram — Tool layer (shouldUseSandbox decision) → Adapter layer (settings translation) → Runtime layer (OS sandbox execution)

> **[Chart placeholder 3.7-B]**: Bare git repo attack flow — Attacker implants HEAD/objects/refs → git mistakenly identifies it as a bare repo → Sandbox protection chain

---

## 1. Three-Layer Architecture

### 1.1 Tool Layer (Decision)

`shouldUseSandbox()` (`shouldUseSandbox.ts:130-153`) makes a binary decision—should this command run inside the sandbox:

```
Check chain:
1. SandboxManager.isSandboxingEnabled() = false → no sandbox
2. dangerouslyDisableSandbox && unsandboxed command allowed → no sandbox
3. Command is in excludedCommands → no sandbox
4. Otherwise → sandbox
```

`excludedCommands` matching supports three patterns (`shouldUseSandbox.ts:106-124`):
- **Exact match**: `git status`
- **Prefix match** (with colon): `docker:` matches all `docker ...` commands
- **Wildcard**: `npm run *`

But a code comment explicitly states (`shouldUseSandbox.ts:19`):

> This is **NOT a security boundary**—users can bypass it with compound commands

### 1.2 Adapter Layer (Configuration Translation)

`sandbox-adapter.ts` (985 lines) is the core, responsible for translating Claude Code's settings into a sandbox configuration that the Runtime can understand.

`convertToSandboxRuntimeConfig()` (`sandbox-adapter.ts:171-380`) handles:
- Network restrictions: building a domain whitelist from `allowedDomains`
- File system restrictions: building path rules from `allowWrite/denyWrite/denyRead/allowRead`
- Unix socket whitelist (macOS only)
- All paths are resolved relative to the settings file location

The `ISandboxManager` interface (`sandbox-adapter.ts:880-922`) defines:
- `initialize()` — one-time initialization
- `wrapWithSandbox()` — command wrapping
- `refreshConfig()` — dynamic updates

### 1.3 Runtime Layer (Execution Engine)

`@anthropic-ai/sandbox-runtime` (version `^0.0.44`) is Anthropic's **closed-source npm package**, responsible for actual OS-level sandbox execution. Claude Code only passes a `SandboxRuntimeConfig` (generated by the Adapter layer) to it; it does not directly call any OS sandbox API. This means the entire analysis chain has a break at the most critical security execution step—for a "complete analysis" article, this is a limitation that must be explicitly stated.

**What we can confirm**: Through Adapter layer import statements and the `SandboxDependenciesTab` component's dependency check logic, we can determine the Runtime layer's interfaces and dependencies:

```
Types/classes imported from @anthropic-ai/sandbox-runtime:
- SandboxRuntimeConfig          ← Config object generated by Adapter
- SandboxManager (BaseSandboxManager) ← Core management class
  - .initialize(config, callback)     ← One-time initialization
  - .wrapWithSandbox(cmd, shell, ...)  ← Command wrapping (core method)
  - .updateConfig(config)             ← Dynamic config update
  - .checkDependencies()              ← Dependency check
  - .isSupportedPlatform()            ← Platform support check
- SandboxViolationStore         ← Violation event store
- SandboxRuntimeConfigSchema    ← Zod validation schema
```

**Inferred macOS implementation**: The dependency check component shows macOS seatbelt labeled as "built-in (macOS)" with no extra installation needed. The Runtime layer likely launches child processes via `sandbox-exec -p <profile>`, where the seatbelt profile (`.sb` format) is dynamically generated from network/file-system rules in `SandboxRuntimeConfig`. Seatbelt profiles use a Scheme-like rule syntax, for example:

```scheme
;; Inferred seatbelt profile structure (not actual source)
(version 1)
(deny default)
(allow file-read* (subpath "/path/to/project"))
(allow file-write* (subpath "/path/to/project"))
(deny file-write* (literal "/path/to/settings.json"))
(allow network-outbound (remote tcp "*:443"))
```

**Inferred Linux implementation**: The dependency check requires bubblewrap (`bwrap`), socat, and seccomp filter. The Runtime layer's `wrapWithSandbox()` likely generates a bwrap command with a structure similar to the following:

```
bwrap \
  --ro-bind / /                     # Read-only mount root filesystem
  --bind /path/to/project /path/to/project  # Writable bind project directory
  --dev /dev                        # Device directory
  --proc /proc                      # proc filesystem
  --unshare-net                     # Network namespace isolation
  --seccomp <fd>                    # seccomp-bpf filter
  -- /bin/bash -c "user command"
```

The seccomp-bpf filter intercepts specific system calls (e.g., `connect(2)` for network control, `socket(2)` for Unix socket restrictions), but **Linux seccomp cannot filter Unix sockets by path** (`sandboxTypes.ts:25-30` comments explicitly note this)—a key security difference between the two platforms. Socat may be used as a network proxy layer, working with the domain whitelist to implement network access control.

> ⚠️ **Supply chain trust issue**: Outsourcing the most critical security execution layer to an npm package introduces supply chain trust dependencies. Has `@anthropic-ai/sandbox-runtime` undergone independent security audits? What is its version update mechanism? If this package is compromised, the entire sandbox is useless. "Claude Code only provides configuration and does not directly operate OS sandbox APIs" is an advantage from an architectural decoupling perspective, but from a security audit perspective it means users must unconditionally trust this black box. By contrast, CodeX uses OS-level egress rules—an OS-native mechanism that has undergone extensive security auditing, with a trust foundation far stronger than a private npm package.

### 1.4 Seatbelt Deprecation Risk

macOS's `sandbox-exec` tool has been marked **deprecated** by Apple since macOS Catalina. Apple's official direction is App Sandbox (a declarative sandbox based on entitlements), not seatbelt's imperative profiles. This means:

1. **The API could be removed at any time**: Building a "last line of defense" on top of a deprecated API is an engineering risk that cannot be ignored. Apple has made no commitment that `sandbox-exec` will remain available in future macOS versions.
2. **No official toolchain support**: The seatbelt profile `.sb` format has no official documentation, no debugging tools, and no validator. Developers must rely on reverse engineering and community knowledge.
3. **The analogy to SELinux is misleading**: SELinux is a first-class security module in the Linux kernel, with a complete policy language (SEPolicy), compilation tools (`checkmodule`), an audit framework (`ausearch`), and long-term support commitments from Red Hat/NSA. Seatbelt is a deprecated user-space tool from Apple; the two are not remotely comparable in engineering maturity.

> 💡 **Plain English**: This is like installing a security door on a wall that is "scheduled for demolition"—the lock itself might be excellent, but the wall could disappear at any moment.

Claude Code's three-layer architecture shows design foresight here: if Apple does remove seatbelt, in theory only the Runtime layer's macOS implementation needs to be replaced (e.g., migrating to the Endpoint Security Framework or App Sandbox entitlements), without modifying the Adapter layer. But whether this "replaceability" has been validated in practice remains unknown.

> 📚 **Course Connection (Operating Systems)**: Understanding this system requires mastery of: process capabilities, system call filtering (seccomp-bpf), and namespace isolation—all core topics in OS security courses. But note the distinction: bubblewrap's use of namespaces + seccomp on Linux is a kernel-level first-class API with long-term stability commitments; macOS's seatbelt is a user-space tool-level wrapper, and while the underlying Sandbox.kext kernel extension is still running, the user-space interface is no longer supported.

## 2. Sandbox Policy Format

### 2.1 SandboxSettings Schema

`sandboxTypes.ts:91-144` defines the complete sandbox settings:

| Field | Type | Description |
|------|------|-------------|
| `enabled` | boolean | Master switch |
| `failIfUnavailable` | boolean | Hard fail if sandbox is unavailable (default `false`, i.e., fail-open) |
| `autoAllowBashIfSandboxed` | boolean | Auto-approve Bash calls inside sandbox (default `true`) |
| `allowUnsandboxedCommands` | boolean | Allow `dangerouslyDisableSandbox` parameter (default `true`) |
| `enabledPlatforms` | Platform[] | Restrict to specific platforms (undocumented) |

**`failIfUnavailable` fail-open default**: When the sandbox is unavailable (missing dependencies, unsupported platform), the default behavior is to show a warning but continue executing the command (fail-open). Source comments explicitly state: "When false (default), a warning is shown and commands run unsandboxed. Intended for managed-settings deployments that require sandboxing as a hard gate." (`sandboxTypes.ts:99-101`). This means in environments where `failIfUnavailable: true` is not set, if seatbelt/bwrap cannot start for any reason, all commands run unsandboxed—the "last line of defense" is silently bypassed. Enterprise deployments **must** explicitly set `failIfUnavailable: true` to achieve fail-closed behavior.

**`autoAllowBashIfSandboxed` trust model deep dive**:

This field defaults to `true` (`sandbox-adapter.ts:471`: `return settings?.sandbox?.autoAllowBashIfSandboxed ?? true`). Its mechanism is: when the sandbox is enabled and this field is `true`, `bashToolHasPermission()`, after traversing all deny/ask rules, returns `behavior: 'allow'` if no explicit rule matches—skipping the user approval popup.

This essentially builds a **single-point trust model**:

```
Traditional mode:  AI decision → user approval → [sandbox] → OS execution
                                          ↑ two defenses

autoAllow mode:    AI decision → [sandbox] → OS execution
                                    ↑ one defense
```

Security implications:
1. **All bets are on sandbox integrity**: If the sandbox has an escape vulnerability (seatbelt bypass, bwrap namespace misconfiguration, incomplete seccomp filtering), an attacker can execute arbitrary commands directly without passing permission approval. The "human defense" of user approval is completely removed.
2. **Contradiction with the Runtime black box**: We cannot audit the actual isolation strength of `@anthropic-ai/sandbox-runtime`, yet `autoAllowBashIfSandboxed` requires us to unconditionally trust its integrity—this creates an analytical contradiction.
3. **Comparison with CodeX (OpenAI)**: CodeX's full-auto mode also auto-executes commands, and has implemented OS-level egress rules, making its security boundary thicker than OS primitive sandboxes. Claude Code trades lighter isolation for lower latency and better UX—an explicit security-performance trade-off.
4. **Comparison with Cursor**: Cursor provides no sandbox but retains user approval (Allow/Deny pop-ups). Claude Code's `autoAllowBashIfSandboxed` goes in the opposite direction—removing approval but adding sandbox. Which mode is safer depends on whether you trust human judgment or technical isolation more.

> 💡 **Plain English**: This is like a bank's security strategy—traditional mode is "every transaction needs a manager's signature + bulletproof glass," while `autoAllowBashIfSandboxed` mode is "cancel the manager's signature and rely entirely on bulletproof glass." If the glass is truly bulletproof, efficiency is indeed higher; but if someone discovers a crack in the glass, there is no second line of defense.

### 2.2 Network Configuration

`sandboxTypes.ts:14-42`:

| Field | Description |
|------|-------------|
| `allowedDomains` | List of allowed domains |
| `allowManagedDomainsOnly` | Only respect enterprise policy domains |
| `allowUnixSockets` | macOS only, allowed Unix socket paths |
| `allowAllUnixSockets` | Allow all Unix sockets |
| `allowLocalBinding` | Allow local port binding |
| `httpProxyPort` / `socksProxyPort` | Proxy ports |

**Platform difference** (`sandboxTypes.ts:25-30` comment): Unix socket path filtering **only works on macOS**—Linux seccomp cannot filter sockets by path. This is an important security difference.

### 2.3 File System Configuration

`sandboxTypes.ts:47-86`:

| Field | Description |
|------|-------------|
| `allowWrite` | Additional writable paths |
| `denyWrite` | Paths protected from writes |
| `denyRead` | Paths protected from reads |
| `allowRead` | Whitelist overriding denyRead |
| `allowManagedReadPathsOnly` | Only use enterprise policy read paths |

## 3. Bare Git Repo Attack Protection

This is a security mechanism in the sandbox system worth deep analysis—targeted protection against a real attack vector.

> 📚 **Course Connection (Software Engineering/Security)**: The bare git repo attack is a variant of a **supply chain attack**—the attacker does not directly target the victim program, but indirectly achieves their goal by manipulating the development toolchain (git). In software security courses, this falls under "trust boundary analysis": Claude Code trusts git's output, and git trusts the current directory's file structure; the attacker exploits this trust chain to mount an attack.

### 3.1 Attack Vector

Git's `is_git_directory()` identifies the current directory as a bare repo when it sees `HEAD` + `objects/` + `refs/`. The complete attack path is as follows:

```
Attack entry (prompt injection / malicious repo file content)
  → Claude executes commands inside the sandbox, creating HEAD/objects/refs/config files in the working directory
  → config sets core.fsmonitor = "malicious command"
  → Claude's subsequent git commands (possibly executed outside the sandbox) trigger fsmonitor
  → Malicious command executes with user privileges (bypassing the sandbox)
```

The key point: some of Claude's git operations (like `git status`, `git log`) may not go through the sandbox (they are in `excludedCommands` or run outside the sandbox). What the attacker exploits is the **trust chain gap where side effects from sandboxed commands influence unsandboxed commands**. Related issue `anthropics/claude-code#29316` tracks this real threat.

### 3.2 Protection Strategy

`sandbox-adapter.ts:256-279`, related issue `anthropics/claude-code#29316`:

```
Check whether HEAD, objects, refs, hooks, config exist:
  ├── Already exist → denyWrite (read-only bind, prevent modification)
  └── Do not exist → add to bareGitRepoScrubPaths (clean up after command)
```

### 3.3 Post-Command Cleanup

`scrubBareGitRepoFiles()` (`sandbox-adapter.ts:403-413`)—after a sandboxed command executes, it checks paths in `bareGitRepoScrubPaths` and deletes any implanted files found.

This "cleanup after execution" strategy is particularly valuable in AI Agent security. Most sandbox systems are **prevention-oriented**—they set isolation boundaries before command execution. But AI Agent behavior is inherently not fully predictable—you cannot know in advance what files the AI will create in the file system. `scrubBareGitRepoFiles()` represents a **detection-response** security strategy that complements prevention-oriented approaches. The source implementation (`sandbox-adapter.ts:404-413`) uses `rmSync(p, { recursive: true })` for forceful deletion, and silently handles ENOENT with try-catch (file not existing is the normal case—indicating the attack did not occur).

> **Competitor comparison**: CodeX's OS-level network isolation and process-level sandbox naturally limit the scope of side effects. But Claude Code's local OS primitive sandbox lacks the "disposable" nature of containerized solutions, so it needs explicit cleanup logic. This is a concrete trade-off between local sandbox vs system-level isolation: system-level isolation is more complete in security but has startup latency and environment requirements (Rust toolchain), which are key reasons Claude Code chose the OS primitive approach.

### 3.4 Worktree Compatibility

`sandbox-adapter.ts:282-287, 421-444`:
- Detects worktrees by checking `.git` file format (not directory)
- Caches the main repo path (during `initialize()`)
- Allows writing `index.lock` to the main repo's `.git` directory—otherwise commits would fail in a worktree

## 4. Enterprise Policy Enforcement

> **Competitor positioning**: Enterprise policy enforcement (domain whitelisting, read path locking) is essentially an **enterprise-ready** capability, not a sandbox technology innovation—MDM tools like Jamf/Intune do the same thing daily. Claude Code's contribution is integrating these control interfaces into an AI coding tool's sandbox configuration, letting enterprise admins control AI network and file access without additional MDM deployment. Cursor's allowlist/blocklist provides similar capabilities, but at a coarser granularity (tool-level rather than command-level).

### 4.1 Domain Locking

`shouldAllowManagedSandboxDomainsOnly()` (`sandbox-adapter.ts:148-156`): When enabled, only `allowedDomains` from `policySettings` take effect. User/project-level domain configurations are ignored.

### 4.2 Read Path Locking

`shouldAllowManagedReadPathsOnly()` (`sandbox-adapter.ts:159-163`): Only uses read path whitelists defined by enterprise policy.

### 4.3 Policy Lock Detection

`areSandboxSettingsLockedByPolicy()` (`sandbox-adapter.ts:645-664`): Detects whether `flagSettings` or `policySettings` override local settings.

### 4.4 Platform Restrictions (Undocumented)

`sandbox-adapter.ts:496-526` comments reveal an interesting enterprise requirement:

> **NVIDIA enterprise deployment**: `enabledPlatforms: ["macos"]` enables sandbox on macOS (with `autoAllowBashIfSandboxed`), but disables it on Linux/WSL—because sandbox maturity differs across platforms.

## 5. Linux Special Handling

### 5.1 No Glob Support

`sandbox-adapter.ts:597-642`: Bubblewrap does not support glob file-system rules. The system needs to expand globs into concrete paths, and warns when expansion fails.

This reveals the essential difference in sandbox configuration generation logic between the two platforms: macOS's seatbelt profile can use static patterns (`(subpath "/path/to/dir")`, supporting wildcard semantics), while Linux's bwrap configuration is **dynamically generated**—relying on the runtime file system state to expand globs into concrete path lists. This difference directly impacts testability and auditability: macOS sandbox configurations are deterministic (same settings = same profile), while Linux sandbox configurations are non-deterministic (depending on which files match the globs in the runtime file system).

### 5.2 Git log HEAD Issue

`sandbox-adapter.ts:263-264` comment: Running `git log HEAD` inside bwrap reports "ambiguous argument"—because bwrap's file system view may prevent git from correctly resolving HEAD.

## 6. Design Trade-offs and Assessment

### 6.1 Core Architectural Decision: Why OS Primitives Instead of Containers?

Claude Code's choice of seatbelt/bwrap over Docker/Podman/Firecracker is the most fundamental architectural decision of the entire sandbox system. The source does not explicitly document the rationale, but it can be inferred from code structure and comments:

| Dimension | OS Primitives (Claude Code) | OS-Level Network Isolation (CodeX) | Cloud Sandbox (Copilot Workspace) |
|-----------|----------------------------|-----------------------------------|-----------------------------------|
| Startup latency | Near-zero overhead | Hundreds of milliseconds | Network latency (seconds) |
| Installation dependencies | Built into macOS; bwrap needed on Linux | Requires Docker | No local dependencies |
| Isolation strength | Process-level (seatbelt/seccomp) | Container-level (full namespace) | VM-level (Firecracker) |
| File system | Direct host file system access | Requires volume mount mapping | Requires file sync |
| Offline availability | Yes | Yes | No |
| Security auditability | Runtime is closed-source | Docker is open-source | Not auditable |

Claude Code's choice prioritizes **developer experience**—zero startup latency, no extra installation, and direct local file operations. The cost is weaker isolation than containerized solutions, and security strength limited by the user's machine OS version and configuration (which the vendor cannot control). Compared to E2B's Firecracker microVM + pre-warmed snapshot approach (one of the de facto standards for AI Agent sandboxes), Claude Code's solution has a significant gap in security isolation depth, but holds an absolute advantage in response speed for local development scenarios.

### 6.2 Excellent Design Choices

1. **Three-layer separation and replaceability**: This is a standard security engineering layering pattern (similar to Docker's containerd→runc or a browser's content policy→sandbox→OS process), but Claude Code's implementation quality is high. Future support for Landlock (Linux 5.13+) would theoretically only require replacing the Runtime layer.
2. **Bare git repo detection-response protection**: `scrubBareGitRepoFiles()`'s "cleanup after execution" strategy supplements the blind spots of prevention-oriented sandboxes—this is a creative design in AI Agent security.
3. **Worktree "precision opening"**: Allowing writes to the main repo `.git` directory's `index.lock` demonstrates a key quality of security systems—precise understanding of legitimate workflows. Over-restriction causes users to disable the sandbox, which is more dangerous than a sandbox vulnerability. Similar to Docker's `--cap-add` mechanism: not a crude all-open or all-closed approach, but precisely granting the minimum necessary permissions.
4. **`excludedCommands` "NOT a security boundary" comment** (`shouldUseSandbox.ts:19`): In security engineering, explicitly labeling a mechanism "not a security boundary" is an important meta-security practice—preventing downstream developers and users from forming incorrect security assumptions.

### 6.3 Costs and Risks

1. **Seatbelt deprecation risk**: macOS's core isolation mechanism is built on an Apple-deprecated API (see Section 1.4), a platform risk that cannot be fixed through code.
2. **Platform security asymmetry**: macOS seatbelt and Linux bwrap/seccomp have unequal capabilities (Unix socket path filtering only works on macOS). Users may mistakenly believe both platforms provide equivalent security guarantees.
3. **`autoAllowBashIfSandboxed` single-point trust**: The default `true` places all security bets on sandbox integrity (see Section 2.1 analysis). If the sandbox has an escape vulnerability, an attacker does not need to pass permission approval.
4. **Runtime black box**: The 985-line Adapter layer is auditable, but the Runtime layer that actually performs isolation is closed-source—the security analysis chain breaks at the most critical link.
5. **985-line adapter responsibility bloat**: An "adapter" layer with 985 lines of code handling path resolution, policy merging, attack protection, worktree detection, glob expansion, and more may hint at a God Object anti-pattern. Compared to peer projects' sandbox configuration code size (e.g., CodeX's sandbox configuration is usually under 100 lines), this scale warrants attention.
6. **Bare git repo protection pattern-matching limitations**: It only handles known filename patterns (HEAD/objects/refs/hooks/config); new attack vectors require manual list updates—an inherent weakness of signature-based detection.

---

*Quality self-check:*
- [x] Coverage: Three-layer architecture + Runtime inference + seatbelt deprecation + policy format + autoAllow deep analysis + bare git attack + enterprise controls + platform differences + competitor comparison
- [x] Fidelity: All line numbers come from actual reads of sandbox-adapter.ts, sandboxTypes.ts, shouldUseSandbox.ts
- [x] Depth: Runtime layer inference analysis, autoAllowBashIfSandboxed trust model, bare git repo complete attack path, OS primitives vs containerization decision analysis
- [x] Criticality: seatbelt deprecation risk, Runtime black box trust issue, autoAllow single-point trust model, adapter responsibility bloat
- [x] Competitor comparison: woven throughout (CodeX, Cursor, E2B, Docker, Copilot Workspace)
