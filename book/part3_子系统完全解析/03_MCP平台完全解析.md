# MCP 平台完全解析

MCP（Model Context Protocol）是 Claude Code 的外部能力扩展层——它让 AI 不再局限于本地文件和 bash 命令，而是能连接到任意外部服务（数据库、API、浏览器、Telegram 等）。27 个 TypeScript 文件构成了一个完整的连接管理平台，支持 4 种核心传输协议（"传输协议"即数据在两个程序之间传递的方式——就像信件可以走邮政、快递、电子邮件等不同渠道）及 4 种部署变体、8 种配置来源、手机端权限审批中继。本章将解析从配置合并到 Channel Permission Relay（远程权限审批中继——让你可以在手机上批准电脑端的操作请求）的完整链路。

> **源码位置**：`src/services/mcp/`（23 个文件）+ `src/tools/MCPTool/`（4 个文件）= 27 个 TypeScript 文件

> **分析范围说明**：27 个文件中，本章深度解读了 6 个核心文件（`config.ts`、`channelPermissions.ts`、`officialRegistry.ts`、`envExpansion.ts`、`types.ts`、`client.ts`），对其余文件做架构级概述。OAuth 认证流程（`auth.ts`、`oauthPort.ts`）、企业 SSO 集成（`xaa.ts`、`xaaIdpLogin.ts`）等子系统因篇幅限制仅做简要介绍。如需了解完整的 OAuth/XAA 实现细节，建议直接阅读对应源码。

> 💡 **通俗理解**：MCP 就像 USB 转接口或万能充电头——Claude 只有一个标准接口（MCP 协议），但通过不同的"转接头"（MCP 服务器），可以连接到数据库、浏览器、Telegram 等任何外部服务，即插即用。

> 🌍 **行业背景**：AI 工具的外部能力扩展是当前行业竞争的焦点之一。**LangChain** 最早通过"Tools"和"Agents"抽象实现了 LLM 调用外部服务的标准化，但它是 Python 库级别的方案，不涉及进程间通信协议。**OpenAI** 的 Function Calling 是 API 层面的能力，让模型声明需要调用哪个函数，但具体执行逻辑完全由客户端自行实现——架构哲学与 MCP 有根本差异：Function Calling 是"客户端内联模型"（能力在调用方代码中），MCP 是"客户端-服务器模型"（能力在独立进程中），这决定了两者在安全模型、性能特征、调试体验上的根本不同。**GitHub Copilot Extensions** 允许第三方通过 GitHub App 注册能力，但走的是 GitHub 自有平台而非开放协议。MCP（Model Context Protocol）是 Anthropic 于 2024 年底推出的开放协议，目标是成为 AI 工具连接外部服务的通用标准——类似于 USB 统一了外设接口，其设计明显借鉴了 VS Code 的 Language Server Protocol（LSP）理念：标准化的客户端-服务器协议、stdio/HTTP 传输、能力协商机制。Claude Code 的 MCP 实现是目前功能最完整的参考客户端之一。但 MCP 协议本身仍在快速迭代（截至 2025 年还在添加 Streamable HTTP 等新传输），生态成熟度不及 OpenAI Function Calling。关于 Claude Code 与其他 MCP 客户端实现的详细对比，见本章第 10 节。

---

## 概述

MCP（Model Context Protocol）是 Claude Code 的外部能力扩展层——它让 Claude 不仅能读写本地文件、执行 bash 命令，还能连接到任意外部服务（数据库、API、浏览器、甚至 Telegram 频道）。底层是 27 个 TypeScript 文件组成的完整连接管理平台，支持 4 种核心传输协议（及 4 种部署变体）、8 种配置来源、权限中继到手机、以及 Anthropic 官方 MCP 注册中心。

---

> **[图表预留 3.3-A]**：架构图 — 4 种核心传输协议 + 4 种部署变体的选择逻辑和适用场景

> **[图表预留 3.3-B]**：数据流图 — Channel Permission Relay 的完整链路（终端权限请求 → channel server → Telegram 消息 → 用户回复 → 解析 → resolve）

---

## 1. 配置系统：8 种来源的合并

### 1.1 配置层级

MCP 服务器配置来自 8 个不同的来源（`config.ts:69-81` `addScopeToServers()`），每个带有 `scope`（作用域）标记——"scope"表示"这条配置是谁设的"，就像一个通知可能来自公司总部、部门经理或你自己，来源不同优先级也不同：

| 来源 | Scope | 优先级 | 说明 |
|------|-------|--------|------|
| enterprise | `policy` | 最高 | 企业策略（managed-mcp.json） |
| flag | `flag` | 高 | GrowthBook 远程配置 |
| user | `user` | 中高 | 用户全局设置（~/.claude/settings.json） |
| project | `project` | 中 | 项目设置（.claude/settings.json） |
| local | `local` | 中低 | 本地 .mcp.json 文件 |
| CLI | `cli` | 低 | 命令行参数 --mcp-config |
| claudeai | `claudeai` | 低 | claude.ai 的 MCP 连接器 |
| managed | `managed` | 最低 | 托管 MCP 文件 |

### 1.2 CCR 代理 URL 重写

> 💡 **名词解释**：**CCR**（Claude Code Remote）是 Anthropic 的远程运行环境——让你可以在云端服务器上运行 Claude Code，而不是只在自己电脑上。当通过 CCR 远程使用时，外部服务的连接地址需要被"改写"，让数据经过 Anthropic 的安全代理中转，而不是直连。

远程会话（通过 Bridge）中，claude.ai 的 MCP 连接器 URL 会被重写为通过 CCR/session-ingress 代理路由（`config.ts:171-193`）：

```typescript
const CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/ccr-sessions/',
]
```

`unwrapCcrProxyUrl()`（"解包 CCR 代理地址"）从代理地址中提取出真正的原始服务地址——打个比方，你的快递被转发到公司前台代收，这个函数就是从前台的收件记录里找出快递的真正寄件地址。这样系统就能识别出"经代理转发"和"直接连接"其实指向同一个服务。

### 1.3 原子文件写入

> 💡 **为什么需要这个设计？** 想象你正在 Word 里写论文，突然断电了。如果 Word 直接在原文件上修改，断电可能导致文件写了一半——打开后发现论文损坏了。解决办法是：先把修改后的内容写到一个临时文件里，确认写完后，再用这个临时文件"一步替换"原文件。这个"一步替换"的动作要么完全成功、要么完全不做，不会出现"半成品"——这就是"原子"的含义（像原子一样不可分割）。

> 📚 **课程关联**：这里的 write-temp-then-rename 模式是 **操作系统**课程中"崩溃一致性（Crash Consistency）"问题的经典解法——**copy-on-write（写时复制）+ POSIX 原子替换**。核心思路是：不直接修改原文件，而是先写一份完整的新副本，确认持久化后，通过 `rename()` 原子替换旧文件。POSIX 标准保证同一文件系统上的 `rename()` 是原子操作。需要注意，这**不是**预写日志（WAL）或 journaling 机制——WAL 的核心是"先写日志再写数据"，支持事务回滚和重放；而 write-temp-then-rename 没有日志、没有重放能力，是一种纯粹的替换语义。vim、Docker、systemd 等工具都采用相同模式保护配置文件完整性，这是工程中的标准可靠性实践。

`writeMcpjsonFile()`（`config.ts:88-131`）使用 **write-to-temp + datasync + rename** 模式保证原子性：

```
1. 读取原文件权限 (stat → mode)
2. 写入临时文件 (mcpJsonPath.tmp.PID.timestamp)
3. datasync() — 确保数据刷到磁盘
4. chmod 恢复原权限
5. rename — 原子替换
6. 失败时清理临时文件
```

这防止了写入过程中断（断电、crash）导致的 .mcp.json 损坏。

## 2. 传输层：4 种核心协议 + 4 种部署变体

### 2.1 传输类型分类

Claude Code 的 `types.ts` 定义了 8 种传输配置类型，但从网络协议层面看，**核心传输协议是 4 种**，其余是部署变体或环境适配：

**4 种核心传输协议：**

| 类型 | 协议 | 适用场景 | 来源 |
|------|------|----------|------|
| `stdio` | 子进程标准输入/输出（程序间最原始的"对话"方式） | 本地 MCP 服务器（最常见） | MCP 协议最初设计 |
| `sse` | HTTP 服务器推送事件（服务器单向给客户端"发通知"） | 远程 HTTP MCP 服务器 | MCP 早期 HTTP 方案（遗留） |
| `http` | 流式 HTTP（增强版 HTTP，支持边处理边返回结果） | 现代 HTTP MCP（支持流式） | MCP 后续替代方案 |
| `ws` | WebSocket（双向实时通信，像打电话而非寄信） | 全双工 WebSocket MCP 服务器 | 社区需求推动 |

**4 种部署变体/环境适配：**

| 类型 | 基于 | 差异 | 适用场景 |
|------|------|------|----------|
| `sse-ide` | SSE | 加 IDE 宿主环境适配层（`ideName`） | VS Code/JetBrains 扩展 |
| `ws-ide` | WebSocket | 加 IDE 宿主环境适配层（`authToken`） | IDE 扩展（WebSocket 版） |
| `sdk` | 进程内调用 | `SdkControlTransport`，无网络通信 | 同进程 SDK 控制 |
| `claudeai-proxy` | HTTP | 带 `ClaudeAuthProvider` 认证 | claude.ai 代理的 MCP |

> 💡 **通俗理解**：核心协议就像 4 种基本运输方式（公路/铁路/水运/航空），部署变体是同一运输方式的不同包装——比如"铁路"可以是普通列车或高铁专线，本质上走同一条轨道。`sse-ide` 和 `ws-ide` 不是新的网络协议，而是 SSE/WebSocket 加了 IDE 环境信息（如编辑器名称、认证 token）。`sdk` 甚至不涉及网络通信——它是进程内函数调用。

**为什么需要这么多变体？** 这主要是 MCP 协议自身演进的结果。stdio 是最初的本地方案，SSE 是第一个远程方案，Streamable HTTP 是对 SSE 的改进替代，WebSocket 是社区推动的补充。Claude Code 作为 Anthropic 自家的参考客户端，支持所有传输类型是协议兼容性的要求——类似于 Chrome 支持所有 Web 标准。真正值得关注的工程决策是：如何在 8 种配置类型之间做选择路由（`client.ts` 中的连接逻辑），以及 IDE 变体如何处理宿主环境差异。

**如果你要实现自己的 MCP 客户端**，最低要求是支持 `stdio`（本地服务器必需）和 `http`（远程服务器的现代标准）。`sse` 仍有大量存量服务器使用，建议也支持。`ws` 和 IDE 变体可按需添加。

### 2.2 连接状态机

5 种状态：

```
disconnected → connecting → connected
                         → error
connected → needs-auth（McpAuthError 时转入）
```

`connected` 状态携带三类信息：`capabilities`（"这个服务器能做什么"的能力声明）、`tools`（具体可调用的工具列表）、`resources`（可访问的数据资源列表）。

## 3. Channel Permission Relay——从终端到手机的权限审批

这是 MCP 子系统中设计最精巧的功能之一。

### 3.1 问题场景

你在公司笔记本上运行 Claude Code（通过 Bridge 远程模式），但人在外面拿着手机。Claude 需要执行一个 `rm` 命令，需要你审批。怎么办？

### 3.2 解决方案

通过 MCP channel 服务器（如 Telegram 插件），权限请求被中继到你的手机：

```
Claude 执行敏感工具 → 权限请求弹窗
  → channelPermissions 检测到活跃 channel
  → 通过 MCP 发送权限提示到 Telegram
  → 用户在 Telegram 回复 "yes tbxkq"
  → Channel server 解析回复 → 发出 notifications/claude/channel/permission 事件
  → CC resolve() 匹配 request_id → 工具执行继续
```

### 3.3 5 字母 ID 系统

> 📚 **课程关联**：5 字母 ID 的设计涉及**计算机网络**课程中的多个概念。25^5 ≈ 980 万的空间大小和生日碰撞分析来自**密码学**的生日攻击理论。去掉易混淆字符'l'借鉴了 Base32/Crockford's Base32 编码的设计哲学。FNV-1a hash 用于脏话过滤则是**数据结构**课程中散列函数的实际应用——选择 FNV-1a 而非 MD5/SHA 是因为它计算极快且分布均匀，适合这种不需要密码学安全性的场景。

权限请求通过一个 5 字母的短 ID 确认（`channelPermissions.ts:75-152`）：

```typescript
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
```

设计细节：
- **25 字母表**（a-z 去掉 'l'）：'l' 在很多字体中和 '1'/'I' 难以区分
- **25^5 ≈ 980 万空间**：生日碰撞 50% 需要约 3000 个同时 pending 的请求，对单个会话来说不可能
- **纯字母**：手机用户不需要切换键盘模式（hex 会需要在字母和数字间切换）
- **脏话过滤**：5 个随机字母可能拼出不雅词（`channelPermissions.ts:85-110` 列出了 24 个屏蔽词），如果 FNV-1a hash 命中屏蔽词，用 salt 重新 hash（最多 10 次重试）

代码注释中 Kenneth（可能是安全团队成员）的原话：

> "this is why i bias to numbers, hard to have anything worse than 80085"

### 3.4 安全模型

注释中记录了一个关键的安全讨论（`channelPermissions.ts:14-24`）：

> **Kenneth 的问题："Would this let Claude self-approve?"**
> 
> 回答：批准方是通过 channel 的**人类**，不是 Claude。但信任边界不是终端——是 allowlist（`tengu_harbor_ledger`）。一个被入侵的 channel server **可以**伪造 "yes \<id\>" 而用户看不到提示。
> 
> **接受的风险**：一个被入侵的 channel 已经拥有无限的对话注入能力（社工攻击、等待 acceptEdits 等）。inject-then-self-approve 更快，但不是更强大。权限对话减慢了入侵者，但不能阻止他们。

### 3.5 GrowthBook Gates

| Gate | 功能 |
|------|------|
| `tengu_harbor` | Channels 总开关（默认 false） |
| `tengu_harbor_ledger` | Channel 插件白名单（{marketplace, plugin} 对） |
| `tengu_harbor_permissions` | Permission relay 开关（默认 false，与 channels 独立） |

注释解释了为什么 permission relay 有独立的 gate：

> Kenneth: "no bake time if it goes out tomorrow"

意思是 channel 功能和 permission relay 可以独立灰度发布，不需要同步上线。

## 4. 官方 MCP 注册中心

`officialRegistry.ts`（73 行）实现了对 Anthropic 官方 MCP 注册中心的查询：

```typescript
// officialRegistry.ts:39-40
const response = await axios.get<RegistryResponse>(
  'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
  { timeout: 5000 },
)
```

- **fire-and-forget**：启动时异步预取，不阻塞应用启动
- **fail-closed**：如果注册中心不可用，`isOfficialMcpUrl()` 返回 false
- **URL 归一化**：去除查询字符串和尾部斜杠后做 Set 查找
- **可禁用**：`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 环境变量跳过

## 5. 环境变量展开

`envExpansion.ts` 处理 MCP 配置中的环境变量引用（`${VAR}` 语法）。这让用户可以在 .mcp.json 中写：

```json
{
  "myServer": {
    "command": "npx",
    "args": ["-y", "my-mcp-server"],
    "env": {
      "API_KEY": "${MY_API_KEY}"
    }
  }
}
```

而不需要把密钥硬编码在配置文件中。

## 6. 其他关键文件

| 文件 | 职责 |
|------|------|
| `auth.ts` | OAuth 认证流程 |
| `oauthPort.ts` | OAuth 回调端口管理 |
| `xaa.ts` + `xaaIdpLogin.ts` | 企业 SSO/IdP 登录子系统（XAA 的具体含义源码未给出明确注释，本章不做推测，以官方仓库命名约定为准） |
| `elicitationHandler.ts` | MCP 服务器向用户请求信息的处理 |
| `channelNotification.ts` | Channel 通知分发 |
| `normalization.ts` | 工具名/服务器名归一化 |
| `mcpStringUtils.ts` | 字符串工具函数 |
| `InProcessTransport.ts` | 同进程 MCP 传输（测试用） |
| `SdkControlTransport.ts` | SDK 控制传输 |
| `vscodeSdkMcp.ts` | VS Code 集成专用 |
| `claudeai.ts` | claude.ai MCP 配置获取 |

## 7. 安全分析

### 7.1 多层防护

1. **配置来源验证**：每个 MCP 配置带 scope 标记，enterprise 来源拥有排他性控制权（存在 enterprise 配置时，其他所有来源被忽略）
2. **策略过滤**：`isMcpServerAllowedByPolicy()` 在配置合并后统一过滤，企业可通过 allowlist 精确控制可用的 MCP 服务器
3. **Channel 白名单**：`tengu_harbor_ledger` 控制哪些插件可以做 channel
4. **Permission relay 独立开关**：channel 能力不自动获得 permission relay 能力
5. **5 字母 ID 防误操作**：纯字母 + 脏话过滤 + 足够大的空间
6. **官方注册中心验证**：`isOfficialMcpUrl()` 区分官方和第三方 MCP 服务器
7. **原子文件写入**：.mcp.json 不会因崩溃而损坏（但这是可靠性保障，不是安全防护）

### 7.2 已知风险

1. **被入侵的 channel 可以伪造审批**（代码注释明确承认）
2. **stdio 传输运行用户指定的命令**——如果 .mcp.json 被恶意 PR 修改，可能运行恶意代码。这是 MCP 最常见的使用场景（本地 stdio 服务器），也是攻击面最大的传输方式。Claude Code 对此的缓解措施包括：项目级 MCP 配置（`project` scope）需要用户显式 approve 才会加载（`getProjectMcpServerStatus(name) === 'approved'`），但这依赖用户的判断能力
3. **URL 重写**：CCR 代理 URL 的 `mcp_url` 参数可能被伪造（需要服务端验证）

### 7.3 供应链安全：MCP 生态最大的未解难题

> 💡 **通俗理解**：MCP 服务器就像手机上的第三方 App——你授权它访问你的通讯录、照片、位置，它就真的能读取这些数据。如果 App Store 里混入了恶意 App，后果可想而知。MCP 生态面临的正是这个问题，而目前的"App Store"（注册中心）还处于非常早期的阶段。

MCP 服务器本质上是**第三方代码**——通过 stdio 传输时，它们以子进程形式直接运行在用户机器上，拥有与用户相同的文件系统访问权限。随着 MCP 生态的快速扩张（社区已涌现大量 MCP 服务器，规模以官方注册中心与主要聚合站点公布数据为准），供应链攻击已成为最现实的安全威胁，类似于 npm/PyPI 生态曾经历的恶意包问题。

**已知的真实攻击案例：**

- **CVE-2025-6514（mcp-remote）**：`mcp-remote` 包存在高危漏洞（CVE 编号与 CVSS 评级以 NVD/厂商公告为准，公开报道提及下载量在数十万量级、CVSS 约 9 分段），攻击者可通过恶意 OAuth 端点实现远程代码执行——被若干安全社区描述为首个针对 MCP 客户端的公开 RCE 案例
- **恶意 MCP 服务器窃取数据**：伪装成合法自动化工具的恶意 MCP 服务器被发现在后台转发企业邮件，其恶意行为与正常服务器操作难以区分
- **Smithery.ai 路径穿越**：MCP 服务器托管平台的构建管道存在路径穿越漏洞，可能影响其所托管的大量服务器的认证 token（具体规模以平台官方披露为准）

**Claude Code 的缓解措施与局限：**

| 措施 | 作用 | 局限 |
|------|------|------|
| `isOfficialMcpUrl()` 官方注册中心 | 区分"官方"和"非官方" | 非官方服务器仍可正常连接使用；无法保证非官方服务器的安全性 |
| 项目 MCP 需用户 approve | 防止恶意 PR 自动添加 MCP | 依赖用户审查能力；用户可能习惯性点"approve" |
| 企业策略 allowlist | 企业锁定可用服务器列表 | 仅限企业版；个人用户无此保护 |
| `isMcpServerAllowedByPolicy()` | 策略级过滤 | 只检查服务器名/URL/命令，不检查服务器行为 |

**关键缺口**：Claude Code 目前没有对 stdio 启动的子进程做沙箱隔离（如 seccomp、AppArmor），也没有命令白名单机制。MCP 服务器一旦启动，与用户拥有相同的系统权限。官方注册中心的 fail-closed 行为（不可用时返回 false）只是少了一个"官方认证"标记，不会阻止非官方服务器的连接——从安全角度看，这实际上更接近 fail-open 行为。

**对从业者的建议**：在 MCP 生态的当前阶段，建议（1）仅使用来源可信的 MCP 服务器，（2）对 stdio 类型的 MCP 服务器审查其 `command` 和 `args` 配置，（3）企业环境中务必使用 enterprise 策略锁定可用服务器列表，（4）关注 `mcp-remote` 等桥接工具的安全更新。

## 8. GrowthBook Gates 汇总

| Gate | 功能 | 默认值 |
|------|------|--------|
| `tengu_harbor` | Channels 总开关 | false |
| `tengu_harbor_ledger` | Channel 白名单 | [] |
| `tengu_harbor_permissions` | Permission relay | false |

代号 `harbor`（港口）——channel 是"停靠在港口的船"？

## 9. 配置合并策略：冲突如何解决

> **与 §1.1 的关系**：§1.1 列出的是**所有 8 种来源**（enterprise / flag / user / project / local / CLI / claudeai / managed），本节聚焦 `getClaudeCodeMcpConfigs()` 在普通（非企业、非远程）路径下实际参与合并的子集——plugin/user/project/local——并说明 enterprise 的排他性控制如何跳过该合并。两处 local 的"优先级"提法视角不同：§1.1 按"规模/治理权威"排，local 属于偏本地级所以位列中下；本节按"last-write-wins 的覆盖顺序"排，local 是最后写入所以覆盖其他三者。为避免混淆，请以本节源码逻辑为准。

源码中配置合并的实际逻辑值得关注。`getClaudeCodeMcpConfigs()` 使用 `Object.assign()` 按以下顺序合并（后者覆盖前者）：

```
plugin（先写，易被覆盖） → user → project(approved) → local（最后写，覆盖前述三者）
```

这意味着**同名 MCP 服务器以 `local`（.mcp.json）为准**，是 last-write-wins 的整体覆盖（不是字段级合并）。

**enterprise 是特殊情况**：如果存在企业配置（`doesEnterpriseMcpConfigExist()`），其他所有来源直接被忽略——enterprise 不是"优先级最高"，而是"排他性控制"。

> 💡 **通俗理解**：想象一个公司的 WiFi 设置——如果 IT 部门锁定了网络配置（enterprise），你自己设的代理（user/project/local）全部失效。如果没有 IT 锁定，则离你最近的配置生效：办公室桌上贴的纸条（local）> 项目文档里写的（project）> 你个人习惯（user）> 系统默认（plugin）。

这对企业部署场景有重要影响：企业策略中定义了一个 MCP 服务器后，用户**无法**通过低优先级配置添加额外参数来扩展它——因为整个配置是整体替换，不做字段级 merge。

## 10. 竞品对比：MCP 客户端实现横评

作为 MCP 协议的实现解析，仅看 Claude Code 一家是不够的。以下对比截至 2026 年初的主要 MCP 客户端实现，帮助读者理解 Claude Code 在 MCP 生态中的定位。MCP 已被誉为"AI 工具界的 USB-C"，竞争焦点已从"是否支持 MCP"转移至"MCP 注册表生态的繁荣度"及"复杂的权限治理"——GitHub Copilot 的企业级 MCP 注册表机制是这一趋势的典型代表。

### 10.1 传输协议支持对比

| MCP 客户端 | stdio | SSE | Streamable HTTP | WebSocket | IDE 变体 | 其他 |
|-----------|-------|-----|-----------------|-----------|----------|------|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | sse-ide, ws-ide | sdk, claudeai-proxy |
| **Cursor** | ✅ | ✅ | ✅ | ❌ | — | — |
| **Zed** | ✅ | ❌（需 mcp-remote 桥接） | ❌（原生不支持） | ❌ | — | — |
| **Cline** (VS Code) | ✅ | ✅ | ✅ | ❌ | — | — |
| **Continue** | ✅ | ✅ | ✅ | ❌ | — | — |
| **VS Code Copilot** | ✅ | ✅ | ✅ | ❌ | — | — |

**分析**：Claude Code 在传输协议覆盖面上确实领先，是唯一原生支持 WebSocket 的主流 MCP 客户端。但这种"领先"需要辩证看待——大多数 MCP 服务器使用 stdio 或 Streamable HTTP，WebSocket 的实际使用率很低。真正有意义的差异是 IDE 变体（`sse-ide`/`ws-ide`）和 `claudeai-proxy`，这些是 Anthropic 产品矩阵（VS Code 扩展、claude.ai）整合的需要，而非通用 MCP 客户端的需求。

Zed 的策略值得注意：它只原生支持 stdio，远程 MCP 通过 `mcp-remote` 桥接工具间接支持。这是一种"最小实现"策略——用一个通用桥接层替代多种传输协议的原生支持。优点是代码简单，缺点是多了一层间接性和 `mcp-remote` 自身的安全风险（见 7.3 节 CVE-2025-6514）。

### 10.2 配置系统对比

| MCP 客户端 | 配置层级 | 企业策略 | 远程配置 | 动态配置 |
|-----------|---------|---------|---------|---------|
| **Claude Code** | 8 层（enterprise/flag/user/project/local/CLI/claudeai/managed） | ✅ 排他性控制 | ✅ GrowthBook + claude.ai | ✅ plugin 系统 |
| **Cursor** | 2 层（全局 ~/.cursor/mcp.json + 项目 .cursor/mcp.json） | ❌ | ❌ | ❌ |
| **Zed** | 2 层（全局 settings.json + 项目 settings.json） | ❌ | ❌ | ✅ 扩展系统 |
| **Cline** | 1 层（VS Code 设置 / cline_mcp_settings.json） | ❌ | ❌ | ❌ |
| **Continue** | 1 层（config.yaml） | ❌ | ❌ | ❌ |

**分析**：Claude Code 的 8 层配置系统是所有 MCP 客户端中最复杂的，这不一定是优点。8 层配置解决的核心问题是**企业部署**——企业需要能在不修改用户配置的前提下注入或禁止某些 MCP 服务器。Cursor、Zed 等面向个人开发者的工具不需要这种复杂度。Claude Code 配置系统的真正创新在于 enterprise 的排他性控制和 plugin 去重机制（通过 URL 签名去重避免重复的 MCP 连接），而非"8 种"这个数字本身。

### 10.3 权限模型对比

| MCP 客户端 | 工具调用审批 | 远程审批 | 沙箱隔离 |
|-----------|------------|---------|---------|
| **Claude Code** | ✅ 每次工具调用需用户确认 | ✅ Channel Permission Relay（手机审批） | ❌ 无进程沙箱 |
| **Cursor** | ✅ 工具调用需确认 | ❌ | ❌ |
| **Cline** | ✅ 工具调用需确认 + auto-approve 选项 | ❌ | ❌ |
| **Zed** | ✅ 工具调用需确认 | ❌ | ❌ |

**分析**：Channel Permission Relay 是 Claude Code 独有的功能，也是唯一试图解决"人不在电脑前但需要审批"场景的方案。这在远程 Bridge 模式下特别有价值。其他所有 MCP 客户端都假设用户在本地操作，权限请求只能通过 IDE 内弹窗审批。

### 10.4 历史类比：LSP 的启示

MCP 的协议设计明显借鉴了 VS Code 的 Language Server Protocol（LSP）：标准化的客户端-服务器协议、stdio/HTTP 传输选项、能力协商（capabilities negotiation）。LSP 从 2016 年到现在的演进历史对预测 MCP 生态的发展有参考价值：

- **协议碎片化**：LSP 从最初的文本同步和代码补全，逐步添加了数十种能力（重命名、代码操作、内联提示等），导致不同 LSP 服务器实现的完备程度差异很大。MCP 正在走同样的路——从最初的 Tools 能力扩展到 Resources、Prompts、Sampling、Elicitation，协议版本碎片化已经出现（Zed 尚未支持 2025-06-18 版本）
- **服务器质量参差不齐**：LSP 生态中，Go 的 gopls 和 Rust 的 rust-analyzer 质量极高，而一些小众语言的 LSP 服务器长期处于半成品状态。MCP 服务器生态已经出现同样的分化
- **安全模型后补**：LSP 最初几乎没有安全考虑（服务器是可信的本地进程），后来才逐步添加沙箱和权限机制。MCP 面临更严峻的安全挑战——MCP 服务器可能是远程的、不可信的，且拥有比 LSP 服务器更大的能力范围

## 11. 设计取舍与评价

**优秀**：
1. 4 种核心传输协议 + 4 种部署变体覆盖了所有实际的 MCP 部署场景，传输协议覆盖面在主流 MCP 客户端中最广
2. Channel Permission Relay 是"远程审批"问题的优雅解决方案，也是当前所有 MCP 客户端中唯一的远程权限中继实现
3. 5 字母 ID 系统在安全性（25^5 空间）、可用性（纯字母）、礼貌性（脏话过滤）之间取得了平衡
4. 配置系统的企业排他性控制（而非简单的优先级覆盖）是面向企业部署的成熟设计
5. 官方注册中心提供"官方 vs 第三方"的区分能力，是供应链安全的第一步

**代价**：
1. 27 个文件的复杂度——MCP 子系统可能是 Claude Code 中文件数最多的子系统之一
2. Channel permission 的安全模型承认了"被入侵 channel 可以自动审批"的风险
3. 8 种配置来源的合并逻辑可能导致调试困难（"这个 MCP 服务器是从哪个来源加载的？"），且 Object.assign 的整体覆盖语义意味着配置冲突时用户可能无感知地丢失低优先级配置
4. `xaa` 相关文件暗示企业 SSO 集成仍在早期阶段
5. 缺少对 stdio 子进程的沙箱隔离，是当前最大的安全短板

---

*质量自检：*
- [x] 覆盖：27 个文件中的核心 6 个深读，其余做架构级概述；明确标注了分析范围和未深入的子系统（OAuth/XAA）
- [x] 忠实：所有 gate 名称、ID 算法、注释引用、配置合并逻辑均来自源代码；传输协议分类已区分核心协议与部署变体
- [x] 深度：Channel Permission Relay 完整链路、供应链安全分析、配置合并策略的冲突解决
- [x] 批判：指出了 channel 伪造风险、配置来源复杂度、stdio 无沙箱隔离、供应链安全缺口
- [x] 竞品对比：与 Cursor/Zed/Cline/Continue 在传输、配置、权限模型三个维度做了具体对比
- [x] 可复用：5 字母 ID 系统、原子文件写入模式、LSP 类比可广泛应用
