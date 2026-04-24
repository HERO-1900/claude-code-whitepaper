# Prompt Cache 可观测性完全解析

Claude Code 每次调用 API 时会发送**一到几万 token 级别**的系统提示词（具体随会话上下文、启用的工具、CLAUDE.md 大小动态变化——本书早期给出的 "15,000-34,000 token" 范围是作者基于典型会话的观察估算，非源码 hard-coded 常量）。这些 token 命中 Anthropic 的 Prompt Cache 时费用显著降低，没命中则按全价计费。Prompt Cache 可观测性系统（`promptCacheBreakDetection.ts` **727 行**，以 `wc -l` 核实）就是"侦探"——当缓存意外失效（cache break）时，它能精确定位是哪一行代码、哪一个参数的变化导致了失效，帮助开发者避免不必要的成本激增。

> **源码位置**：`src/services/api/promptCacheBreakDetection.ts`（727 行）、相关：`src/utils/tokenBudget.ts`（73 行，以 `wc -l` 核实；原书写 74 属于 off-by-1）

> 💡 **通俗理解**：就像超市的会员积分——每次购物都能用积分抵扣（缓存命中 = 便宜）。但如果你换了会员卡号（系统提示词变了），之前的积分就失效了。这个系统就像"积分对账员"——它会告诉你"你的积分在 3 月 5 日失效了，原因是你换了手机号"，让你知道哪里出了问题。

---

## 概述

本章名为"Prompt Cache 可观测性"，但内容实际分为两大块：

**核心主题（第一、二部分）**：Prompt Cache Break 检测系统（为什么缓存会失效、如何精确定位原因）+ Token Budget 解析器（一个小而精的辅助系统，让用户用自然语言控制 token 消耗）。

**附录（A/B/C 三节）**：三个代码量不足以独立成章的运行时子系统——**Computer Use**（Chrome 集成 + 权限审批，~474 行）、**Rate Limiting**（限流状态机 + 测试模拟器，~1,100 行）、**Remote Sessions WebSocket + Env-less Bridge**（~1,400 行）。

**篇幅说明**：附录 A/B/C 三节合计约 ~3,000 行源码的解析，篇幅超过前两部分的 Prompt Cache + Token Budget（合计约 800 行源码）。这种安排是编辑策略——Cache 可观测性是本章正题，三个附录是"顺手解析的同尺度子系统"。读者如只关心章节标题所指的核心主题，可以只读第一、二部分。

---

> **[图表预留 3.22-A]**：Cache Break 检测流程 — 请求前状态快照 → API 调用 → 响应头检查 → Diff 生成 → 告警

---

## 第一部分：Cache Break 检测（727 行）

### 1. 为什么缓存会失效？

Anthropic 的 Prompt Cache 基于**前缀匹配**——只要请求的前 N 个 token 与缓存中的完全相同，就命中缓存。但如果前缀中任何一个 token 变了，整个缓存就失效。

可能导致失效的变化源：

| 变化源 | 发生频率 | 成本影响 |
|--------|---------|---------|
| 系统提示词内容变化 | 罕见（代码更新时） | 高 |
| 工具描述 schema 变化 | 每次加载 MCP 工具时 | 高 |
| beta headers 变化 | 功能开关切换时 | 中 |
| cache_control 位置变化 | 压缩后 | 中 |
| 超额(overage)状态变化 | 计费状态切换时 | 低 |
| effort 参数变化 | 用户切换模式时 | 低 |

### 2. 检测机制

```typescript
// promptCacheBreakDetection.ts — 核心检测流程

// 第1步：每次 API 调用前，快照当前状态
type PreviousState = {
  systemPromptHash: string    // 系统提示词的 SHA256
  toolSchemasHash: string     // 所有工具描述的 SHA256
  betaHeaders: string[]       // beta header 列表
  cacheControlPositions: any  // cache_control 标记位置
  overageState: string        // 超额计费状态
  effort: string              // 推理努力级别
}

// 第2步：API 响应后，对比状态
function trackCacheBreak(
  prevState: PreviousState,
  currentState: PreviousState,
  responseHeaders: Headers
) {
  // 检查每个字段是否变化
  // 如果有变化 → 生成 diff → 记录到临时目录
}
```

### 3. 工具级 Schema 追踪

77% 的缓存失效来自工具描述变化——MCP 服务器可能在不同时间点返回不同的工具列表或描述。系统对每个工具单独计算哈希：

```typescript
// 不是把所有工具描述拼成一个字符串然后 hash
// 而是每个工具单独 hash，这样能精确定位"哪个工具变了"

const toolHashes = tools.map(tool => ({
  name: tool.name,
  hash: sha256(JSON.stringify(tool.input_schema))
}))

// 对比时:
// "BashTool hash 没变, ReadTool hash 没变, 
//  mcp__slack__send_message hash 变了!
//  → 是 Slack MCP 服务器返回了不同的 schema"
```

### 4. Diff 输出

当检测到缓存失效时，系统会生成结构化的 diff 文件：

```typescript
// 写入临时目录: /tmp/claude-cache-breaks/
// 文件名: cache-break-{timestamp}.diff

function buildCacheBreakDiff(
  prev: PreviousState,
  curr: PreviousState
): string {
  // 生成统一 diff 格式
  // 精确标注变化的字段和内容
  // 可用于离线分析和回归检测
}
```

### 5. 缓存策略类型

```typescript
type CacheStrategy =
  | 'tool_based'        // 基于工具描述的缓存边界
  | 'system_prompt'     // 基于系统提示词的缓存边界
  | 'none'              // 不使用 prompt cache
```

**`none` 的适用场景**：
- **一次性/短请求**：如会话标题生成（调用 Haiku，总 token 量小到缓存管理开销大于节省）
- **极度动态的前缀**：如包含当前时间戳或每次都变的随机盐值的测试路径
- **MCP 工具集合剧烈变动的时段**：已知工具列表在本次调用后会改变，提前放弃缓存反而节省"建缓存又失效"的额外开销
- **调试路径**：开发者显式关闭 cache 用于重现问题（避免缓存命中掩盖 bug）

大多数生产请求走 `tool_based` 或 `system_prompt`，`none` 是少数特定场景的显式选择。

### 6. "粘性闩锁"模式

某些状态变化不应该导致缓存失效——系统使用"粘性闩锁"（Sticky Latch）模式：

```typescript
// 超额状态变化: free → overage
// 这个变化会影响 beta headers
// 但不应该触发缓存重建

// 粘性闩锁: 一旦进入 overage 状态，
// 即使短暂恢复也不切换回来
// 避免状态抖动导致缓存反复失效
```

> 💡 **通俗理解**：就像空调的温度控制——设定 25°C，不是温度一到 25.1°C 就关、24.9°C 就开（那会频繁开关，像缓存反复失效）。而是设置一个"死区"——25.5°C 才关、24.5°C 才开，避免在边界反复跳动。

---

## 第二部分：Token Budget 解析器（73 行）

### 7. 功能

`parseTokenBudget`（`src/utils/tokenBudget.ts`，73 行）是一个小而精的解析器——它让用户用自然语言控制 AI 的 token 消耗预算：

```typescript
// 支持的格式:

// 开头格式:
"+500k tokens 帮我重构这个模块"
→ 解析为: budget = 500,000 tokens

// 结尾格式:
"帮我重构这个模块, spend 2M tokens."
→ 解析为: budget = 2,000,000 tokens

// 关键词格式:
"use 100k tokens on this refactor"
→ 解析为: budget = 100,000 tokens
```

### 8. 实现

```typescript
// tokenBudget.ts

// 核心函数
parseTokenBudget(text: string): number | null {
  // 正则匹配缩写: k=1K, m=1M, b=1B
  // 锚定到文本开头/结尾或关键词
  // 避免在正常句子中误匹配
}

// 辅助函数
findTokenBudgetPositions(text: string):
  Array<{ start: number; end: number }> {
  // 返回所有匹配位置（用于 UI 高亮）
}

// 进度消息
getBudgetContinuationMessage(
  pct: number,           // 已用百分比
  turnTokens: number,    // 本轮消耗
  budget: number         // 总预算
): string {
  // "已使用 45% 的预算 (450K/1M tokens)"
}
```

> 💡 **通俗理解**：就像叫外卖时说"预算 50 块"——系统不需要你精确到"5 万 token"，说"500k"就够了。系统还会在执行过程中告诉你"已经花了多少"，像骑手 App 显示的"预计费用"。

### 9. 设计亮点

**仅 73 行实现自然语言 token 预算控制**——这是一个教科书级的"小而美"设计：

- 正则锚定到开头/结尾，避免在 "the model processes 500k tokens per request" 这样的句子中误匹配
- 支持 3 种格式（前置/后置/关键词），覆盖大多数自然表达
- 返回 `null`（而非默认值）表示"用户没有指定预算"——不做假设

---

## 批判与反思

### Cache 可观测性的"事后诸葛亮"问题

当前系统只在缓存**已经失效后**才检测和报告——它是诊断工具，不是预防工具。理想的设计应该在"即将发送可能导致缓存失效的请求"之前就发出预警。但这需要预测未来的 API 请求内容，技术上很难实现。

### Token Budget 的精度问题

用户说"use 500k tokens"，但实际消耗可能因为以下原因偏离：

- 压缩操作会改变上下文大小
- 工具调用的 token 消耗不确定
- AI 的回复长度不可预测

系统只能做"尽力而为"的预算控制，而非精确预算。

> 🔑 **深度洞察**：Prompt Cache 可观测性和 Token Budget 解析器代表了 Claude Code 对"成本"的两种管理方式——**诊断型**（发现问题后定位原因）和**预算型**（提前设定消耗上限）。在 AI 编程工具的商业模式中，成本管理不是可选的"运维功能"，而是直接影响用户留存的核心产品特性——没有人愿意在不知情的情况下花掉 10 倍的 API 费用。

---

## 附录：三个"小而独立"的运行时子系统

以下三个子系统各自的主模块代码量在 400–1,400 行之间，单独成章篇幅过短，但各自扮演不可忽视的角色。本附录将它们作为"小型子系统群"进行集中解析。（注：早期"三个子系统不足以独立成章"的措辞与后文单节 1,400/1,100 行的规模存在语义张力——这里的"小而独立"指的是**相对于前面动辄 2,500-4,000 行的子系统而言**，不是绝对数量小。）

---

### A. Computer Use：从终端跨入浏览器（~474 行）

> **源码位置**：`src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx`（440 行）、`src/skills/bundled/claudeInChrome.ts`（34 行）、`src/utils/claudeInChrome/setup.ts`（401 行）、`src/utils/claudeInChrome/prompt.ts`（84 行）

> 💡 **通俗理解**：Claude Code 本来只能在终端里读写代码。Computer Use 就像给它配了一副"遥控手臂"——它可以伸进你的 Chrome 浏览器，替你点击按钮、填写表单、截图查看页面。但在伸手之前，必须先问你："我可以碰这几个应用吗？"

#### A.1 权限审批 UI：双面板调度器

`ComputerUseApproval` 组件采用一种我们称为"**双面板调度器**"（Two-Panel Dispatcher）的 UI 组织方式——这不是业界通用术语，是本书为描述该组件结构使用的称谓：**同一个入口组件根据请求状态的某个关键字段（此处为 `tccState`），分发到两个独立的子面板**，而非在单一面板内用条件渲染堆叠。这种分发确保了两类完全不同的交互（"去系统设置授权"vs"应用白名单勾选"）各自有独立的组件心智模型。

```typescript
// ComputerUseApproval.tsx — 入口判断
export function ComputerUseApproval({ request, onDone }) {
  // tccState 存在 → macOS 权限缺失（Accessibility / Screen Recording）
  // tccState 不存在 → 正常的应用白名单面板
  return request.tccState
    ? <ComputerUseTccPanel ... />   // 面板1：引导用户去系统设置
    : <ComputerUseAppListPanel ... /> // 面板2：应用白名单审批
}
```

**面板 1：TCC 权限引导（macOS 专属）**。当检测到缺少 Accessibility 或 Screen Recording 权限时，UI 直接用 `open x-apple.systempreferences:` URL scheme 跳转到 macOS 系统偏好设置的对应页面。这不是"告诉用户去哪设置"，而是直接帮你打开那个设置页。

**面板 2：应用白名单审批**。这是核心交互——列出所有需要访问的应用，每个应用旁边显示勾选状态。关键设计：

```typescript
// 高风险应用的哨兵分类警告
const SENTINEL_WARNING = {
  shell: 'equivalent to shell access',       // 等同于 shell 权限
  filesystem: 'can read/write any file',     // 可读写任意文件
  system_settings: 'can change system settings' // 可修改系统设置
}
```

高风险应用（Terminal、Finder、System Settings）旁边会显示醒目的警告标签。`getSentinelCategory()` 根据 `bundleId` 对应用进行危险等级分类——这是一种**最小权限原则**的 UI 体现。

**权限响应的三元组**：审批结果不是简单的 allow/deny，而是 `{ granted[], denied[], flags }` 三元组。`flags` 包含 `clipboardRead`、`clipboardWrite`、`systemKeyCombos` 三个细粒度开关。

#### A.2 Chrome 集成：Skill + MCP + Native Host

Claude Code 的浏览器自动化通过三层架构实现：

| 层级 | 组件 | 职责 |
|------|------|------|
| 技能层 | `claudeInChrome.ts` | 注册 `claude-in-chrome` Skill，注入浏览器操作提示词 |
| 传输层 | `setup.ts` + MCP Server | 通过 stdio 启动 MCP 进程，管理 Native Host 清单安装 |
| 协议层 | Chrome Native Messaging | 通过 `com.anthropic.claude_code_browser_extension` 与浏览器扩展通信 |

`setup.ts` 的 Native Host 安装流程颇为精巧：它会在 `~/.claude/chrome/` 目录下创建一个 wrapper script（macOS/Linux 是 shell 脚本，Windows 是 .bat），因为 Chrome 的 Native Messaging manifest 的 `path` 字段不允许包含命令行参数。安装覆盖所有 Chromium 内核浏览器（Chrome、Edge、Brave、Arc 等），Windows 上还需要写注册表。

扩展检测采用**单向缓存策略**：只缓存"已安装"的正面检测结果，不缓存"未安装"。原因是 `~/.claude.json` 可能在多台机器间共享——如果在没有 Chrome 的远程开发机上缓存了 `false`，会永久毒化其他所有机器的自动启用逻辑。

#### A.3 行业对比与批判

**对比 Cursor**：Cursor 没有浏览器控制能力。Claude Code 通过 MCP 协议桥接浏览器，架构上更灵活但也更脆弱——Native Host 安装需要写文件系统和注册表，失败模式复杂。

**批判**：440 行的 `ComputerUseApproval.tsx` 中超过一半是 React Compiler 生成的 memo 缓存代码（`$[0]`、`Symbol.for("react.memo_cache_sentinel")` 等），实际业务逻辑不到 200 行。这是编译产物的典型膨胀——如果有源码 map，这个组件在手写 React 中大概只有 100-120 行。

---

### B. Rate Limiting：限流状态机与开发测试模拟（~400+ 行）

> **源码位置**：`src/services/rateLimitMessages.ts`（345 行）、`src/services/rateLimitMocking.ts`（145 行）、`src/services/mockRateLimits.ts`（~400 行）、`src/commands/rate-limit-options/`（220 行）

> 💡 **通俗理解**：就像手机流量包——月底流量用完了，系统不会直接断网，而是弹出一个菜单："要买加油包？要升级套餐？还是等下个月？"Claude Code 的限流系统就是这个"弹窗"背后的全部逻辑，包括怎么识别你在哪种限流状态、该显示什么文案、以及一套供内部工程师测试各种限流场景的模拟器。

#### B.1 限流状态分类

Claude Code 面对的不是单一的"限流/不限流"二元状态，而是一个多维度的状态矩阵：

| 维度 | 可能的值 | 对应 Header（出处） |
|------|---------|-------------|
| 基础状态 | `allowed` / `allowed_warning` / `rejected` | `anthropic-ratelimit-unified-status`（`rateLimitMocking.ts:71`） |
| 超额状态 | `allowed` / `allowed_warning` / `rejected` | `anthropic-ratelimit-unified-overage-status`（`rateLimitMocking.ts:73`） |
| 限流类型 | `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` | `anthropic-ratelimit-unified-representative-claim`（`rateLimitMocking.ts:75`） |
| 超额禁用原因 | `out_of_credits` / `org_level_disabled_until` / ... | `anthropic-ratelimit-unified-overage-disabled-reason`（出现在消息解析路径，非 mocking 层；与前三个同属 `anthropic-ratelimit-unified-*` 家族） |

基础状态和超额状态的**组合**决定了最终行为——并非 `rejected` 就一定不能用，如果超额通道 `allowed`，请求仍可继续（只是开始计费）。

#### B.2 消息生成：一个精心设计的状态机

`rateLimitMessages.ts` 的核心函数 `getRateLimitMessage()` 是一个按优先级排列的决策链：

```typescript
// rateLimitMessages.ts — 决策优先级
function getRateLimitMessage(limits, model): RateLimitMessage | null {
  // 1. 超额使用中？→ 只在接近超额上限时警告
  if (limits.isUsingOverage) {
    if (limits.overageStatus === 'allowed_warning') return warning(...)
    return null  // 正常超额使用，不需要消息
  }

  // 2. 已被拒绝？→ 错误消息
  if (limits.status === 'rejected') return error(getLimitReachedText(...))

  // 3. 接近限制？→ 警告消息（但有阈值过滤）
  if (limits.status === 'allowed_warning') {
    // 关键：只有利用率超过 70% 才警告
    // 防止 API 在周重置后发送过期的 allowed_warning
    if (limits.utilization < 0.7) return null
    return warning(getEarlyWarningText(...))
  }

  return null
}
```

70% 阈值过滤是一个值得关注的防御性设计：API 可能在周限额重置后仍然返回 `allowed_warning`（服务端数据滞后），如果不加阈值过滤，用户会在 0% 使用量时看到"接近限额"的误导性警告。

**针对不同用户类型的差异化文案**：Team/Enterprise 用户看到的是"Request extra usage"（向管理员申请），Pro/Max 用户看到的是"Upgrade your plan"。**Ant**（源码中 `USER_TYPE === 'ant'` 代号所指的 Anthropic 内部员工）还能看到 Slack 频道链接和 `/reset-limits` 命令。

#### B.3 选项菜单：限流后的用户出路

`rate-limit-options` 命令是一个**隐藏内部命令**（`isHidden: true`），只在限流触发时由系统自动调用。它提供最多三个选项：

```typescript
// rate-limit-options.tsx — 选项构建逻辑
actionOptions = []
if (extraUsage.isEnabled()) {
  // "Switch to extra usage" 或 "Request extra usage" 或 "Add funds..."
  actionOptions.push({ label: ..., value: 'extra-usage' })
}
if (!isMax20x && !isTeamOrEnterprise && upgrade.isEnabled()) {
  actionOptions.push({ label: 'Upgrade your plan', value: 'upgrade' })
}
// 始终有取消选项
cancelOption = { label: 'Stop and wait for limit to reset', value: 'cancel' }
```

选项顺序受 GrowthBook 特性开关 `tengu_jade_anvil_4` 控制——`buyFirst=true` 时付费选项排在前面（"先买后等"），否则取消选项在前（"先等后买"）。这是一个典型的 A/B 测试驱动的转化率优化。

#### B.4 Mock 测试系统：22 种场景模拟

`mockRateLimits.ts`（~400 行）实现了一个完整的限流场景模拟器，`MockScenario` 共 **20 种**（`mockRateLimits.ts:60-80`，`grep` 核实）：`normal`、`session-limit-reached`、`approaching-weekly-limit`、`weekly-limit-reached`、`overage-active`、`overage-warning`、`overage-exhausted`、`out-of-credits`、`org-zero-credit-limit`、`org-spend-cap-hit`、`member-zero-credit-limit`、`seat-tier-zero-credit-limit`、`opus-limit`、`opus-warning`、`sonnet-limit`、`sonnet-warning`、`fast-mode-limit`、`fast-mode-short-limit`、`extra-usage-required`、`clear`。每种场景设置一组特定的 HTTP header mock 值。

`rateLimitMocking.ts` 是 facade 层——它在每个 API 请求前检查是否启用了 mock，如果是则拦截 header 并注入模拟值。对于 `status=rejected` 的场景，它甚至直接构造 `APIError(429, ...)` 对象，完全跳过真实 API 调用。

> 💡 **通俗理解**：这就像飞行员训练时的飞行模拟器——不用真的制造一次发动机故障，就能练习紧急降落流程。工程师用 `/mock-limits` 命令进入"模拟器模式"，测试各种限流场景下的 UI 表现。

#### B.5 批判

**信息前缀的脆弱匹配**：`RATE_LIMIT_ERROR_PREFIXES` 数组（`rateLimitMessages.ts:21-32`）用前缀字符串匹配来判断一条消息是否是限流错误——诸如 "You've hit your"、"You've used" 等。任何文案修改（哪怕只是改标点或加粗斜体）都可能导致 UI 组件无法识别限流状态。更稳健的设计应该在消息对象上附加结构化的类型标签（如 `errorCode: 'RATE_LIMIT'`），而非依赖文本内容的起始字符串匹配。

---

### C. Remote Sessions WebSocket 与 Env-less Bridge 实现细节（~1400 行）

> **源码位置**：`src/remote/SessionsWebSocket.ts`（404 行）、`src/bridge/remoteBridgeCore.ts`（1008 行）

> 💡 **通俗理解**：第 12 章讲了 Bridge 远程控制的"大楼蓝图"——从 v1 环境层到 v2 直连的架构演进。本节讲的是 v2 大楼里的"水电气管道"：WebSocket 断了怎么重连、JWT 过期了怎么刷新、一千条消息同时发送时怎么排队不丢失。

> **与第 12 章的关系**：第 12 章已覆盖 Bridge 的整体架构、v1/v2 对比、五步生命周期。本节聚焦第 12 章未展开的两个实现文件：`SessionsWebSocket`（CCR Web 端的 WebSocket 客户端）和 `remoteBridgeCore`（Env-less 桥接的完整状态管理）。

#### C.1 SessionsWebSocket：分层重连策略

`SessionsWebSocket` 是 CCR（Claude Code Remote）Web 界面用来订阅会话事件流的 WebSocket 客户端。它的重连策略按 close code 分为三个层级：

```typescript
// SessionsWebSocket.ts — 重连决策
const PERMANENT_CLOSE_CODES = new Set([4003])  // unauthorized → 永不重连
const MAX_SESSION_NOT_FOUND_RETRIES = 3        // 4001 → 有限重试
const MAX_RECONNECT_ATTEMPTS = 5               // 其他 → 通用重连

handleClose(closeCode) {
  // 层级1：永久拒绝（4003 unauthorized）→ 立即放弃
  if (PERMANENT_CLOSE_CODES.has(closeCode)) { onClose(); return }

  // 层级2：瞬态缺失（4001 session not found）→ 渐进延迟重试
  // 服务端压缩期间可能短暂认为 session 过期
  if (closeCode === 4001) {
    sessionNotFoundRetries++
    if (sessionNotFoundRetries > 3) { onClose(); return }
    scheduleReconnect(RECONNECT_DELAY_MS * sessionNotFoundRetries, ...)
    return
  }

  // 层级3：通用断连 → 标准重连（最多5次）
  if (previousState === 'connected' && reconnectAttempts < 5) {
    reconnectAttempts++
    scheduleReconnect(RECONNECT_DELAY_MS, ...)
  }
}
```

4001 的特殊处理值得注意——注释明确说明这是因为服务端在"compaction"（压缩）期间会短暂认为会话过期。这是一种**基于业务语义的重连策略**，而非简单的"断了就重连"。

**双运行时兼容**：`connect()` 方法内部区分 Bun 和 Node.js 两种运行时——Bun 使用原生 `WebSocket`（通过 `addEventListener`），Node.js 使用 `ws` 包（通过 `.on()`）。两种路径做完全相同的事情，只是 API 形式不同。30 秒心跳间隔（`PING_INTERVAL_MS`）保持连接活跃。

#### C.2 Env-less Bridge 核心：十步生命周期

`remoteBridgeCore.ts` 的 `initEnvLessBridgeCore()` 函数实现了完整的无环境层桥接，源码注释标注了十个步骤（具体在 `remoteBridgeCore.ts` 内以 `// Step 1:` 到 `// Step 10:` 的注释段分隔）。第 12 章已详细展开前三步：**(1) 创建 session 对象与初始状态**、**(2) 获取 OAuth token 与凭证**、**(3) 建立 V2 transport 连接**。本节补充后七步（4–10）的实现细节，其中本附录明确呈现了 **步骤 4（状态管理与去重）、5（JWT 刷新竞态）、7（Transport Rebuild）、9（Teardown）**——步骤 6、8、10 篇幅较短未单独列小标题，但在后面的讨论中有覆盖。

**步骤 4 — 状态管理与消息去重**：

```typescript
// remoteBridgeCore.ts — 双层 UUID 去重
const recentPostedUUIDs = new BoundedUUIDSet(2000)  // 环形缓冲区，容量 2000
const initialMessageUUIDs = new Set<string>()         // 不限容量的兜底集合

// 为什么需要两层？
// recentPostedUUIDs 是环形缓冲区，超过 2000 条后旧 UUID 会被驱逐。
// 如果初始历史消息很多，它们的 UUID 可能被驱逐后再被服务端回放，
// 导致重复消息。initialMessageUUIDs 是不限容量的兜底防线。
```

这种"环形缓冲区 + 无界兜底集合"的双层去重是一种**纵深防御**（defense-in-depth）模式，注释明确说是从 `replBridge.ts` 继承的设计。

**步骤 5 — JWT 刷新调度器的竞态防护**：

JWT 过期刷新和 SSE 401 恢复可能同时触发（典型场景：笔记本合盖唤醒后）。代码用 `authRecoveryInFlight` 布尔闩锁解决竞态：

```typescript
// remoteBridgeCore.ts — 竞态防护
onRefresh: (sid, oauthToken) => {
  // 关键：在 /bridge 请求之前就抢占标志位
  // 因为每次 /bridge 调用都会 bump epoch
  // 如果两个路径都调用 /bridge，第一个拿到的 epoch 立刻过期 → 409
  if (authRecoveryInFlight || tornDown) return
  authRecoveryInFlight = true
  // ... fetch + rebuildTransport ...
}
```

注释里的"each /bridge call bumps epoch"是关键洞察：epoch 是服务端的单调递增版本号，每次 `/bridge` 调用都会 +1。如果两个刷新路径并发调用 `/bridge`，先完成的那个拿到的 epoch 在后者完成时就已经过期了。

**步骤 7 — Transport Rebuild 的 FlushGate 机制**：

`rebuildTransport()` 在重建传输层期间必须暂停所有写入——否则消息会写入一个即将被关闭的旧传输通道：

```typescript
// remoteBridgeCore.ts — FlushGate 队列
async function rebuildTransport(fresh, cause) {
  flushGate.start()  // 开始排队，所有 writeMessages 进入缓冲
  try {
    const seq = transport.getLastSequenceNum()  // 保存序列号
    transport.close()                           // 关闭旧传输
    transport = await createV2ReplTransport({   // 创建新传输
      initialSequenceNum: seq,                  // 从旧序列号继续
      // ...
    })
    wireTransportCallbacks()
    transport.connect()
    drainFlushGate()  // 排空缓冲，写入新传输
  } finally {
    flushGate.drop()  // 失败时丢弃队列
  }
}
```

`initialSequenceNum: seq` 确保了新传输从旧传输的高水位标记继续，服务端不会重放已经接收过的消息。

**步骤 9 — Teardown 的预算约束**：

```typescript
// remoteBridgeCore.ts — 优雅关闭
async function teardown() {
  // 1. 先发 result message（fire-and-forget）
  transport.reportState('idle')
  void transport.write(makeResultMessage(sessionId))

  // 2. 再 archive session（有时间预算）
  // gracefulShutdown 给清理函数总共 2 秒
  // archive 超时设为 1500ms，留 500ms 给其他清理
  let status = await archiveSession(..., cfg.teardown_archive_timeout_ms)

  // 3. 如果 archive 返回 401 → 尝试刷新 OAuth 重试一次
  if (status === 401 && onAuth401) {
    await onAuth401(token ?? '')
    status = await archiveSession(...)
  }

  // 4. 最后关闭传输
  transport.close()
}
```

注意"先写 result，后 archive"的顺序——`transport.write()` 只是入队（SerialBatchEventUploader 缓冲后异步发送），archive 的 100-500ms 网络延迟给了上传器一个自然的"排水窗口"。如果反过来先 close 再 write，`closed=true` 会阻止排水循环。

#### C.3 行业对比与批判

**对比 VS Code Remote Tunnels**：VS Code 的远程隧道使用 `dev.tunnels.api.visualstudio.com` 的长连接，断连后依赖 Azure 基础设施的自动恢复。Claude Code 的方案更轻量（纯 OAuth + SSE，无需额外基础设施），但也更脆弱——JWT 过期、epoch 竞态、compaction 瞬态丢失等边界情况都需要客户端代码逐一处理。

**FlushGate 的设计权衡**：`flushGate.drop()` 在 rebuild 失败时丢弃所有排队消息。这意味着如果网络恢复后重建又失败，用户在"排队窗口"期间的操作会静默丢失。代码注释坦承了这一点（"Queued messages are dropped (transport still dead)"），但没有提供用户可见的通知。一个改进方向是在 `drop()` 时触发 UI 提示，让用户知道有消息可能丢失。

**1008 行的闭包工厂**：`initEnvLessBridgeCore` 是一个巨型闭包工厂函数——所有状态（`transport`、`tornDown`、`authRecoveryInFlight`、`initialFlushDone` 等）都是闭包变量。这种模式在 JavaScript 中很常见，但当闭包变量超过 10 个时，心智负担急剧增加。相比之下，`SessionsWebSocket` 使用了更传统的 class 模式，状态管理更清晰。

> 🔑 **深度洞察**：这三个子系统代表了 Claude Code 工程复杂度的三种来源——**Computer Use** 的复杂度来自跨进程通信（Terminal → MCP → Chrome Extension → Web Page），**Rate Limiting** 的复杂度来自产品逻辑的组合爆炸（用户类型 x 限流类型 x 超额状态 x 计费权限），**Remote Bridge** 的复杂度来自分布式系统的经典问题（断连恢复、竞态条件、消息去重、有序投递）。它们共同说明了一件事：AI 编程工具的真正工程挑战不在 AI 本身，而在 AI 与真实世界对接时那些"脏乱差"的边界情况。
