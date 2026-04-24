# 如何从浏览器远程"驾驶"你的终端 AI？

你在公司笔记本上跑着 Claude Code，人却在手机上浏览 claude.ai——能不能直接在网页上给终端下指令？Remote Control 功能让这成为现实。它不是简单的终端转发，而是一个完整的分布式会话管理平台，涉及环境注册、JWT 认证、git worktree 隔离和断线重连。本章深入剖析 Bridge 系统 30+ 个源文件背后的架构设计。

> 💡 **通俗理解**：就像远程桌面/向日葵——在另一台设备上控制你的开发环境。

> 🌍 **行业背景**：远程操控终端 AI 并非 Claude Code 独创——这是 2024-2025 年 AI 编程工具的共同方向。**Cursor** 的 Remote SSH 模式允许用户通过 VS Code Remote SSH 在远端服务器运行 AI 辅助编码，但本质上复用了 VS Code 的远程架构，没有独立的会话管理层。**GitHub Copilot** 在 VS Code 中通过 Codespaces 实现云端编码环境，但以 IDE 为中心而非终端。**Windsurf**（Codeium）同样依赖 VS Code 远程扩展体系。**Codex（OpenAI）** 也在近期版本中增加了专用独立客户端，但主要面向本地终端运行（具体版本号与时间以官方发布为准）。业界亦出现以通信应用（WhatsApp/Telegram 等）为入口的远程控制范式——以手机消息触发本地电脑任务，支持跨地域设备唤醒（相关产品名称与实现细节以官方公告为准，本文未穷举验证）。Claude Code 的 Bridge 系统独特之处在于：它不依赖 IDE 远程框架，而是构建了一个从零实现的**分布式会话调度层**——包含环境注册、工作分派、JWT 认证刷新和 git worktree 隔离，更接近 Kubernetes 的编排理念而非简单的 SSH 隧道。

---

## 问题

你在公司笔记本上跑着 Claude Code，但人在手机上浏览 claude.ai。突然你想让 Claude 帮你修个 bug——不用回到终端，直接在网页上输入指令就行。这个叫做"Remote Control"的功能背后，是怎样一套分布式会话系统？

---

> **[图表预留 2.16-A]**：时序图 — Bridge 从注册到会话执行的完整生命周期（注册环境 → poll work → spawn session → WebSocket 双向通信 → 会话结束 → 清理）

## 你可能以为……

"大概就是开个 SSH 隧道或者 WebSocket，把终端的输入输出转发到网页上吧？"你可能这么想。类似 VS Code Remote 那样，搞一个简单的 I/O 代理。

---

## 实际上是这样的

Remote Control 是一个完整的**会话管理平台**（"分布式"特指"浏览器客户端 ↔ 中心服务器 ↔ 多个用户笔记本 bridge"的多方协作，不是多节点集群；bridge 本身只运行在单台笔记本上）。它涵盖环境注册、工作分派、JWT 认证刷新、多会话 worktree 隔离、断线重连、权限桥接——复杂度远超一个简单的终端代理。代码在 `bridge/` 目录下有 30+ 个 TypeScript 文件，主逻辑文件 `replBridge.ts` 单文件 2400+ 行。

### 小节 1：Bridge 是一个"工作环境注册中心"

类比一个外卖平台：骑手（bridge）先在平台上"上线"（注册环境），然后不断刷新看有没有新订单（poll for work），接单后出发送餐（spawn session），送完回来继续等。

```typescript
// src/bridge/bridgeMain.ts，第 141-152 行
export async function runBridgeLoop(
  config: BridgeConfig,
  environmentId: string,
  environmentSecret: string,
  api: BridgeApiClient,
  spawner: SessionSpawner,
  logger: BridgeLogger,
  signal: AbortSignal,
  backoffConfig: BackoffConfig = DEFAULT_BACKOFF,
  // ...
): Promise<void> {
```

Bridge 注册时带上完整的"身份信息"：工作目录、机器名、Git 分支、最大并发会话数（默认 32）、spawn 模式。

### 小节 2：三种 Spawn 模式——多个会话怎么共存

> 📚 **课程关联**：Spawn 模式的三种隔离策略可类比**操作系统**课程中的进程隔离模型——`single-session` 类似单进程独占资源、`worktree` 类似"文件树/分支级"隔离（仅提供独立的工作目录与分支 checkout，**不包含进程/网络/资源隔离**，也不能替代安全沙箱）、`same-dir` 类似共享内存的线程模型。理解这三种模式的取舍，就是理解 OS 中"隔离性 vs 性能"这一经典权衡。

这是架构上最关键的决策之一：

```typescript
// src/bridge/types.ts，第 64-69 行
export type SpawnMode = 'single-session' | 'worktree' | 'same-dir'
```

- **single-session**：一次只跑一个会话，结束后 bridge 自动退出。最简单的模式。
- **worktree**：每个新会话获得一个**隔离的 git worktree**——独立的工作目录、独立的分支、互不干扰。想象 git 仓库的"平行宇宙"。
- **same-dir**：所有会话共享同一目录。快速但危险——两个会话可能同时编辑同一个文件。

worktree 模式在底层调用 `createAgentWorktree()` 创建临时分支，会话结束后调用 `removeAgentWorktree()` 清理。这意味着每个从 claude.ai 发起的会话都有独立的工作目录与分支——分支级的写入不会污染主分支。**重要提示**：worktree 只是 git 层面的目录/分支隔离，**不是进程沙箱**——bridge 里发起的任意 shell 命令仍然可以 `rm -rf /path/outside/repo`、改系统配置、发网络请求、修改 `~/.claude/settings.json` 等仓库外资源。把 worktree 当"写坏也不影响主分支"的保险栓可以，但不能当"安全沙箱"使用。

### 小节 3：双版本传输协议——v1 遗留与 v2 直连

> 📚 **课程关联**：v1/v2 协议共存是**计算机网络**课程中"协议演进与向后兼容"的教科书案例。就像 HTTP/1.1 到 HTTP/2 的迁移需要 ALPN 协商一样，Bridge 通过 GrowthBook feature flag 实现协议版本切换，让客户端对传输层透明——这正是网络分层架构中"接口抽象"原则的实践。

系统同时**能支持**两套连接协议，运行时由 GrowthBook feature flag（`isEnvLessBridgeEnabled`）决定单次连接走哪一条——不是"同时都在跑"的双通道，而是"保留 v1 兼容路径，默认走 v2"的渐进迁移。说"两套都在运行"指代码路径都存在、flag 可以随时切回 v1；说"flag 控制切换"指同一时刻每个客户端走其中一条。两种表述描述的是同一件事的不同侧面，这里澄清避免读者误以为是"双通道并发"：

**v1（Environments API，传统路径）**：
1. 注册环境 → 获得 environment_id + secret
2. 轮询工作 → 获得 WorkSecret（base64url 编码的 JSON，含 JWT token）
3. 确认工作 → 启动 WebSocket（HybridTransport：WS 读 + HTTP POST 写）

**v2（Env-less 直连，新路径）**：
1. POST `/v1/code/sessions` → 创建会话
2. POST `/v1/code/sessions/{id}/bridge` → 直接获得 `worker_jwt` + `epoch`
3. SSE 读 + CCRClient 写

术语解释：
- **epoch**：一个单调递增的整数（每次 bridge 拿到新 worker_jwt 时递增），用于服务端在并发重连时区分"旧连接"和"新连接"——旧 epoch 的写入会被拒绝，避免网络抖动导致两个客户端同时声称自己是同一个 bridge。语义类似 Raft/Paxos 里的 term，或分布式锁里的 fencing token。
- **CCRClient**：Claude Code Remote Client 的简称，是 v2 协议里负责"从 bridge 把 payload 推到服务器"的 HTTP 写入客户端（对应 v1 里的 HybridTransport 写入层）。它不是一个公开对外的 SDK 名字，而是 bridge 代码内部给这条写路径的命名。

v2 的注释（`remoteBridgeCore.ts`）解释了演进原因：

> "The Environments API historically existed because CCR's /worker/* endpoints required a session_id+role=worker JWT that only the work-dispatch layer could mint. Server PR #292605 adds the /bridge endpoint as a direct OAuth→worker_jwt exchange, making the env layer optional."

简单说：v1 需要一个"中间人"层来铸造 JWT，v2 直接一步到位。传输层被抽象为 `ReplBridgeTransport` 接口，让上层代码对协议版本无感知。

### 小节 4：权限桥接——远程操作的安全绳

当远程 Claude 要执行敏感操作（编辑文件、运行命令），权限请求需要穿越整个链路到达网页用户面前：

```
Claude 子进程 → control_request → bridge 捕获
→ bridge 转发到 claude.ai 后端
→ 网页用户看到权限弹窗 → 允许/拒绝
→ control_response → bridge 转发给子进程
→ 继续或停止执行
```

权限请求的格式（`sessionRunner.ts:33-43`）：
```typescript
export type PermissionRequest = {
  type: 'control_request'
  request_id: string
  request: {
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    tool_use_id: string
  }
}
```

### 小节 5：断线不慌——睡眠检测与指数退避

Bridge 运行在用户的笔记本上，笔记本会合盖休眠。系统有一个实用的**系统睡眠检测器**（类似做法在 Electron 应用和移动端长连接服务中也很常见）：

```typescript
// src/bridge/bridgeMain.ts，第 107-109 行
function pollSleepDetectionThresholdMs(backoff: BackoffConfig): number {
  return backoff.connCapMs * 2  // 默认 4 分钟
}
```

如果两次 poll 之间的间隔超过 4 分钟（最大退避间隔的 2 倍），系统判定为"刚从休眠中醒来"，重置所有错误计数——避免因休眠期间累积的超时误判为连接失败。

退避策略本身是标准的指数退避：初始 2 秒，上限 2 分钟，10 分钟后完全放弃。

### 小节 6：Session ID 的身份危机

系统中存在一个令人哭笑不得的兼容问题：同一个会话在不同 API 层有不同的 ID 前缀。

```typescript
// src/bridge/workSecret.ts，第 62-73 行
export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  return aBody.length >= 4 && aBody === bBody
}
```

v2 基础设施返回 `cse_abc123`，v1 兼容层返回 `session_abc123`——底层 UUID 一样，但前缀不同。如果不做这个比较，bridge 会把自己发起的会话误判为"外来会话"并拒绝。注释诚实地记录了这个历史债务的来源。

### 小节 7：代号 Tengu 和五层门禁

所有 GrowthBook feature gate 都以 `tengu_` 为前缀（天狗，日本神话中的妖怪形象）。要成功使用 Remote Control，需要通过五层检查：

1. `feature('BRIDGE_MODE')` — 编译时 flag
2. `isClaudeAISubscriber()` — 必须是 claude.ai 付费订阅（排除 Bedrock/Vertex/API key）
3. `hasProfileScope()` — OAuth token 需要 `user:profile` scope
4. `getOauthAccountInfo()?.organizationUuid` — 必须能解析组织 UUID
5. `checkGate('tengu_ccr_bridge')` — 服务端 GrowthBook 开关

每一层失败都有独立的诊断消息（`bridgeEnabled.ts:70-87`），告诉用户该怎么修。比如 scope 不足时会说"Long-lived tokens from setup-token are limited to inference-only for security reasons. Run `claude auth login` to use Remote Control."

---

## 这背后的哲学

Remote Control 系统借鉴了**云原生编排系统**（如 Kubernetes）的设计范式：

1. **环境注册 ≈ Node 注册**。Bridge 向控制面板注册自己能做什么、能跑几个会话。
2. **工作分派 ≈ Pod 调度**。后端把会话请求分派给有容量的 bridge。
3. **Worktree 隔离 ≈ 容器隔离**。每个会话在自己的 git worktree 里运行，不影响其他会话。
4. **心跳 ≈ 健康检查**。bridge 定期向后端发心跳，租约过期未续则视为失联。
5. **优雅关闭 ≈ Graceful shutdown**。Bridge 收到 SIGTERM 后会先走优雅关闭流程（停止接新 session、等进行中的 session 自然结束、清理 worktree）。"30 秒 grace period" 是参照 Kubernetes `terminationGracePeriodSeconds` 默认值给出的类比时长，本章未在源码中精确定位到该数字的常量——实际超时阈值由实现层决定，这里以"分钟级内"的通用"优雅关闭"理解即可，不要把 30s 当确凿的 bridge 源码常量。

但与 K8s 不同的是，这里的"节点"是用户的笔记本电脑，会休眠、断网、关机——因此需要额外的睡眠检测、OAuth 刷新、断线重连机制。

---

## 代码落点

- `src/bridge/types.ts`，第 1 行：`DEFAULT_SESSION_TIMEOUT_MS = 24h`
- `src/bridge/types.ts`，第 64-69 行：`SpawnMode` 三种模式定义
- `src/bridge/types.ts`，第 33-51 行：`WorkSecret` 完整结构
- `src/bridge/types.ts`，第 79 行：`BridgeWorkerType` 两种 worker 类型
- `src/bridge/types.ts`，第 133-176 行：`BridgeApiClient` 完整 API 接口
- `src/bridge/types.ts`，第 178-190 行：`SessionHandle` 会话句柄
- `src/bridge/bridgeMain.ts`，第 72-79 行：`DEFAULT_BACKOFF` 退避参数
- `src/bridge/bridgeMain.ts`，第 83 行：`SPAWN_SESSIONS_DEFAULT = 32`
- `src/bridge/bridgeMain.ts`，第 107-109 行：`pollSleepDetectionThresholdMs` 睡眠检测
- `src/bridge/bridgeMain.ts`，第 141 行：`runBridgeLoop` 主循环入口
- `src/bridge/bridgeEnabled.ts`，第 28-36 行：`isBridgeEnabled` 运行时 gate
- `src/bridge/bridgeEnabled.ts`，第 70-87 行：`getBridgeDisabledReason` 诊断消息
- `src/bridge/bridgeEnabled.ts`，第 126-130 行：`isEnvLessBridgeEnabled` v2 gate
- `src/bridge/bridgeEnabled.ts`，第 185-189 行：`getCcrAutoConnectDefault` 自动连接
- `src/bridge/bridgeEnabled.ts`，第 197-202 行：`isCcrMirrorEnabled` 镜像模式
- `src/bridge/bridgeConfig.ts`，第 18-48 行：OAuth token 和 base URL 解析
- `src/bridge/remoteBridgeCore.ts`，第 1-29 行：v2 env-less 架构注释
- `src/bridge/replBridgeTransport.ts`，第 14-21 行：v1/v2 传输区别注释
- `src/bridge/workSecret.ts`，第 6-32 行：`decodeWorkSecret` base64url 解码
- `src/bridge/workSecret.ts`，第 41-48 行：`buildSdkUrl` WebSocket URL 构建
- `src/bridge/workSecret.ts`，第 62-73 行：`sameSessionId` 跨前缀 ID 比较
- `src/bridge/sessionRunner.ts`，第 69-89 行：`TOOL_VERBS` 工具名→动词映射
- `src/bridge/sessionRunner.ts`，第 33-43 行：`PermissionRequest` 权限请求结构
- `src/bridge/bridgeMessaging.ts`，第 77-88 行：`isEligibleBridgeMessage` 消息过滤
- `src/bridge/initReplBridge.ts`，第 110 行：`initReplBridge` REPL bridge 入口
- `src/remote/RemoteSessionManager.ts`，第 95 行：`RemoteSessionManager` 远程会话管理器

---

## 局限性与批判

- **v1/v2 协议共存增加复杂度**：两套传输协议同时运行，由 GrowthBook flag 切换，意味着代码中维护着两条完整的连接路径，任何改动都需要双重测试
- **Session ID 跨前缀问题是技术债务**：`sameSessionId()` 的 hack 说明 v1/v2 基础设施的 ID 体系未统一，长期维护风险高
- **笔记本休眠场景脆弱**：虽然有睡眠检测（4 分钟阈值）和指数退避（上限 2 分钟、10 分钟后放弃），但长时间休眠（如过夜合盖）后 bridge 会越过 10 分钟放弃阈值进入彻底断连状态，用户往往需要手动重启 bridge 进程。此点源于对退避/放弃时间的组合推理，未单独从源码中找到一条"休眠后必须手动重启"的断言，属于基于退避上限的合理推断而非直接证据。

---

## 还可以追问的方向

1. **Direct Connect** (`server/` 目录)：另一种连接模式，可能面向 IDE 集成，与 Bridge 有何区别？
2. **QR Code 功能**：BridgeLogger 有 `toggleQr()` 方法，bridge 运行时可以扫码连接吗？
3. **CCR Mirror 模式**：纯出站事件转发（不接受入站控制）的具体应用场景是什么？
4. **多 Bridge 协调**：如果同一台机器注册了多个 bridge 实例，后端如何分派？
5. **Session 生命周期管理**：24 小时超时后的会话清理流程？worktree 残留的回收机制？

---

*质量自检：*
- [x] 覆盖：30+ 文件中的核心 11 个文件已在"代码落点"列出（与本节实际列出条目一一对应）
- [x] 忠实：所有常量、行号、GrowthBook gate 名称均来自源代码
- [x] 可读：用外卖平台类比建立"注册-接单-送餐"直觉
- [x] 一致：遵循 Q&A 章节标准结构
- [x] 批判：指出了 v1/v2 共存复杂度、session ID 历史债务
- [x] 可复用：SpawnMode 设计和睡眠检测机制可应用于任何长驻客户端服务
