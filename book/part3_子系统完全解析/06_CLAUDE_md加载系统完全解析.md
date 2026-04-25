# CLAUDE.md 加载系统完全解析

CLAUDE.md 是 Claude Code 的"仓库级指令系统"——让用户和团队在 Markdown 文件中写下项目约定、编码规范、工具偏好，Claude 会在每次对话开始时自动加载这些指令。但"加载一个 Markdown 文件"远比想象的复杂——系统需要处理从企业全局策略到项目子目录的多层级查找、`@include` 递归文件引用、frontmatter 条件规则、不同来源的安全验证、token 成本优化、以及与 Hooks 和 Memory 系统的交互。本章将完整解析加载链路、搜索路径、合并策略和安全边界。

> **源码位置**：核心逻辑分布在多个文件中：
> - `src/utils/claudemd.ts`（小写 m）— 文件发现、`@include` 处理、缓存管理
> - `src/context.ts` — `getUserContext()` 调用入口、yoloClassifier 缓存注入
> - `src/utils/memory/types.ts` — `MemoryType` 类型定义
> - `src/utils/frontmatterParser.ts` — YAML frontmatter 解析、条件规则 glob 展开
> - `src/utils/config.ts` — `getMemoryPath()`、各层级路径计算
> - `src/utils/settings/managedPath.ts` — 企业管理路径（`/etc/claude-code/` 等）

> 💡 **通俗理解**：CLAUDE.md 就像新员工入职前读的项目手册——从公司总部的强制合规手册（`Managed`，相当于 IT 部门统一下发、员工无法删改的制度文件），到个人的全局工作习惯（`User`），到部门的项目约定（`Project`），再到个人的私有笔记（`Local`），一路收集、层层叠加。新员工（Claude）每次开始工作前，都会把这些手册全部读一遍。而 `@include` 指令就像手册里的"详见附件 A"——一个文件可以引用其他文件，自动展开。

> 🌍 **行业背景**："项目级指令文件"已成为 AI 编码工具的标配，但各产品的实现深度差异很大。**Cursor** 的 `.cursor/rules/` 目录支持多文件规则、frontmatter 条件规则（基于 glob 匹配文件类型）、以及 `alwaysApply` / `autoAttach` / `agentRequested` 等规则激活模式。**Aider** 的 `.aider.conf.yml` 主要是工具配置而非 AI 行为指令。**GitHub Copilot** 支持 `.github/copilot-instructions.md` 作为项目级指令，但只有一层，没有用户级/子目录级的层叠。**Windsurf** 有类似的 `.windsurfrules` 文件。**Codex（OpenAI）** 支持 `codex.md` 和 `AGENTS.md`，设计上借鉴了 Claude Code 的多层级加载。**Cline** 的 `.clinerules` 和 **Roo Code** 的 `.roo/rules/` 也已支持多文件规则目录和条件规则。Claude Code 的 CLAUDE.md 系统在层级深度上最为完善（Managed → User → Project → Local 四大类型），`@include` 递归文件引用在同类产品中独一无二，但 Claude Code 和 Cursor 在规则系统上的差异不再是"有 vs 无"，而是具体的设计选择差异——比如 Claude Code 的向上目录遍历 vs Cursor 的扁平规则目录、Claude Code 的全量拼接 vs Cursor 的条件激活模型。

---

## 概述

CLAUDE.md 是 Claude Code 的"仓库级指令系统"——让用户和团队在 Markdown 文件中写下项目约定、编码规范、工具偏好，Claude 会在每次对话开始时自动加载这些指令。但"加载一个 Markdown 文件"远比想象的复杂——系统需要处理多层级查找、`@include` 递归引用、安全验证、token 成本优化、以及与 Memory 系统的交互。

---

> **[图表预留 3.6-A]**：查找链路图 — CLAUDE.md 从 Managed → User → Project → Local 的四大类型加载顺序 + .claude/rules/ 规则目录 + @include 递归展开

---

## 1. 四大 MemoryType 与查找算法

### 1.1 四大类型：Managed / User / Project / Local

源码 `memory/types.ts` 中定义了完整的 MemoryType 类型体系：

```typescript
// src/utils/memory/types.ts
export const MEMORY_TYPE_VALUES = [
  'User',      // 用户全局指令
  'Project',   // 项目级指令（提交在仓库中）
  'Local',     // 本地私有指令（gitignored）
  'Managed',   // 企业管理策略（由系统管理员部署）
  'AutoMem',   // 自动记忆
  // 'TeamMem' — 团队记忆（feature flag 控制）
] as const
```

`claudemd.ts` 文件头注释明确定义了四大核心类型的加载顺序和优先级：

```
加载顺序（从先到后，后加载 = 更高优先级）：
1. Managed（企业管理策略） — 如 /etc/claude-code/CLAUDE.md
2. User（用户全局指令）    — ~/.claude/CLAUDE.md
3. Project（项目指令）     — CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md
4. Local（本地私有指令）   — CLAUDE.local.md
```

> 💡 **通俗理解**：这四个层级就像公司的规章制度体系——Managed 是公司总部的合规文件（所有员工必须遵守、无法删除）；User 是你个人的工作习惯备忘录；Project 是部门的项目规范手册（所有组员共享）；Local 是你自己在项目规范上的私人批注（不会提交到团队共享文档中）。

### 1.2 Managed 类型：企业管理策略注入

**这是整个系统中安全含义最重大的层级**。Managed 类型从系统级路径加载，由 IT 管理员通过 MDM（Mobile Device Management）或端点管理工具部署：

```typescript
// src/utils/settings/managedPath.ts
export const getManagedFilePath = memoize(function (): string {
  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/ClaudeCode'
    case 'windows':
      return 'C:\\Program Files\\ClaudeCode'
    default:
      return '/etc/claude-code'  // Linux
  }
})
```

Managed 层级有两个关键的设计特性：

1. **最先加载**（优先级最低，但这是位置上的"最低"——实际上它的内容会被模型看到）
2. **不可排除**——`isClaudeMdExcluded` 函数中明确跳过 Managed 类型：

```typescript
function isClaudeMdExcluded(filePath: string, type: MemoryType): boolean {
  // Managed, AutoMem, TeamMem 类型不受排除规则影响
  if (type !== 'User' && type !== 'Project' && type !== 'Local') {
    return false
  }
  // ...检查 claudeMdExcludes 配置
}
```

这意味着企业管理员可以通过 `/etc/claude-code/CLAUDE.md` 和 `/etc/claude-code/.claude/rules/*.md` 注入**不可排除、一定会被注入上下文**的全局策略——例如"禁止生成涉及竞争对手的代码"、"所有输出必须符合公司编码规范"。用户无法通过 `claudeMdExcludes` 配置绕过这些策略。

> ⚠️ **准确语义**：这里说的是"不可排除、会被注入"，而**不是**"不可覆盖"。CLAUDE.md 加载系统只做**全量拼接**，不做"上层覆盖下层"的冲突解决——如果用户级 CLAUDE.md 包含与 Managed 策略冲突的指令，两者**都会**被注入到上下文，由模型权衡（后加载的在物理位置上更靠近对话，通常模型关注度更高）。"不可绕过"是相对于"用户无法通过 `claudeMdExcludes` 关掉 Managed 条目"这一事实，**不是**相对于"任何用户指令都无法与 Managed 相抵触"。真正的强制不可覆盖能力由**设置系统**的 `allowManagedHooksOnly` / `strictPluginOnlyCustomization` 等企业锁定开关提供（详见 Part 3 第 9 章 §4），与本章的 CLAUDE.md 加载是两套机制。

### 1.3 CLAUDE.local.md：私有项目配置

`CLAUDE.local.md` 是源码中明确设计的第四种类型——放置在项目目录中，但**被 gitignore 排除**，只存在于开发者本地。源码注释明确说明：

> "CLAUDE.local.md is gitignored so it only exists in the main repo"

这解决了一个常见的实际问题：开发者想要项目级的个人偏好配置（如"我偏好函数式风格"、"使用 vim 键位"），但不想将这些偏好提交到团队仓库中，也不想被恶意 PR 修改。`CLAUDE.local.md` 与 `CLAUDE.md` 平行存在于同一目录，在向上遍历时同步被发现和加载：

```typescript
// 在每个目录层级中同时查找 Project 和 Local 文件
for (const dir of dirs.reverse()) {
  // ...
  // Project 文件
  const projectPath = join(dir, 'CLAUDE.md')
  result.push(...(await processMemoryFile(projectPath, 'Project', ...)))
  
  // Local 文件（私有项目指令）
  if (isSettingSourceEnabled('localSettings')) {
    const localPath = join(dir, 'CLAUDE.local.md')
    result.push(...(await processMemoryFile(localPath, 'Local', ...)))
  }
}
```

### 1.4 多层级搜索路径

CLAUDE.md 的加载不是简单地读取一个文件——它从**多个位置**收集内容：

```
完整搜索路径（按加载顺序）：

1. Managed 层级：
   - /etc/claude-code/CLAUDE.md（或平台对应路径）
   - /etc/claude-code/.claude/rules/*.md

2. User 层级：
   - ~/.claude/CLAUDE.md
   - ~/.claude/rules/*.md

3. Project 层级（从 git-root 向 cwd 逐层）：
   - <dir>/CLAUDE.md
   - <dir>/.claude/CLAUDE.md
   - <dir>/.claude/rules/*.md（包含"无条件规则"和"条件规则"两种，详见 §1.6——条件规则仅在 frontmatter `paths` 匹配当前工作文件时加载）

4. Local 层级（与 Project 同步遍历）：
   - <dir>/CLAUDE.local.md
```

所有找到的内容按特定顺序组装成一个大的系统提示注入。

### 1.5 安全：防恶意 CLAUDE.md

项目级 CLAUDE.md（提交在仓库中的）可以被恶意 PR 修改。系统对不同来源的 CLAUDE.md 有不同的信任级别：

- **Managed**（`/etc/claude-code/CLAUDE.md`）：完全信任（管理员部署的系统策略）
- **用户全局**（`~/.claude/CLAUDE.md`）：完全信任（用户自己创建的）
- **Local**（`CLAUDE.local.md`）：完全信任（本地私有文件，不受版本控制）
- **项目级**（仓库中的 `CLAUDE.md`）：受限信任（可能被 PR 修改）
- **项目 settings 中的路径设置**：**完全不信任**用于 Memory 路径（防止 `autoMemoryDirectory: '~/.ssh'` 攻击——详见 Part 3「记忆系统完全解析」章节，以及本章 §6 与 Memory 系统的关系表格）

### 1.6 `.claude/rules/` 规则目录与 frontmatter 条件规则

除了单个 CLAUDE.md 文件，用户还可以在 `.claude/rules/` 下放置多个 .md 文件。这让团队可以按主题组织规范：

```
.claude/rules/
  ├── coding-style.md     — 编码风格
  ├── testing-policy.md   — 测试要求  
  ├── security-rules.md   — 安全约束
  └── tsx-conventions.md  — 仅对 .tsx 文件生效（条件规则）
```

**关键区别**：规则文件分为**无条件规则**和**条件规则**两种。条件规则通过 YAML frontmatter 中的 `paths` 字段指定作用范围：

```markdown
---
paths: "*.tsx, src/components/**"
---

# TSX 组件编码规范
- 使用函数式组件
- Props 必须定义 TypeScript 接口
```

`paths` 字段支持 glob 模式，包括大括号展开（如 `*.{ts,tsx}`）。源码中 `parseFrontmatterPaths` 函数解析 frontmatter，`processMdRules` 函数通过 `conditionalRule` 参数区分两种规则：

```typescript
// 无条件规则：没有 frontmatter paths 的文件，始终加载
result.push(...files.filter(f => (conditionalRule ? f.globs : !f.globs)))
// 条件规则：有 frontmatter paths 的文件，仅在匹配时加载
```

条件规则的匹配逻辑通过 `processConditionedMdRules` 函数实现——将目标文件的路径与规则文件的 glob 模式进行匹配，只有匹配的规则才会被注入上下文。这让规则可以说"这条编码规范只在 `*.tsx` 文件中生效"，避免了无关规则对 token 的浪费。

> 💡 **通俗理解**：无条件规则就像公司所有员工都要遵守的通用规章，条件规则就像"仅适用于前端工程师"的专项规范——只在处理相关文件时才被加载。

### 1.7 加载顺序与组装策略

> 📚 **课程关联**：多层级配置的查找和合并策略是**操作系统**课程中"环境变量继承"和"路径解析"概念的扩展。子进程继承父进程的环境变量，但可以覆盖——这与 CLAUDE.md 的层级模型类似。"全部拼接不做冲突解决"的设计选择则对应**软件工程**课程中"配置管理"的两种流派：**声明式合并**（如 CSS 的层叠规则，后声明覆盖前声明）vs **全量拼接**（让消费者自行决定优先级）。Claude Code 选择了后者，因为 LLM 有"理解上下文"的能力，可以自行判断哪条规则更具体——但这也意味着冲突解决的责任被推给了一个本质上不确定的组件（见第 7 节设计取舍分析）。

所有 CLAUDE.md 来源的内容不是简单拼接——系统按以下顺序组装为最终的系统提示注入：

```
组装顺序（从先到后，后加载 = 模型关注度更高）：
1. Managed CLAUDE.md + .claude/rules/*.md（企业策略）
2. User CLAUDE.md + ~/.claude/rules/*.md（用户全局）
3. Project CLAUDE.md / .claude/CLAUDE.md / .claude/rules/*.md（逐层，从 git-root 向 cwd）
4. Local CLAUDE.local.md（逐层，与 Project 同步）
```

每个来源的内容在注入时会附带**来源标注和类型描述**，这让 Claude 知道每条指令的出处和性质：

```typescript
const description =
  file.type === 'Project'
    ? ' (project instructions, checked into the codebase)'
    : file.type === 'Local'
      ? " (user's private project instructions, not checked in)"
      : " (user's private global instructions for all projects)"
```

**关键设计**：组装是**全部拼接**而非"后覆盖前"。这意味着如果用户级写了"使用 2 空格缩进"，项目级写了"使用 4 空格缩进"，Claude 会**同时看到**两条矛盾的指令。系统不做冲突解决——由 Claude 自行判断更具体的上下文（通常是更局部的指令优先）。相比之下，Cursor 有明确的优先级模型（`alwaysApply` > `autoAttach` > manual），用户可以预测哪条规则生效。

### 1.8 搜索路径的边界条件

**monorepo 场景**：在 monorepo 中，`<git-root>` 是最外层仓库根目录。如果你在 `packages/frontend/src/` 下工作，系统会搜索：
- `packages/frontend/src/CLAUDE.md`（及 `CLAUDE.local.md`）
- `packages/frontend/CLAUDE.md`（及 `CLAUDE.local.md`）
- `packages/CLAUDE.md`（及 `CLAUDE.local.md`）
- `<git-root>/CLAUDE.md`（及 `CLAUDE.local.md`）

这让每个子包可以有自己的 CLAUDE.md，同时继承项目根的通用规范。

**非 git 目录**：如果当前目录不在 git 仓库中，`<git-root>` 检测失败，系统只加载 Managed、User 层级和当前目录的文件。

**符号链接**：系统使用 `safeResolvePath()` 解析路径——对于符号链接，会解析到真实路径，并同时在 `processedPaths` 中记录原始路径和解析后路径，防止同一文件被重复加载。

**Git worktree 去重**：源码中有专门的 worktree 处理逻辑。当 worktree 嵌套在主仓库内部时（如 `.claude/worktrees/<name>/`），向上遍历会同时经过 worktree root 和 main repo root，导致同一个 CLAUDE.md 被加载两次。源码用 `isNestedWorktree` 检测这种情况，跳过主仓库中的 Project 类型文件，但仍加载 `CLAUDE.local.md`（因为它是 gitignored 的，在 worktree 中不存在副本）：

```typescript
const skipProject =
  isNestedWorktree &&
  pathInWorkingPath(dir, canonicalRoot) &&
  !pathInWorkingPath(dir, gitRoot)
```

### 1.9 缓存策略与失效机制

CLAUDE.md 文件**不是**通过文件系统监视器（fs watcher）进行实时监控的。实际实现使用 `memoize` 缓存：

```typescript
export const getMemoryFiles = memoize(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    // ...整个文件发现和加载逻辑
  }
)
```

缓存只在特定事件触发时清除：

- **`clearMemoryFileCaches()`**：纯正确性缓存失效——用于 worktree 切换、settings 同步、`/memory` 对话框等场景。不触发 `InstructionsLoaded` hook。
- **`resetGetMemoryFilesCache(reason)`**：带 hook 触发的缓存重置——用于 compaction 等需要审计的场景，重置后下一次加载会触发 `InstructionsLoaded` hook 并报告加载原因。

```typescript
export function clearMemoryFileCaches(): void {
  getMemoryFiles.cache?.clear?.()
}

export function resetGetMemoryFilesCache(
  reason: InstructionsLoadReason = 'session_start',
): void {
  nextEagerLoadReason = reason
  shouldFireHook = true
  clearMemoryFileCaches()
}
```

**重要澄清**：这不是"文件监视与热更新"。如果用户在会话中途手动修改了 CLAUDE.md，修改**不会自动生效**——只有在缓存被显式清除后（如 compaction 事件），下一轮对话才会重新加载。`InstructionsLoaded` hook 是加载完成后触发的**观察事件**（fire-and-forget），不是文件变化触发器。这是一个性能 vs 实时性的 trade-off：对于长会话期间 CLAUDE.md 很少变化的典型场景，缓存避免了每轮对话重复的文件系统遍历。

---

## 2. `@include` 指令系统

### 2.1 语法与设计

`@include` 是整个 CLAUDE.md 加载系统中**工程复杂度最高的功能**。它让 CLAUDE.md 文件可以引用其他文件，使指令系统从"单个配置文件"升级为"配置文件图"。源码 `claudemd.ts` 文件头注释详细描述了其规范：

```
Memory @include directive:
- Syntax: @path, @./relative/path, @~/home/path, or @/absolute/path
- @path (without prefix) is treated as a relative path (same as @./path)
- Works in leaf text nodes only (not inside code blocks or code strings)
- Included files are added as separate entries AFTER the including file
  (parent file pushed first, then recursively resolved children)
- Circular references are prevented by tracking processed files
- Non-existent files are silently ignored
```

> **源码核实**：原注释写的是 "before the including file"，但 `processMemoryFile()` 的实际实现（`claudemd.ts:661-664`）是先 `result.push(memoryFile)` 主文件，再递归处理 include。子文件**跟在父文件之后**，顺序是自顶向下展开。这里以代码行为为准。

示例用法：

```markdown
# 项目规范

@./shared/coding-standards.md
@./shared/api-conventions.md
@~/my-global-rules/security.md

## 本项目特定规则
- 使用 pnpm 而非 npm
- 测试覆盖率不低于 80%
```

### 2.2 实现机制

`@include` 的解析依赖一个完整的 Markdown lexer 流程：

1. **词法分析**：使用 `marked` 库的 `Lexer` 将 Markdown 内容解析为 token 流（使用 `gfm: false` 避免 `~/path` 被解析为删除线语法）
2. **路径提取**：`extractIncludePathsFromTokens` 函数递归遍历 token 树，只从 `text` 类型节点中提取 `@path` 引用——**代码块和代码 span 中的 @path 被跳过**
3. **路径解析**：支持四种路径格式（`@path`、`@./path`、`@~/path`、`@/path`），通过 `expandPath` 函数解析为绝对路径
4. **递归处理**：`processMemoryFile` 函数递归加载被引用的文件，被引用文件的结果添加到引用者之后

```typescript
const MAX_INCLUDE_DEPTH = 5

export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  // 防循环引用 + 深度限制
  const normalizedPath = normalizePathForComparison(filePath)
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return []
  }
  processedPaths.add(normalizedPath)
  
  // 读取并解析文件（一次 lex 同时完成 HTML 注释剥离和 @include 提取）
  const { info: memoryFile, includePaths } =
    await safelyReadMemoryFileAsync(filePath, type, resolvedPath)
  
  const result: MemoryFileInfo[] = [memoryFile]
  
  // 递归处理每个 @include 引用
  for (const resolvedIncludePath of includePaths) {
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) continue  // 外部引用需要审批
    
    const includedFiles = await processMemoryFile(
      resolvedIncludePath, type, processedPaths, includeExternal,
      depth + 1, filePath,  // 传递 parent
    )
    result.push(...includedFiles)
  }
  return result
}
```

### 2.3 安全边界

`@include` 指令有严格的安全控制：

1. **文件类型白名单**：只允许加载文本文件（`.md`, `.txt`, `.json`, `.ts`, `.py` 等 90+ 种扩展名），二进制文件（图片、PDF 等）被自动跳过。这防止了 `@./logo.png` 导致二进制数据被注入上下文。

2. **内外部引用区分**：通过 `pathInOriginalCwd()` 检查引用路径是否在工作目录内。外部引用（如 `@~/personal-rules.md` 或 `@/etc/some-config`）需要项目配置中 `hasClaudeMdExternalIncludesApproved` 为 true 才会被加载。

3. **循环引用检测**：`processedPaths` Set 跟踪所有已处理的文件路径（包括符号链接解析后的路径），防止 A include B include A 的无限循环。

4. **深度限制**：`MAX_INCLUDE_DEPTH = 5`，防止过深的嵌套链消耗过多 token 和加载时间。

> 💡 **通俗理解**：`@include` 的安全设计就像图书馆的馆际互借——你可以在笔记中引用本馆的其他书籍（内部引用），但要引用外馆的资料（外部引用）需要特别审批。同时禁止借阅非文字类资料（图片、视频），防止无效内容混入。

这是整个系统中**安全意识最强的设计决策之一**，因为它防止了一个严重的攻击向量：恶意 CLAUDE.md 通过 `@~/.ssh/id_rsa` 或 `@~/.aws/credentials` 引用敏感文件，将其内容暴露给 AI 模型。

### 2.4 HTML 注释剥离

源码中有完整的 `stripHtmlComments` 实现，使用 marked lexer 在 block 级别剥离 HTML 注释，同时保留代码块中的注释：

```typescript
export function stripHtmlComments(content: string): {
  content: string; stripped: boolean
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false }
  }
  return stripHtmlCommentsFromTokens(new Lexer({ gfm: false }).lex(content))
}
```

这让用户可以在 CLAUDE.md 中用 `<!-- 这段只给人看 -->` 写人类可读但**不会被 AI 加载**的注释。一个巧妙的优化是：`parseMemoryFileContent` 函数只做**一次** lex，同时完成 HTML 注释剥离和 `@include` 路径提取，避免重复解析。

---

## 3. `claudeMdExcludes` 排除机制

源码中有完整的排除逻辑，让用户可以通过 `claudeMdExcludes` 配置排除特定路径的 CLAUDE.md 文件。值得注意的是 macOS 上 `/tmp` -> `/private/tmp` 的符号链接问题处理：

```typescript
function resolveExcludePatterns(patterns: string[]): string[] {
  const expanded: string[] = patterns.map(p => p.replaceAll('\\', '/'))
  for (const normalized of expanded) {
    if (!normalized.startsWith('/')) continue
    // 解析符号链接，同时保留原始模式和解析后模式
    const resolvedDir = fs.realpathSync(dirToResolve).replaceAll('\\', '/')
    if (resolvedDir !== dirToResolve) {
      expanded.push(resolvedDir + normalized.slice(dirToResolve.length))
    }
  }
  return expanded
}
```

用户写 `/tmp/project/CLAUDE.md` 作为排除模式，但文件实际路径可能是 `/private/tmp/project/CLAUDE.md`——通过双向解析确保两侧匹配。

**关键限制**：`Managed`、`AutoMem`、`TeamMem` 类型**不受** `claudeMdExcludes` 影响——源码中 `isClaudeMdExcluded()` 对非 `User` / `Project` / `Local` 的类型直接返回 `false`。这意味着企业策略、AI 自动记忆、团队共享记忆都无法被开发者通过 `claudeMdExcludes` 排除（但 User/Project/Local 可以）。

---

## 4. yoloClassifier 的缓存注入模式

> 📚 **课程关联**：这是**软件工程**课程中"依赖注入打破循环依赖"的经典案例。A 需要 B 的输出，B 的模块又间接依赖 A——解决方案是引入一个独立的缓存中间层，让两者都能安全访问共享数据。

yoloClassifier（自动权限分类器）需要读取 CLAUDE.md 的内容来决定权限策略。但如果 yoloClassifier 直接 import claudemd.ts，会产生模块循环依赖：`permissions/filesystem → permissions → yoloClassifier → claudemd.ts → permissions/filesystem`。

源码中的解决方案**不是**"加载时绕过 yoloClassifier"，而是**通过缓存中间层间接传递数据**。在 `context.ts` 的 `getUserContext()` 中：

```typescript
// context.ts 第 170-176 行
const claudeMd = shouldDisableClaudeMd
  ? null
  : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
// Cache for the auto-mode classifier (yoloClassifier.ts reads this
// instead of importing claudemd.ts directly, which would create a
// cycle through permissions/filesystem → permissions → yoloClassifier).
setCachedClaudeMdContent(claudeMd || null)
```

也就是说：`getUserContext()` 加载 CLAUDE.md 后，调用 `setCachedClaudeMdContent()` 将内容写入一个独立的缓存模块。yoloClassifier 从这个缓存读取内容，而不是直接 import claudemd.ts。这是一个经典的**依赖注入模式**——通过一个轻量的中间缓存（在 `bootstrap/state.ts` 中），打破了模块级别的循环依赖。

> **精确性说明**：这里说的"yoloClassifier 总能访问到最新的 CLAUDE.md 内容"是**相对于上游缓存**的——一旦 `getUserContext()` 完成了 CLAUDE.md 的加载与 `setCachedClaudeMdContent()` 的写入，yoloClassifier 下次读取就能看到这份内容。但这不等于"yoloClassifier 能看到磁盘上的最新 CLAUDE.md"——`getUserContext()` 本身由 `memoize` 缓存（§1.9），会话中途用户手动修改 CLAUDE.md 不会自动触发重新加载，因此 yoloClassifier 看到的仍是上次 session_start / compact 时的快照，与 §1.9 的语义一致，不矛盾。

---

## 5. Init 命令

`/init` 命令可以自动生成一个项目的初始 CLAUDE.md——Claude 分析项目结构（package.json、Makefile、CI 配置等）后生成适合该项目的编码约定和工具偏好。

生成过程：
1. 扫描项目根目录的关键配置文件（`package.json`、`Makefile`、`Cargo.toml`、`.github/workflows/`、`tsconfig.json` 等）
2. 识别项目技术栈、构建系统、测试框架
3. 用 AI 生成结构化的 CLAUDE.md，包含：构建命令、测试命令、编码风格、目录结构说明
4. 写入 `<git-root>/CLAUDE.md`

**注意**：`/init` 不会覆盖已存在的 CLAUDE.md——如果文件已存在，会提示用户确认是否追加或替换。

---

## 6. 与 Memory 系统的关系

CLAUDE.md 和 Memory 系统（`~/.claude/memory/`）是两个独立但互补的指令来源：

| 特性 | CLAUDE.md | CLAUDE.local.md | Memory |
|------|-----------|----------------|--------|
| 作用域 | 项目级/用户级 | 项目级（私有） | 用户级 |
| 编辑方式 | 手动编辑文件 | 手动编辑文件 | AI 通过 `/memory` 命令写入 |
| 内容类型 | 项目约定、编码规范 | 个人项目偏好 | 用户偏好、反馈记录 |
| Git 追踪 | 项目级可以提交 | 不提交（gitignored） | 不提交（用户私有） |
| 可排除 | 是（claudeMdExcludes） | 是 | 不适用 |

两者的内容在最终系统提示中合并，但没有显式的优先级关系——Claude 需要自行判断哪条指令更适用于当前上下文。

---

## 7. 设计取舍与评价

### 优秀设计

1. **四大 MemoryType 分层**让不同角色（企业管理员、个人用户、项目团队、个人开发者）各有其指令空间，且安全边界清晰——Managed 不可排除，Local 不入版本控制
2. **`@include` 指令系统**让指令从单文件升级为文件图，在同类产品中独一无二（Cursor、Copilot、Windsurf 的指令文件均不支持类似引用机制），且安全控制完善（深度限制、循环检测、外部引用审批、文件类型白名单）
3. **frontmatter 条件规则**让规则可以精确作用于特定文件类型，避免 token 浪费——"这条 TSX 规范只在处理 .tsx 文件时加载"
4. **InstructionsLoaded hook** 提供企业审计能力，每个加载的文件都报告来源类型、加载原因（`session_start` / `compact` / `include`）和父文件路径
5. **与 prompt cache 的集成**让常规使用下的额外 token 成本趋近于零

### 代价与风险

1. **全量拼接的不确定性**：当两条矛盾的规则同时存在时，用户没有确定性保证哪条会生效。在企业场景中，"LLM 自行判断"等于非确定性的策略执行。相比 Cursor 的明确优先级模型，Claude Code 的方式在可预测性上有劣势
2. **向上遍历的 "ambient authority" 风险**：源码中 `while (currentDir !== parse(currentDir).root)` 会从 CWD 一直向上遍历到文件系统根目录。在深层嵌套目录中，如果某个上级目录恰好有一个遗留的 CLAUDE.md，它会被静默加载——难以追踪
3. **缓存与实时性的矛盾**：`memoize` 缓存意味着整个会话期间只加载一次（除非显式清除）。如果用户在会话中途修改了 CLAUDE.md，修改不会自动生效。这与用户可能期望的"保存即生效"行为不符
4. **`@include` 的 token 爆炸风险**：在大型 monorepo 中，如果每个子包的 CLAUDE.md 都 include 共享规则，include 链可能快速累积大量 token。`MAX_INCLUDE_DEPTH = 5` 限制了深度但没有限制总量
5. **`tengu_paper_halyard` 特性开关**：源码中 `getClaudeMds` 函数有一个特性开关可以跳过所有 Project 和 Local 类型的内容——这暗示 Anthropic 内部在实验"不加载项目级指令"的模式，CLAUDE.md 系统的设计可能仍在演进中

---

