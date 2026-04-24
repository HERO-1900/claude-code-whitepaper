# Fast Mode 与 UltraPlan 完全解析

Claude Code 不是一个静态的工具——它有"档位"。Fast Mode（827 行）让 AI 切换到高速推理模式（同一个 Opus 4.6 模型，但输出速度更快），UltraPlan（1,557 行）则让 AI 通过云端的 Claude 实例执行 30 分钟级别的大规模探索任务。这两个系统代表了 Claude Code 在性能和能力两个维度上的"升档"能力。

> **源码位置**（以 `wc -l` / `cc-source-stats-report.md` 实测）：Fast Mode — `src/utils/fastMode.ts`（533 行）、`src/commands/fast/`（294 行）；UltraPlan — `src/commands/ultraplan.tsx`（470 行）、`src/utils/ultraplan/`（476 行）

> 💡 **通俗理解**：Fast Mode 就像汽车的 Sport 模式——同一台发动机，但油门响应更快、换挡更激进。UltraPlan 则像把任务交给远程的"专家团队"——你在本地下单，云端的 Claude 花 30 分钟做深度规划，完成后把方案发回给你审批。

---

## 第一部分：Fast Mode

### 行业背景

"快速模式"在 AI 编程工具中有不同的实现方式：

- **Cursor**：Tab 补全与对话使用不同模型——Tab 走的是 Cursor 自研/微调的小模型（为低延迟、按键级响应优化），对话走标准大模型（如 Claude、GPT）。具体是否"Tab 用小模型"依公开资料汇总，不同 Cursor 版本可能有变化，本书不替 Cursor 团队做权威声明。
- **GitHub Copilot**：调速通常通过选择不同模型 tier（如 `gpt-4o` vs `gpt-4o-mini`）和上下文长度做权衡，文档未公开声明对 `temperature`/`max_tokens` 做端到端用户可感知的"fast 档位"。本条描述属**行业面上的常见做法**，非 Copilot 官方明示。
- **Codex（OpenAI）**：无明确的快速模式，但支持不同模型 tier（GPT-4o vs o3）

Claude Code 的 Fast Mode 独特之处在于：**不切换模型**——仍然是 Opus 4.6，只是推理引擎的输出速度更快。这避免了"快速模式=低质量模式"的陷阱。

---

### 1. 架构

```
用户: /fast (切换 Fast Mode)
  │
  ▼
┌────────────────────────────────────────────┐
│ fast.tsx — CLI 命令 UI                      │
│  · 显示当前状态                              │
│  · 切换开关                                  │
│  · 显示不可用原因                            │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ fastMode.ts — 状态管理核心                   │
│  · isFastModeEnabled(): 当前是否开启         │
│  · isFastModeAvailable(): 是否可用           │
│  · getFastModeUnavailableReason(): 原因      │
│  · 冷却(Cooldown)管理                        │
│  · 组织(Org)级别控制                         │
│  · 超额(Overage)计费检查                     │
└────────────────────────────────────────────┘
```

### 2. 多层可用性判定

Fast Mode 是否可用取决于多个独立条件——全部满足才能启用：

```
           ┌─ 模型支持? (仅 Opus 4.6) ─── No → 不可用
           │
           ├─ 提供商支持? (仅 1P Anthropic) ─── Bedrock/Vertex/Foundry → 不可用
           │
用户切换 ──┤─ 组织级别允许? (GrowthBook flag) ─── 组织关闭 → 不可用
           │
           ├─ 计费状态正常? (无超额) ─── 超额未确认 → 不可用
           │
           └─ 速率限制冷却中? ─── 冷却未过期 → 暂时不可用
```

> **修正说明**：早期草稿列出过"每会话确认 (可选 flag)"这一层——`fastMode.ts` 中**没有**对应的 per-session 确认开关。Fast Mode 的启用由 userSettings 的 `fastMode` 字段决定（布尔），而非每次会话重新弹窗确认。已从判定链中移除。

### 3. 冷却机制

当 API 返回速率限制（429）时，Fast Mode 不是立即重试，而是进入冷却期：

```typescript
// fastMode.ts:214-233 — 冷却管理（真实源码）

export function triggerFastModeCooldown(
  resetTimestamp: number,         // 由调用方传入，通常来自服务端响应头（retry-after 类）
  reason: CooldownReason,         // 'rate_limit' | 'overloaded'
): void {
  if (!isFastModeEnabled()) return
  runtimeState = { status: 'cooldown', resetAt: resetTimestamp, reason }
  // ... 记录日志 + 发送 analytics + 触发 onCooldownTriggered 信号
}

// 冷却到期自动恢复（轮询 Date.now() >= resetAt）：
// - isFastModeAvailable() / isFastModeEnabled() 自动读取 runtimeState
// - resetAt 到达后 runtimeState 被重置为 'active'，onCooldownExpired 触发
```

> **关键修正**：早期草稿写"指数退避 5min / 15min / 1h"——这是事实捏造。源码的 `triggerFastModeCooldown(resetTimestamp, reason)` **直接接受由调用方传入的 `resetAt` 时间戳**（通常是服务端通过 rate-limit 响应头指定的重置时间），本地没有任何"5/15/60 指数退避"逻辑。冷却时长完全由服务端决定。

```
// 事件信号
onCooldownTriggered  → UI 显示冷却倒计时
onCooldownExpired    → UI 显示 "Fast Mode 已恢复"
```

> 💡 **通俗理解**：就像开车开到限速路段——你可以踩 Sport 模式，但如果超速被测速相机拍到（触发速率限制），系统会自动降回普通模式并"罚你"等一会儿（冷却期）。具体罚多久不是客户端自己决定的"先 5 分钟、再 15 分钟"——是服务端告诉你"到 XX:XX 之前别来"，客户端等到那个时刻才恢复。

### 4. 组织级控制

Fast Mode 不是纯用户级功能——组织管理员可以通过 GrowthBook Feature Flag 全局控制：

```typescript
// GrowthBook flag: tengu_penguins_off
// true → 组织禁用 Fast Mode
// false → 组织允许 Fast Mode

// 优先级: 组织关闭 > 用户想开 → 不可用
// 即使用户设置了 "我要 Fast Mode"，组织说关就关
```

### 5. 超额计费检查

```typescript
// 如果用户的 API 使用量超过免费额度:
// 1. 检查是否启用了 "Extra Usage"
// 2. 如果未启用 → Fast Mode 不可用
// 3. 如果组织拒绝了超额请求 → 调用 handleFastModeOverageRejection()

// 源码 fastMode.ts:295-313 的真实行为：
handleFastModeOverageRejection(reason: string | null): void {
  // 条件禁用（非 "out-of-credits" 原因才真正禁用）：
  if (!isOutOfCreditsReason(reason)) {
    updateSettingsForSource('userSettings', { fastMode: undefined })     // 清除用户级开关
    saveGlobalConfig(current => ({ ...current, penguinModeOrgEnabled: false }))  // 组织级开关落盘 false
  }
  // "out-of-credits" 情况下不做上述持久化修改（用户补值后即可恢复）
}
```

> **关键修正**：早期草稿称"永久禁用（本会话内）"——这是自相矛盾（永久 vs 本会话）。源码实际效果：
> - 当 reason 为信用额度不足（out-of-credits）时：**不做持久化禁用**，用户充值后即可恢复 Fast Mode；
> - 当 reason 为其他（组织拒绝、配额关闭等）时：**写入 userSettings 和全局配置**，使得 Fast Mode 跨会话保持禁用——用户需到 Anthropic 控制台或重新开启设置后才能恢复。
>
> 这是"条件性的跨会话禁用"，不是"永久禁用"也不是"仅本会话禁用"。

---

## 第二部分：UltraPlan

### 行业背景

"大规模规划"在 AI 工具中是一个新兴能力：

- **Devin（Cognition）**：长时间自主执行，但缺乏用户审批节点
- **GitHub Copilot Workspace**：规划 → 审批 → 执行，但规划时间较短
- **SWE-Agent**：自主 debug 循环，无规划/审批分离
- **OpenAI o3/o4**：长推理链，但在 API 层面，不是编程工具层面

Claude Code 的 UltraPlan 独特之处在于：**远程规划 + 本地审批 + 可传送**——规划在云端完成（利用远程 Claude 的更大资源），但执行权回到用户手中。

---

### 6. 架构

```
用户: "帮我规划如何重构认证模块"
  │
  ▼
┌────────────────────────────────────────────┐
│ ultraplan.tsx — 命令调度器 (470 行)          │
│  · 组装系统提示词 + 用户输入                 │
│  · 启动远程 CCR 会话                         │
│  · 30 分钟超时                               │
└─────────────────┬──────────────────────────┘
                  │ 远程会话
                  ▼
┌────────────────────────────────────────────┐
│ 云端 Claude (CCR = Claude Code Remote)      │
│  · 在云端执行代码探索                        │
│  · 产出结构化计划                            │
│  · 阶段: running → needs_input → plan_ready  │
└─────────────────┬──────────────────────────┘
                  │ 事件流
                  ▼
┌────────────────────────────────────────────┐
│ ccrSession.ts — 事件轮询 + 计划提取         │
│  · 后台轮询远程会话状态                      │
│  · ExitPlanModeScanner: 无副作用状态机       │
│  · 提取远程 Claude 产出的计划                │
└─────────────────┬──────────────────────────┘
                  │ 计划文本
                  ▼
┌────────────────────────────────────────────┐
│ PlanModal (浏览器 UI)                        │
│  · 展示计划给用户                            │
│  · 用户选择: 批准 / 拒绝 / 修改             │
│  · "在 CCR 执行" 或 "传送到本地"            │
└────────────────────────────────────────────┘
```

### 7. 状态机

```
           ┌────────┐
           │running │ ← 远程 Claude 正在探索代码、思考方案
           └───┬────┘
               │ Claude 需要用户输入（如 "你想保留旧接口吗？"）
               ▼
         ┌───────────┐
         │needs_input│ ← 等待用户回复
         └─────┬─────┘
               │ 用户回复后继续
               ▼
           ┌────────┐
           │running │ ← 继续规划
           └───┬────┘
               │ 规划完成
               ▼
         ┌───────────┐
         │plan_ready │ ← 计划已就绪，等待用户审批
         └─────┬─────┘
               │
           ┌───┴───┐
           ▼       ▼
     "在CCR执行" "传送到本地"
     (远程PR)    (本地选择执行)
```

### 8. ExitPlanModeScanner — 有状态、无 I/O 的事件扫描器

UltraPlan 的事件流解析器是一个 **class 形式的有状态扫描器**，但 `ingest()` 方法没有 I/O。设计原则是"状态 + 纯计算"的组合，而非纯函数：

```typescript
// ccrSession.ts:80 — ExitPlanModeScanner（简化版，完整见源码）

export class ExitPlanModeScanner {
  private exitPlanCalls: string[] = []          // 累积的 tool_use ID 列表
  private results = new Map<string, ToolResultBlockParam>()  // tool_result 映射
  private rejectedIds = new Set<string>()       // 被用户拒绝的 ID 集合
  private terminated: { subtype: string } | null = null
  private rescanAfterRejection = false
  everSeenPending = false

  // 派生属性：当前是否有等待用户审批的 ExitPlanMode
  get hasPendingPlan(): boolean {
    const id = this.exitPlanCalls.findLast(c => !this.rejectedIds.has(c))
    return id !== undefined && !this.results.has(id)
  }

  get rejectCount(): number {
    return this.rejectedIds.size
  }

  // 注：源码中**没有 `get phase()` getter**。"phase" 是调用方基于 hasPendingPlan、
  // exitPlanCalls、results 等派生属性计算出的外部状态（见 ccrSession.ts:286-294）：
  //   const phase = scanner.hasPendingPlan ? 'needs_input' : ...
  // 早期草稿中出现的 `scanner.phase` 是虚构 API。

  ingest(newEvents: SDKMessage[]): ScanResult {
    // 扫描事件批次：assistant/tool_use → 累入 exitPlanCalls
    // user/tool_result → 累入 results；拒绝或终止 → 更新 rejected/terminated
    // 无 I/O、无计时器（注释原文："No I/O, no timers"）
  }
}
```

> **关键修正**：
> - 早期草稿把 Scanner 描述为"纯函数设计"——不准确。Scanner 是**有状态 class**（至少 6 个内部可变字段），只是 `ingest()` 方法的计算过程无 I/O。应称"**有状态、无副作用**的事件扫描器"。
> - 早期草稿声称 `scanner.phase` 是类的 getter——事实错误。源码没有 `.phase` getter，phase 是外部代码基于 `hasPendingPlan` 等派生属性在 `ccrSession.ts:286-294` 自己拼出来的 `UltraplanPhase` 值。

### 9. "传送"机制

当远程规划完成后，用户可以选择把计划"传送"（Teleport）回本地：

```
远程 CCR 完成规划
  │
  ▼
用户选择 "传送到本地"
  │
  ▼
计划文本传输到本地 CLI
  │
  ▼
本地 Claude Code 接收计划
  │
  ▼
用户在本地决定: 执行 / 修改 / 放弃
```

> 💡 **通俗理解**：就像请外部顾问做规划——你把项目资料发给顾问（远程 Claude），顾问花几小时出方案（30 分钟规划），方案做好后发回给你审批。你可以选择"让顾问来执行"（在 CCR 执行）或"我自己来"（传送到本地）。

### 10. 拒绝追踪

系统追踪用户拒绝计划的次数，用于产品优化：

```typescript
// 如果用户多次拒绝 UltraPlan 的产出:
// → 上报 analytics（匿名化）
// → 帮助 Anthropic 改善规划质量
// → 不会影响用户体验（不会因此限制功能）
```

---

## 设计取舍

### Fast Mode

| 决策 | 选择 | 替代方案 | 理由 |
|------|------|---------|------|
| 同模型加速 | ✅ Opus 4.6 不变 | 切换到小模型（如 Sonnet） | 保证质量不下降 |
| 组织级控制 | ✅ 管理员可全局禁用 | 纯用户级控制 | 成本管控需要 |
| 冷却而非硬拒 | ✅ 自动恢复 | 触发后永久关闭 | 更好的用户体验 |
| 仅 1P API | ✅ 不支持第三方 | 支持 Bedrock/Vertex | Fast Mode 依赖 Anthropic 内部基础设施 |

### UltraPlan

| 决策 | 选择 | 替代方案 | 理由 |
|------|------|---------|------|
| 远程执行规划 | ✅ CCR 云端 | 本地执行 | 远程有更多资源（内存、上下文） |
| 用户审批节点 | ✅ 必须审批 | 自动执行 | 30 分钟规划影响大，需要人类把关 |
| 30 分钟超时 | ✅ 硬限制 | 无限制 | 防止成本失控 |
| 传送机制 | ✅ 支持回传本地 | 只能远程执行 | 用户可能想在本地环境执行 |

---

## 批判与反思

### Fast Mode 的感知 vs 实际

"同一个模型，更快的输出"——用户可能会问"那为什么不一直用 Fast Mode？"答案是：Fast Mode 的加速是通过推理引擎的不同配置实现的。Anthropic 未公开 Fast Mode 与常规模式的具体权衡，源码本身也未体现该权衡机制——因此本文无法断言 Fast Mode 是否影响推理深度；用户在选择时主要依据的是可用配额与响应速度，而非可量化的质量差异。

### UltraPlan 的"规划悖论"

让 AI 花 30 分钟做规划，但用户需要等待——这可能比用户自己花 10 分钟快速规划还慢。UltraPlan 的价值取决于规划质量是否真的显著高于本地 Claude 的即时规划。对于简单任务，UltraPlan 可能过度工程化；对于真正复杂的重构，30 分钟可能又不够。

> 🔑 **深度洞察**：Fast Mode 和 UltraPlan 代表了 AI 工具的两种扩展方向——**速度**（同样的事做得更快）和**深度**（做更复杂的事）。它们的共同点是：都需要在"用户控制"和"自主行动"之间找平衡。Fast Mode 通过组织级控制和冷却机制让用户保持控制权；UltraPlan 通过审批节点和传送机制让用户保持决策权。在 AI 越来越强大的趋势下，这些"保持人类在环"的设计模式会越来越重要。
