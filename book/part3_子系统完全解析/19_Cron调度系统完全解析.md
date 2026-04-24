# Cron 调度系统完全解析

Claude Code 不仅是一个"对话式"工具——它可以像一个永不休息的值班员，按照你设定的时间表定期执行任务。Cron 调度系统（1,601 行，5 个核心文件）让用户通过自然语言设定定时任务（如"每 30 分钟检查一次部署状态"），系统会在后台持续执行。**但有一个前提**：任务创建时必须显式传 `durable: true`，它才会写入 `.claude/scheduled_tasks.json` 并跨会话存活；默认 `durable: false` 的任务仅在当前会话内有效，会话结束即消失。这是 Claude Code 从"被动响应"演进为"主动巡逻"的关键基础设施。

> **源码位置**：`src/utils/cronScheduler.ts`（565 行）、`src/utils/cronTasks.ts`（458 行）、`src/utils/cron.ts`（308 行）、`src/utils/cronTasksLock.ts`（195 行）、`src/utils/cronJitterConfig.ts`（75 行），合计 1,601 行（以 Claude Code 2.1.88 源码 `wc -l` 核实）

> 💡 **通俗理解**：Cron 调度就像你手机上的闹钟 App——你设好"每天早上 7 点叫我"、"每 30 分钟提醒喝水"，手机会在后台持续工作，到点就响。不同的是，这个"闹钟"响了之后不是发出声音，而是让 AI 执行一段工作（检查代码、跑测试、更新进度等）。

### 行业背景

定时/后台任务在 AI 编程工具中是一个相对新兴的能力：

- **GitHub Copilot**：无原生定时任务，依赖 GitHub Actions 的 cron trigger
- **Cursor**：无定时功能，纯被动响应
- **Aider**：可以通过外部 cron 调用 `aider --message`，但不是内置能力
- **Codex（OpenAI）**：有 agent 模式的持续执行，但无用户自定义定时调度

Claude Code 的 Cron 系统是少数**内置于 AI 编程工具**的定时调度器，支持文件持久化、多会话安全、自动过期等生产级特性。

---

## 概述

本章按以下顺序展开：第 1 节拆解核心架构（调度器 + 任务存储 + 锁机制）；第 2 节深入 cron 表达式解析器；第 3 节讲解文件持久化与多会话安全；第 4 节分析抖动（Jitter）机制；第 5 节解析任务生命周期管理；第 6 节讨论设计取舍。

---

> **[图表预留 3.19-A]**：Cron 调度器架构图 — CronScheduler ↔ CronTasks 文件存储 ↔ Lock 多会话协调

> **[图表预留 3.19-B]**：任务生命周期 — 创建 → 持久化 → 调度 → 触发 → 执行 → 过期/删除

---

## 1. 核心架构

### 1.1 三层组件

```
用户: "/loop 30m 检查部署状态"
  │
  ▼
┌────────────────────────────────────────────┐
│ /loop Skill (解析层)                        │
│  · 自然语言 → interval + prompt             │
│  · interval → cron 表达式                    │
│  · 调用 CronCreate 工具                      │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ CronCreate / CronDelete / CronList (工具层)  │
│  · 创建/删除/列出任务                         │
│  · 生成任务 ID                                │
│  · 设置 recurring / one-shot 标记             │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ cronScheduler.ts (调度层)                    │
│  · 定时检查待触发任务                         │
│  · 多会话锁协调                               │
│  · Jitter 抖动防雷群效应                      │
│  · 触发后执行 prompt                          │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ cronTasks.ts (持久化层)                      │
│  · .claude/scheduled_tasks.json 文件存储     │
│  · Chokidar 文件变更监听                      │
│  · 读写原子性保护                             │
└────────────────────────────────────────────┘
```

### 1.2 代码量分布

| 文件 | 行数 | 职责 |
|------|------|------|
| `cronTasks.ts` | 458 | 任务文件 I/O、解析、序列化、文件监听 |
| `cronScheduler.ts` | 565 | 调度核心、定时检查、锁获取、触发执行 |
| `cron.ts` | 308 | Cron 表达式解析器、下次触发时间计算 |
| `cronTasksLock.ts` | 195 | 多会话文件锁、死进程探测 |
| `cronJitterConfig.ts` | 75 | 抖动配置（GrowthBook 远程控制） |
| **合计** | **1,601** | |

---

## 2. Cron 表达式解析器（cron.ts）

### 2.1 标准 cron 格式

```
┌───────────── 分 (0-59)
│ ┌───────────── 时 (0-23)
│ │ ┌───────────── 日 (1-31)
│ │ │ ┌───────────── 月 (1-12)
│ │ │ │ ┌───────────── 星期 (0-7, 0和7都是周日)
│ │ │ │ │
* * * * *
```

### 2.2 核心函数

```typescript
// cron.ts 导出的两个核心函数（两步式调用链：先解析、再计算）

// 步骤 1：解析 cron 表达式为结构化字段（失败时返回 null）
parseCronExpression(expr: string): CronFields | null

// 步骤 2：基于已解析字段和起始时间计算下次触发时间
computeNextCronRun(fields: CronFields, from: Date): Date | null
```

### 2.3 /loop 的自然语言转换

`/loop` 是 Cron 系统的用户入口——它把自然语言时间间隔转换为标准 cron 表达式：

| 用户输入 | 解析后的间隔 | Cron 表达式 | 说明 |
|---------|------------|------------|------|
| `5m /check-tests` | 5m | `*/5 * * * *` | 每 5 分钟 |
| `2h check deploy` | 2h | `0 */2 * * *` | 每 2 小时 |
| `1d backup` | 1d | `0 0 */1 * *` | 每天午夜 |
| `30s ping` | 30s → 1m | `*/1 * * * *` | 秒级向上取整到分钟 |
| `check deploy every 20m` | 20m | `*/20 * * * *` | 尾部 "every" 模式 |
| `90m report` | 90m → 2h | `0 */2 * * *` | N≥60 时需折算为整除 24 的小时数（`H = N/60`），不整除时向最近的可表达间隔近似（见 ch.14 §6.4 `loop.ts` 转换表） |

> 💡 **通俗理解**：`/loop` 就像一个翻译官——你说"每半小时看一下"，它翻译成机器能理解的 `*/30 * * * *`。如果你说了一个机器无法精确表达的时间（比如"每 90 分钟"——cron 最小粒度是分钟，但 90 分钟不能被 60 整除），翻译官会先选一个最接近的可表达间隔（如 2 小时），然后**直接告知用户**"我已经把它四舍五入为 X，已经开始调度"。注意：源码指令是 `tell the user what you rounded to before scheduling`（`loop.ts`），即"告知"而非"询问确认"——不是征求意见的商量口吻。

---

## 3. 文件持久化与多会话安全

### 3.1 持久化格式

任务以 `CronTask[]` 形式存储在 `.claude/scheduled_tasks.json`（字段以源码持久化格式为准）：

```json
{
  "tasks": [
    {
      "id": "cron_abc123",
      "cron": "*/30 * * * *",
      "prompt": "检查部署状态",
      "createdAt": "2026-04-05T10:00:00Z",
      "lastFiredAt": "2026-04-05T10:30:00Z",
      "recurring": true,
      "permanent": false
    }
  ]
}
```

> **字段注记**：源码实际持久化的字段是 `{ id, cron, prompt, createdAt, lastFiredAt?, recurring?, permanent? }`。本章早期草稿中出现的 `lastRun`/`expiresAt`/`sessionId`/`scheduledAt` 均非源码字段——自动过期依据 `createdAt + TTL` 动态计算，不落盘；会话归属由运行时内存结构管理而非持久化到 JSON。

### 3.2 Chokidar 文件监听

当多个 Claude Code 实例共享同一个工作目录时，每个实例都需要感知任务文件的变更。文件监听逻辑位于 `cronScheduler.ts` 的 `enable()` 方法中，而非独立的 watcher 函数：

```typescript
// cronScheduler.ts:enable() — 调度器启用时直接调用 chokidar.watch
chokidar.watch(getCronFilePath(dir), { ... }).on('change', () => {
  // 文件变更 → 等待 300ms 稳定期 → 重新加载任务列表
  // 300ms 阈值防止多次快速写入导致重复加载
})
```

> 注：早期草稿误将此处写成 `watchTeamMemory()`——该函数属于团队记忆同步子系统（见 Ch20），与 Cron 无关，已更正。

### 3.3 多会话锁（cronTasksLock.ts）

多个 Claude Code 实例可能同时运行，但同一个定时任务不应该被触发两次：

```typescript
// cronTasksLock.ts — 文件锁实现（真实源码行为）

// 获取锁（返回 true/false）
tryAcquireSchedulerLock(): boolean {
  // 1. 尝试 O_EXCL 原子创建锁文件（tryCreateExclusive）→ 成功即锁到
  // 2. 创建失败 → 读取现有锁；如果 sessionId 是自己的，幂等返回 true
  // 3. 现有锁进程仍存活（isProcessRunning(existing.pid)）→ 返回 false（被别人持有）
  // 4. 现有锁进程已死 → 视为 stale，unlink 后重试 O_EXCL 创建
  //
  // 注：**没有 lease 超时机制**。判定 stale 的唯一依据是"持有进程是否仍在运行"
  // （POSIX kill(pid, 0) / Windows 等价 API），而非 acquiredAt 的时间差。
}

// 释放锁
releaseSchedulerLock(): void {
  // 删除锁文件（仅当锁属于自己时）
}
```

> 💡 **通俗理解**：就像办公室的共用打印机——只有一个人能同时使用。张三点了打印，锁住了打印机；李四也想打印，发现锁住了就等着。如果张三打印到一半人走了（进程崩溃），系统会检测"张三这个进程 ID 还在不在"（而不是"多久没响应"），只要进程确认消失就立刻把锁让给李四；反过来，如果张三进程卡死但没崩，这把锁会**一直**在他手上，李四只能等——源码刻意没有"超时自动解锁"机制。

### 3.4 死进程探测

```typescript
// 锁文件内容（cronTasksLock.ts:SchedulerLock）:
{
  "sessionId": "sess_abcxyz",        // 稳定所有者键：REPL 用 getSessionId()；daemon 自带 UUID
  "pid": 12345,                      // 进程 ID —— 唯一的活性信号
  "acquiredAt": 1714050000000        // Date.now() 毫秒时间戳，仅作日志；不参与 stale 判定
}

// 判断持有者是否还活着 (cronTasksLock.ts:149):
// 1. isProcessRunning(existing.pid) —— POSIX kill(pid, 0) 探测
// 2. 进程不存在 → 视为 stale，unlink 锁文件后重新抢锁
// 3. 进程仍存活 → 视为活锁，返回 false（本次未抢到）
//
// 关键差异：**源码没有 lease 超时**。一个锁文件可以存在任意长时间，只要对应 PID 仍在运行。
// 如果持有进程卡死但没崩溃（如死循环），其他会话会**永久**被阻塞而非超时接管——
// 这是此方案相对于"lease-based lock"的取舍：牺牲死锁恢复能力，换取实现简单性。
```

---

## 4. 抖动（Jitter）机制

### 4.1 雷群效应

当多个 `*/5 * * * *` 任务在同一台机器上运行时，它们会在每个 `:00`、`:05`、`:10` 精确同时触发，造成 API 请求尖峰。

### 4.2 确定性偏移（基于 taskId 哈希）

```typescript
// cronTasks.ts:362 — jitterFrac(taskId) = taskId 的前若干位 hex 转成 [0, 1) 的定值
// 源码注释："Non-hex ids (hand-edited JSON) fall back to 0 = no jitter."

// cronTasks.ts:381 jitteredNextCronRunMs()：
//   jitter = min( jitterFrac(taskId) * cfg.recurringFrac * (t2 - t1), ...)
//   nextRun = t1 + jitter
//
// 关键事实：**jitter 是基于 taskId 的确定性偏移**（每次重算结果相同），
// 不是 Math.random()。同一任务跨进程、跨会话计算出的下一次触发时间完全一致——
// 这是为了保证集群内不同会话不会因随机打散而重复触发同一任务。
```

> 💡 **通俗理解**：就像学校放学——如果所有学生同时涌出校门，门口会堵死。Jitter 给每个任务按"它自己的编号"固定算一个偏移量（同一个学生每天固定晚 3 分钟、另一个学生固定晚 7 分钟），让触发时间错开。因为是**按编号确定**的而非随机，每次结果都一样，跨会话重算不会漂移。

---

## 5. 任务生命周期

### 5.1 创建

```
用户输入 → /loop 解析 → CronCreate 工具调用 →
  写入 scheduled_tasks.json（如 durable=true）→
  /loop skill 指令："Then immediately execute the parsed prompt now" —— 立即执行一次
```

> **来源注**：`CronCreate` 工具本身只负责"注册任务"，**不会自动立即执行**。"立即执行一次"是 `/loop` skill 的提示词级约定（`skills/bundled/loop.ts:67`，"Then immediately execute the parsed prompt now — don't wait for the first cron fire"）。通过其他路径（如直接调用 CronCreate 或由其他 skill 调度）创建的任务不自动立即执行。

### 5.2 调度与触发

```typescript
// cronScheduler.ts — 主调度循环

createCronScheduler(options) {
  return {
    start() {
      // 1. 获取多会话锁
      // 2. 加载任务列表
      // 3. 每秒 tick（CHECK_INTERVAL_MS = 1000，cronScheduler.ts:40）：
      //    检查哪些任务的 nextRun <= now？ cron 最小粒度仍是 1 分钟，
      //    但调度器轮询粒度是秒级——这是为了让 jitter 偏移 / 锁续期 / 多会话协调
      //    能在分钟边界内细粒度推进，不是每分钟集中爆发。
      // 4. 触发到期任务（执行其 prompt）
      // 5. 更新 lastRun 时间
      // 6. 检查过期任务（自动清理）
    },
    stop() {
      // 释放锁 + 停止定时器
    },
    getNextFireTime() {
      // 返回最近的下次触发时间（用于 UI 显示）
    }
  }
}
```

### 5.3 自动过期

```typescript
// recurring 任务的自动过期机制
// 默认 TTL: 7 天
// 从 createdAt 开始计算
// 过期后自动从 scheduled_tasks.json 中移除

if (task.recurring && task.expiresAt < now) {
  removeTask(task.id)  // 静默清理，不打扰用户
}
```

这个设计防止了用户设置定时任务后忘记取消，导致 API 费用持续产生。

### 5.4 遗漏任务检测

```typescript
// 启动时检查 (cronScheduler.ts:194-220): 有没有在停机期间"错过"的任务？
// 场景: 用户设了 "每小时检查一次"，但电脑关机了 3 小时

// One-shot 任务 (recurring=false):
//   - findMissedTasks() 按 cron + lastFiredAt + createdAt 判定是否已过触发点
//   - 调用 onMissed(missed) 或 onFire(buildMissedTaskNotification(missed))
//   - 通知文案要求 Claude 先用 AskUserQuestion 问用户"是否立即执行"，经确认后再跑
//   - 对应任务同时从 scheduled_tasks.json 中移除（不再重复提示）
// Recurring 任务: 不提示、不补跑——check() 在下一轮正常触发即可
```

### 5.5 Daemon 模式

```typescript
// 守护进程模式: 只执行标记为 permanent 的任务
// 用于后台持续运行的 Claude daemon
// 注：源码中 createCronScheduler 的选项名是 `filter`，
// 并且 `permanent` 是 CronTask 内部字段，不在 CronCreate 工具输入 schema 中暴露——
// 它由系统按任务来源自动赋值

const scheduler = createCronScheduler({
  dir: workingDir,
  filter: (t) => t.permanent  // 过滤掉会话级任务
})
```

---

## 6. 设计取舍

### 6.1 文件存储 vs 数据库

选择 JSON 文件而非 SQLite 或其他数据库：

| 方面 | JSON 文件 | 数据库 |
|------|----------|-------|
| 部署复杂度 | 零依赖 | 需要额外运行时 |
| 人类可读性 | ✅ 可直接查看/编辑 | ❌ 需要工具 |
| 并发安全 | 需要文件锁 | 内置事务 |
| 性能 | 任务量小时足够 | 大量任务时更优 |
| 可移植性 | 跨平台 | 需要对应平台的驱动 |

Claude Code 选择 JSON 文件，因为预期的任务量很小（通常个位数），文件锁机制已经足够保证多会话安全。

### 6.2 7 天自动过期

7 天 TTL 是一个务实的平衡：

- **太短**（如 1 天）：用户设置周级任务时需要反复续期
- **太长**（如 30 天）：忘记取消的任务会持续消耗 API 额度
- **无过期**：最危险——一个被遗忘的 `*/5 * * * *` 任务每天消耗 288 次 API 调用

### 6.3 分钟级最小粒度

Cron 的最小粒度是 1 分钟——即使用户要求"每 10 秒"，也会被向上取整到 1 分钟。这是因为：

- 每次任务触发都意味着一次完整的 AI 推理调用
- 10 秒间隔 = 每天 8,640 次调用，对 API 成本和速率限制都不现实
- 大多数实际场景（代码检查、部署监控）不需要秒级响应

---

## 7. 批判与反思

### 7.1 错过补偿策略过于简单

当前实现在停机后只有两种选择：立即执行（one-shot）或跳过（recurring）。对于"每小时检查部署状态"这种任务，如果停机 3 小时，理想的行为应该是"补执行 1 次最新的"，而非"补执行 3 次"或"完全跳过"。

### 7.2 任务隔离性

任务文件是 `dir/.claude/scheduled_tasks.json`——已经按工作目录天然隔离（不同项目在不同 cwd 下各自持有一份）。真正的隔离缺口出现在**同一工作目录内被多条逻辑线共用**的场景：

- monorepo 根目录下多个子包共用 `.claude/` → 子包的定时任务混在一起，无法按"子包"过滤
- 用户把个人笔记任务和项目任务都建在 `~/project/` → 两类任务共用 scheduled_tasks.json，`CronList` 只能按 ID 区分，没有 namespace/tag 维度

源码本身只保证"目录级隔离"，不提供项目内的细粒度命名空间。

### 7.3 可观测性不足

缺少任务执行历史记录——用户无法查看"过去一周每次定时检查的结果"。这限制了 Cron 系统在运维场景中的实用性。

> 🔑 **深度洞察**：Cron 调度系统虽然只有 1,601 行，但它代表了 AI 编程工具从"对话式"向"常驻式"演进的关键一步。当 AI 可以定时巡逻、主动监控、按计划执行，它就不再是"你问一句它答一句"的聊天工具，而是一个真正的软件工程团队成员——有自己的工作日程、值班时间和自动化流程。
