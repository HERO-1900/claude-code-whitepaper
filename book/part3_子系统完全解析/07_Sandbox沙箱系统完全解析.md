# Sandbox 沙箱系统完全解析

沙箱是 Claude Code 的最后一道安全防线——即使 AI 决定执行一条恶意命令，沙箱也能限制它能造成的损害。系统采用三层架构（Tool 决策层、Adapter 配置转换层、Runtime 执行引擎层），在 macOS 上通过 seatbelt 限制进程能力，在 Linux 上通过 bubblewrap + seccomp 实现类似效果。本章将深入解析沙箱的决策逻辑、bare git repo 攻击防护、以及企业级域名和路径锁定能力。

> **源码位置**：`src/utils/sandbox/`、`src/entrypoints/sandbox/`

> 💡 **通俗理解**：沙箱就像银行的防弹玻璃柜台——你（AI）能和柜员（操作系统）交流、递送文件，但有物理隔离保护双方安全。即使有人企图抢劫（恶意命令），防弹玻璃会把损害限制在可控范围内。

### 🌍 行业背景：AI 编程工具的沙箱现状

沙箱并非 Claude Code 独创——它是 AI 编程工具处理"不可信代码执行"的行业共识方案，但各家实现路径差异显著：

- **GitHub Copilot Workspace**：在云端容器中执行代码，用户本地环境完全不受影响，代价是必须联网且无法操作本地文件系统。
- **Cursor**：默认不沙箱化命令执行，依赖用户审批（"Allow/Deny"弹窗）作为主要安全边界。沙箱能力较弱，更多依靠权限模型。
- **Aider**：完全不提供沙箱——它信任用户在自己的环境中运行，安全责任交给用户。适合高级开发者但企业场景风险高。
- **Codex（OpenAI）**：近期版本实现了 OS 级别的网络出口限制（OS-level egress rules），取代了早期脆弱的环境变量控制（具体版本号以官方 release notes 为准）。三级沙箱模式（suggest/auto-edit/full-auto）配合大比例 Rust 重写（具体比例以官方为准）带来的内存安全，与 Claude Code 的方案最为接近。
- **Windsurf（Codeium）**：采用云端执行 + 本地同步模式，沙箱在服务端实现，本地只是渲染层。
- **LangChain/LangGraph**：作为框架层不直接提供沙箱，但推荐用户通过 Docker 容器或 E2B（Code Interpreter SDK）实现隔离执行。

Claude Code 的独特之处在于**本地原生沙箱**——在用户自己的机器上通过 OS 级机制（macOS seatbelt / Linux bubblewrap+seccomp）实现隔离。这种方案的核心权衡将贯穿本章：

- **vs OS 级网络隔离方案（Codex）**：更低延迟、无需安装 Docker，但隔离强度弱于 Codex 的 OS-level egress rules
- **vs 云端沙箱（Copilot Workspace/Windsurf）**：离线可用、直接操作本地文件，但安全强度受限于用户机器的 OS 版本（服务商无法控制）
- **vs 无沙箱方案（Aider/Cursor）**：更强的安全兜底，但增加了跨平台能力不对称的工程复杂性

后续章节在分析每个关键机制时，会持续对比这些方案的不同选择。

---

## 概述

本章按以下顺序展开：第 1 节拆解三层架构（Tool→Adapter→Runtime）的职责边界；第 2 节详解沙箱策略格式与关键配置字段的安全含义；第 3 节深入分析 bare git repo 攻击防护链；第 4 节讲解企业级域名/路径锁定；第 5 节处理 Linux 平台的特殊问题；第 6 节分析设计取舍。

> ⚠️ **分析边界说明**：本章的主要分析对象是 Claude Code 开源/可反编译的 Adapter 层（`sandbox-adapter.ts`，985 行）和决策层（`shouldUseSandbox.ts`）。实际执行 OS 级隔离的 Runtime 层（`@anthropic-ai/sandbox-runtime`）是 Anthropic 的闭源 npm 包，我们无法直接审计其源码。对 Runtime 层的描述基于接口推断、依赖检查输出和 OS 沙箱原语的公开文档——这意味着本章对"沙箱实际隔离了什么"的分析存在不可避免的盲区。

---

> **[图表预留 3.7-A]**：三层架构图 — Tool 层（shouldUseSandbox 决策）→ Adapter 层（设置转换）→ Runtime 层（OS 沙箱执行）

> **[图表预留 3.7-B]**：Bare git repo 攻击流程 — 攻击者植入 HEAD/objects/refs → git 误认为 bare repo → 沙箱防护链

---

## 1. 三层架构

### 1.1 Tool 层（决策）

`shouldUseSandbox()`（`shouldUseSandbox.ts:130-153`，其中使用的 `excludedCommands` 辅助函数在同文件的 106-124 行定义，两个行号区间分别对应"主决策函数"和"辅助模式匹配"，不是同一段代码的两次引用）做出二元决策——这条命令是否要在沙箱中运行：

```
检查链：
1. SandboxManager.isSandboxingEnabled() = false → 不沙箱
2. dangerouslyDisableSandbox && unsandboxed 命令允许 → 不沙箱
3. 命令在 excludedCommands 中 → 不沙箱
4. 其他 → 沙箱
```

`excludedCommands` 的匹配支持三种模式（`shouldUseSandbox.ts:106-124`）：
- **精确匹配**：`git status`
- **前缀匹配**（带冒号）：`docker:` 匹配所有 `docker ...` 命令
- **通配符**：`npm run *`

但代码注释明确指出（`shouldUseSandbox.ts:19`）：

> 这**不是安全边界**——用户可以通过复合命令绕过

### 1.2 Adapter 层（配置转换）

`sandbox-adapter.ts`（985 行）是核心，负责将 Claude Code 的设置转换为 Runtime 可以理解的沙箱配置。

`convertToSandboxRuntimeConfig()`（`sandbox-adapter.ts:171-380`）处理：
- 网络限制：从 `allowedDomains` 构建域名白名单
- 文件系统限制：从 `allowWrite/denyWrite/denyRead/allowRead` 构建路径规则
- Unix socket 白名单（仅 macOS）
- 所有路径相对于设置文件位置解析（**相对路径以声明该路径的 settings 文件所在目录为基准**——例如 `projectSettings` 中的 `./build` 展开为 `<项目根>/build`，`userSettings` 中的 `./scratch` 展开为 `~/.claude/scratch`。绝对路径和 `~` 开头的路径按字面语义处理）

`ISandboxManager` 接口（`sandbox-adapter.ts:880-922`）定义了：
- `initialize()` — 一次性初始化
- `wrapWithSandbox()` — 命令包装
- `refreshConfig()` — Claude Code 接口层方法（触发重新读取配置并转换为 Runtime 所需格式）；底层调用 Runtime 包的 `BaseSandboxManager.updateConfig()` 完成实际配置更新。两套名字服务于不同的抽象层——Adapter 层用 "refresh" 强调"重新生成配置"，Runtime 层用 "update" 强调"应用新配置"

### 1.3 Runtime 层（执行引擎）

`@anthropic-ai/sandbox-runtime`（版本 `^0.0.44`）是 Anthropic 发布的**闭源 npm 包**，负责实际的 OS 级沙箱执行。Claude Code 只向它传递 `SandboxRuntimeConfig`（由 Adapter 层生成），不直接调用任何 OS 沙箱 API。这意味着整个分析链在最关键的安全执行环节存在断裂——对于一篇"完全解析"文章，这是必须显式声明的局限性。

**我们能确认的**：通过 Adapter 层的 import 语句和 `SandboxDependenciesTab` 组件的依赖检查逻辑，可以确定 Runtime 层的接口和依赖：

```
从 @anthropic-ai/sandbox-runtime 导入的类型/类：
- SandboxRuntimeConfig          ← Adapter 生成的配置对象
- SandboxManager (BaseSandboxManager) ← 核心管理类
  - .initialize(config, callback)     ← 一次性初始化
  - .wrapWithSandbox(cmd, shell, ...)  ← 命令包装（核心方法）
  - .updateConfig(config)             ← 动态配置更新
  - .checkDependencies()              ← 依赖检查
  - .isSupportedPlatform()            ← 平台支持检查
- SandboxViolationStore         ← 违规事件存储
- SandboxRuntimeConfigSchema    ← Zod 验证 Schema
```

**对 macOS 实现的推断**：依赖检查组件显示 macOS 的 seatbelt 被标注为"built-in (macOS)"，无需额外安装。Runtime 层很可能通过 `sandbox-exec -p <profile>` 启动子进程，其中 seatbelt profile（`.sb` 格式）根据 `SandboxRuntimeConfig` 中的网络/文件系统规则动态生成。seatbelt profile 使用 Scheme-like 的规则语法，例如：

```scheme
;; 推断的 seatbelt profile 结构（非实际源码）
(version 1)
(deny default)
(allow file-read* (subpath "/path/to/project"))
(allow file-write* (subpath "/path/to/project"))
(deny file-write* (literal "/path/to/settings.json"))
(allow network-outbound (remote tcp "*:443"))
```

**对 Linux 实现的推断**：依赖检查要求安装 bubblewrap (`bwrap`)、socat 和 seccomp filter。Runtime 层的 `wrapWithSandbox()` 很可能生成类似以下结构的 bwrap 命令：

```
bwrap \
  --ro-bind / /                     # 只读挂载根文件系统
  --bind /path/to/project /path/to/project  # 可写绑定项目目录
  --dev /dev                        # 设备目录
  --proc /proc                      # proc 文件系统
  --unshare-net                     # 网络命名空间隔离
  --seccomp <fd>                    # seccomp-bpf 过滤器
  -- /bin/bash -c "user command"
```

seccomp-bpf 过滤器用于拦截特定系统调用（如 `connect(2)` 用于网络控制、`socket(2)` 用于 Unix socket 限制），但**Linux seccomp 无法按路径过滤 Unix socket**（`sandboxTypes.ts:25-30` 注释明确指出）——这是两个平台的关键安全差异。socat 可能被用作网络代理层，配合域名白名单实现网络访问控制。

> ⚠️ **供应链信任问题**：将最关键的安全执行层外包给一个 npm 包，引入了供应链信任依赖。`@anthropic-ai/sandbox-runtime` 是否经过独立安全审计？版本更新机制如何？如果该包被 compromise，整个沙箱形同虚设。"Claude Code 只提供配置，不直接操作 OS 沙箱 API"从架构解耦角度是优点，但从安全审计角度意味着用户必须无条件信任这个黑盒。对比之下，Codex 使用 OS 级别的网络出口限制（OS-level egress rules）——这是操作系统原生的、经过广泛安全审计的机制，其信任基础远比私有 npm 包强。

### 1.4 seatbelt 的弃用风险

macOS 的 `sandbox-exec` 工具自 macOS Catalina 起已被 Apple 标记为 **deprecated**。Apple 的官方方向是 App Sandbox（基于 entitlements 的声明式沙箱），而非 seatbelt 的命令式 profile。这意味着：

1. **API 可能随时被移除**：在一个已弃用的 API 上构建"最后一道安全防线"，工程风险不容忽视。Apple 没有承诺 `sandbox-exec` 在未来 macOS 版本中继续可用。
2. **无官方工具链支持**：seatbelt profile 的 `.sb` 格式没有官方文档、没有调试工具、没有验证器。开发者只能依赖逆向工程和社区知识。
3. **与 SELinux 的类比有误导性**：SELinux 是 Linux 内核的 first-class 安全模块，有完整的策略语言（SEPolicy）、编译工具（`checkmodule`）、审计框架（`ausearch`）和 Red Hat/NSA 的长期支持承诺。seatbelt 是 Apple 已弃用的用户态工具，二者的工程成熟度完全不在同一水平。

> 💡 **通俗理解**：这就像把房子的防盗门装在一个"即将拆除"的墙上——门锁本身可能很好，但墙随时可能不在了。

Claude Code 的三层架构在这里体现出其设计远见：如果 Apple 真的移除 seatbelt，理论上只需要替换 Runtime 层的 macOS 实现（例如迁移到 Endpoint Security Framework 或 App Sandbox entitlements），Adapter 层不需要修改。但这种"可替换性"是否经过实际验证，仍是未知数。

> 📚 **课程关联（操作系统）**：理解这套系统需要掌握：进程能力（capabilities）、系统调用过滤（seccomp-bpf）、命名空间隔离（namespaces）——这些都是 OS 安全课程的核心内容。但要注意区分：Linux 上的 bubblewrap 使用的 namespaces + seccomp 是内核级的 first-class API，有长期的稳定性承诺；macOS 上的 seatbelt 是用户态工具层面的封装，底层的 Sandbox.kext 内核扩展虽然仍在运行，但用户态接口已不被支持。

## 2. 沙箱策略格式

### 2.1 SandboxSettings Schema

`sandboxTypes.ts:91-144` 定义了完整的沙箱设置：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 主开关 |
| `failIfUnavailable` | boolean | 沙箱不可用时是否硬失败（默认 `false`，即 fail-open） |
| `autoAllowBashIfSandboxed` | boolean | 沙箱内自动批准 Bash 调用（默认 `true`） |
| `allowUnsandboxedCommands` | boolean | 允许 `dangerouslyDisableSandbox` 参数（默认 `true`） |
| `enabledPlatforms` | Platform[] | 限制特定平台启用（未文档化） |

**`failIfUnavailable` 的 fail-open 默认值**：当沙箱不可用时（依赖缺失、平台不支持），默认行为是显示警告但继续执行命令（fail-open）。源码注释明确说明："When false (default), a warning is shown and commands run unsandboxed. Intended for managed-settings deployments that require sandboxing as a hard gate."（`sandboxTypes.ts:99-101`）。这意味着在未设置 `failIfUnavailable: true` 的环境中，如果 seatbelt/bwrap 因为任何原因无法启动，所有命令都会在无沙箱状态下运行——"最后一道安全防线"被静默绕过。企业部署**必须**显式设置 `failIfUnavailable: true` 才能获得 fail-closed 行为。

**`autoAllowBashIfSandboxed` 的信任模型深度分析**：

这个字段的默认值为 `true`（`sandbox-adapter.ts:471`：`return settings?.sandbox?.autoAllowBashIfSandboxed ?? true`），其工作机制是：当沙箱启用且此字段为 `true` 时，`bashToolHasPermission()` 在遍历完所有 deny/ask 规则后，如果没有匹配到任何显式规则，直接返回 `behavior: 'allow'`——跳过用户审批弹窗。

这实质上构建了一个**单点信任模型**（"传统模式"指关闭此字段、回退到 Claude Code 默认权限路径的情况，不是另一个独立产品的模式）：

```
传统模式（autoAllowBashIfSandboxed=false）：
  AI 决策 → 用户审批弹窗 → [沙箱] → OS 执行
                ↑ 两道防线

autoAllow 模式（autoAllowBashIfSandboxed=true，默认）：
  AI 决策 → [沙箱] → OS 执行
            ↑ 一道防线
```

安全含义：
1. **全部赌注押在沙箱完整性上**：如果沙箱存在逃逸漏洞（seatbelt 绕过、bwrap namespace 配置缺陷、seccomp 过滤不完整），攻击者不需要通过权限审批就能直接执行任意命令。用户审批这道"人工防线"被完全移除。
2. **与 Runtime 黑盒的矛盾**：我们无法审计 `@anthropic-ai/sandbox-runtime` 的实际隔离强度，但 `autoAllowBashIfSandboxed` 要求我们无条件信任它的完整性——这构成了分析上的矛盾。
3. **对比 Codex（OpenAI）**：Codex 的 full-auto 模式同样自动执行命令，且已实现 OS 级别的网络出口限制（OS-level egress rules），安全边界比 OS 原语沙箱更厚重。Claude Code 用更轻量的隔离换取更低的延迟和更好的体验——这是一个显式的安全-性能权衡。
4. **对比 Cursor**：Cursor 不提供沙箱但保留用户审批（Allow/Deny 弹窗）。Claude Code 的 `autoAllowBashIfSandboxed` 走了反方向——移除审批但加上沙箱。哪种模式更安全取决于你更信任人类判断还是技术隔离。

> 💡 **通俗理解**：这就像银行的安保策略——传统模式是"每笔交易都需要经理签字 + 防弹玻璃"，`autoAllowBashIfSandboxed` 模式是"取消经理签字，完全依赖防弹玻璃"。如果玻璃真的防弹，效率确实更高；但如果有人发现玻璃有裂缝，就没有第二道防线了。

### 2.2 网络配置

`sandboxTypes.ts:14-42`：

| 字段 | 说明 |
|------|------|
| `allowedDomains` | 允许的域名列表 |
| `allowManagedDomainsOnly` | 只尊重企业策略的域名 |
| `allowUnixSockets` | macOS only，允许的 Unix socket 路径 |
| `allowAllUnixSockets` | 允许所有 Unix socket |
| `allowLocalBinding` | 允许本地端口绑定 |
| `httpProxyPort` / `socksProxyPort` | 代理端口 |

**平台差异**（`sandboxTypes.ts:25-30` 注释）：Unix socket 路径过滤**只在 macOS 有效**——Linux seccomp 无法按路径过滤 socket。这是一个重要的安全差异。

### 2.3 文件系统配置

`sandboxTypes.ts:47-86`：

| 字段 | 说明 |
|------|------|
| `allowWrite` | 额外可写路径 |
| `denyWrite` | 保护不被写入的路径 |
| `denyRead` | 保护不被读取的路径 |
| `allowRead` | 覆盖 denyRead 的白名单 |
| `allowManagedReadPathsOnly` | 只使用企业策略的读路径 |

## 3. Bare Git Repo 攻击防护

这是沙箱系统中一个值得深入分析的安全机制——针对真实攻击向量的定向防护。

> 📚 **课程关联（软件工程/安全）**：Bare git repo 攻击是**供应链攻击**（supply chain attack）的一种变体——攻击者不直接攻击目标程序，而是通过操纵开发工具链（git）间接实现攻击。这类攻击在软件安全课程中属于"信任边界分析"（trust boundary analysis）范畴：Claude Code 信任 git 的输出，而 git 信任当前目录的文件结构，攻击者利用这条信任链实施攻击。

### 3.1 攻击向量

Git 的 `is_git_directory()` 会在当前目录看到 `HEAD` + `objects/` + `refs/` 时将其识别为 bare repo。完整的攻击路径如下：

```
攻击入口（prompt injection / 恶意仓库文件内容）
  → Claude 在沙箱内执行命令，在工作目录创建 HEAD/objects/refs/config 文件
  → config 中设置 core.fsmonitor = "恶意命令"
  → Claude 的后续 git 命令（可能在沙箱外执行）触发 fsmonitor
  → 恶意命令以用户权限执行（绕过沙箱）
```

关键在于：Claude 的某些 git 操作（如 `git status`、`git log`）可能不经过沙箱（在 `excludedCommands` 中或沙箱外执行）。攻击者利用的是**沙箱内命令的副作用影响沙箱外命令**这一信任链间隙。关联 issue `anthropics/claude-code#29316` 追踪了这个真实威胁。

### 3.2 防护策略

`sandbox-adapter.ts:256-279`，关联 issue `anthropics/claude-code#29316`：

```
检测 HEAD, objects, refs, hooks, config 是否存在：
  ├── 已存在 → denyWrite（只读绑定，防止修改）
  └── 不存在 → 加入 bareGitRepoScrubPaths（命令后清除）
```

### 3.3 命令后清除

`scrubBareGitRepoFiles()`（`sandbox-adapter.ts:403-413`）——沙箱命令执行后检查 `bareGitRepoScrubPaths` 中的路径，如果发现被植入的文件则删除。

这种"运行后清洁"策略在 AI Agent 安全中特别有价值。大多数沙箱系统是**预防型**的——在命令执行前设置隔离边界。但 AI Agent 的行为本质上不可完全预测——你无法提前知道 AI 会在文件系统中创建什么文件。`scrubBareGitRepoFiles()` 代表了一种**检测-响应型**安全策略，与预防型形成互补。源码实现（`sandbox-adapter.ts:404-413`）使用 `rmSync(p, { recursive: true })` 强制删除，并用 try-catch 静默处理 ENOENT（文件不存在是正常情况——说明攻击未发生）。

> **竞品对比**：Codex 通过 OS 级网络隔离和进程级沙箱天然限制了副作用范围。但 Claude Code 的本地 OS 原语沙箱没有容器化方案那种"一次性"特性，所以需要显式的清理逻辑。这是本地沙箱 vs 系统级隔离的一个具体权衡：系统级隔离在安全性上更完整，但启动延迟和环境要求（Rust 编译链）是 Claude Code 选择 OS 原语方案的关键原因。

### 3.4 Worktree 兼容

`sandbox-adapter.ts:282-287, 421-444`：
- 检测 `.git` 文件格式（非目录）识别 worktree
- 缓存主仓库路径（`initialize()` 时）
- 允许写入主仓库 `.git` 目录的 `index.lock`——否则 worktree 中无法 commit

## 4. 企业策略执行

> **竞品定位**：企业策略执行（域名白名单、读路径锁定）本质上是**企业就绪**（enterprise-ready）能力，而非沙箱技术创新——Jamf/Intune 等 MDM 工具每天在做同样的事情。Claude Code 的贡献在于将这些管控接口集成到 AI 编程工具的沙箱配置中，让企业管理员无需额外 MDM 部署就能控制 AI 的网络和文件访问。Cursor 的 allowlist/blocklist 也提供类似能力，但粒度更粗（整个工具级别而非命令级别）。

### 4.1 域名锁定

`shouldAllowManagedSandboxDomainsOnly()`（`sandbox-adapter.ts:148-156`）：当启用时，只有 `policySettings` 中的 `allowedDomains` 生效。用户/项目级的域名配置被忽略。

### 4.2 读路径锁定

`shouldAllowManagedReadPathsOnly()`（`sandbox-adapter.ts:159-163`）：只使用企业策略定义的读路径白名单。

### 4.3 策略锁检测

`areSandboxSettingsLockedByPolicy()`（`sandbox-adapter.ts:645-664`）：检测 `flagSettings` 或 `policySettings` 是否覆盖了本地设置。

### 4.4 平台限制（未文档化）

`sandbox-adapter.ts:496-526` 注释揭示了一个有趣的企业需求：

> **NVIDIA 企业部署**：`enabledPlatforms: ["macos"]` 在 macOS 启用沙箱（配合 `autoAllowBashIfSandboxed`），但在 Linux/WSL 禁用——因为不同平台的沙箱成熟度不同。

## 5. Linux 特殊处理

### 5.1 Glob 不支持

`sandbox-adapter.ts:597-642`：Bubblewrap 不支持 glob 文件系统规则。系统需要将 glob 展开为具体路径，并在无法展开时发出警告。

这揭示了两个平台沙箱配置生成逻辑的本质差异：macOS 的 seatbelt profile 可以使用静态模式（`(subpath "/path/to/dir")`，支持通配语义），而 Linux 的 bwrap 配置是**动态生成**的——依赖运行时文件系统状态来展开 glob 为具体路径列表。这种差异对可测试性和可审计性有直接影响：macOS 的沙箱配置是确定性的（相同设置 = 相同 profile），Linux 的沙箱配置是非确定性的（取决于运行时文件系统中有哪些文件匹配 glob）。

### 5.2 Git log HEAD 问题

`sandbox-adapter.ts:263-264` 注释：bwrap 内执行 `git log HEAD` 会报 "ambiguous argument"——因为 bwrap 的文件系统视图可能让 git 无法正确解析 HEAD。

## 6. 设计取舍与评价

### 6.1 核心架构决策：为什么选择 OS 原语而非容器化？

Claude Code 选择 seatbelt/bwrap 而非 Docker/Podman/Firecracker，这是整个沙箱系统最核心的架构决策。源码中没有显式记录决策理由，但从代码结构和注释可以推断：

| 维度 | OS 原语（Claude Code） | OS 级网络隔离（Codex） | 云端沙箱（Copilot Workspace） |
|------|----------------------|---------------------|---------------------------|
| 启动延迟 | 几乎零开销 | 较低（无容器启动开销）| 网络延迟（秒级） |
| 安装依赖 | macOS 内置；Linux 需 bwrap | 依赖 OS 网络栈（egress rules）| 无本地依赖 |
| 隔离强度 | 进程级（seatbelt/seccomp） | OS-level egress rules（网络出口限制，不使用 namespace 隔离）| VM 级（Firecracker） |
| 文件系统 | 直接访问宿主文件系统 | 直接访问宿主文件系统 | 需要文件同步 |
| 离线可用 | 是 | 是 | 否 |
| 安全审计 | Runtime 闭源 | OS 机制公开 | 不可审计 |

Claude Code 的选择优先考虑了**开发体验**——零启动延迟、无额外安装、直接操作本地文件。代价是隔离强度弱于容器方案，且安全强度受限于用户机器的 OS 版本和配置（服务商无法控制）。对比 E2B（AI Agent 沙箱的事实标准之一）使用的 Firecracker microVM + 预热快照方案，Claude Code 的方案在安全隔离深度上存在显著差距，但在本地开发场景的响应速度上有绝对优势。

### 6.2 优秀设计

1. **三层分离的可替换性**：这是安全工程的标准分层模式（类似 Docker 的 containerd→runc、浏览器的 content policy→sandbox→OS process），但 Claude Code 的实现质量较高。未来支持 Landlock（Linux 5.13+）理论上只需替换 Runtime 层。
2. **Bare git repo 的检测-响应型防护**：`scrubBareGitRepoFiles()` 的"运行后清洁"策略补充了预防型沙箱的盲区——这在 AI Agent 安全中是一个有创意的设计。
3. **Worktree 的"精确开孔"**：允许写入主仓库 `.git` 目录的 `index.lock` 体现了安全系统的关键品质——对合法工作流的精确理解。过度限制会导致用户关闭沙箱，这比沙箱漏洞更危险。类似 Docker 的 `--cap-add` 机制：不是粗暴地全开或全关，而是精确授予最小必要权限。
4. **`excludedCommands` 的 "NOT a security boundary" 注释**（`shouldUseSandbox.ts:19`）：在安全工程中，明确标注某个机制"不是安全边界"是一种重要的元安全实践——防止下游开发者和用户建立错误的安全假设。

### 6.3 代价与风险

1. **seatbelt 弃用风险**：macOS 的核心隔离机制基于 Apple 已弃用的 API（详见 1.4 节），这是一个无法通过代码修复的平台风险。
2. **平台安全不对称**：macOS seatbelt 和 Linux bwrap/seccomp 的能力不对等（Unix socket 路径过滤只在 macOS 有效）。用户可能错误地认为两个平台提供等价的安全保证。
3. **`autoAllowBashIfSandboxed` 的单点信任**：默认 `true` 将全部安全赌注押在沙箱完整性上（详见 2.1 节分析）。如果沙箱有逃逸漏洞，攻击者无需通过权限审批。
4. **Runtime 黑盒**：985 行的 Adapter 层可以审计，但真正执行隔离的 Runtime 层是闭源的——安全分析链在最关键的环节断裂。
5. **985 行适配器的职责问题**：一个"适配器"层有 985 行代码，承担了路径解析、策略合并、攻击防护、worktree 检测、glob 展开等多种职责，可能暗示 God Object 反模式。对比同类项目的沙箱配置代码量（如 Codex 的沙箱配置通常在百行以内），这个规模值得关注。
6. **Bare git repo 防护的模式匹配局限**：只处理已知的文件名模式（HEAD/objects/refs/hooks/config），新的攻击向量需要手动更新列表——这是基于签名的检测方式的固有弱点。

---

