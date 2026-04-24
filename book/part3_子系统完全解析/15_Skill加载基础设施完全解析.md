# Skill 加载基础设施完全解析

本章解析 Claude Code 的 Skill 插件加载机制——从内置技能、用户自定义 Markdown 文件到 MCP 远程技能，解析发现、元数据解析、按需加载的完整链路。

---

> **🌍 行业背景**：插件/技能扩展机制是 AI 编程工具的核心竞争力之一。**Cursor** 通过 `.cursorrules` 文件（纯文本提示词）实现项目级行为定制，但不支持参数化调用或远程技能加载。**Aider** 通过 `.aider.conf.yml` 和命令行参数定制行为，没有独立的插件系统。**GitHub Copilot** 通过 Copilot Extensions（基于 GitHub Apps）实现第三方扩展，采用 OAuth + API 的重量级方案。**Windsurf** 使用 `.windsurfrules` 文件，类似 Cursor 的纯文本方案。Claude Code 的 Skill 系统独特之处在于采用 **Markdown + YAML frontmatter** 作为统一格式，同时支持本地文件和 MCP 远程加载，兼顾了轻量级（手写 .md 文件即可发布技能）和可扩展性（MCP 协议连接远程服务）。这种"提示词即插件"的设计理念，在 AI 原生工具中正在形成一种新范式。

---

## 本章导读

Skill（技能）是 Claude Code 2.1.88 中用于扩展 AI 能力的插件机制。每个 Skill 本质上是一个 Markdown 文件（包含 YAML frontmatter 元数据和 Markdown 正文提示词），当用户通过 `/skill-name` 斜杠命令或 Claude 自动判断调用时，Skill 的内容会作为上下文注入到对话中。

**技术比喻（OS 视角）**：Skill 加载系统像操作系统中的**动态链接库（DLL/SO）加载器**——有内置库（bundled skills，相当于 libc），有用户安装的库（目录中的 .md 文件，相当于 /usr/lib 下的库），有远程仓库的库（MCP skills，相当于 apt 源的包）。加载器负责发现、解析元数据（frontmatter ≈ ELF header）、解决依赖（allowed-tools ≈ symbol resolution）、按需加载（getPromptForCommand ≈ dlopen）。

> 💡 **通俗理解**：Skill 像**手机 App Store**——有内置 App（bundled skills，如计算器、天气），有第三方 App（用户自己写的 .md 文件或从 MCP 加载的），每个 App 有说明书（frontmatter 元数据），安装后就能用（加载执行），不同的来源有不同的信任级别（内置 > 本地 > MCP）。

## 文件结构

| 文件 | 大小 | 职责 |
|------|------|------|
| `loadSkillsDir.ts` | 34KB | 核心加载器——目录扫描、frontmatter 解析、命令构建 |
| `bundledSkills.ts` | 7.5KB | 内置技能注册框架——编译进二进制的技能 |
| `mcpSkillBuilders.ts` | 1.6KB | MCP 技能适配器——打破循环依赖的注册表 |
| `bundled/` 目录 | 17+ 个文件 | 具体的内置技能实现（含辅助内容文件） |

加上 `bundled/` 目录下的技能文件（17 个技能注册 + 辅助文件），Skill 子系统总计约 20+ 个文件。

## 1. 技能来源分类

### 1.1 六种来源（含一种废弃兼容）

`loadSkillsDir.ts` 第 67-75 行定义了技能的来源类型：

```typescript
export type LoadedFrom =
  | 'commands_DEPRECATED'  // 旧 /commands 目录（已废弃，向后兼容保留）
  | 'skills'               // .claude/skills/ 目录
  | 'plugin'               // 插件提供的技能
  | 'managed'              // 企业管理的技能
  | 'bundled'              // 编译进二进制的内置技能
  | 'mcp'                  // MCP 服务器提供的技能
```

类型定义中包含六种来源。其中 `commands_DEPRECATED` 是旧版 `/commands` 目录的兼容入口，代码中仍然被处理（加载逻辑会扫描该目录并标记来源），但已不推荐使用。五种现行来源为 `skills`、`plugin`、`managed`、`bundled`、`mcp`。

### 1.2 目录层级

技能文件按层级存放，高层级覆盖低层级：

```typescript
export function getSkillsPath(
  source: SettingSource | 'plugin',
  dir: 'skills' | 'commands',
): string {
  switch (source) {
    case 'policySettings':    return join(getManagedFilePath(), '.claude', dir)
    case 'userSettings':      return join(getClaudeConfigHomeDir(), dir)
    case 'projectSettings':   return `.claude/${dir}`
    case 'plugin':            return 'plugin'
    default:                  return ''
  }
}
```

优先级从高到低：企业策略 → 项目级 → 用户级 → 插件 → 内置。

## 2. Frontmatter 解析

### 2.1 核心解析函数

`parseSkillFrontmatterFields`（第 185-265 行）是整个 Skill 系统最重要的函数，它从 YAML frontmatter 中提取所有元数据：

```typescript
export function parseSkillFrontmatterFields(
  frontmatter: FrontmatterData,
  markdownContent: string,
  resolvedName: string,
  descriptionFallbackLabel: 'Skill' | 'Custom command' = 'Skill',
): {
  displayName: string | undefined
  description: string
  hasUserSpecifiedDescription: boolean
  allowedTools: string[]
  argumentHint: string | undefined
  argumentNames: string[]
  whenToUse: string | undefined
  version: string | undefined
  model: ReturnType<typeof parseUserSpecifiedModel> | undefined
  disableModelInvocation: boolean
  userInvocable: boolean
  hooks: HooksSettings | undefined
  executionContext: 'fork' | undefined
  agent: string | undefined
  effort: EffortValue | undefined
  shell: FrontmatterShell | undefined
}
```

一个典型的 Skill Markdown 文件的 frontmatter 如下：

```yaml
---
name: Code Review
description: Review code for bugs and style issues
when_to_use: When the user asks for a code review or mentions PR review
allowed-tools: [Read, Grep, Glob]
argument-hint: <file-or-directory>
arguments: [path]
model: sonnet
effort: high
context: fork
user-invocable: true
---

You are a code review expert. Analyze the following code...
```

### 2.2 关键字段处理细节

**description 回退链**（第 208-214 行）：

```typescript
const validatedDescription = coerceDescriptionToString(
  frontmatter.description, resolvedName,
)
const description =
  validatedDescription ??
  extractDescriptionFromMarkdown(markdownContent, descriptionFallbackLabel)
```

如果 frontmatter 没有 description，则从 Markdown 正文中提取第一段作为描述。

**model 继承语义**（第 222-227 行）：

```typescript
const model =
  frontmatter.model === 'inherit'
    ? undefined                              // 继承主循环模型
    : frontmatter.model
      ? parseUserSpecifiedModel(frontmatter.model as string)
      : undefined                            // 未指定也继承
```

`model: inherit` 是一个显式声明——"使用当前对话的模型"，与省略 model 字段效果相同。

**effort 验证**（第 228-235 行）：

```typescript
const effortRaw = frontmatter['effort']
const effort = effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
if (effortRaw !== undefined && effort === undefined) {
  logForDebugging(
    `Skill ${resolvedName} has invalid effort '${effortRaw}'. ` +
    `Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
  )
}
```

effort 支持预定义级别（如 `low`, `medium`, `high`）或整数值。

**agent 字段——子 Agent 类型指定**：

frontmatter 支持 `agent` 字段（`agent?: string`），`BundledSkillDefinition` 中也有对应定义。源码中 `command.ts` 的类型注释明确说明了其用途：

```typescript
// Agent type to use when forked (e.g., 'Bash', 'general-purpose')
// Only applicable when context is 'fork'
agent?: string
```

当技能声明 `context: fork` 时，它会在独立的子 Agent 中执行（拥有独立的上下文和 token 预算）。`agent` 字段进一步指定该子 Agent 的**类型**——源码注释仅列举了 `'Bash'` 和 `'general-purpose'` 两个示例值，**并未在注释中展开说明不同类型之间的差异**。将其解读为"不同类型配备不同工具集/系统提示词"属于合理推测，但本章不引用注释外的证据就此下判断；读者若关心 Agent 类型的实际差别，需参照 `AgentTool/built-in/` 目录下各 Agent 定义文件做对照阅读。结合 `scheduleRemoteAgents.ts` 技能的存在可以看出：`agent` 字段是 Skill 声明式指定"谁来执行"的接口，Skill 不仅注入提示词，也参与任务到执行者的路由。

**frontmatter 命名风格不一致（设计观察）**：

值得注意的是，frontmatter 字段的命名存在三种不同的风格混用：

| 命名风格 | 示例字段 |
|----------|----------|
| kebab-case（连字符） | `allowed-tools`、`argument-hint`、`user-invocable`、`disable-model-invocation` |
| snake_case（下划线） | `when_to_use` |
| camelCase（驼峰） | `userInvocable`（BundledSkillDefinition 中） |

这不是无关紧要的代码风格问题——它揭示 Skill schema 在命名规范上缺乏统一治理。源码中未见 commit 历史或注释直接佐证"多次迭代逐步添加"，这个推断留给读者自行判断；但可观察的事实是：三种风格的字段并存于同一 `parseSkillFrontmatterFields()` 返回对象中。对于一个快速迭代的产品来说这很常见（实用性优先于一致性），但随着字段数量增长（当前已有 15+ 个字段），这种不一致会增加 Skill 作者的认知负担——`user-invocable` 还是 `userInvocable`？`when_to_use` 还是 `when-to-use`？JSON Schema 可以通过别名（aliases）缓解这个问题，但纯 frontmatter 方案缺乏这种机制。

### 2.3 路径匹配（Skill Paths）

`parseSkillPaths` 函数（第 159-178 行）支持 gitignore 风格的路径模式：

```typescript
function parseSkillPaths(frontmatter: FrontmatterData): string[] | undefined {
  if (!frontmatter.paths) return undefined

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // 如果所有模式都是 **（匹配所有），视为未指定
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return undefined
  }
  return patterns
}
```

这允许技能声明它只在特定目录下激活，例如 `paths: src/components/**` 表示只在组件目录下可用。

## 3. 命令构建管线

### 3.1 createSkillCommand

`createSkillCommand` 函数（第 270-399 行）将解析后的元数据组装成一个可执行的 Command 对象：

```typescript
export function createSkillCommand({
  skillName, displayName, description, markdownContent,
  allowedTools, source, baseDir, loadedFrom, hooks, ...
}): Command {
  return {
    type: 'prompt',
    name: skillName,
    description,
    allowedTools,
    isHidden: !userInvocable,
    progressMessage: 'running',

    async getPromptForCommand(args, toolUseContext) {
      let finalContent = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent

      // 1. 替换参数占位符
      finalContent = substituteArguments(finalContent, args, true, argumentNames)

      // 2. 替换 ${CLAUDE_SKILL_DIR}
      if (baseDir) {
        const skillDir = process.platform === 'win32'
          ? baseDir.replace(/\\/g, '/') : baseDir
        finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
      }

      // 3. 替换 ${CLAUDE_SESSION_ID}
      finalContent = finalContent.replace(
        /\$\{CLAUDE_SESSION_ID\}/g, getSessionId()
      )

      // 4. 执行内嵌 Shell 命令（仅非 MCP 来源）
      if (loadedFrom !== 'mcp') {
        finalContent = await executeShellCommandsInPrompt(
          finalContent, toolUseContext, `/${skillName}`, shell
        )
      }

      return [{ type: 'text', text: finalContent }]
    },
  }
}
```

### 3.2 变量替换系统

Skill 正文支持三种变量替换：

| 变量 | 含义 | 示例 |
|------|------|------|
| `$1`, `$2`, `${argName}` | 用户传入的参数 | `/review $1` → `/review src/app.ts` |
| `${CLAUDE_SKILL_DIR}` | 技能文件所在目录 | 引用同目录下的参考文件 |
| `${CLAUDE_SESSION_ID}` | 当前会话 ID | 用于日志关联 |

### 3.3 MCP 安全隔离

注意第 372-376 行的安全限制：

```typescript
// Security: MCP skills are remote and untrusted — never execute inline
// shell commands (!`…` / ```! … ```) from their markdown body.
if (loadedFrom !== 'mcp') {
  finalContent = await executeShellCommandsInPrompt(...)
}
```

MCP 来源的技能**禁止执行内嵌 Shell 命令**。这是因为 MCP 服务器是远程的、不受信任的——如果允许它们在 Skill 内容中嵌入 Shell 命令，就等于给远程服务器任意代码执行的权限。

### 3.4 内嵌 Shell 执行的安全分析

`executeShellCommandsInPrompt` 是整个 Skill 系统中**最强大也最危险的特性**。它让 Skill 从"静态提示词模板"升级为"可执行的提示词"——Skill 正文中可以嵌入 Shell 命令（`!` 前缀行或 ` ```! ``` ` 代码块），加载时自动执行并将输出内联到提示词中。

```typescript
// promptShellExecution.ts 中的两种语法模式
const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g    // 代码块: ```! command ```
const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm          // 内联: !`command`
```

**这意味着 Skill 文件在功能上等价于可执行程序**。一个放在 `.claude/skills/` 目录下的 Markdown 文件可以：

1. **通过内嵌 Shell 命令执行任意代码**：`!`git log --oneline -5`` 会在加载时直接执行
2. **通过 `allowed-tools` 请求工具访问权限**：如请求 BashTool、文件读写等
3. **通过 hooks 字段注册生命周期钩子**：在特定事件触发时执行额外逻辑

**安全防线分析**：

代码中确实存在权限检查——`executeShellCommandsInPrompt` 在执行每条命令前会调用 `hasPermissionsToUseTool`：

```typescript
const permissionResult = await hasPermissionsToUseTool(
  shellTool, { command }, context,
  createAssistantMessage({ content: [] }), '',
)
if (permissionResult.behavior !== 'allow') {
  throw new MalformedCommandError(
    `Shell command permission check failed for pattern "${match[0]}": ...`
  )
}
```

但需要注意的**供应链风险**：如果开源项目的 `.claude/skills/` 目录中被放入了恶意 Skill 文件（类似 `.github/workflows` 中的恶意 Action），用户 clone 后可能在不知情的情况下执行恶意命令。这与 Git hooks（`.git/hooks/`）的信任模型类似——区别在于 Git hooks 需要用户手动启用，而 Skill 文件在路径匹配后可能被 Claude 自动推荐调用。

**与 GitHub Actions `run:` 步骤的类比**：GitHub Actions 的 YAML 中 `run:` 字段允许执行 Shell 命令，社区为此建立了完善的审计工具链（Dependabot、CodeQL 扫描 workflow 文件等）。Skill 文件的 Shell 执行能力在性质上与之相同，但目前缺乏类似的静态分析和审计机制——Skill 的行为不是静态可分析的（Shell 命令的输出会影响最终的提示词内容）。

> 💡 **通俗理解**：普通 Skill 像菜谱——告诉厨师（Claude）怎么做菜。但带有 `!` Shell 命令的 Skill 像一个"会自己先去菜市场买菜"的菜谱——它在被使用之前就先执行了一些操作。这很方便（可以动态获取环境信息），但也意味着你需要信任菜谱的作者不会在"买菜"步骤中做坏事。

## 4. 内置技能系统（Bundled Skills）

### 4.1 注册框架

`bundledSkills.ts` 提供了内置技能的注册和管理：

```typescript
export type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  files?: Record<string, string>  // 附带的参考文件
  getPromptForCommand: (args: string, context: ToolUseContext) =>
    Promise<ContentBlockParam[]>
}
```

注册接口采用与 Claude Code 内部其他子系统（如 `registerPostSamplingHook()`）相同的"启动时注册"模式——在模块初始化阶段将定义推入全局注册表：

```typescript
export function registerBundledSkill(definition: BundledSkillDefinition): void {
  const command: Command = {
    type: 'prompt',
    name: definition.name,
    source: 'bundled',
    loadedFrom: 'bundled',
    // ...
  }
  bundledSkills.push(command)
}
```

### 4.2 附带文件提取

内置技能可以包含参考文件（`files` 字段），这些文件在首次调用时解压到磁盘：

```typescript
if (files && Object.keys(files).length > 0) {
  skillRoot = getBundledSkillExtractDir(definition.name)
  let extractionPromise: Promise<string | null> | undefined
  const inner = definition.getPromptForCommand
  getPromptForCommand = async (args, ctx) => {
    extractionPromise ??= extractBundledSkillFiles(definition.name, files)
    const extractedDir = await extractionPromise
    const blocks = await inner(args, ctx)
    if (extractedDir === null) return blocks
    return prependBaseDir(blocks, extractedDir)
  }
}
```

这里使用了 Promise 记忆化（`extractionPromise ??= ...`）——多次并发调用只会触发一次提取操作。

### 4.3 安全写入

文件写入使用了防符号链接攻击的安全模式（第 176-193 行）：

```typescript
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const SAFE_WRITE_FLAGS = process.platform === 'win32'
  ? 'wx'                                          // Windows 用字符串标志
  : fsConstants.O_WRONLY | fsConstants.O_CREAT |
    fsConstants.O_EXCL | O_NOFOLLOW               // Unix 用数字标志

async function safeWriteFile(p: string, content: string): Promise<void> {
  const fh = await open(p, SAFE_WRITE_FLAGS, 0o600)
  try {
    await fh.writeFile(content, 'utf8')
  } finally {
    await fh.close()
  }
}
```

使用 `O_EXCL`（文件存在则失败）+ `O_NOFOLLOW`（拒绝符号链接）+ `0o600`（仅所有者可读写）+ `0o700` 目录权限。注释解释了设计："The per-process nonce in getBundledSkillsRoot() is the primary defense against pre-created symlinks/dirs"——随机目录名是主要防御，文件系统标志是额外保障。

> **📚 课程关联**：这段代码是《操作系统》课程中**文件系统安全**的教科书案例。`O_EXCL | O_NOFOLLOW` 组合防御的是经典的 **TOCTOU（Time-of-Check to Time-of-Use）竞态攻击**——攻击者在检查文件不存在和创建文件之间的窗口期插入符号链接，将写入重定向到敏感文件（如 `/etc/passwd`）。`O_EXCL` 将检查和创建合并为原子操作，`O_NOFOLLOW` 拒绝解引用符号链接，随机目录名（nonce）则让攻击者无法预测目标路径。这是**纵深防御（Defense in Depth）**策略的典型实践。

### 4.4 具体内置技能

`bundled/` 目录包含 17 个内置技能注册（其中 9 个始终注册，8 个受 feature flag 或运行时条件控制，包括 `skillify` 需 `USER_TYPE === 'ant'`）：

| 文件 | 技能名 | 用途 | 注册条件 |
|------|--------|------|----------|
| `updateConfig.ts` | update-config | 配置更新 | 始终注册 |
| `keybindings.ts` | keybindings | 快捷键配置 | 始终注册 |
| `verify.ts` | verify | 代码验证 | 始终注册 |
| `debug.ts` | debug | 调试辅助 | 始终注册 |
| `loremIpsum.ts` | lorem-ipsum | 测试数据生成 | 始终注册 |
| `skillify.ts` | skillify | 将操作转化为 Skill | Anthropic 内部条件注册（`USER_TYPE === 'ant'`） |
| `remember.ts` | remember | 记忆管理 | 始终注册 |
| `simplify.ts` | simplify | 代码简化审查 | 始终注册 |
| `batch.ts` | batch | 批量处理 | 始终注册 |
| `stuck.ts` | stuck | 卡住时的辅助 | 始终注册 |
| `dream.ts` | dream | Dream 功能 | `KAIROS` / `KAIROS_DREAM` feature flag |
| `hunter.ts` | hunter | 审查工件 | `REVIEW_ARTIFACT` feature flag |
| `loop.ts` | loop | 循环执行任务 | `AGENT_TRIGGERS` feature flag |
| `scheduleRemoteAgents.ts` | schedule | 远程 Agent 调度 | `AGENT_TRIGGERS_REMOTE` feature flag |
| `claudeApi.ts` | claude-api | Claude API / SDK 使用指导 | `BUILDING_CLAUDE_APPS` feature flag |
| `claudeInChrome.ts` | claude-in-chrome | Chrome 扩展集成 | `shouldAutoEnableClaudeInChrome()` |
| `runSkillGenerator.ts` | run-skill-generator | Skill 生成器 | `RUN_SKILL_GENERATOR` feature flag |

注意：`bundled/` 目录中还有 `index.ts`（注册入口）、`claudeApiContent.ts`、`verifyContent.ts` 等辅助文件，它们不是独立技能，而是为对应技能提供内容数据。feature flag 控制的技能使用动态 `require()` 延迟加载，避免在该功能未启用时加载不必要的代码。

### 4.5 三个关键内置技能的提示词原文

内置技能（bundled skills）的精髓不只在注册框架，而在于它们的 `SIMPLIFY_PROMPT`、`SKILLIFY_PROMPT`、`buildPrompt()` 等具体提示词——这些是 Claude Code 如何通过提示词工程实现"自我反思"、"捕获工作流"和"定时循环"的原文证据。

---

### 4.5.1 SIMPLIFY_PROMPT：三并行审查 Agent 的代码质检流程

**源码位置**：`src/skills/bundled/simplify.ts`，第 4–53 行

`/simplify` 技能是 Claude Code 自我代码审查机制的核心。它的提示词展示了如何通过一个 Skill 驱动三个并行 Agent 进行独立维度的代码审查：

```
# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run `git diff` (or `git diff HEAD` if there are staged changes) to see what changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool to launch all three agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props (flexShrink, alignItems, etc.) already provide the needed behavior
7. **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that), narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. Also: if a wrapper function takes an updater/reducer callback, verify it honors same-reference returns (or whatever the "no change" signal is) — otherwise callers' early-return no-ops are silently defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).
```

**中文分析**：`SIMPLIFY_PROMPT` 的设计揭示了 Claude Code 用提示词驱动 Agent 协作的精确机制：

1. **三 Agent 并行的分工设计**：三个审查 Agent 被明确划分了独立、不重叠的审查维度——代码复用（是否重造轮子）、代码质量（是否有糟糕模式）、效率（是否有性能问题）。这种分工不是随意的：每个维度都是人类 code reviewer 实际关注的独立视角，而且三个维度之间几乎没有信息依赖，天然适合并行执行。
2. **"Pass each agent the full diff"**：提示词要求把完整 diff 传给每个 Agent，而不是让它们自己去读文件。这确保了三个 Agent 基于相同的信息做审查，避免了因读取时序不同导致的信息不一致。
3. **Phase 3 的聚合策略**：`If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.` 这句话的设计意图是：**不要让 Claude 陷入反驳子 Agent 发现的陷阱**。如果三个审查 Agent 有一个发现可能是误报，Claude 应该直接跳过，而不是花时间解释为什么它不算问题——这样效率更高。
4. **代码质量禁令的精确性**：Agent 2 的审查清单中，每一条都是精准的反模式描述（如"Stringly-typed code: using raw strings where constants, enums already exist"），而不是泛泛的"写好代码"。这说明这些规则来自于真实的代码审查经验积累，而不是理论推导。

---

### 4.5.2 SKILLIFY_PROMPT：将会话转化为可复用技能的元提示词

**源码位置**：`src/skills/bundled/skillify.ts`，第 22–156 行

`/skillify` 是 Claude Code 最具"元认知"特色的内置技能——它让 Claude 回顾当前会话，提炼出可复用的工作流，并将其写成一个新的 Skill 文件。只有 Anthropic 内部用户可用（`process.env.USER_TYPE !== 'ant'` 时跳过注册）。

```
# Skillify {{userDescriptionBlock}}

You are capturing this session's repeatable process as a reusable skill.

## Your Session Context

Here is the session memory summary:
<session_memory>
{{sessionMemory}}
</session_memory>

Here are the user's messages during this session. Pay attention to how they steered the process, to help capture their detailed preferences in the skill:
<user_messages>
{{userMessages}}
</user_messages>

## Your Task

### Step 1: Analyze the Session

Before asking any questions, analyze the session to identify:
- What repeatable process was performed
- What the inputs/parameters were
- The distinct steps (in order)
- The success artifacts/criteria (e.g. not just "writing code," but "an open PR with CI fully passing") for each step
- Where the user corrected or steered you
- What tools and permissions were needed
- What agents were used
- What the goals and success artifacts were

### Step 2: Interview the User

You will use the AskUserQuestion to understand what the user wants to automate. Important notes:
- Use AskUserQuestion for ALL questions! Never ask questions via plain text.
- For each round, iterate as much as needed until the user is happy.
- The user always has a freeform "Other" option to type edits or feedback -- do NOT add your own "Needs tweaking" or "I'll provide edits" option. Just offer the substantive choices.

**Round 1: High level confirmation**
- Suggest a name and description for the skill based on your analysis. Ask the user to confirm or rename.
- Suggest high-level goal(s) and specific success criteria for the skill.

**Round 2: More details**
- Present the high-level steps you identified as a numbered list. Tell the user you will dig into the detail in the next round.
- If you think the skill will require arguments, suggest arguments based on what you observed. Make sure you understand what someone would need to provide.
- If it's not clear, ask if this skill should run inline (in the current conversation) or forked (as a sub-agent with its own context). Forked is better for self-contained tasks that don't need mid-process user input; inline is better when the user wants to steer mid-process.
- Ask where the skill should be saved. Suggest a default based on context (repo-specific workflows → repo, cross-repo personal workflows → user). Options:
  - **This repo** (`.claude/skills/<name>/SKILL.md`) — for workflows specific to this project
  - **Personal** (`~/.claude/skills/<name>/SKILL.md`) — follows you across all repos

**Round 3: Breaking down each step**
For each major step, if it's not glaringly obvious, ask:
- What does this step produce that later steps need? (data, artifacts, IDs)
- What proves that this step succeeded, and that we can move on?
- Should the user be asked to confirm before proceeding? (especially for irreversible actions like merging, sending messages, or destructive operations)
- Are any steps independent and could run in parallel? (e.g., posting to Slack and monitoring CI at the same time)
- How should the skill be executed? (e.g. always use a Task agent to conduct code review, or invoke an agent team for a set of concurrent steps)
- What are the hard constraints or hard preferences? Things that must or must not happen?

You may do multiple rounds of AskUserQuestion here, one round per step, especially if there are more than 3 steps or many clarification questions. Iterate as much as needed.

IMPORTANT: Pay special attention to places where the user corrected you during the session, to help inform your design.

**Round 4: Final questions**
- Confirm when this skill should be invoked, and suggest/confirm trigger phrases too. (e.g. For a cherrypick workflow you could say: Use when the user wants to cherry-pick a PR to a release branch. Examples: 'cherry-pick to release', 'CP this PR', 'hotfix.')
- You can also ask for any other gotchas or things to watch out for, if it's still unclear.

Stop interviewing once you have enough information. IMPORTANT: Don't over-ask for simple processes!

### Step 3: Write the SKILL.md

Create the skill directory and file at the location the user chose in Round 2.

Use this format:

```markdown
---
name: {{skill-name}}
description: {{one-line description}}
allowed-tools:
  {{list of tool permission patterns observed during session}}
when_to_use: {{detailed description of when Claude should automatically invoke this skill, including trigger phrases and example user messages}}
argument-hint: "{{hint showing argument placeholders}}"
arguments:
  {{list of argument names}}
context: {{inline or fork -- omit for inline}}
---

# {{Skill Title}}
Description of skill

## Inputs
- `$arg_name`: Description of this input

## Goal
Clearly stated goal for this workflow. Best if you have clearly defined artifacts or criteria for completion.

## Steps

### 1. Step Name
What to do in this step. Be specific and actionable. Include commands when appropriate.

**Success criteria**: ALWAYS include this! This shows that the step is done and we can move on. Can be a list.

IMPORTANT: see the next section below for the per-step annotations you can optionally include for each step.

...
```

**Per-step annotations**:
- **Success criteria** is REQUIRED on every step. This helps the model understand what the user expects from their workflow, and when it should have the confidence to move on.
- **Execution**: `Direct` (default), `Task agent` (straightforward subagents), `Teammate` (agent with true parallelism and inter-agent communication), or `[human]` (user does it). Only needs specifying if not Direct.
- **Artifacts**: Data this step produces that later steps need (e.g., PR number, commit SHA). Only include if later steps depend on it.
- **Human checkpoint**: When to pause and ask the user before proceeding. Include for irreversible actions (merging, sending messages), error judgment (merge conflicts), or output review.
- **Rules**: Hard rules for the workflow. User corrections during the reference session can be especially useful here.

**Step structure tips:**
- Steps that can run concurrently use sub-numbers: 3a, 3b
- Steps requiring the user to act get `[human]` in the title
- Keep simple skills simple -- a 2-step skill doesn't need annotations on every step

**Frontmatter rules:**
- `allowed-tools`: Minimum permissions needed (use patterns like `Bash(gh:*)` not `Bash`)
- `context`: Only set `context: fork` for self-contained skills that don't need mid-process user input.
- `when_to_use` is CRITICAL -- tells the model when to auto-invoke. Start with "Use when..." and include trigger phrases. Example: "Use when the user wants to cherry-pick a PR to a release branch. Examples: 'cherry-pick to release', 'CP this PR', 'hotfix'."
- `arguments` and `argument-hint`: Only include if the skill takes parameters. Use `$name` in the body for substitution.

### Step 4: Confirm and Save

Before writing the file, output the complete SKILL.md content as a yaml code block in your response so the user can review it with proper syntax highlighting. Then ask for confirmation using AskUserQuestion with a simple question like "Does this SKILL.md look good to save?" — do NOT use the body field, keep the question concise.

After writing, tell the user:
- Where the skill was saved
- How to invoke it: `/{{skill-name}} [arguments]`
- That they can edit the SKILL.md directly to refine it
```

**中文分析**：SKILLIFY_PROMPT 是 Claude Code 中最体现"元认知"能力的提示词，它让 AI 对自己刚刚完成的工作进行结构化回顾：

1. **`{{sessionMemory}}` 和 `{{userMessages}}` 模板变量**：这两个占位符在运行时被替换成真实的会话内容（`skillify.ts` 第 190–193 行）。`sessionMemory` 来自 `getSessionMemoryContent()`，`userMessages` 则是用户消息的过滤提取。这意味着 Skillify 是一个**上下文感知的元提示词**——它不是静态的，而是在运行时注入了当前会话的实际信息。
2. **四轮结构化访谈（AskUserQuestion）**：Skillify 不是直接生成一个 Skill 文件，而是通过四轮访谈引导用户澄清细节——从高层确认（命名/描述）→ 步骤细节 → 每步的成功标准 → 触发时机。这种多轮对话策略确保了生成的 Skill 能准确反映用户的实际需求，而不是 AI 的主观推断。
3. **"Pay special attention to places where the user corrected you"**：这一指令要求 AI 把用户在会话中的**纠正行为**当作关键信息来提炼进 Skill——因为纠正行为往往反映了用户的隐性偏好和边界条件，这些是最难在 Skill 文件中显式表达但又最重要的约束。
4. **"Success criteria is REQUIRED on every step"**：SKILLIFY_PROMPT 中强调每个步骤都必须有明确的成功标准。这是 Anthropic 工作流自动化哲学的体现：一个好的自动化工作流不只是"做了什么"，更要知道"如何判断这一步做成了"，才能在步骤失败时及时停止而不是继续执行后续步骤。
5. **只对内部用户开放**（`skillify.ts` 第 159–161 行）：`if (process.env.USER_TYPE !== 'ant') return` ——Skillify 在当前构建中仅对 `USER_TYPE === 'ant'`（Anthropic 内部用户）注册。这是**访问门控层面的观察**，不直接等同于"官方产品路线图上的内测状态"——代码只能告诉我们"谁现在能看到"，无法告诉我们"未来是否 / 何时对外"。

---

### 4.5.3 loop.ts 的 buildPrompt()：定时循环的自然语言解析引擎

**源码位置**：`src/skills/bundled/loop.ts`，`buildPrompt()` 函数（第 25–72 行）

`/loop` 技能实现了"让 Claude 定期重复执行某个任务"的能力（如每 5 分钟检查 CI 状态）。其核心是 `buildPrompt()` 函数，它生成一个包含完整自然语言解析规则和时间表达式转换逻辑的提示词：

```
# /loop — schedule a recurring prompt

Parse the input below into `[interval] <prompt…>` and schedule it with CronCreate.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches `^\d+[smhd]$` (e.g. `5m`, `2h`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with `every <N><unit>` or `every <N> <unit-word>` (e.g. `every 20m`, `every 5 minutes`, `every 2 hours`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — `check every PR` has no interval.
3. **Default**: otherwise, interval is `10m` and the entire input is the prompt.

If the resulting prompt is empty, show usage `/loop [interval] <prompt>` and stop — do not call CronCreate.

Examples:
- `5m /babysit-prs` → interval `5m`, prompt `/babysit-prs` (rule 1)
- `check the deploy every 20m` → interval `20m`, prompt `check the deploy` (rule 2)
- `run tests every 5 minutes` → interval `5m`, prompt `run tests` (rule 2)
- `check the deploy` → interval `10m`, prompt `check the deploy` (rule 3)
- `check every PR` → interval `10m`, prompt `check every PR` (rule 3 — "every" not followed by time)
- `5m` → empty prompt → show usage

## Interval → cron

Supported suffixes: `s` (seconds, rounded up to nearest minute, min 1), `m` (minutes), `h` (hours), `d` (days). Convert:

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| `Nm` where N ≤ 59   | `*/N * * * *`     | every N minutes                          |
| `Nm` where N ≥ 60   | `0 */H * * *`     | round to hours (H = N/60, must divide 24)|
| `Nh` where N ≤ 23   | `0 */N * * *`     | every N hours                            |
| `Nd`                | `0 0 */N * *`     | every N days at midnight local           |
| `Ns`                | treat as `ceil(N/60)m` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. `7m` → `*/7 * * * *` gives uneven gaps at :56→:00; `90m` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.

## Action

1. Call CronCreate with:
   - `cron`: the expression from the table above
   - `prompt`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - `recurring`: `true`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after 7 days, and that they can cancel sooner with CronDelete (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

[user's input here]
```

**中文分析**：`buildPrompt()` 是一个特殊的"**提示词即编译器**"设计案例：

1. **在提示词中内嵌解析器规范**：传统实现会在 TypeScript 代码中写正则表达式来解析"5m /babysit-prs"这样的输入。`loop.ts` 选择了一种不同的路径——把解析规则写进提示词，让 AI 来解析自然语言输入。这意味着解析逻辑对自然语言边界情况的容忍度更高（"check every PR"中的"every"不是时间间隔，AI 能理解这个语义差异）。
2. **`check every PR` 的边界案例**：提示词中显式列出了"`check every PR` has no interval"这个反例，防止 AI 把"every PR"误解为时间间隔。这种边界案例的显式列举，比依赖模型的"常识"更可靠。
3. **Interval → cron 的转换表**：提示词中内嵌了一张完整的时间间隔到 cron 表达式的转换表，包括处理"不能整除"情况的指令（"pick the nearest clean interval and tell the user"）。这把数学上的边界情况处理也交给了 AI，而不是硬编码在 TypeScript 中。
4. **"Then immediately execute the parsed prompt now"**：创建定时任务后立即执行一次——这是优秀的 UX 设计。用户不需要等到第一个 cron 周期才看到效果，立即执行给了用户即时反馈，验证了任务配置的正确性。
5. **动态 prompt 生成**（`buildPrompt(args: string)` 第 26 行）：`buildPrompt()` 接收用户输入 `args` 作为参数，把它嵌入到提示词最后的 `## Input` 章节。这是一个"数据-指令分离"的设计模式：提示词主体是固定的解析指令，用户输入是数据，两者明确分离。这与 SQL 的参数化查询（防止 SQL 注入）在结构上类似——把指令和数据分开，避免数据被误解为指令。

**三个内置技能的对比**：

| 技能 | 提示词角色 | 子 Agent 数量 | 关键设计特征 |
|------|-----------|--------------|-------------|
| `/simplify` | 编排器 | 3 个并行审查 Agent | 维度分离 + 并行 + 聚合修复 |
| `/skillify` | 元认知引导器 | 0（内联执行） | 四轮访谈 + 上下文注入 + 生成 Skill 文件 |
| `/loop` | 自然语言解析 + 调度器 | 0（调用 CronCreate 工具） | 规则内嵌提示词 + 立即执行 + cron 转换 |

这三个技能展示了 Skill 系统的三种不同用法：用提示词驱动多 Agent 并行（simplify）、用提示词实现交互式工作流捕获（skillify）、用提示词实现自然语言 DSL 解析（loop）。

---

## 5. MCP 技能桥接

### 5.1 循环依赖问题

`mcpSkillBuilders.ts` 的存在纯粹是为了解决一个循环依赖问题。如注释所述：

```typescript
/**
 * Write-once registry for the two loadSkillsDir functions that MCP skill
 * discovery needs. This module is a dependency-graph leaf: it imports nothing
 * but types, so both mcpSkills.ts and loadSkillsDir.ts can depend on it
 * without forming a cycle (client.ts → mcpSkills.ts → loadSkillsDir.ts → …
 * → client.ts).
 */
```

依赖链条：`client.ts → mcpSkills.ts → loadSkillsDir.ts → ... → client.ts`，如果直接 import 就会形成循环。解决方案是将共享的两个函数通过注册表模式解耦：

```typescript
export type MCPSkillBuilders = {
  createSkillCommand: typeof createSkillCommand
  parseSkillFrontmatterFields: typeof parseSkillFrontmatterFields
}

let builders: MCPSkillBuilders | null = null

export function registerMCPSkillBuilders(b: MCPSkillBuilders): void {
  builders = b
}

export function getMCPSkillBuilders(): MCPSkillBuilders {
  if (!builders) {
    throw new Error(
      'MCP skill builders not registered — loadSkillsDir.ts has not been evaluated yet',
    )
  }
  return builders
}
```

注册发生在 `loadSkillsDir.ts` 的模块初始化阶段——由于 `commands.ts` 静态导入了 `loadSkillsDir.ts`，注册会在任何 MCP 服务器连接之前完成。

> **📚 课程关联**：这里的循环依赖打破策略是《软件工程》中**依赖倒置原则（DIP）**的实际应用。通过引入一个无依赖的"注册表"叶节点模块，将直接依赖转换为间接的运行时注册——本质上是**服务定位器模式（Service Locator Pattern）**。这也是 Java Spring 的 IoC 容器和 Angular 的依赖注入在解决循环依赖时采用的同族技术。

### 5.2 动态导入的陷阱

注释还提到了一个 Bun 打包的技术限制：

```
// The non-literal dynamic-import approach ("await import(variable)") fails at
// runtime in Bun-bundled binaries — the specifier is resolved against the
// chunk's /$bunfs/root/… path, not the original source tree
```

在 Bun 打包的二进制中，`await import(variablePath)` 会失败，因为路径解析指向虚拟文件系统（`$bunfs/root`）而非源码树。字面量动态导入可以工作，但会被依赖分析工具（dependency-cruiser）追踪到，产生新的循环依赖告警。

## 6. 文件去重机制

### 6.1 基于 realpath 的去重

`loadSkillsDir.ts` 第 118-124 行通过解析符号链接来检测重复文件：

```typescript
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}
```

注释引用了一个具体的 issue（#13893）："Uses realpath to resolve symlinks, which is filesystem-agnostic and avoids issues with filesystems that report unreliable inode values (e.g., inode 0 on some virtual/container/NFS filesystems, or precision loss on ExFAT)"

源码注释明确给出了选用 `realpath` 而非 inode 的理由：某些文件系统（ExFAT、NFS、容器虚拟 FS）的 inode 值不可靠（可能为 0 或精度溢出），因此采用"文件系统无关"的 `realpath` 路径规范化方案。注释未说明"最初实现"是什么——是否曾经用过 inode 属于推断，本书不做历史判断。

### 6.2 Token 估算

```typescript
export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}
```

只对 frontmatter 进行 Token 估算（而非完整内容），因为技能内容是延迟加载的——只在调用时才读取。

## 7. Hooks 集成

技能可以通过 frontmatter 定义 hooks：

```typescript
function parseHooksFromFrontmatter(
  frontmatter: FrontmatterData,
  skillName: string,
): HooksSettings | undefined {
  if (!frontmatter.hooks) return undefined
  const result = HooksSchema().safeParse(frontmatter.hooks)
  if (!result.success) {
    logForDebugging(`Invalid hooks in skill '${skillName}': ${result.error.message}`)
    return undefined
  }
  return result.data
}
```

使用 Zod schema 进行验证，格式不正确的 hooks 会被安静地忽略（日志记录但不报错）。

## 批判性分析

### 优点

1. **统一的 Markdown 格式**：用 frontmatter + Markdown 作为技能描述格式是一个成熟且实用的选择（Hugo、Jekyll 等静态站点生成器早已验证了这种模式）——它人类可读、版本控制友好、易于编写，同时 frontmatter 提供了结构化元数据
2. **分层覆盖**：企业策略 > 项目 > 用户 > 内置的覆盖层级，既保证了企业合规需求，又给了个人用户足够的定制空间
3. **MCP 安全隔离**：禁止 MCP 来源的技能执行内嵌 Shell 命令，是正确的安全决策
4. **延迟加载**：只在技能被调用时才读取完整内容，减少了启动时的内存和 I/O 开销
5. **安全文件写入**：`O_EXCL | O_NOFOLLOW` + 随机目录名的防御组合非常专业

### 不足

1. **单文件巨无霸**：`loadSkillsDir.ts` 有 34KB，包含了解析、加载、构建、去重、Hooks 处理等过多职责，应该拆分
2. **`commands_DEPRECATED` 残留**：旧的 `/commands` 目录仍然被支持（LoadedFrom 类型中有 `commands_DEPRECATED`），这种兼容性负担何时清除没有明确计划
3. **缺乏版本兼容**：frontmatter 没有版本字段的标准化处理——虽然有 `version` 字段，但没有看到基于版本的兼容性检查逻辑
4. **MCP 技能的二等公民地位**：MCP 技能被禁止执行 Shell 命令、不能使用 `${CLAUDE_SKILL_DIR}`——这些限制是安全驱动的，但如果 MCP 服务器是可信的（如企业内部的），用户没有办法覆盖这些限制
5. **循环依赖的味道**：`mcpSkillBuilders.ts` 的存在说明模块间的依赖关系需要重构。使用运行时注册表来打破编译时循环依赖，虽然有效，但增加了"注册顺序"这个隐式约束——如果 MCP 服务器在 `loadSkillsDir.ts` 加载之前连接，系统会 throw
