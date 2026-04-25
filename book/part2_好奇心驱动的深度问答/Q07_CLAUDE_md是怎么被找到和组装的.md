# CLAUDE.md 是怎么被找到和组装的？

解析 Claude Code 的多层配置发现与组装机制——从用户目录到项目子目录，六种来源的 CLAUDE.md 如何按优先级合并，并利用 LLM 的注意力特性实现"越靠后越重要"。

### 🌍 行业背景

"让 AI 工具读取项目级配置文件来定制行为"已经成为 AI 编码工具的标准做法，但各家在配置发现机制的深度上差异显著：

- **Cursor（`.cursorrules`）**：支持在项目根目录放置 `.cursorrules` 文件定义规则，但仅支持单文件、单层级，没有目录树遍历、条件规则或 `@include` 机制。2024 年底新增了 `.cursor/rules/` 目录，开始支持多文件规则，但仍不支持 frontmatter 路径条件。
- **Windsurf（`.windsurfrules`）**：与 Cursor 类似的单文件规则机制，功能较为基础。
- **Aider（`.aider.conf.yml` + conventions）**：通过 YAML 配置文件和 `--read` 参数加载规则文件，支持指定多个文件，但需要用户手动指定路径，没有自动的目录树发现机制。
- **GitHub Copilot（`.github/copilot-instructions.md`）**：2024 年引入项目级指令文件，仅支持单文件，位置固定在 `.github/` 目录下。
- **Codex（`AGENTS.md`）**：OpenAI 的方案同样支持多层级目录发现——从仓库根目录到当前工作目录逐层查找 `AGENTS.md`，支持 `@include` 引用其他文件，设计思路与 Claude Code 的 CLAUDE.md 高度相似。
- **Cursor（`.cursor/rules/`）**：已从简单的 `.cursorrules` 文件进化为 `.mdc` 格式的条件规则引擎，支持 Frontmatter 元数据、globs 文件类型匹配和 alwaysApply 全局生命周期定义——实质上构建了一个响应式的事件触发系统。

Claude Code 的 CLAUDE.md 系统在功能完整度上处于行业前列（六层来源、条件规则、`@include`、HTML 注释过滤），但"多层配置文件 + 目录树遍历"的基本模式并非 Claude Code 独创——Codex 的 AGENTS.md 采用了几乎相同的分层发现机制，Cursor 的 `.mdc` 条件规则引擎则在另一个维度上实现了更精细的规则匹配。

---

## 问题

当你在项目根目录放一个 CLAUDE.md，Claude Code 就会读取它。但如果你的项目有多个子目录，每个目录都有自己的 CLAUDE.md，情况会怎样？用户目录的 `~/.claude/CLAUDE.md` 和项目里的 CLAUDE.md 哪个优先级高？`.claude/rules/*.md` 又是什么？

---

## 你可能以为……

你可能以为系统只是找到最近的一个 CLAUDE.md 并读取它，或者把所有 CLAUDE.md 拼接在一起，没有特别的顺序。

实际上这是一套有精心设计优先级规则的多层配置系统，而且它利用了 LLM 的一个内在特性来实现优先级。

> 💡 **通俗理解**：CLAUDE.md 就像**新员工入职手册的多层结构**——公司总部规章（企业管理策略）+ 部门手册（用户全局设置）+ 项目组约定（项目级 CLAUDE.md）+ 你的个人备忘录（本地私有 CLAUDE.md）+ 老板的特别嘱咐（用户追加指令）。放在手册越后面的内容，Claude 越认真对待——因为 AI 天然对"最近看到的内容"更重视。

---

## 实际上是这样的

### 六种内存来源

Claude Code 从六个地方寻找配置文件，按优先级从低到高：

```
1. Managed   → /etc/claude-code/CLAUDE.md   （企业管理员策略）
2. User      → ~/.claude/CLAUDE.md          （你的全局个人偏好）
3. Project   → CLAUDE.md / .claude/CLAUDE.md（项目级规则）
4. Local     → CLAUDE.local.md             （私有项目规则，gitignored）
5. AutoMem   → ~/.claude/projects/*/memory/ （自动积累的记忆）
6. TeamMem   → 组织共享记忆（ant-only，即仅在 Anthropic 内部 / dogfood 分支可用，社区版不装载）
```

每一层都有自己的用途：企业层确保公司策略生效；用户层放你的个人编码风格；项目层放团队约定（提交到 git，所有人共享）；本地层放你不想提交的私有注释。

### 目录树遍历算法

对于项目级规则，系统做了一件有趣的事：**从 `process.cwd()` 即当前工作目录向上遍历到文件系统根目录（`/` 或 Windows 盘符根）**，收集所有中间目录，然后反转顺序，从根往下加载。下方示例为节省篇幅只展示到 `/home`，真实遍历会一直走到 `/`。

```
当前目录：/home/user/company/project/src/feature/

遍历收集：
  /home/user/company/project/src/feature
  /home/user/company/project/src
  /home/user/company/project
  /home/user/company
  /home/user
  /home

反转，加载顺序（优先级从低到高）：
  → /home/CLAUDE.md（如果存在，最先加载）
  → /home/user/company/CLAUDE.md
  → /home/user/company/project/CLAUDE.md ← 通常这里有
  → /home/user/company/project/src/CLAUDE.md
  → /home/user/company/project/src/feature/CLAUDE.md（最后加载，最高优先级）
```

**为什么反转？** 因为"优先级"是通过 **prompt 中的位置** 实现的——越晚加载的内容在 prompt 里越靠后，LLM 对靠后内容通常给予更多注意力。这是利用模型的位置偏见来实现配置优先级的设计。

> 📚 **课程关联**：这种"从根目录向下逐层覆盖"的配置发现模式，在《软件工程》和《操作系统》课程中都有对应概念。它与 Git 的配置系统（`/etc/gitconfig` → `~/.gitconfig` → 仓库内的 `.git/config`）、npm 的 `package.json` 向上查找、以及 Linux shell 的 `/etc/profile` → `~/.profile` / `~/.bashrc` 分层加载机制同属一种设计模式——**分层配置覆盖**（Layered Configuration Override）。在分布式系统中，这种模式也出现在 Kubernetes 的 ConfigMap 层级覆盖和 Spring Boot 的 profile-based 配置中。

### 三种位置的 Project 规则文件

在每个目录里，系统查找三种文件：

```
CLAUDE.md                 — 主配置文件
.claude/CLAUDE.md         — 放在隐藏目录里的主配置（等价，只是位置不同）
.claude/rules/*.md        — 规则集合（每个文件一条主题规则）
```

`.claude/rules/` 让你把不同关注点的规则分文件存放，更容易维护。比如 `testing.md`、`git-conventions.md`、`code-style.md`。

### 条件规则（Frontmatter paths）

`.claude/rules/*.md` 文件可以声明只对特定文件路径生效：

```markdown
---
paths:
  - "src/**/*.ts"
  - "tests/**"
---

# TypeScript 规范
永远使用 interface 而不是 type alias 定义公共 API 类型。
```

这条规则只在 TypeScript 文件和测试文件中生效，其他文件（如 Python 脚本）看不到它。

### @include 指令

CLAUDE.md 文件可以引用其他文件：

```markdown
@./shared-conventions.md
@~/my-global-standards/code-review.md
@/etc/company/security-rules.md
```

被引用的文件作为独立条目插入到引用它的文件之前（优先级更低），形成一个扁平化的规则列表。循环引用由 `processedPaths` 集合防止。

**安全注意**：引用 cwd 之外的外部文件需要用户批准。这防止了恶意项目通过 CLAUDE.md 加载外部规则（类似代码供应链攻击）。

### HTML 注释隐藏内容

你可以在 CLAUDE.md 里写 HTML 注释，AI 不会读到这些内容：

```markdown
# 代码规范

<!-- 注：这条规则是因为 2024 年的安全事故加的，详见 JIRA-1234 -->
永远对用户输入进行 SQL 参数化查询。

<!-- TODO: 当迁移完成后删除这条 -->
临时规则：所有新代码必须加向后兼容的 Fallback。
```

系统使用 `marked` lexer 来精确识别 HTML 注释——之所以不用简单的字符串匹配，是因为代码块（```fenced block```、缩进代码）里出现的 `<!-- -->` 必须**保留原文**（那是代码示例的一部分，不是要被隐藏的指令）；`marked` 的词法分析可以区分"真正的 HTML 注释" vs "代码块内的字面量"。

### 最终拼接格式

所有加载的文件按顺序拼接，格式如下：

```
Codebase and user instructions are shown below. Be sure to adhere to these
instructions. IMPORTANT: These instructions OVERRIDE any default behavior
and you MUST follow them exactly as written.

Contents of /home/user/company/project/CLAUDE.md (project instructions, checked into the codebase):

[项目 CLAUDE.md 的内容]

Contents of /home/user/company/project/src/CLAUDE.md (project instructions, checked into the codebase):

[src 目录 CLAUDE.md 的内容]

Contents of /home/user/.claude/CLAUDE.md (user's private global instructions for all projects):

[用户全局 CLAUDE.md 的内容]
```

每个文件都带了它的路径和类型描述，让 AI 知道"这条规则是从哪里来的"。

> **示例说明**：上面的示例仅展示同一 Project 层内的向上遍历嵌套顺序，并非六种来源的完整优先级排序。完整顺序以 `getMemoryFiles()` 为准：Managed → User → Project（向上遍历后反转）→ Local，越靠后优先级越高。若把示例按完整顺序拼接，User 全局 `~/.claude/CLAUDE.md` 会出现在所有 Project 条目之前（先加载、优先级较低），`CLAUDE.local.md` 会在最末尾（最高优先级）。

---

## 这个设计的精妙之处

**隐式优先级**：不是通过数字权重，而是通过 prompt 中的位置来实现优先级。这利用了 LLM 的内在特性（对靠后内容关注度更高），不需要特殊的优先级解析逻辑。这种"位置即优先级"的做法是一种务实的工程选择，但并非完美方案——LLM 的位置偏见（recency bias）是模型的统计特性而非确定性保证，在极长上下文中靠后内容的注意力优势可能被稀释。

**树形发现 + 覆盖语义**：子目录的规则自然地覆盖父目录的规则，和大多数分层配置系统（.gitconfig、package.json 等）的心智模型一致。

**渐进式权限**：Managed（企业）> Project（共享）> User（全局）> Local（私有）的六种来源（再加上 AutoMem、TeamMem 两类自动/组织共享记忆，共六层）。本节仅讨论人工可编辑的前四层配置层，AutoMem / TeamMem 不在此讨论。这种分层允许"尊重团队规范，同时保留个人自定义"的使用模式。

---

## 实践建议

基于对这套系统的理解：

1. **项目规则放 `.claude/rules/*.md`**：按主题分文件，比单个 CLAUDE.md 更容易维护
2. **私有注释用 CLAUDE.local.md**：不提交到 git 的内容（如你的调试偏好、临时实验性规则）
3. **HTML 注释写"为什么"**：规则的背景信息放在注释里，AI 不看，但队友能看
4. **条件规则按文件类型**：前端规则、后端规则、测试规则分开，不互相干扰

---

## 代码落点

- `src/utils/claudemd.ts`，第 1-26 行：文件注释，完整的加载顺序说明
- `src/utils/claudemd.ts`，第 790 行：`getMemoryFiles()` 函数，完整发现逻辑
- `src/utils/claudemd.ts`，第 1153 行：`getClaudeMds()` 函数，拼接和格式化逻辑
- `src/utils/claudemd.ts`，第 292 行：`stripHtmlComments()` 函数
- `src/context.ts`，第 155 行：`getUserContext()`，调用链入口

---

## 还可以追问的方向

- `AutoMem` 系统是如何自动积累记忆的？它什么时候往 memory.md 里写东西？
- 条件规则（frontmatter paths）的匹配逻辑——picomatch 支持哪些 glob 语法？
- `--add-dir` 命令行参数如何与 CLAUDE.md 系统交互？

---

