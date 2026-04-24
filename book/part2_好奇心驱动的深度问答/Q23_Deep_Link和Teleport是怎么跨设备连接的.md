# Deep Link 和 Teleport 是怎么跨设备连接的？

从浏览器点一个链接就能打开终端里的 Claude Code，或者把本地代码"传送"到云端沙箱让远程 AI 工作——这两个跨边界的"传送"功能，解决的核心问题是如何安全地跨越信任边界传递意图。本章拆解 Deep Link 的 URI 安全验证、三平台协议注册、12 种终端适配，以及 Teleport 的 Git Bundle 三级降级策略。

> 💡 **通俗理解**：就像 AirDrop——在不同设备之间无缝传递会话。

> 🌍 **行业背景**：Deep Link（从浏览器唤起本地应用）是移动端的成熟技术，但在 CLI 开发工具中很少见。**VS Code** 支持 `vscode://` 协议打开文件和安装扩展，**JetBrains Toolbox** 支持 `jetbrains://` 协议打开项目，这些是桌面 IDE 中最接近的先例。**Cursor**（一款基于 VS Code 源码分支构建的 AI 编辑器）继承了 `vscode://` 机制。**Windsurf** 由 Codeium 开发，并非传统意义上的"VS Code 分支"——它构建在 Monaco / 类 VS Code 生态上，但走的是独立路线；它是否支持 deep link 协议以本章写作时点的公开信息为准，本章不作具体断言，避免把早期草稿里"VS Code 分支"这个不准确口径复读。至于远程代码传送（Teleport），**GitHub Codespaces** 和 **Gitpod** 通过容器化实现云端开发环境，但它们传送的是整个仓库的 Git clone，而非 Claude Code 这种"Git bundle 三级降级"的轻量策略。**Aider** 和 **Codex** 目前没有浏览器远程控制能力（Codex 支持并行 Agent 工作流但面向本地终端）。行业中还流传若干以通信应用（WhatsApp/Telegram 等）为入口实现跨设备唤醒的产品，但具体产品名与实现细节本章未经独立验证，不在此处点名，避免引用不可靠实体。Claude Code 的 Deep Link + Teleport 组合的独特之处在于：它为一个**终端工具**（而非 GUI IDE）实现了跨信任边界的意图传递，这带来了额外的安全挑战——没有 OS 级的 URL 确认对话框，必须自建安全 banner。

---

## 问题

你在浏览器里点了一个 `claude-cli://open?q=fix+the+login+bug&repo=myorg/myapp` 链接。你的终端突然弹出来了，Claude Code 已经打开了正确的项目目录，输入框里预填了"fix the login bug"，等你按 Enter。或者，你执行了一个 `/remote` 命令，你的本地代码被打包上传到云端，一个远程沙箱里的 Claude 开始帮你工作。这两个跨越边界的"传送"是怎么实现的？

---

> **[图表预留 2.21-A]**：架构图 — Deep Link 的完整调用链（浏览器 → OS → 跳板进程 → 终端检测 → 新终端窗口 → Claude Code 启动）

> **[图表预留 2.21-B]**：架构图 — Teleport 的 Git Bundle 传送流程（本地 stash → bundle → upload → 远程 session → sandbox）

## 你可能以为……

"Deep Link 不就是一个 URL scheme 嘛？注册一下就行了。Teleport 不就是把代码上传到云端？"你可能觉得这些是简单的管道工作。

---

## 实际上是这样的

Deep Link 系统覆盖了 URI 解析、安全验证、协议注册（macOS/Linux/Windows 三平台）、终端检测（主流终端模拟器，当前表中列出 19 项、按跨平台去重后约 12 类）、shell 注入防御、以及一套完整的安全告警 banner 系统。Teleport 系统实现了 Git bundle 三级降级策略、云端会话管理、环境选择，以及带重试的 API 通信层。关于"6 个源文件、1,388 行"与"4 个文件、955 行"这类量化描述，本章早期版本直接写入了数字，但未在"代码落点"列出 `wc -l` 命令输出作为统计口径；这里把它读作"一个量级感的方向参考"，具体数字请以 repo 当前 HEAD 为准。这两个系统共同解决一个核心问题：**怎样安全地跨越信任边界传递意图**。

### 小节 1：Deep Link——URI 解析与安全卫兵

Deep Link 使用自定义协议 `claude-cli://`（`parseDeepLink.ts:23`）。一个完整的 URI 长这样：

```
claude-cli://open?q=fix+tests&repo=owner/repo&cwd=/path/to/project
```

`parseDeepLink` 函数（`parseDeepLink.ts:84-153`，70 行）解析这个 URI，但它**主要是一个安全验证器**，而不是一个解析器。每个参数都经过层层检查：

**q（查询文本）**：
- 上限 5,000 字符（`MAX_QUERY_LENGTH`）——为什么是 5000？因为 Windows cmd.exe 的命令行限制是 8,191 字符，减去 `cd /d <cwd> && claude.exe --deep-link-origin --prefill "<q>"` 的固定开销，再考虑 cmd.exe 的 `%→%%` 转义膨胀，~5000 是安全上限（`parseDeepLink.ts:57-69` 的注释详细解释了这个计算）
- ASCII 控制字符检查（`containsControlChars`）——换行符和回车符在 shell 中等价于命令分隔符，一个包含 `\n rm -rf /` 的查询可能导致命令注入
- Unicode 清洗（`partiallySanitizeUnicode`）——过滤 ASCII 走私字符和隐藏的提示注入

**cwd（工作目录）**：
- 必须是绝对路径（以 `/` 或 Windows 盘符开头）
- 上限 4,096 字符（Linux PATH_MAX）
- 同样检查控制字符

**repo（仓库标识）**：
- 严格匹配 `owner/repo` 格式（`REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/`）——只允许字母数字、点、横杠、下划线和恰好一个斜杠。这防止了路径遍历攻击

设计哲学是**拒绝而非截断**——如果查询超长，抛出错误而不是截取前 5000 个字符。因为截断会改变语义，一个精心构造的恶意查询可能把关键的"also cat ~/.ssh/id_rsa"放在截断点之后。

### 小节 2：协议注册——三个平台，三种完全不同的方式

`registerProtocol.ts`（348 行）是跨平台协议注册的完整实现（这是桌面应用开发中的常见需求，VS Code、Slack 等应用都有类似机制），三个平台的注册方式完全不同：

**macOS（`registerMacos`，`registerProtocol.ts:75-138`）**：
创建一个最小的 `.app` 跳板包在 `~/Applications/Claude Code URL Handler.app`。这个 .app 的 `Info.plist` 声明了 `CFBundleURLSchemes`（URL scheme 注册），但它的可执行文件不是一个真正的程序——而是指向 `claude` 二进制文件的**符号链接**（`registerProtocol.ts:128`）。

> 📚 **课程关联**：三平台的协议注册更准确的定位是操作系统与桌面环境的**服务注册 / 发现**机制（Service Registration & Discovery），属于 URL scheme handler 的范畴，而不是"进程间通信（IPC）"；IPC 专指进程之间交换数据的机制（管道、套接字、共享内存等），和 URL scheme 绑定不是一回事。macOS 的 LaunchServices、Linux 侧的 **XDG Desktop Entry 规范**（URL scheme handler 由 `.desktop` 文件里的 `MimeType=x-scheme-handler/...` 声明，和 MIME 类型映射复用同一套 XDG 机制；写成"XDG MIME 系统"是粗略口径）、Windows 的注册表，分别代表了三种不同的"服务注册与发现"范式。关于 macOS 侧的 symlink：这里利用的准确语义是，macOS 端点安全工具在评估可执行文件签名时，通常会**沿 symlink 跟踪到目标文件**再验证签名，因此指向已签名 `claude` 二进制的 symlink 可以复用目标的签名身份；说 symlink 本身有"签名继承特性"是简化口径，严格说是"安检时被跟随 + 目标有签名"两个条件叠加。

为什么用符号链接而不是复制？因为 macOS 的端点安全工具（如 Santa）会检查可执行文件的签名。一个新的、未签名的可执行文件会被拦截。符号链接指向已签名的 `claude` 二进制，不需要额外签名。

注册完还要调用 `lsregister -R`（`registerProtocol.ts:132-133`）通知 LaunchServices 重新索引——否则 macOS 不知道新的 URL scheme handler。

**Linux（`registerLinux`，`registerProtocol.ts:144-180`）**：
创建 `.desktop` 文件到 `$XDG_DATA_HOME/applications/`，然后用 `xdg-mime default` 注册为 scheme handler。在无桌面环境的系统上（WSL、Docker），`xdg-mime` 不存在不算错误——headless 环境没有浏览器可以点链接。

**Windows（`registerWindows`，`registerProtocol.ts:185-209`）**：
三条 `reg add` 命令写入注册表 `HKEY_CURRENT_USER\Software\Classes\claude-cli`——标准的 Windows URL scheme 注册流程。

三个平台还共享一个**自愈检测**（`isProtocolHandlerCurrent`，`registerProtocol.ts:263-290`）：每次启动时检查注册是否有效且指向正确的二进制。如果二进制路径变了（比如更新后安装位置变了），自动重新注册。检测直接读取 OS 注册产物（符号链接目标、.desktop 文件内容、注册表值），不依赖任何缓存文件——所以跨机器同步配置不会导致误判。

失败还有 24 小时退避（`registerProtocol.ts:314-326`）——如果因为 EACCES 或 ENOSPC 注册失败，写一个标记文件到 `~/.claude/.deep-link-register-failed`，24 小时内不重试，避免每次启动都报同一个错。标记文件放在 `~/.claude`（不是 `~/.claude.json`），因为 `.claude.json` 可能跨机器同步（比如通过 dotfiles 仓库），而注册状态是 per-machine 的。

还有一个门控层：`ensureDeepLinkProtocolRegistered`（`registerProtocol.ts:298-348`）检查两个前置条件才会注册——用户没有通过设置禁用（`disableDeepLinkRegistration`），以及 GrowthBook 功能开关 `tengu_lodestone_enabled` 开启。这意味着 Deep Link 功能可以被远程开关控制。

### 小节 3：protocolHandler——跳板进程的逻辑

`protocolHandler.ts`（136 行）是 `claude --handle-uri <url>` 的入口。它的工作流程：

1. 解析 URI（调用 `parseDeepLink`）
2. 解析工作目录（`resolveCwd`）：显式 cwd 优先 → repo 查找（MRU 本地克隆）→ 回退到 home
3. 如果是 repo 来源，读取 `.git/FETCH_HEAD` 的 mtime（`readLastFetchTime`，`banner.ts:88-102`）——FETCH_HEAD 是 per-worktree 的，如果当前目录是 worktree，系统检查主仓库和 worktree 两个位置，取较新的
4. 启动终端（`launchInTerminal`），传入预计算好的 `lastFetchMs` 标志

repo 路径解析（`resolveCwd`，`protocolHandler.ts:117-136`）有一个宽容的设计：如果 `?repo=myorg/myapp` 在本地找不到对应的克隆，**不报错**——静默回退到 home 目录。因为 web 上的链接可能引用用户没有克隆的仓库，但这不应该阻止 Claude Code 打开。

还有一个 macOS 特有的入口：`handleUrlSchemeLaunch`（`protocolHandler.ts:84-105`）处理 macOS 通过 .app bundle 的 Apple Event 传递 URL 的情况。它通过 `__CFBundleIdentifier === MACOS_BUNDLE_ID` 判断是否是 URL scheme 启动（而非终端 `open` 命令），然后使用 NAPI 模块 `url-handler-napi` 的 `waitForUrlEvent(5000)` 等待 Apple Event，最多 5 秒。

### 小节 4：终端发射器——12 种终端的适配之苦

当 OS 调用 `claude --handle-uri <url>` 时，这个进程**没有终端**——它是 LaunchServices 直接启动的。所以它需要自己打开一个终端窗口。

`terminalLauncher.ts`（557 行，最大的单个文件）适配了 主流终端模拟器（当前表中列出 19 项，按跨平台去重后约 12 类）：

| 平台 | 支持的终端 |
|------|-----------|
| macOS | iTerm2, Ghostty, Kitty, Alacritty, WezTerm, Terminal.app |
| Linux | ghostty, kitty, alacritty, wezterm, gnome-terminal, konsole, xfce4-terminal, mate-terminal, tilix, xterm |
| Windows | Windows Terminal, PowerShell, cmd.exe |

检测优先级按用户偏好排序：存储的偏好 → `TERM_PROGRAM` 环境变量 → `mdfind` 查 Spotlight → 遍历 `/Applications` → 回退到默认终端。

但最关键的区分是**安全路径分类**。文件头部注释（`terminalLauncher.ts:199-212`）明确标注了两类路径：

**纯 argv 路径**（安全）：Ghostty、Alacritty、Kitty、WezTerm、所有 Linux 终端、Windows Terminal。用户输入作为 argv 数组元素传递，空格、引号、shell 元字符完全由 argv 边界保护，**零解释**。

**Shell 字符串路径**（需要 shell 转义）：iTerm2、Terminal.app（因为 AppleScript 的 `write text` 本质上是 shell 解释的）、PowerShell、cmd.exe。用户输入必须经过 `shellQuote` / `psQuote` / `cmdQuote` 转义。

`cmdQuote`（`terminalLauncher.ts:553-557`）的实现特别值得注意：cmd.exe **不使用** `CommandLineToArgvW` 风格的反斜杠转义——它用 `"` 字符切换引用状态。一个嵌入的 `"` 会突破引用区域，暴露 `&`、`|`、`<`、`>` 给 cmd.exe 解释。所以 `cmdQuote` 的策略是**直接删除所有 `"`**（不是转义）——因为在 cmd.exe 中没有安全的方式表示一个字面双引号。

### 小节 5：安全 Banner——最后的防线

当一个 deep link 启动了 Claude Code，用户会看到一条警告 banner（`banner.ts`，123 行）：

```
This session was opened by an external deep link in ~/projects/myapp
The prompt below was supplied by the link — review carefully before pressing Enter.
```

为什么需要这个？因为 Linux 的 `xdg-open` 和浏览器的"始终允许"设置会静默分发链接——没有 OS 级的确认。一个恶意链接可以预填任意提示词，如果用户不看直接按 Enter，可能执行危险操作。

Banner 有几个精妙的安全细节：

- 超长提示词（> 1,000 字符）会触发特殊警告："scroll to review the **entire** prompt"——因为恶意指令可能藏在第 60 行以后、用户看不到的地方
- 如果 cwd 通过 `?repo=` 解析，banner 会显示上次 `git fetch` 的相对时间，格式形如 `Resolved {repo} from local clones · last fetched {age}`；**如果超过 7 天未 fetch**（由 `STALE_FETCH_WARN_MS` 阈值判定），同一行末尾直接拼接 ` — CLAUDE.md may be stale`（见 `banner.ts:59-65`）。它不是单独一行新警告，而是 fetch-age 行末的后缀；这样设计是为了让"多久没同步"和"可能过期"两件事在同一行自然关联
- 路径显示使用 `tildify()`——`/Users/USERNAME/projects` 变成 `~/projects`，让用户一眼看出工作目录

### 小节 6：Teleport——把代码"传送"到云端

Teleport 系统实现了"远程 Claude Code 会话"——你的代码在云端沙箱中运行，Claude 在那里工作，结果同步回来。

**Git Bundle 三级降级**（`gitBundle.ts`，292 行）——这种渐进式降级策略在分布式系统课程中被称为**优雅降级（graceful degradation）**，是服务韧性设计的核心模式：

```
--all (所有 refs) → HEAD (仅当前分支) → squashed-root (无历史快照)
```

`_bundleWithFallback`（`gitBundle.ts:50-146`）实现了这个链：

1. 先尝试 `git bundle create --all`——包含所有分支、标签。如果超过大小限制（默认 100MB，可通过 GrowthBook 调整），降级
2. `git bundle create HEAD`——只打包当前分支历史。如果还是太大，继续降级
3. **Squashed root**——用 `git commit-tree` 创建一个无父提交（orphan commit），只包含当前树的快照，零历史。这是最后的手段

还有一个巧妙的 WIP（Work In Progress）处理：在打包之前，系统执行 `git stash create`（`gitBundle.ts:193-199`）创建一个**不影响工作区的隐式 stash**——它不会改变 `refs/stash`，不会改变你的暂存区，只是创建一个悬空提交。然后通过 `git update-ref refs/seed/stash` 让它可达，这样 bundle 就能包含你未提交的修改。

安全清理也很周到：`finally` 块（`gitBundle.ts:279-291`）删除临时文件和 `refs/seed/stash`、`refs/seed/root` 引用。甚至在函数**开头**就先清理一次（`gitBundle.ts:164-167`）——处理上次崩溃残留的 stale refs。

**会话 API**（`api.ts`，466 行）：

`prepareApiRequest` 函数（`api.ts:181-198`）是所有 API 调用的入口守卫——检查 OAuth token 存在性和 organization UUID。错误消息特别提到"API key authentication is not sufficient"——因为远程会话需要 Claude.ai 账户的 OAuth 认证，不是 API key。

请求自带指数退避重试（`axiosGetWithRetry`，`api.ts:47-81`）：2s → 4s → 8s → 16s，共 4 次重试（5 次总尝试）。重试策略的判断很精确（`isTransientNetworkError`，`api.ts:24-41`）：
- 没有 response（网络断开、DNS 失败、超时）→ 重试
- 5xx（服务端错误）→ 重试
- 4xx（认证失败、参数错误）→ **不重试**，因为这些不是暂时性错误

`sendEventToRemoteSession`（`api.ts:362-417`）向远程会话发送用户消息，支持富内容（`RemoteMessageContent` 可以是纯文本或 content block 数组）。超时 30 秒——注释说 CCR worker 冷启动可能需要约 2.6 秒，30 秒是为冷启动容器预留的宽裕窗口。

会话数据模型也值得注意（`api.ts:84-143`）：`SessionContext` 包含 `sources`（Git 仓库或知识库）、`outcomes`（Git 分支输出）、`custom_system_prompt`（自定义系统提示词）、`seed_bundle_file_id`（上传的 bundle 文件 ID）。这个结构允许一个会话同时引用代码仓库和知识库，并在完成后输出到特定的 Git 分支——这是一个完整的"任务输入 → 执行 → 输出"的抽象。

**环境管理**（`environments.ts` + `environmentSelection.ts`，198 行）：

支持三种环境类型：`anthropic_cloud`（Anthropic 托管）、`byoc`（Bring Your Own Cloud，自带云）、`bridge`（桥接模式）。`getEnvironmentSelectionInfo` 函数（`environmentSelection.ts:24-77`）从设置系统的五层优先级中解析默认环境 ID，并遍历设置源找到"是哪一层配置指定了这个环境"——这对 UI 显示"为什么选了这个环境"很有用。

`createDefaultCloudEnvironment`（`environments.ts:76-120`）会创建一个默认的 Anthropic 云环境，预装 Python 3.11 和 Node 20。

### 小节 7：城市比喻——传送门系统

如果把 Claude Code 比作一座城市，Deep Link 和 Teleport 合起来就是**城市的传送门系统**。

Deep Link 是**入境传送门**：从外部世界（浏览器、其他应用）传送到城市内部。传送门有严格的安检——每个包裹（URL 参数）都要过 X 光机（安全验证），超过 5 公斤的（5000 字符）拒绝入境，携带危险品的（控制字符）当场没收。入境后，系统自动安排交通工具（检测终端）把你送到正确的目的地（工作目录），一路上不需要你做任何决定。

但入境者到达后会看到一条醒目的横幅："你是从外部传送门进来的，请检查你携带的指令再行动。"这是为了防止有人在传送包裹里夹带恶意指令。

Teleport 是**出境传送门**：把城市里的"东西"（代码）传送到另一个平行世界（云端沙箱）。传送前先把所有行李打包（Git bundle），如果行李太重就逐步精简——先扔掉旁支（HEAD-only），再扔掉历史（squashed-root），只保留当前状态的快照。传送门还会把你**已经写到磁盘、但还没 commit 的跟踪修改**（对应 `git stash create` 捕获的 WIP）悄悄塞进行李；**编辑器里尚未保存到磁盘的缓冲区**不在此范畴——`git stash create` 只能看到文件系统上真实存在的变更，没保存过的内容 Git 看不到，因此也不会被传送到云端。Untracked 新文件也不会进入这份 bundle（见"这个设计背后的取舍"一节解释）。

两个传送门的认证口径并不相同：Deep Link 只负责本地唤起终端，全程**不需要 OAuth**（靠 URI 安全验证 + 工作区信任把守）；而 Teleport 因为要把代码送到云端沙箱，入口必须携带 Claude.ai 账户的 OAuth access token，没有有效身份证就进不了出境传送门。

---

## 这个设计背后的取舍

**为什么 Deep Link 不直接启动 Claude Code，而要通过终端？** 因为 Claude Code 是一个终端应用——它需要 TTY 来渲染 UI、接收输入。OS 启动的 `claude --handle-uri` 进程没有 TTY，所以它必须先打开一个终端，然后在那个终端里启动 Claude Code。这个"跳板"设计多了一层，但保证了用户看到的始终是正常的终端体验。

**为什么 cmdQuote 删除双引号而不是转义？** 因为 cmd.exe 没有安全的双引号转义机制。`\"` 在 cmd.exe 中不工作（它不是反斜杠转义系统），`""` 在某些上下文有效但在其他上下文无效。删除是唯一确定安全的选择——代价是查询中的双引号会丢失，但这比命令注入好得多。

**为什么 Git bundle 不包含 untracked 文件？** `git stash create` 天然只处理已跟踪文件的修改。包含 untracked 文件（`--include-untracked`）会增加 stash 大小且可能包含 `.env`、`node_modules` 等不应传送的内容。这是一个安全和实用性的平衡。

**为什么终端偏好要持久化？** 因为 Deep Link handler 运行在 headless 上下文（LaunchServices 启动），没有 `TERM_PROGRAM` 环境变量。`terminalPreference.ts` 在正常的交互式会话中记住你用的终端（写入全局配置），这样 headless 的 handler 就知道该打开哪个终端。

---

## 代码落点

- `src/utils/deepLink/parseDeepLink.ts`，第 84-153 行：URI 解析与安全验证
- `src/utils/deepLink/registerProtocol.ts`，第 75-138 行：macOS 协议注册（.app 跳板）
- `src/utils/deepLink/registerProtocol.ts`，第 263-290 行：自愈检测（`isProtocolHandlerCurrent`）
- `src/utils/deepLink/protocolHandler.ts`，第 84-105 行：macOS URL scheme 启动入口
- `src/utils/deepLink/terminalLauncher.ts`：主流终端模拟器（当前表中列出 19 项，按跨平台去重后约 12 类）适配
- `src/utils/deepLink/banner.ts`：安全告警 banner 系统
- `src/utils/claudeInChrome/` — Chrome 浏览器侧的"在浏览器里拉起 / 对接 Claude Code"相关工具函数集合。与本章主干（Deep Link URL scheme 和 Teleport 云端沙箱）是**周边辅助关系**——当某些 Deep Link 流程从 Chrome 扩展触发时，会复用这里的一部分逻辑（例如检测是否有可用的 Chrome 扩展、如何把 URL 参数传递给扩展），但它本身不是 URL scheme 管道或 Git bundle 打包的一部分。本章不展开 `claudeInChrome/` 的内部实现，列在这里只是让读者在扩展侧继续深挖时知道入口
- `src/utils/teleport/gitBundle.ts`，第 50-146 行：Git bundle 三级降级策略
- `src/utils/teleport/api.ts`，第 181-198 行：`prepareApiRequest()` OAuth 入口守卫
- `src/utils/teleport/environments.ts`：三种环境类型管理

---

## 局限性与批判

- **终端适配脆弱**：12 种终端各有不同的启动方式和转义规则，新终端（如 Warp、Rio）上线后需要手动适配，无法自动发现
- **cmdQuote 丢弃双引号**：Windows 下 cmd.exe 的安全妥协导致用户查询中的双引号被静默删除，可能改变语义
- **Git bundle 不含 untracked 文件**：新创建但未 `git add` 的文件不会被传送到云端，用户可能困惑为何远程 Claude 看不到某些文件

---

## 如果你只记住一件事

Deep Link 和 Teleport 解决的核心问题是**跨信任边界传递意图**——一个来自浏览器的 URL 必须经过一层又一层的安全检查（URI 合法性 / 字符集清洗 / 控制字符过滤 / 长度上限 / 仓库路径白名单 / shell 转义策略 / 弹 banner 提醒用户复核）才能变成终端里的预填提示词，一个本地仓库要经过 3 级降级打包（--all → HEAD → squashed-root）才能安全地出现在云端沙箱里。此前本章给出的"5 层"是个概括口径、不对应文中哪一节的明确 5 条编号；避免读者误以为正文前面已经用 1～5 的序号列过 5 层，这里改用列举式描述，更贴合实际。
