# Computer Use 是怎么让 AI 操控你的屏幕的？

Claude Code 是一个终端程序——没有窗口、没有鼠标、没有图形界面。但 Computer Use 功能让它能截图桌面、移动鼠标、点击按钮、敲击键盘。这背后是一个 4 层架构、2 种原生语言（Rust + Swift）、需要手动泵送 macOS 主线程的复杂系统。本章从 MCP 协议到硬件事件，完整拆解让 AI "看到"并"触摸"图形界面的技术链条。

> 💡 **通俗理解**：就像远程操控无人机——AI 发指令，你的屏幕执行操作。

> 🌍 **行业背景**：AI 操控图形界面（GUI Agent）是 2024-2025 年的热门方向。**Codex（OpenAI）** 专注于终端操作和并行 Agent 工作流，不涉及 GUI 控制。**Kimi Code** 的多模态能力值得关注——支持直接摄入 UI 交互视频或屏幕录制，底层视觉大模型将动态画面转化为高保真的前端交互代码，实现了"所见即所得"的视觉编程，代表了另一种 GUI 理解路线。**Cursor** 和 **Windsurf** 作为 IDE 内嵌工具，通过 VS Code 的 API 操控编辑器界面，但不能控制编辑器之外的桌面应用。**Anthropic 的 Computer Use API**（2024 年 10 月发布）是首个让 LLM 通过截图+坐标进行通用桌面操控的商业化方案；Claude Code 中的 Computer Use 模块是这一 API 在 CLI 环境下的工程落地。在开源社区，**Open Interpreter** 的 OS 模式和 **UFO**（微软研究院）也在探索类似的 GUI 自动化，但多数依赖 OCR + Accessibility Tree 而非截图+坐标的纯视觉方案。真正的技术难点不在"调 API"——而在于跨语言调用（Rust/Swift）、事件循环兼容、多显示器坐标对齐等工程细节，这正是本章要拆解的内容。

---

## 问题

Claude Code 是一个终端工具——它没有窗口，没有鼠标，没有图形界面。但 Computer Use 功能让它可以截图你的桌面、移动鼠标、点击按钮、敲击键盘。一个纯文本的终端程序，是怎么"看到"并"操控"你的图形界面的？这中间的技术链条到底有多长？

---

> **[图表预留 2.20-A]**：架构图 — Computer Use 的四层架构（MCP Server → Wrapper → Executor → Native Modules），标注每层的职责和数据流

> **[图表预留 2.20-B]**：时序图 — 一次"截图 → 分析 → 点击"操作的完整调用链

## 你可能以为……

"大概就是调一下截图 API，然后模拟键鼠事件？"你可能觉得这很简单——毕竟 macOS 有 Accessibility API，有 CGEvent，有 screencapture 命令。

---

## 实际上是这样的

Computer Use 是 Claude Code 2.1.88 中最复杂的子系统之一——本章引用时 `src/utils/computerUse/` 目录下 15 个源文件、约 2,100 行数量级的代码（确切数字随 repo 版本漂移，不作硬承诺），横跨 4 层架构。它依赖两个原生 **Napi 模块**（Napi 指 Node-API，Node.js 的稳定原生扩展接口；这里是 Rust 的 `@ant/computer-use-input` 和 Swift 的 `@ant/computer-use-swift` 两个包），需要解决 macOS 权限模型、Node.js 事件循环与 macOS 主线程的冲突、终端应用"没有窗口"的身份困境、多显示器坐标转换，以及一个必须全系统拦截的 Escape 键安全机制。

说明：关于"多显示器坐标转换"——正文未展开多显示器具体场景（谁负责拼接、DPI scale 不同如何对齐），这里保留为一个"系统面对的问题域"维度，不作为"本章会一一回答"的承诺。如果你主要关心多显示器对齐细节，需要另外翻 `executor.ts` 截图尺寸计算与 Swift 侧显示管理。

### 小节 1：四层架构——从 MCP 协议到硬件事件

整个系统分为四层，每层解决不同的问题：

**第一层：MCP Server（`mcpServer.ts`，106 行）**

Computer Use 以 MCP Server 的形式暴露能力。为什么不做成内置工具？因为 API 后端会检测 `mcp__computer-use__*` 的工具名，在系统提示词中注入特定的 Computer Use 指引。说明这一点的注释位于 `src/utils/computerUse/setup.ts:17-21`（本章此前版本写作 `setup.ts:19-20` 是行号对不齐，以当前 HEAD 为准）。用不同的工具名就无法触发后端的这个行为。

`createComputerUseMcpServerForCli`（`mcpServer.ts:60-78`）构建了这个进程内 MCP Server。它有一个有意思的细节：会用 1 秒超时尝试枚举已安装应用（`tryGetInstalledAppNames`，`mcpServer.ts:25-44`），把应用列表注入工具描述——这样模型在看到工具描述时就知道用户电脑上装了哪些应用。如果 Spotlight 太慢或崩溃了，优雅降级：描述里不带应用列表，模型在实际使用时再发现。

**第二层：Wrapper（`wrapper.tsx`，大文件）**

Wrapper 是 `ToolUseContext`（Claude Code 的工具上下文）和 Computer Use 包的桥梁。它维护一个进程级缓存的 `binding`——通过 `bindSessionContext` 创建，包含 `dispatch` 函数和内部的截图缓存。

关键是权限管理：`onPermissionRequest` 回调弹出一个 React 渲染的审批对话框（`ComputerUseApproval` 组件），让用户授权 AI 操控哪些应用。还有一个跨会话的文件锁（`computerUseLock.ts`），确保同一台机器上只有一个 Claude Code 会话在做 Computer Use——避免两个 AI 同时抢鼠标。

**第三层：Executor（`executor.ts`，658 行）**

这是核心实现层。`createCliExecutor` 工厂函数（`executor.ts:259`）返回一个 `ComputerExecutor` 对象，包含截图、鼠标移动、点击、键盘输入、拖拽、应用管理等所有原始操作。每个操作都需要处理 macOS 特有的复杂性。

**第四层：Native Modules（`inputLoader.ts` + `swiftLoader.ts`）**

两个原生模块的加载器。Swift 模块在工厂创建时立即加载（截图功能必需），Input 模块在第一次鼠标/键盘操作时**懒加载**（`executor.ts:271-272` 注释）——如果只做截图分析而不操控，就不用加载 Rust 模块。

### 小节 2：Node.js 的阿喀琉斯之踵——drainRunLoop

这是整个 Computer Use 中最"奇特"的技术难点。

macOS 的 Swift `@MainActor` 方法和 Rust 的 `key()/keys()` 函数都会把工作分发到 `DispatchQueue.main`（macOS 主线程的工作队列）。在 Electron 中，`CFRunLoop` 持续运转，主队列自然排空，一切正常——这就是为什么 Cowork（Anthropic 的桌面应用）不需要这个 hack。

但 Claude Code 运行在 Node.js/Bun 上。libuv 事件循环**不会**驱动 macOS 的 `CFRunLoop`。结果是：所有分发到主队列的工作永远不会执行，Promise 永远 pending，程序挂死。

> 📚 **课程关联**：这是一个经典的**事件循环模型冲突**问题（操作系统课程）。macOS 的 `CFRunLoop` 和 Node.js 的 `libuv` 是两个独立的事件分发机制，类似于两个不同的调度器（scheduler）各自管理自己的就绪队列。`drainRunLoop` 的 1ms 轮询本质上是一种**忙等待（busy waiting/polling）**——操作系统课程中通常被视为低效方案，但在无法修改底层运行时的约束下，这是唯一可行的跨事件循环桥接手段。引用计数的 retain/release 模式则对应**引用计数内存管理**（类似 Objective-C 的 ARC）的思路。

解决方案（`drainRunLoop.ts`，79 行）：一个引用计数的 `setInterval`，每 1 毫秒调用 `_drainMainRunLoop()`（即 `RunLoop.main.run()`）手动泵送主队列。"这是**唯一可行**的跨事件循环桥接手段"这种说法偏强，更准确是"在不改动 Node.js/Bun 运行时 native 绑定的前提下，这是 Claude Code 选择的可行工程路径"——理论上也可以通过把全部 Computer Use 调用丢进独立子进程、由该子进程跑 Electron 式的 CFRunLoop 再 IPC 回来，只是开销和复杂度更高。

```
pump 启动 → setInterval(drainTick, 1ms) → cu._drainMainRunLoop() → 主队列排空 → Promise resolve
```

这个泵使用**引用计数模式**：

- `retain()` 递增计数器，首次时启动 `setInterval`
- `release()` 递减计数器，归零时停止
- 多个并发的 `drainRunLoop()` 调用共享同一个泵

还有 30 秒超时保护（`drainRunLoop.ts:42`）——如果原生调用 30 秒没返回，Promise race 超时获胜。被抛弃的原生 Promise 会因为 `.catch(() => {})` 静默吞掉，不会变成 `unhandledRejection`。

`retainPump` / `releasePump` 还被导出给 Escape 热键系统——CGEventTap 的 CFRunLoopSource 也需要泵持续运转（`escHotkey.ts:34`）。

### 小节 3：截图——"看到"桌面的技巧

截图通过 Swift 的 `SCContentFilter` API 实现（`@ant/computer-use-swift`），但 Claude Code 作为终端应用面临一个独特问题：**不能把终端自己截进去**。

解决方案是"允许列表反转"（`executor.ts:279-286`）。Swift 0.2.1 的 `captureExcluding` 实际接受的是**允许列表**而非排除列表（注释说这是一个命名误导的 API，引用了 `apps#30355`）。所以 `withoutTerminal()` 辅助函数从允许列表中**过滤掉终端应用**：

```typescript
const withoutTerminal = (allowed: readonly string[]): string[] =>
  terminalBundleId === null
    ? [...allowed]
    : allowed.filter(id => id !== terminalBundleId)
```

终端的 Bundle ID 通过两种方式检测（`common.ts:43-47`）：
1. `__CFBundleIdentifier` 环境变量——macOS 在 .app 启动子进程时自动设置
2. 回退映射表——根据 `TERM_PROGRAM` 环境变量匹配（覆盖 iTerm、Terminal.app、Ghostty 等 6 种终端）

截图还有精确的尺寸控制（`executor.ts:63-68`）：先拿到逻辑分辨率和缩放因子，换算成物理像素，再通过 `targetImageSize` 计算 API 期望的目标尺寸。这是为了让 API 的图像转码器触发"早返回"（`executor.ts:398-399` 注释）——不做服务端缩放，保持坐标系一致。JPEG 质量固定为 0.75（`executor.ts:57`），平衡清晰度和传输大小。

### 小节 4：键鼠操控——0.05 秒的精密舞步

每个鼠标和键盘操作都充满了时序细节。

**鼠标移动**（`moveAndSettle`，`executor.ts:113-120`）：先瞬间移动到目标位置，然后**等待 50 毫秒**。为什么？因为从 HID（人机接口设备）事件到 AppKit 的 `NSEvent` 有一个传播延迟。如果立刻点击，`NSEvent.mouseLocation` 可能还没更新到新位置。50ms 在源码中是一个固定常量（`executor.ts:113-120` 内设置），我们只能说它是"实现者选定"的值；"经过实战验证"是对这个选择的合理猜测，源码注释没有明确说"经过 X 次测试校准"。

**点击**（`executor.ts:538-556`）：先 `moveAndSettle`，然后 `mouseButton('click', count)`。双击和三击依赖 AppKit 自己的计时和位置聚类——连续点击在相同位置、间隔足够短，AppKit 会自动递增 `clickCount`。修饰键（Ctrl、Shift 等）通过 `withModifiers` 函数（`executor.ts:150-165`）"按下-执行-释放"包裹，`finally` 块确保即使操作异常也会释放修饰键——否则你的 Ctrl 键就"卡住"了。

**拖拽**（`executor.ts:579-594`）：移动到起点 → 按下鼠标 → 等 50ms → **动画式移动**到终点 → 释放鼠标。动画移动使用 ease-out-cubic 缓动，60fps、速度 2000px/sec、最长 0.5 秒——这些数值来自 `animatedMove`（`executor.ts:217-255`）的实现参数，具体行号要以 repo 当前状态为准；这里是对"动画参数数量级"的描述性引用，不作为"第 X 行有一个叫 `ANIMATION_FPS = 60` 的常量"的断言。为什么拖拽要动画？因为目标应用可能监听 `.leftMouseDragged` 事件的中间位置来实现滚动条拖动或窗口调整——瞬间移动不会产生这些中间事件。

**键盘输入**（`executor.ts:455-473`）：支持 xdotool 风格的组合键（如 `"ctrl+shift+a"` → 按 `+` 分割）。每次按键间隔 8 毫秒——匹配 USB 125Hz 轮询频率。对于文本输入，有两种模式：逐字符输入或**剪贴板粘贴**。

**剪贴板粘贴**（`typeViaClipboard`，`executor.ts:180-206`）是一个精心编排的 6 步协议：

1. 读取并保存用户当前剪贴板内容
2. 写入要输入的文本到剪贴板
3. **回读验证**——如果写入后读回的不一致，**拒绝粘贴**（否则会粘贴垃圾）
4. 模拟 Cmd+V
5. 等待 100ms——让目标应用完成粘贴
6. 恢复原始剪贴板内容（在 `finally` 中，确保异常时也恢复）

> 📚 **课程关联**：这个 6 步协议本质上是一个**事务（transaction）**——具备原子性（要么完成粘贴、要么不粘贴）和一致性（剪贴板状态最终恢复）。严格地讲，ACID 意义下的"Durability（持久性）"指的是一旦事务提交就写入永久存储、崩溃也不丢；而这里的剪贴板恢复属于**补偿 / 回滚**语义（compensation / rollback），更接近 Sagas 模式里"反向操作恢复原状"的思路。用 ACID 做比喻可以帮助理解"原子+可恢复"的意图，但不要把它当成满足完整 ACID 的持久事务。回读验证则类似分布式系统中的**写后读一致性**校验（写入后立刻读回、比较是否生效）。

这里有 3 个防御性设计：回读验证防止静默写入失败、100ms 延迟防止恢复太快导致粘贴的是恢复后的内容、`finally` 防止用户剪贴板被永久篡改。

### 小节 5：Escape 键——全系统的紧急刹车

当 AI 在操控你的电脑时，你需要一个可靠的"停止"按钮。Claude Code 选择了 Escape 键，但实现方式极其激进：**全系统级的 CGEventTap**。

`escHotkey.ts`（54 行）通过 Swift 模块注册一个 CGEventTap——macOS 最底层的事件拦截机制。一旦注册：

- Escape 键被**全系统消费**——任何应用都收不到 Escape
- 这是防止提示注入的防线——如果恶意指令让 AI 按 Escape 关闭某个确认对话框，CGEventTap 会吞掉这个 Escape

但 AI 自己有时也需要按 Escape（比如退出某个应用的全屏模式）。解决方案是 `notifyExpectedEscape()`（`escHotkey.ts:51-54`）——executor 在合成 Escape 按键前通知 Swift 模块，Swift 会在 100ms 内放行下一个 Escape 事件。这个 100ms 衰减窗口（`executor.ts:467-468` 注释中描述）确保了：如果合成的 CGEvent 由于某种原因没到达 tap 回调，100ms 后自动恢复拦截——不会永久打开漏洞。

CGEventTap 的 `CFRunLoopSource` 需要 `CFRunLoop` 运转才能工作——所以它通过 `retainPump()` 保持 drainRunLoop 的泵在注册期间持续运行。

### 小节 6：Host Adapter——粘合剂层

`hostAdapter.ts`（69 行）是把所有东西粘合在一起的单例。`getComputerUseHostAdapter()` 返回一个进程生命周期的 `ComputerUseHostAdapter` 对象，包含：

- **executor**：通过 `createCliExecutor` 创建，传入两个动态 getter——`getMouseAnimationEnabled` 和 `getHideBeforeActionEnabled`。这些读取 GrowthBook 的子门控（GrowthBook 是 Anthropic 使用的特性开关平台，本书其他章节多次提及；在 `gates.ts:72` 首次出现前，本处是该名称在 Q22 正文里的首次使用，因此在这里注明），使 Anthropic 可以远程开关某些行为（比如暂时关闭鼠标动画来调试问题）
- **logger**：`DebugLogger` 类把所有日志转发到 `logForDebugging`，分为 silly/debug/info/warn/error 五级
- **ensureOsPermissions**：检查 Accessibility 和 Screen Recording 两项 macOS TCC 权限。返回 `{ granted: true }` 或详细告知哪项缺失
- **cropRawPatch**：像素验证的 JPEG 裁剪回调——返回 `null` 表示跳过验证。为什么？因为 Cowork 用 Electron 的 `nativeImage`（同步），但 CLI 只有 `image-processor-napi`（异步），而调用方需要同步的 `patch1.equals(patch2)` 比较。返回 null 是设计好的降级路径（`PixelCompareResult.skipped`）

这个 adapter 还硬编码了 `getAutoUnhideEnabled: () => true`——在每轮操作结束后，之前被隐藏的应用窗口会自动恢复显示。没有用户偏好可以关闭这个行为——被你的 AI 永久隐藏窗口是不可接受的。

### 小节 7：功能门控——谁能用这个"远程操控中心"

Computer Use 不是所有人都能用的。`gates.ts`（72 行）实现了多层门控：

1. **订阅等级**：只有 Max 和 Pro 订阅用户可用（`hasRequiredSubscription()`）。Anthropic 内部员工（`USER_TYPE === 'ant'`）绕过此限制
2. **远程配置**：通过 GrowthBook 功能开关 `tengu_malort_pedway` 控制（GrowthBook 是 Anthropic 内部使用的特性开关平台，在小节 7 此处首次出现，正文后半段可能再次引用）。即使你是 Max 用户，如果 Anthropic 没有开启此功能，你也用不了
3. **内部防误触**：如果检测到 `MONOREPO_ROOT_DIR` 环境变量（说明在 Anthropic monorepo 的开发环境），除非显式设置 `ALLOW_ANT_COMPUTER_USE_MCP=1`，否则禁用——防止开发者不小心让 AI 操控他们的开发机器
4. **macOS only**：`createCliExecutor` 第一行就检查 `process.platform !== 'darwin'`，非 macOS 直接抛异常
5. **OS 权限**：需要 Accessibility（辅助功能）和 Screen Recording（屏幕录制）两项 macOS **TCC 权限**（TCC = Transparency, Consent, and Control，是 macOS 用于管理应用访问敏感资源的权限数据库与弹窗系统，定义见 `hostAdapter.ts:48-53` 的 `ensureOsPermissions()` 检查）

坐标模式（像素 vs 归一化）在首次读取后冻结（`gates.ts:68-72`）——防止 GrowthBook 在会话中途切换导致模型认为是"像素坐标"而 executor 按"归一化坐标"转换。

### 小节 8：prepareForAction——操作前的"清场"

在鼠标或键盘操作之前，系统可以执行一个"清场"步骤（`executor.ts:302-339`）。`prepareForAction` 做三件事：

1. 调用 Swift 的 `prepareDisplay`——隐藏不在允许列表中的应用窗口，激活目标应用
2. 传入 `surrogateHost`（终端的 Bundle ID）——让 Swift 侧豁免终端不被隐藏，同时在 z-order 激活时跳过终端
3. 整个操作包裹在 `drainRunLoop` 中——因为 `prepareDisplay` 内部的 `.hide()` 调用触发窗口管理器事件，这些事件排在 CFRunLoop 上

注释（`executor.ts:310-318`）解释了一个 Electron vs CLI 的关键差异：Cowork 的 Electron 持续排空 CFRunLoop，所以窗口隐藏事件立即处理。而 CLI 的 drainRunLoop 在操作结束后停止泵送，导致多个 `.hide()` 事件堆积，下次泵启动时一次性处理——表现为窗口闪烁。所以清场期间必须持续泵送。

如果清场失败（比如目标应用没响应），**不抛异常**——日志记录后继续执行操作。安全保障由后续的 frontmost gate 提供——如果目标应用不在前台，操作会被拦截。

操作结束后，`unhideComputerUseApps`（`executor.ts:652-658`）在 turn 结束时恢复所有被隐藏的窗口。这个函数是模块级导出而非 executor 方法——它在 executor 生命周期之外被 `cleanup.ts` 调用，fire-and-forget。

### 小节 9：城市比喻——远程操控中心

如果把 Claude Code 比作一座城市，Computer Use 就是**城市的远程操控中心**。

这个操控中心坐落在城市地下——终端是一个没有窗户的指挥室。但它有一整套高科技设备：

- **监控摄像头**（截图）：可以看到城市地面上的一切，但摄像头经过精心安装，不会拍到指挥室自己
- **机械手臂**（鼠标/键盘操控）：每个动作都有精确的时序控制，移动后等 50ms 确认到位，拖拽时模拟真人的加减速曲线
- **广播系统**（剪贴板粘贴）：先备份当前正在播放的内容，播完后恢复——市民甚至不知道广播被临时征用过
- **紧急按钮**（Escape 全局拦截）：全城任何地方按 Escape 都会触发紧急停止，这个按钮不能被任何人绕过——即使操控中心自己发出的"假 Escape"也会被标记和短暂放行
- **心跳泵**（drainRunLoop）：指挥室和地面系统说的是不同的"语言"（Node.js vs macOS 主线程），需要一个翻译泵每毫秒工作一次来保持通信

最关键的安全设计：操控中心有一把锁，同一时间只有一个操作员能坐在控制台前（`computerUseLock`）。新来的操作员如果发现锁被占用，必须等前一个离开。

---

## 这个设计背后的取舍

**为什么不直接用 AppleScript？** AppleScript 可以做很多自动化，但它是 shell-interpreted 的字符串，有注入风险。而且 AppleScript 操作有限——不能精确控制鼠标坐标，不能做亚像素级的截图裁剪。原生模块虽然复杂，但提供了完整的控制力和类型安全。

**为什么用 MCP 而非内置工具？** 纯粹是因为 API 后端的约定——它通过工具名 `mcp__computer-use__*` 来识别 Computer Use 能力并注入相应的系统提示词。内置工具用不同的命名模式，无法触发这个机制。

**为什么需要 1ms 的 drainRunLoop？** 这是在 Node.js 环境中运行 macOS 原生代码的"胶水税"。Electron/Chromium 在 macOS 上的主进程事件循环与 macOS 的 `CFRunLoop` 深度集成（通过 `CFRunLoopSource`/`NSRunLoop`），开发者通常不需要手动泵送；但 Node.js/Bun 的 libuv 事件循环是独立的，终端应用必须自己每 1ms 推一次。说"CFRunLoop 是 Chromium 事件循环的一部分"这种表述跳步太大——更准确地说：Chromium 在 macOS 上与 CFRunLoop 协同运行、两者事件循环互相驱动，而不是"CFRunLoop 内置于 Chromium"。1ms 的间隔意味着最多 1ms 的延迟，对用户无感知但足以保持原生调用流畅。

**为什么截图要预先计算目标尺寸？** 如果让 API 服务端缩放，缩放后的坐标和本地坐标系不一致——模型说"点击 (300, 200)"但对应的实际屏幕位置不对。本地预缩放确保本地坐标 = 模型看到的坐标 = 点击坐标，消除了一整类坐标错位 bug。

**为什么坐标模式要冻结？** `gates.ts:68-72` 在首次读取后冻结坐标模式（`frozenCoordinateMode`）。如果 GrowthBook 在会话中途从"像素"切换到"归一化"，模型还在说像素坐标，但 executor 开始按归一化坐标转换——点击位置全部错位。冻结是最简单的一致性保证。

**为什么像素验证返回 null 跳过？** `hostAdapter.ts:65` 的 `cropRawPatch` 回调返回 `null`。像素验证需要同步的 JPEG 裁剪比较（`patch1.equals(patch2)`），但 CLI 只有异步的 `image-processor-napi`。强行同步会阻塞事件循环。跳过验证的降级是安全的——子门控默认关闭，且点击仍然会执行，只是少了一层"确认目标像素没变"的检查。

---

## 代码落点

- `src/utils/computerUse/executor.ts`，第 259 行：`createCliExecutor()` 工厂函数
- `src/utils/computerUse/executor.ts`，第 113-120 行：`moveAndSettle()` 鼠标移动 + 50ms 等待
- `src/utils/computerUse/executor.ts`，第 180-206 行：`typeViaClipboard()` 6 步剪贴板协议
- `src/utils/computerUse/executor.ts`，第 302-339 行：`prepareForAction()` 操作前清场
- `src/utils/computerUse/drainRunLoop.ts`：1ms 间隔的 CFRunLoop 手动泵送
- `src/utils/computerUse/escHotkey.ts`：全系统 Escape 键 CGEventTap 拦截
- `src/utils/computerUse/hostAdapter.ts`：CLI 环境下的 host adapter 单例
- `src/utils/computerUse/gates.ts`：多层门控（订阅等级 + GrowthBook + macOS only）
- `src/utils/computerUse/mcpServer.ts`，第 60-78 行：MCP Server 构建（注意实际位置在 `src/utils/computerUse/` 而非 `src/tools/ComputerUseTool/`；本章此前的目录路径是误写）
- `src/utils/computerUse/wrapper.tsx`：ToolUseContext 桥梁层
- `src/utils/computerUse/setup.ts`，第 11-22 行：`setupComputerUseMCP()` + 为什么用 MCP 命名空间触发后端 system prompt 的完整注释

---

## 局限性与批判

- **仅限 macOS**：整个系统深度依赖 macOS 的 CGEvent、SCContentFilter 和 Accessibility API，Linux/Windows 完全不可用
- **drainRunLoop 是架构妥协**：1ms 轮询泵送 macOS 主线程是一个 hack，持续消耗 CPU 周期；未来如果 Bun/Node.js 原生支持 CFRunLoop 集成，此设计应被替换
- **像素验证被跳过**：CLI 环境下 `cropRawPatch` 返回 null，意味着无法确认点击目标的像素是否与截图时一致——在动态 UI 中可能点错位置

---

## 如果你只记住一件事

Computer Use 不是简单的"截图 + 模拟点击"。它是一个 4 层架构、2 种原生语言、需要手动泵送 macOS 主线程、全系统拦截 Escape 键、动画模拟拖拽轨迹、6 步协议保护剪贴板、跨会话文件锁防止冲突的完整系统。它证明了：**让 AI"看到"和"触摸"图形界面的难度，远超让它读写代码文件**。
