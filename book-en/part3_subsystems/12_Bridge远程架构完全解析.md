# Bridge Remote Architecture Fully Explained

This chapter analyzes Claude Code's remote control subsystem, Bridge, and how it lets users control a locally running Claude Code instance through the claude.ai Web interface, enabling cross-network AI coding collaboration.

## Chapter Guide

Bridge is the core subsystem that implements "remote control" in Claude Code 2.1.88. It lets users operate a Claude Code instance running on a local machine from the claude.ai Web interface, enabling cross-network AI coding collaboration.

**Technical analogy (OS perspective)**: Bridge is like **SSH remote command execution** in an operating system. The local machine runs a daemon that waits for instructions, while the remote side sends commands and receives results through structured messages (rather than graphical UI frames). Bridge transports JSON-formatted commands and responses, so it belongs to the "remote command" model (similar to SSH / RPC), not the "remote rendering" model used by RDP/VNC. Bridge's Environment API is analogous to SSH session management, JWT is analogous to a Kerberos ticket, and the Work Poll loop is analogous to a message pump.

> 💡 **Plain English**: Bridge is like **directing a construction crew far away over a walkie-talkie**. You (the claude.ai user) speak instructions into the radio ("change line 42 to xxx"), the construction crew (local Claude Code) performs the action, and then reports the result back over the radio ("done, tests passed"). The key difference is that this walkie-talkie is not a direct connection. There is a **dispatch center** (Anthropic's relay server) in the middle forwarding all messages. Neither you nor the construction crew needs to know the other's address; both only need to stay connected to the dispatch center.

### 🌍 Industry Context: Remote Execution Architectures for AI Coding Tools

"Controlling a local/remote development environment from a Web interface" is a common architectural challenge for both AI coding tools and cloud IDEs, and the solutions across products differ significantly:

- **GitHub Codespaces / Copilot Workspace**: User code runs in GitHub-hosted cloud containers, and the Web IDE (VS Code for Web) connects directly to the container. There is no "local ↔ remote" bridging problem because everything is in the cloud. The cost is that users must trust GitHub to host their code.
- **Cursor (Remote SSH)**: Inherits VS Code's Remote SSH architecture. It runs `cursor-server` on the remote machine and uses an SSH tunnel to transport LSP traffic and file operations. This is a mature approach, but it requires SSH access.
- **Gitpod / DevPod**: Focuses on containerized development environments and remote connectivity, using a WebSocket proxy to provide real-time browser-to-container communication. This is the closest mainstream approach to Claude Code Bridge's WebSocket tunneling design.
- **JetBrains Gateway**: Uses a client-server split architecture. A lightweight client runs locally, while the full IDE backend runs remotely and communicates through a proprietary protocol (not SSH).
- **VS Code Server (code-server)**: Runs the full VS Code instance on the server, with the browser acting purely as a rendering layer and receiving UI updates over WebSocket.
- **ngrok / Cloudflare Tunnel**: General-purpose tunnel products that expose local services to the public internet. Conceptually, Bridge's Environment registration + server relay model resembles these tunnel tools: both use an intermediate server to forward traffic.
- **Replit Agent**: Both the AI and the code run in Replit's cloud containers, and the user observes and intervenes through a Web interface. This stands in sharp contrast to Bridge's "AI orchestrated in the cloud, code executed locally" model. Replit does not need a Bridge, but users must host their code on Replit and give up the safety and flexibility of local execution.
- **Open-source AI agents such as Cline / Aider**: Cline (formerly Claude Dev) runs as a VS Code extension and naturally inherits VS Code's Remote SSH capabilities, so it does not need a custom Bridge protocol. Aider runs entirely locally and has no remote-control capability. These "no Bridge" choices are exactly the inverse reference point for Claude Code's Bridge design: Claude Code had to build its own remote architecture precisely because it chose an editor-independent CLI form.

Claude Code's Bridge adopts a **server relay** model. This is the single most important design decision in the entire Bridge architecture, and it is worth unpacking the trade-offs in detail:

**Why not choose P2P direct connection or an SSH tunnel?**

| Dimension | Server Relay (Bridge approach) | P2P Direct Connection | SSH Tunnel (Cursor approach) |
|------|-------------------------|----------|----------------------|
| **Deployment barrier** | **Zero configuration**: the user does not need to open ports, configure a firewall, or manage keys | Requires NAT traversal (STUN/TURN), which often fails behind enterprise firewalls | Requires an SSH server, key pair, and open port |
| **Latency** | All data is forwarded through Anthropic servers, adding one RTT hop | Direct connection has the lowest latency | SSH direct connection has low latency, but requires a reachable public IP |
| **Availability** | Anthropic server outage = **all Bridge connections drop** (single point of failure) | No central dependency | Depends on SSH server availability |
| **Privacy** | All commands and code pass through Anthropic servers, which may be a showstopper for privacy-sensitive users | Data does not pass through a third party | Data does not pass through a third party |
| **Cost** | Relay bandwidth and compute cost are borne by Anthropic; scaling creates real cost pressure | No middle-layer cost | Users bear the cost of their own SSH server |
| **Offline / air-gapped environments** | **Unavailable**: must connect to Anthropic servers | Works on a LAN | Works on a LAN |

The core motivation for choosing server relay is **zero configuration**. Anthropic's target users include developers who are not comfortable with network setup, and the experience of "log in and remote control immediately" is far friendlier than "first configure SSH keys and port forwarding." This is a classic trade-off of **exchanging operational complexity for user experience**, standing in sharp contrast to Cursor's SSH tunnel approach (low latency, no central dependency, but requires SSH setup).

This decision also introduces an important security implication: Anthropic's relay server becomes the **single trust anchor** for all remote sessions. If the relay server were compromised, an attacker could theoretically observe the code operations of every Bridge session. Combined with the possibility that Work Secret may contain `environment_variables` (such as API keys and other sensitive values), this creates a nontrivial attack surface. For enterprise deployments, self-hosted relay servers or end-to-end encryption may be needed to mitigate it.

CCR v2's migration from polling to SSE push is the correct direction for the architecture's evolution. It reduces both latency and wasted resources, matching the broader industry shift in Web real-time communication from long polling toward SSE/WebSocket. Longer term, if MCP's SSE transport becomes the general standard for remote agent connectivity, the Bridge subsystem may eventually need to be refactored toward MCP over SSE.

## Architecture Overview

The Bridge subsystem lives under the `src/bridge/` directory, with 31 files and more than 450KB of code. Within the overall Claude Code codebase, this qualifies as a medium-to-large subsystem, roughly on par with the MCP subsystem in size, reflecting the inherent complexity of authentication, transport, concurrency, error recovery, and related concerns in remote-control scenarios. The core architecture is divided into three layers:

```
┌─────────────────────────────────────────────┐
│         claude.ai Web UI (remote)           │
│   User enters commands in the browser        │
└────────────────────┬────────────────────────┘
                     │ HTTPS / WebSocket
                     ▼
┌─────────────────────────────────────────────┐
│       Anthropic server (relay layer)        │
│   Session Ingress / Environments API        │
│   JWT issuance / Work dispatch / Heartbeats │
└────────────────────┬────────────────────────┘
                     │ HTTPS Poll / SSE
                     ▼
┌─────────────────────────────────────────────┐
│       Local Claude Code (Bridge side)       │
│   bridgeMain.ts - polling main loop          │
│   replBridge.ts - REPL session bridge        │
│   remoteBridgeCore.ts - direct connect       │
└─────────────────────────────────────────────┘
```

## Core File Index

| File | Lines | Responsibility |
|------|------|------|
| `bridgeMain.ts` | ~3000 | Main loop of the standalone bridge daemon (`claude remote-control`) |
| `replBridge.ts` | ~2500 | Bridge embedded inside the REPL (`/remote-control` command) |
| `remoteBridgeCore.ts` | ~1000 | Direct-connection core without the Environment layer (CCR v2) |
| `bridgeApi.ts` | ~540 | REST API client (registration / polling / ACK / stop / heartbeat) |
| `jwtUtils.ts` | ~257 | JWT decoding and token refresh scheduler |
| `trustedDevice.ts` | ~211 | Trusted-device enrollment and token management |
| `capacityWake.ts` | ~57 | Capacity wake-up signaling primitive |
| `types.ts` | ~263 | All Bridge type definitions |
| `workSecret.ts` | ~128 | Work Secret decoding and SDK URL construction |
| `bridgeMessaging.ts` | ~400 | Message filtering and control request handling |

## 1. Bridge Handshake Flow

### 1.1 Environment Registration

The first step when Bridge starts is registering an "environment" with the server. This is equivalent to announcing that an endpoint is online in a remote-control system.

The source is in `bridgeApi.ts`, lines 142-197:

```typescript
async registerBridgeEnvironment(
  config: BridgeConfig,
): Promise<{ environment_id: string; environment_secret: string }> {
  const response = await withOAuthRetry(
    (token: string) =>
      axios.post<{
        environment_id: string
        environment_secret: string
      }>(
        `${deps.baseUrl}/v1/environments/bridge`,
        {
          machine_name: config.machineName,
          directory: config.dir,
          branch: config.branch,
          git_repo_url: config.gitRepoUrl,
          max_sessions: config.maxSessions,
          metadata: { worker_type: config.workerType },
        },
        {
          headers: getHeaders(token),
          timeout: 15_000,
          validateStatus: status => status < 500,
        },
      ),
    'Registration',
  )
  // ...
  return response.data
}
```

The registration payload includes the machine name, working directory, Git branch, repository URL, maximum number of sessions, and Worker type. The server returns `environment_id` and `environment_secret`, and all subsequent API calls depend on those two credentials.

### 1.2 Architectural Evolution: A Paradigm Shift from Stateful to Stateless

Claude Code's Bridge went through a fundamental architectural evolution, from the "stateful long-lived connection" model of v1 to the "stateless on-demand connection" model of v2. This is not just a simplification of API paths; it is a paradigm shift in the entire **state-management model**, comparable to the shift in Web architecture from session-based authentication to stateless JWT-based authentication.

> 💡 **Plain English**: v1 is like going to a government office to handle paperwork. First you **register at the window** (register the Environment), then **wait for your number to be called** (poll for Work), then **sign to confirm receipt** (ACK), and after you're done you **cancel the record** (deregister the Environment). The whole process depends on your status being recorded in the office ledger. v2 is like placing an order in a phone app. Every time you submit a request directly, the app automatically verifies your identity (OAuth → JWT). You do not need to "register your presence" first, and the server does not maintain an "I am here" state for you.

#### v1: A Stateful Channel Built Around Environment

The full lifecycle of the traditional channel (`replBridge.ts` + `bridgeMain.ts`) is:
1. POST `/v1/environments/bridge` -> register the environment and get `environment_id`
2. GET `/v1/environments/{id}/work/poll` -> poll and wait for tasks
3. POST `/v1/environments/{id}/work/{workId}/ack` -> confirm receipt
4. WebSocket connection -> real-time message transport
5. POST `/v1/environments/{id}/work/{workId}/heartbeat` -> heartbeat renewal
6. POST `/v1/environments/{id}/stop` -> deregister the environment

In this model, the server maintains **long-lived Environment state** (registered -> active -> stopped). `environment_id` acts as a stateful anchor: the server must continuously track whether each Environment is alive, how many sessions it currently has, and when the last heartbeat arrived. This creates obvious problems: the complexity of state synchronization (what happens when the client crashes and the Environment becomes a "zombie"?), latency and resource waste caused by polling, and five extra HTTP round trips for the registration/deregistration lifecycle.

#### v2: Env-less Stateless Direct Connection - The Future of Bridge

CCR v2 (`remoteBridgeCore.ts`) is the evolutionary direction of the Bridge architecture and the most important technical innovation in this chapter. As stated in the comments at `remoteBridgeCore.ts`, lines 1-29:

```
// "Env-less" = no Environments API layer.
// 1. POST /v1/code/sessions              (OAuth, no env_id)  → session.id
// 2. POST /v1/code/sessions/{id}/bridge  (OAuth)             → {worker_jwt, expires_in}
//    Each /bridge call bumps epoch — it IS the register.
// 3. createV2ReplTransport(worker_jwt, worker_epoch)         → SSE + CCRClient
// 4. createTokenRefreshScheduler                             → proactive /bridge re-call
// 5. 401 on SSE → rebuild transport with fresh /bridge credentials
```

Notice the key design: **`Each /bridge call bumps epoch — it IS the register`**. In v1, "registration" and "work" were two separate steps. In v2, each `/bridge` call is itself the registration. There is no separate registration/deregistration lifecycle. State becomes **short-lived and created on demand**. The `epoch` here acts like a monotonically increasing version number: each call refreshes it, and the server only needs to remember the latest epoch. Older connections expire automatically.

v2 also upgrades the transport protocol from HTTP polling to **SSE (Server-Sent Events) push**, completely eliminating polling latency.

This simpler connection path is gradually rolled out behind the `tengu_bridge_repl_v2` GrowthBook feature gate, with v1 and v2 running in parallel. Feature-flag-driven canary rollout is standard industry practice, but maintaining two parallel channels at the protocol layer does require extra engineering effort.

#### The Architectural Meaning of the v1 -> v2 Migration

| Dimension | v1 (Environment-based) | v2 (Env-less) |
|------|------------------------|----------------|
| State model | Server maintains long-lived state | Created on demand, no persistent state |
| Registration method | Separate register / deregister APIs | Every call is registration (`bump epoch`) |
| Transport protocol | HTTP polling | SSE push |
| Failure recovery | Must handle zombie Environments | Naturally expires, no cleanup required |
| API round trips | 5+ times (register -> poll -> ACK -> heartbeat -> stop) | 2 times (create Session -> Bridge call) |
| Analogy | Stateful TCP connection | Stateless HTTP + JWT |

This is highly similar to the evolution in microservice architecture from session-based systems to stateless token-based systems. v1's `environment_id` is like a server-side Session ID that requires centralized state storage; v2's Worker JWT carries all necessary context inside the token itself, so the server does not need to maintain session state. For readers who design distributed systems, this is a decision worth studying carefully.

## 2. Session Tunneling

### 2.1 Work Secret Decoding

When the server assigns a task via polling, the returned `WorkResponse` contains a `secret` field. This is base64url-encoded JSON containing everything needed to connect to the session.

Using base64url (rather than standard base64) is an intentional design choice. base64url avoids the `+` `/` `=` characters and can be safely embedded in URL parameters and HTTP headers without extra escaping. Packaging all connection data into a single opaque token instead of multiple parameters simplifies both API design and transport. This "single token carrying all context" pattern has strong precedents in the industry: Stripe's PaymentIntent `client_secret` and GitHub's Installation Token use the same basic idea.

`workSecret.ts`, lines 6-32:

```typescript
export function decodeWorkSecret(secret: string): WorkSecret {
  const json = Buffer.from(secret, 'base64url').toString('utf-8')
  const parsed: unknown = jsonParse(json)
  if (!parsed || typeof parsed !== 'object' || 
      !('version' in parsed) || parsed.version !== 1) {
    throw new Error(`Unsupported work secret version`)
  }
  // Validate required fields
  if (typeof obj.session_ingress_token !== 'string' ||
      obj.session_ingress_token.length === 0) {
    throw new Error('Invalid work secret: missing session_ingress_token')
  }
  return parsed as WorkSecret
}
```

The `WorkSecret` type definition (`types.ts`, lines 29-51) reveals its full structure:

```typescript
export type WorkSecret = {
  version: number
  session_ingress_token: string     // JWT used for WebSocket auth
  api_base_url: string              // API base URL
  sources: Array<{                  // Git source info
    type: string
    git_info?: { type: string; repo: string; ref?: string; token?: string }
  }>
  auth: Array<{ type: string; token: string }>  // Auth tokens
  claude_code_args?: Record<string, string>      // CLI args
  mcp_config?: unknown                           // MCP config
  environment_variables?: Record<string, string>  // Environment variables
  use_code_sessions?: boolean                     // CCR v2 flag
}
```

### 2.2 SDK URL Construction and Transport Protocol

After decoding the Work Secret, the next step is building the connection URL. There are two URL construction paths depending on the protocol version:

```typescript
// V1: WebSocket URL (legacy path)
export function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const protocol = isLocalhost ? 'ws' : 'wss'
  const version = isLocalhost ? 'v2' : 'v1'  // Local direct uses v2; production goes through Envoy proxy on v1
  const host = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}

// V2: HTTP URL (CCR v2 path, SSE-based)
export function buildCCRv2SdkUrl(apiBaseUrl: string, sessionId: string): string {
  return `${base}/v1/code/sessions/${sessionId}`
}
```

### 2.3 Multi-session Concurrency Management

`bridgeMain.ts`, lines 83-98, shows the feature gate for multi-session support:

```typescript
const SPAWN_SESSIONS_DEFAULT = 32

async function isMultiSessionSpawnEnabled(): Promise<boolean> {
  return checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge_multi_session')
}
```

Inside `runBridgeLoop`, Bridge maintains a rich set of session state maps (lines 163-194):

- `activeSessions`: active session map (`sessionId` -> `SessionHandle`)
- `sessionStartTimes`: session start times
- `sessionWorkIds`: work ID corresponding to each session
- `sessionCompatIds`: compatibility-layer session ID cache
- `sessionIngressTokens`: session JWT tokens
- `completedWorkIds`: set of completed work IDs
- `timedOutSessions`: set of sessions killed due to timeout

## 3. JWT Management

### 3.1 JWT Decoding (Without Signature Verification)

> 🔄 **Competitor comparison**: Managing authentication credentials is a core problem in remote-control systems, and the solutions vary widely. Cursor inherits VS Code Remote SSH and uses **SSH key-pair** authentication. There is no complexity around expiration or refresh, but key distribution and revocation become difficult, and users must manually manage `~/.ssh/`. JetBrains Gateway uses OAuth tokens from a JetBrains Account. ngrok uses long-lived API keys. Bridge chose a **short-lived JWT + proactive refresh** model, striking a compromise between security (short-lived tokens + automatic rotation) and complexity (a dedicated refresh scheduler).

`jwtUtils.ts` provides a lightweight JWT decoder. Note that it **does not verify the signature**; it only parses the payload:

```typescript
export function decodeJwtPayload(token: string): unknown | null {
  // If the sk-ant-si- prefix (Session Ingress Token) is present, strip it first
  const jwt = token.startsWith('sk-ant-si-')
    ? token.slice('sk-ant-si-'.length)
    : token
  const parts = jwt.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    return jsonParse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
```

One interesting detail: Session Ingress Token carries the `sk-ant-si-` prefix, which is not part of standard JWT format, so it must be stripped before decoding.

### 3.2 Proactive Refresh Scheduler

> 📚 **Course linkage (Computer Networks / Distributed Systems)**: The proactive JWT refresh scheduler reflects the classic distributed-systems pattern of **lease renewal**. The client holds a credential with an expiration time (a lease) and must renew it before it expires. The "refresh 5 minutes early" buffer avoids the race condition of expiring at exactly the wrong moment. This is the same pattern used in DHCP lease renewal (retry at T1=50% and T2=87.5%), Kerberos ticket refresh, and similar network protocols. The generation counter is likewise a standard technique for handling async races and appears in optimistic concurrency control (OCC) in databases as well.

The core of JWT management is `createTokenRefreshScheduler` (lines 72-256), a well-designed timed refresh system:

```typescript
export function createTokenRefreshScheduler({
  getAccessToken,
  onRefresh,
  label,
  refreshBufferMs = TOKEN_REFRESH_BUFFER_MS,  // default 5 minutes
}: { ... }): {
  schedule: (sessionId: string, token: string) => void
  scheduleFromExpiresIn: (sessionId: string, expiresInSeconds: number) => void
  cancel: (sessionId: string) => void
  cancelAll: () => void
}
```

Key design elements:

1. **Early refresh buffer**: refresh 5 minutes before expiry by default (`TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000`)
2. **Fallback refresh interval**: if the new token's expiry time cannot be decoded, fall back to a 30-minute interval
3. **Retry limit on failure**: give up after 3 consecutive failures (`MAX_REFRESH_FAILURES = 3`)
4. **Generation counter**: maintain an incrementing generation number per session to detect stale async refresh callbacks

The generation mechanism (lines 96-100) is a standard pattern for handling async races:

```typescript
function nextGeneration(sessionId: string): number {
  const gen = (generations.get(sessionId) ?? 0) + 1
  generations.set(sessionId, gen)
  return gen
}
```

When `doRefresh` returns asynchronously, it checks whether the current generation still matches the one from when it started. If not, the session was canceled or rescheduled, and the current refresh result should be discarded. This prevents the "ghost timer" problem. This generation-check pattern is standard in asynchronous programming (React `useEffect` cleanup, Go `context` cancellation, optimistic concurrency control in databases, and so on), and Bridge applies it in a conventional and solid way.

> 📚 **Course linkage (Operating Systems)**: The AbortController signal-merging used by the capacity wake mechanism is essentially a JavaScript implementation of a **one-shot event notification**. Once `wake()` triggers the signal via `abort()`, a new AbortController must be created before it can be used again. This is closer to Linux `eventfd` one-shot semantics than to the reusable wait/signal semantics of `pthread_cond_signal()` (a condition variable can be repeatedly `wait`ed and `signal`ed, while an AbortController cannot be reused after abort). The merged signal returned by `signal()` is equivalent to `select()` / `poll()` style multiplexing: any event source can wake the waiter. This is lighter than using locks or mutexes and fits JavaScript's event-driven model more naturally.

## 4. Trusted Device

### 4.1 Design Background

> 🔄 **Competitor comparison**: How does a remote execution environment confirm that "the device issuing commands is trusted"? SSH-based approaches (Cursor, VS Code Remote) rely on SSH keys. The key itself is proof of device trust, but losing the key means losing access. GitHub Codespaces runs in the cloud and uses browser session + 2FA to verify user identity, so device trust is not a separate concern. Bridge introduces an **independent trusted-device layer**, adding device-level trust on top of OAuth authentication. That means even if an OAuth token leaks, an attacker still cannot establish a Bridge connection from an unregistered device.

On the server side, Bridge sessions operate at `SecurityTier=ELEVATED`. The trusted-device mechanism provides an extra authentication layer for this high security tier.

The comments in `trustedDevice.ts`, lines 15-31, clearly explain the two-switch design:

```
// Bridge sessions run with SecurityTier=ELEVATED on the server side
// Server-side switch: sessions_elevated_auth_enforcement (controls whether the server checks)
// CLI-side switch: tengu_sessions_elevated_auth_enforcement (controls whether the Token is sent)
// Splitting the two switches enables staged rollout: turn on the CLI side first (start sending Header),
// then turn on the server side (begin enforcing)
```

### 4.2 Device Enrollment Flow

Enrollment happens immediately after `/login` (lines 98-210):

```typescript
export async function enrollTrustedDevice(): Promise<void> {
  // 1. Check the feature gate
  if (!(await checkGate_CACHED_OR_BLOCKING(TRUSTED_DEVICE_GATE))) return

  // 2. Get the OAuth Token
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (!accessToken) return

  // 3. Send the enrollment request
  response = await axios.post(
    `${baseUrl}/api/auth/trusted_devices`,
    { display_name: `Claude Code on ${hostname()} · ${process.platform}` },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10_000 }
  )

  // 4. Persist to the Keychain
  storageData.trustedDeviceToken = token
  secureStorage.update(storageData)
}
```

The `display_name` submitted at enrollment time has the format `"Claude Code on <hostname> · <platform>"`, for example `"Claude Code on MacBook-Pro · darwin"`.

### 4.3 Token Reading and Caching

The read function uses `lodash-es/memoize` for caching, so each API call does not have to invoke the macOS `security` command (about 40ms of overhead):

```typescript
const readStoredToken = memoize((): string | undefined => {
  const envToken = process.env.CLAUDE_TRUSTED_DEVICE_TOKEN  // Env var takes precedence
  if (envToken) return envToken
  return getSecureStorage().read()?.trustedDeviceToken
})
```

Inside `bridgeApi.ts`, the token is sent in the request header as `X-Trusted-Device-Token`.

## 5. Capacity Wake

`capacityWake.ts` is an elegant concurrency primitive. In only 57 lines of code, it solves a specific problem: when Bridge reaches its session limit, it goes to sleep in a "capacity full" state. When a session ends and frees capacity, the polling loop must be **woken up immediately** so it can accept new work.

```typescript
export function createCapacityWake(outerSignal: AbortSignal): CapacityWake {
  let wakeController = new AbortController()

  function wake(): void {
    wakeController.abort()           // Interrupt the current sleep
    wakeController = new AbortController()  // Immediately create a new one, ready for next time
  }

  function signal(): CapacitySignal {
    const merged = new AbortController()
    const abort = (): void => merged.abort()
    outerSignal.addEventListener('abort', abort, { once: true })
    const capSig = wakeController.signal
    capSig.addEventListener('abort', abort, { once: true })
    return {
      signal: merged.signal,
      cleanup: () => {
        outerSignal.removeEventListener('abort', abort)
        capSig.removeEventListener('abort', abort)
      },
    }
  }

  return { signal, wake }
}
```

This uses a "signal merging" pattern: it combines the outer shutdown signal and the capacity wake signal into a single AbortSignal, and either one can wake the sleep. The same logic used to be duplicated in both `replBridge.ts` and `bridgeMain.ts`, and was later extracted into its own module.

## 6. In-Depth Security Analysis

### 6.1 Path Traversal Defense

`bridgeApi.ts`, lines 41-53, performs strict validation on all IDs returned by the server:

```typescript
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export function validateBridgeId(id: string, label: string): string {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: contains unsafe characters`)
  }
  return id
}
```

This blocks path traversal attacks such as `../../admin`. If the server were compromised or returned a malicious ID, the client would not blindly splice it into a URL.

### 6.2 OAuth 401 Retry

All authenticated requests are wrapped with `withOAuthRetry` (lines 106-139). On a 401 response, the code automatically refreshes the token and retries once. This mirrors the pattern used in `withRetry.ts`, ensuring that token expiry does not cause the operation to fail outright.

### 6.3 Fatal Error Classification

The `BridgeFatalError` class (lines 56-66) is reserved for errors that should not be retried:

- 401: authentication failure -> prompt the user to log in again
- 403: permission denied or session expired
- 404: feature unavailable
- 410: session expired (Gone)

By contrast, 429 (rate limiting) and other errors are allowed to retry.

## 7. Session ID Compatibility Layer

Because of the introduction of CCR v2, a single session may have two different ID prefixes: `session_*` (compatibility layer) and `cse_*` (infrastructure layer). The `sameSessionId` function in `workSecret.ts` compares the part after the last underscore to decide whether they represent the same session:

```typescript
export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  return aBody.length >= 4 && aBody === bBody
}
```

> ⚠️ **Technical debt warning**: This implementation has a known collision risk. It assumes that "the part after the underscore" is globally unique, but the minimum-length check `aBody.length >= 4` means equivalence can be determined using as few as 4 characters. In large-scale concurrent scenarios, any two different sessions ending in the same suffix would be misidentified as the same session. This is a compatibility workaround introduced to bridge the dual v1/v2 ID systems, not a robust design. Until the ID generation strategy guarantees suffix uniqueness, this remains a potential fault point worth tracking.

---

## Guide to the Second Half: From Handshake Protocol to Runtime Semantics

Sections §1 to §7 covered Bridge's **static infrastructure**: handshake, protocol, authentication, and the v1/v2 evolution. The content after §8 shifts to **runtime state semantics**: once bridge is actually running, what internal conceptual oppositions exist in the system, which ones are easy to confuse, and what design intent sits behind each distinction.

The eight subsections in the second half (§8-§15) are organized around three themes:

- **Dual-track state** (§8): two sets of similarly prefixed state variables that look alike but mean fundamentally different things
- **Continuity and identity** (§9-§13): Pointer recovery (§9) -> Perpetual mode (§10) -> the Mirror paradox (§11) -> SessionId rotation (§12) -> Handle identity binding (§13). This forms a progressive chain from "how bridge is remembered" to "how bridge identity is guaranteed"
- **Contracts and layering** (§14-§15): namespace design for peer-address routing (§14), and the layering of send contracts vs state surfaces (§15). These answer "how data flows" and "who can observe which information"

After reading §8-§15, you should be able to answer one core question: **Bridge is not just "a remote connection." It is a system coordinating multiple layers of state. Why do those layers need to be separate, and where are the boundaries?** If you only want a quick panoramic view, read §8 and §15 first (the core on both ends), and then consult the middle sections as needed.

---

## 8. Bridge's Dual State Tracks: UI Session State vs Capability Gate

Inside the Bridge system there are two sets of state that are **easy to confuse but fundamentally different**:

### replBridgeSessionActive (UI world)

- **Ownership**: `AppStateStore` (React state tree)
- **Consumers**: `bridge.tsx`, `PromptInputFooter.tsx`, `BridgeDialog.tsx` - all UI components
- **Semantics**: whether the session ingress synchronization chain is healthy, not merely "whether it connected"
  > 💡 **What is ingress?** Literally "entry." In the Bridge context it specifically refers to the **event stream pushed from the remote server to the local client** (as opposed to egress = requests sent out by the client). Think of ingress as a "courier delivery channel to your door." It is not enough for the channel to exist; you also need to know that the courier can keep delivering packages on time.
- **Writer**: `handleStateChange()` in `useReplBridge.tsx` explicitly writes it in the ready / connected / reconnecting / failed branches
- **Relationship to ingress**: the `onBatchDropped` callback in `replBridge.ts` triggers `reconnecting`, which makes `useReplBridge.tsx` set `replBridgeSessionActive: false`. So prolonged ingress failure also turns it false
- **Immediate behavior after connected**: in the connected branch, `handleStateChange()` sets `replBridgeSessionActive: true` and then immediately sends a `system/init` message (carrying commands / agents / skills / model / permissionMode / fastMode), declaring to the remote side that "the client is now attached." This further confirms that sessionActive means "client online state," not merely "send capability is ready"

### replBridgeActive (capability-gate world)

- **Ownership**: `bootstrap/state.ts` (global singleton)
- **Consumers**: `SendMessageTool.ts` (send gate), `ToolSearchTool/prompt.ts` (tool-availability gate)
- **Semantics**: whether bridge cross-session message delivery capability is ready
- **Writer**: `setReplBridgeActive()` is **defined but never called anywhere** in the source. This is a known missing writer

> **⚠️ Key fact**: Searching for `setReplBridgeActive` in `bootstrap/state.ts` shows only its definition line and no callsites anywhere in the codebase. That means in the current snapshot, the host file responsible for setting this capability gate to true is missing. Based on the research-boundary statement in the prologue, this belongs to a checkout-level source gap and does not affect understanding of the intended behavior.

> 💡 **What does "host" mean here?** In this book, "host" means the **file where a function or variable is defined**. Think of it as the book that contains a dictionary entry. The term is referenced somewhere, but where is the actual definition entry stored? If that defining entry is missing, that is called a "missing host." "Flip true" is programmer slang meaning "change a boolean variable from false to true," i.e. "turn this switch on."

> **Wouldn't that make `isReplBridgeActive()` always return false? How can the system still send messages?** Good question. In the current snapshot, `isReplBridgeActive()` would indeed theoretically remain false forever, meaning bridge cross-session message delivery is **permanently disabled** in this community-released source snapshot. But that does not mean production behaves the same way. The real writer almost certainly exists in an ingress callback host file that did not make it into the snapshot, perhaps a WebSocket event handler that flips this gate when it receives a "session ready" signal from the server. What we are looking at is a **source specimen with callers, a definition, but a missing start-switch host**. It is like excavating an old kerosene lamp: the oil reservoir is there, the wick is there, the glass cover is there, but the ignition switch is missing.

> 💡 **Plain English**: This is like a hotel where the front desk tracks "room occupied" (UI session state), while the fire-control room tracks "is the room's fire system ready" (capability gate). Both relate to the same room, but their data sources, update timing, and consumers are completely different.

---

## 9. Bridge Pointer Crash Recovery Mechanism

Bridge continuity does not depend on the remote session list. It depends on a local **pointer file**.

### bridge-pointer.json

After a bridge session is established successfully, the system writes `bridge-pointer.json` into the current project directory:

```jsonc
{
  "sessionId": "session_abc123...",
  "environmentId": "env_xyz789...",
  "source": "repl"  // or "standalone"
}
```

### Recovery Mechanism

- **Freshness check**: based on file mtime, with a TTL of **4 hours** (`BRIDGE_POINTER_TTL_MS = 4 * 60 * 60 * 1000`, source `bridgePointer.ts`)
- **Keepalive for long sessions**: automatically refresh the pointer file's mtime every hour (source `replBridge.ts:1505-1524`)
- **Clean shutdown**: clear the pointer on normal exit (`cleanupBridgePointer()`)
- **Crash / kill -9**: the pointer file remains; on the next startup, the system sees the pointer and attempts recovery
- **Worktree fanout**: if there is no pointer in the current directory, it scans up to 50 sibling git worktrees (`MAX_WORKTREE_FANOUT=50`) and restores from the freshest pointer
  > 💡 **What is fanout?** "Fan-out" means **spreading from one point to multiple targets like an opened fan**. Here it means starting from the current working directory and fanning out to sibling git worktree directories. Git worktree allows the same repository to be checked out simultaneously into multiple directories.

> 💡 **Plain English**: The Bridge pointer is like a "Do Not Disturb" sign hanging outside a hotel room. On normal checkout, the sign is removed. If the power suddenly goes out (crash), the sign is still hanging there. When you return next time, the hotel sees the sign and takes you back to your original room (restores the session) instead of assigning you a new one.

---

## 10. Perpetual Bridge and KAIROS

### The Nature of assistant Mode

`claude assistant` does not start a new local Agent. It **attaches to a remote session** in viewer mode. After `main.tsx` parses the `assistant` subcommand, it constructs `RemoteSessionConfig` + `viewerOnly=true` and enters `launchRepl()`.

### The KAIROS feature gate

`KAIROS` is the internal codename for assistant mode (it appears **190 times across 61 files** in the source; see the explanation of the precise data source in Part3 Ch24 `assistant=viewer` §2). When `feature('KAIROS')` is enabled and `isAssistantMode()` is true:

- Bridge enters **perpetual mode**: `perpetual = true`
- `worker_type` becomes `claude_code_assistant`
- Teardown behavior becomes **completely different** from ordinary bridge: no result is sent, no `stopWork`, no transport shutdown. It only stops polling, clears the flush gate, and refreshes the pointer (source `replBridge.ts:1595-1616`)

### Mutual exclusion between perpetual and v2

At present, perpetual mode only supports the v1 channel. `initReplBridge.ts:410` explicitly says `if (isEnvLessBridgeEnabled() && !perpetual)` before taking the v2 path. That means assistant mode cannot yet use the new env-less bridge features.

---

## 11. OutboundOnly / Mirror Mode

### Why does the handle exist while active is false?

This apparent contradiction has a precise explanation: **outboundOnly (CCR mirror) mode**.

Mirror mode only establishes a one-way mirror. It forwards local events (tool results, text, and so on) to claude.ai, but does not establish interactive peer messaging capability. In the `outboundOnly` branch of `handleStateChange()` in `useReplBridge.tsx`:

1. It synchronizes `replBridgeConnected` (marking "connected")
2. It **returns immediately**
3. Therefore it never enters the `connected` case
4. So `replBridgeSessionActive` is **never flipped to true**

The log label is `"Mirror initialized"`. The comment in `SendMessageTool.ts:645` explicitly says `isReplBridgeActive()` is used to "reject outbound-only (CCR mirror) mode".

> 💡 **Plain English**: Mirror mode is like one-way glass. You can see what is happening inside from the outside (`claude.ai`), but you cannot knock on the glass and speak through it. The handle exists (the glass is installed), but active is false (interactive communication is not supported).

---

## 12. Session ID Rotation and Address Semantics

Bridge's `bridgeSessionId` is not a stable identity. It is a **rotating session-scoped address token**.

On reconnect, `replBridge.ts` calls `createSession()` again and gets a new `sessionId`. The new ID is published through `setReplBridgeHandle()` -> `getSelfBridgeCompatId()` -> `updateSessionBridgeId()` into the session record, allowing `peerRegistry` to continue deduplicating correctly.

The comment in `replBridgeHandle.ts:22` reads: "Publish (or clear) our bridge session ID in the session record so other local peers can dedup us out of their bridge list."

**Engineering implication**: any logic that depends on `bridgeSessionId` as a long-term identifier will break after reconnect. An address such as `bridge:session_xxx` in `peerAddress.ts` is only valid within the lifetime of the current connection.

---

## 13. Identity Binding of the Bridge Handle

`replBridgeHandle` is not a cache object that can be rebuilt arbitrarily. Its **closure captures `sessionId` and `getAccessToken`**.

The original comment in `replBridgeHandle.ts:6-13` says: "the handle's closure captures the sessionId and getAccessToken that created the session, and re-deriving those independently (BriefTool/upload.ts pattern) risks staging/prod token divergence."

> 💡 **What is staging/prod token divergence?** Engineering teams usually maintain two environments: **staging** (pre-production, using fake data for testing) and **prod** (production, serving real user data). The tokens issued by those environments are different. The comment means that if different modules fetch tokens independently, one module may end up with a staging token while another gets a prod token. Mixing them causes authentication chaos. So the code forces all modules to share **the same token captured inside the same handle closure**.

`setReplBridgeHandle()` sets the handle and, at the same time, writes the current bridge session address back into the session PID record through `updateSessionBridgeId()`. This is the visible writer for the bridge **address lane**.

---

## 14. Peer Address Routing and Compatibility Asymmetry

Bridge is not only a remote-control channel. It is also a target address for **cross-session message delivery**. `parseAddress()` in `peerAddress.ts` defines three address schemes:

```typescript
parseAddress(to):
  "uds:..."   → { scheme: 'uds', target }    // Local UDS channel
  "bridge:..." → { scheme: 'bridge', target }  // Remote Bridge channel
  leading "/"  → { scheme: 'uds', target }    // Legacy compat: bare socket path
  otherwise    → { scheme: 'other', target }   // Route by teammate name
```

**Key design decision**: a bare UDS path (starting with `/`) is automatically treated as compatible with the `uds:` scheme, but a bare bridge session id is **not** auto-interpreted as a bridge scheme. The source comment explains why: "the prefix would hijack teammate names like session_manager". This is **not** "it might just happen to collide with a teammate called `session_manager`." It is a **namespace hijacking defense**. Teammate names are arbitrary user-defined strings, and their namespace overlaps with the `session_*` format used by bridge IDs. If `parseAddress()` automatically treated bare `session_xxx` strings as bridge addresses, any teammate name beginning with `session_` (`session_manager`, `session_reviewer`, `session_debugger`, and so on) would be routed into the bridge channel. That is a **namespace pollution problem**, not a low-probability name collision.

### The Envelope Model and TOCTOU Race Defense

For cross-session messages, the `from` field is constructed by the sender host using `getReplBridgeHandle()`. In other words, **the sender host writes the envelope and the receiver host reads the envelope**.

> 💡 **What is an envelope?** It is the **outer wrapper object** of a cross-session message, containing fields such as `from` (sender), `to` (recipient), `messageId`, and `body`. Think of it as the sender/recipient section printed on the outside of a letter. The postal system does not read the contents of the letter, but it must read the envelope.

There is a noteworthy **TOCTOU race** defense in the source (`SendMessageTool.ts:744-750`): `checkPermissions` pops up a confirmation dialog, and the user may wait minutes before clicking Allow. During that time, bridge may disconnect. If the code does not re-check the handle at the start of `call()`, a message may be sent with `from="unknown"` in the envelope. The source comment says: "without this, from='unknown' ships".

> 💡 **What is TOCTOU?** Time-Of-Check to Time-Of-Use race. You check that a state is safe at one moment, but by the time you actually use it, the state has changed. This is one of the classic classes of security bugs in concurrent systems. A real-world analogy: before leaving home, you check the forecast and see sunshine, so you do not bring an umbrella (check). By the time you reach the office, it is raining (use). There is a time gap between the check and the use.

---

## 15. Send Contract vs State Surface: Bridge's Two-layer Data Model

An important architectural characteristic of Bridge is that its data model is clearly split into **two layers**:

| Layer | File | Number of fields | Purpose |
|------|------|--------|------|
| **Thin send layer** | `peerAddress.ts` | 2 (`scheme + target`) | Message routing |
| **Thick state surface** | `AppStateStore.ts` | 13 (`replBridgeEnabled -> replBridgeInitialName`) | Bridge UI state display |
| **Observation surface** | `concurrentSessions.ts` | 5+ (`pid`, `sessionId`, `status`, `waitingFor...`) | `claude ps` + peer discovery |

`peerAddress.ts` is intentionally separated from `peerRegistry.ts` (the source comment says: "kept separate from peerRegistry.ts so that SendMessageTool can import parseAddress without transitively loading the bridge (axios) and UDS (fs, net) modules at tool-enumeration time"). The purpose is to keep the send layer from pulling in heavy dependencies during module load.

> 💡 **Plain English**: This is similar to DNS. A DNS query result only gives you an IP address (thin), but the DNS server itself maintains richer metadata internally, such as TTL, authoritative flags, and DNSSEC signatures (thick). The message delivery layer only needs to know "deliver to `bridge:session_abc123`." It does not need to know whether that bridge is reconnecting or has an error.

> 🌍 **Industry comparison**: This "thin send contract + thick state surface" layering has two classic analogues in frontend architecture:
> - **Redux action/store separation**: an action is a thin object (`type` + `payload`), while the store is a thick state tree. Message passing goes through actions; state reads go through the store. The two data structures must not be mixed.
> - **Kubernetes spec vs status**: a Pod's `spec` (desired state, writable by the user) and `status` (actual state, read-only and maintained by the system) are layered separately. `spec` is thin, while `status` is thick, including container state, restart count, IP assignment, and other runtime data.
>
> Claude Code made the same judgment in the Bridge layer: minimize the contract for "can we send," and put the metadata for "what is happening in the system" into another lane. This is a classic piece of **Clean Architecture information hiding** in practice.

### The Dual-model Design of Real-time Connection vs Background Mirror

Bridge splits remote communication into two models:

- **Real-time connection** (`RemoteSessionManager`, which carries all the handshake / authentication / transport mechanisms discussed in §1-§7 of this chapter): WebSocket subscription and HTTP sending are split into two flows to optimize low-latency interaction
- **Background mirror** (`RemoteAgentTask` + sidecar + polling; see the Part3 "Remote Agent Management" chapter for details): optimized for recoverable, hostable background task execution

These are deliberately split into two models rather than unified under one bidirectional transport because their failure semantics, timeout strategies, and authentication requirements are completely different. Real-time connection needs instant reconnect. Background mirror needs persist-and-resume.

---

## Critical Analysis

### Strengths

1. **The v1 -> v2 paradigm shift**: the move from stateful Environment to stateless Env-less is the most valuable design decision in the Bridge architecture. "Each `/bridge` call is registration" removes the complexity of server-side state management. You do not see the same architectural evolution in competitors such as Cursor or JetBrains Gateway, which still depend on persistent connections.
2. **Progressive migration through dual channels**: Feature Flags allow v1 and v2 to run in parallel, reducing protocol-migration risk. Feature-flag rollout is standard industry practice, but maintaining dual channels in parallel at the transport-protocol layer (rather than just API versioning) requires extra engineering investment.
3. **A zero-configuration user-experience decision**: choosing server relay over SSH tunneling trades server-side complexity for zero client configuration. This is a product decision made with a clear trade-off in mind, not a purely technical choice.
4. **Defense in depth for security**: path validation + trusted device + OAuth refresh + JWT rotation + a 10-minute registration window form a richer security model than the single-factor authentication model of SSH keys alone.

### Weaknesses

1. **Huge code volume**: `bridgeMain.ts` (115KB) and `replBridge.ts` (100KB) are enormous, and there is a large amount of similar logic between them. Extracting `bridgeMessaging.ts` and `capacityWake.ts` is only the beginning.
2. **JWT without signature verification**: `decodeJwtPayload` explicitly does not verify signatures. Since the JWT is received over HTTPS from Anthropic servers, transport-layer injection already requires breaking TLS first. If TLS is already broken, signature verification is not the main concern. The real risk scenarios for not verifying signatures are: (a) a locally stored JWT is tampered with and reloaded, or (b) an insecure transport path is used during debugging/testing. This is a pragmatic engineering choice, but the threat model should be made explicit.
3. **Polling inefficiency**: the traditional Environment-based channel still depends on polling rather than push, causing both latency and resource waste, although CCR v2's SSE is actively addressing this.
4. **The trusted-device security window**: `enrollTrustedDevice` requires registration to complete within 10 minutes of login (`account_session.created_at < 10min`). At first glance this may look like a limitation, but it is actually a carefully considered security decision. It ensures that only devices that have just completed an interactive login (proving user presence) can enroll as trusted devices, preventing the attack path of "steal an OAuth token and silently enroll a trusted device on another machine." The cost is that delayed-enrollment schemes are impossible.
5. **Semantic compensation for HTTP 403**: `BridgeFatalError` treats 403 differently depending on whether it means "session expired" or "insufficient permission", and the existence of `isSuppressible403` reflects an engineering compensation for the inadequacy of HTTP status-code semantics. 403 can mean very different things in different contexts ("never allowed" vs "not allowed right now"). Using `isSuppressible` to distinguish those cases is pragmatic, but it increases the cognitive burden of the codebase. Future maintainers must understand the exact semantics of each 403 scenario.
