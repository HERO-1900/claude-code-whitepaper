# Bash AST 解析器完全解析

Claude Code 的 BashTool 是使用频率最高的工具——它执行用户环境中的一切 shell 命令。但"能执行"不等于"应该执行"：一条看似无害的 `cd /tmp && git status` 在进入恶意构造的仓库后，可能通过仓库级 `core.fsmonitor` / `core.sshCommand` 等可执行配置（历史上被 CVE-2022-24765 类漏洞利用）触发任意代码执行。现代 git 已通过 `safe.directory` 和所有者校验缓解跨用户场景，但**同用户下的敏感配置仍可能执行**——这正是 Claude Code Git 安全协议需要单独防御的原因。为了在"让 AI 自由操作"与"防止灾难性命令"之间找到平衡，Anthropic 投入了 **35,000+ 行代码**构建了一套纯 TypeScript 的 Bash AST 解析器 + 安全分析管线。这是 Claude Code 中代码量最大的单一子系统——比查询循环（3,024 行）大 10 倍，比整个记忆系统（~4,000 行）大 8 倍。

> **源码位置**（以 `wc -l` 精确核实）：
> - `src/utils/bash/`（解析器核心 **12,306 行**）
> - `src/tools/BashTool/`（安全集成 **10,894 行** · 原书早期写"23,000+"是将本章讨论涉及的 permissions/ 重复计入，实际 BashTool/ 目录内为 10,894 行）
> - `src/utils/permissions/`（权限规则 **9,409 行**）
>
> 三者合计 32,609 行（本章讨论的"广义 bash 安全系统"，不重复计入任何目录）。

> 💡 **通俗理解**：想象海关安检——每个入境旅客（shell 命令）都要过 X 光机（AST 解析器）。X 光机不是把行李打开逐件检查，而是用射线"看穿"内部结构。如果看到可疑物品（危险命令模式），安检员（权限系统）会拦下来问旅客："你确定要带这个进来吗？"如果 X 光机根本看不清行李内部（解析失败），那就更要拦下来——宁可误拦，不可放过。

### 行业背景：AI 编程工具的命令安全现状

shell 命令执行是 AI 编程工具安全的核心难题，各家方案差异巨大：

- **Cursor**：依赖用户审批弹窗（Allow/Deny），不做深度命令分析。快速但安全边界薄——用户很容易"手滑"放过危险命令。
- **GitHub Copilot Workspace**：云端容器执行，物理隔离解决安全问题，但牺牲了本地文件系统访问能力。
- **Aider**：完全信任用户环境，不做命令拦截。面向高级开发者，企业场景风险高。
- **Codex（OpenAI）**：v0.118.0 实现 OS 级出口控制（egress rules），Rust 重写带来内存安全，但命令分析粒度不如 Claude Code 的 AST 级别。
- **Windsurf（Codeium）**：云端执行 + 本地同步，命令安全在服务端处理。

Claude Code 的独特之处在于**本地运行 + AST 级静态分析**——不依赖容器/云端/Rust 内存安全，而是通过"理解命令结构"来做细粒度安全决策。这种方案的核心权衡贯穿本章：

- **vs 容器隔离（Copilot/Windsurf）**：更灵活、离线可用，但安全依赖解析器的正确性
- **vs OS 级控制（Codex）**：更细粒度（能区分"安全的 git diff"和"危险的 git push --force"），但解析器本身可能成为攻击面
- **vs 纯审批模式（Cursor/Aider）**：更智能（AI 可以自主执行安全命令），但工程复杂度高出数个量级

---

## 概述

本章按以下顺序展开：第 1 节给出系统全景——从命令输入到执行/拒绝的完整管线；第 2 节深入纯 TypeScript 词法器和解析器的实现；第 3 节解析 FAIL-CLOSED 的 AST 安全分析器；第 4 节展示 24 项安全检查的完整清单；第 5 节讲解 Git 安全协议的代码实现；第 6 节分析权限规则系统；第 7 节讨论性能保护机制；第 8 节剖析差异攻击防御；第 9 节总结设计哲学与局限性；第 10 节是"批判与反思"——独立审视上述设计中真实存在的权衡与局限。

> ⚠️ **分析边界说明**：本章分析的是 Claude Code 2.1.88 版本的开源/可反编译代码。其中 `bashParser.ts`（纯 TS 解析器）可能是对内部 tree-sitter-bash WASM 模块的替代方案——通过 Feature Flag `TREE_SITTER_BASH` 控制使用哪条路径。Anthropic 内部版本（源码中以 `USER_TYPE === 'ant'` 这类代号标识，后文简称 "ANT"）可能使用 tree-sitter 的 C/WASM 绑定获得更高性能。本章分析纯 TS 路径，这也是开源版本用户实际使用的路径。

---

> **[图表预留 3.18-A]**：Bash AST 解析管线全景图 — 命令输入 → 词法分析 → 语法树构建 → AST 安全分析 → 24项检查 → 权限判定 → 执行/拒绝

> **[图表预留 3.18-B]**：FAIL-CLOSED 安全模型 — 允许节点类型白名单 vs 未知节点类型 → too-complex → 用户确认

---

## 1. 系统全景：从命令到判决

当 AI 调用 BashTool 时，命令字符串要经过一条层层递进的分析管线，每一层都可以做出"拒绝"决策：

```
输入: bash 命令字符串 (如 "cd /tmp && git status")
  │
  ▼
┌─────────────────────────────────────────────┐
│ 第1层: bashParser.ts — 纯TS词法器+解析器     │
│  · 50ms 超时 + 50,000 节点预算              │
│  · 产出 tree-sitter-bash 兼容的 AST 节点树   │
│  · 失败 → PARSE_ABORTED 哨兵值              │
└─────────────────┬───────────────────────────┘
                  │ TsNode 语法树
                  ▼
┌─────────────────────────────────────────────┐
│ 第2层: ast.ts — FAIL-CLOSED 安全分析器       │
│  · 前置检查: 控制字符/Unicode空格/Zsh语法    │
│  · AST 遍历: 仅处理白名单节点类型            │
│  · 未知节点 → too-complex (需用户确认)       │
│  · 产出 SimpleCommand[] 或 too-complex       │
└─────────────────┬───────────────────────────┘
                  │ SimpleCommand[]
                  ▼
┌─────────────────────────────────────────────┐
│ 第3层: bashSecurity.ts — 24项安全检查        │
│  · 检查 argv 中的危险模式                    │
│  · 每项检查有唯一 analytics ID               │
│  · 任一检查不通过 → 标记为不安全             │
└─────────────────┬───────────────────────────┘
                  │ 安全标记
                  ▼
┌─────────────────────────────────────────────┐
│ 第4层: bashPermissions.ts — 权限判定         │
│  · 匹配用户配置的权限规则                    │
│  · Git 安全协议 (cd+git 复合命令检测)        │
│  · 只读命令验证 (readOnlyValidation.ts)      │
│  · 路径验证 (pathValidation.ts)              │
└─────────────────┬───────────────────────────┘
                  │ allow / deny / ask
                  ▼
            执行 或 弹出权限确认
```

> 💡 **通俗理解**：这像机场的四道安检——第一道是 X 光机（把行李"看穿"成结构化信息），第二道是结构分析员（看行李里有没有"不认识的东西"，有就拦下），第三道是违禁品清单对照（24 项逐一检查），第四道是海关官员（根据你的身份和目的地做最终放行/拦截决策）。

### 1.1 代码量分布

| 层级 | 核心文件 | 行数 | 职责 |
|------|---------|------|------|
| 解析器层 | `bashParser.ts` | 4,436 | 纯 TS 词法器 + 解析器 |
| | `heredoc.ts` | 733 | Heredoc 提取/恢复 |
| | `commands.ts` | 1,339 | 命令分割/重定向分类 |
| | `ParsedCommand.ts` | 318 | IParsedCommand 接口 |
| | `ShellSnapshot.ts` | 582 | Shell 状态快照 |
| | 其他 utils/bash/ | ~4,685 | 管道/补全/引号/注册表/规格 |
| **解析器层小计** | | **~12,093** | |
| 安全分析层 | `ast.ts` | 2,679 | FAIL-CLOSED AST 遍历 |
| 安全检查层 | `bashSecurity.ts` | 2,592 | 24 项安全检查 |
| 权限判定层 | `bashPermissions.ts` | 2,621 | 权限规则匹配 + Git 安全协议 |
| | `readOnlyValidation.ts` | 1,990 | 只读命令白名单 |
| | `pathValidation.ts` | 1,303 | 路径提取/验证 |
| | `sedValidation.ts` | 684 | sed 脚本验证 |
| | 其他 BashTool/ | ~1,569 | 提示/辅助/沙箱决策 |
| | `permissions/` 目录 | 9,409 | 规则解析/分类器/拒绝追踪 |
| **安全+权限层小计** | | **22,847**（表内行数相加实测）| |
| **总计** | | **34,940**（解析器 12,093 + 安全权限 22,847 · 含 permissions/ 9,409）| |

Claude Code 约 **8.3%** 的总代码量（420,000 行中的 34,940 行 ≈ 8.32%）都用在了"理解并验证一条 bash 命令"上。这个比例远超大多数人的直觉——它反映了一个核心工程判断：**在 AI 编程工具中，"安全地执行命令"比"让命令跑得更快"重要得多。**

> ⚠ 2026-04-22 SoT 核实修正：原书早期版本给出 23,588 / 35,681 两个数字，经三家评审指出并与 `wc -l` 对照后，表内实际相加只到 22,847 与 34,940。已改为精确可复算数字。

---

## 2. 纯 TypeScript 解析器（bashParser.ts）

### 2.1 为什么不直接用 tree-sitter？

tree-sitter 是业界标准的增量解析器框架，已有成熟的 bash 语法定义。Claude Code 内部版本确实通过 `feature('TREE_SITTER_BASH')` 使用 tree-sitter，但开源版本选择了纯 TypeScript 重写。原因：

1. **零依赖部署**：tree-sitter 需要 C/WASM 编译产物，增加 npm 包体积和平台兼容性问题
2. **安全审计可控**：纯 TS 代码可以完全审计，WASM 二进制不透明
3. **UTF-8 字节偏移**：安全分析需要精确的字节级位置信息，JS 的 string index 和 UTF-8 byte offset 不同，纯 TS 可以精确控制这个映射
4. **性能预算可控**：50ms 超时 + 50K 节点限制，纯 TS 实现让这些限制的行为完全可预测

### 2.2 词法器架构

词法器（Lexer）是解析器的第一步——把命令字符串切分成有意义的词法单元（Token）：

```typescript
// 词法器状态（bashParser.ts 核心数据结构）
type Lexer = {
  src: string            // 原始命令文本
  len: number            // 文本长度
  i: number              // JS string index（字符位置）
  b: number              // UTF-8 byte offset（字节位置）
  heredocs: HeredocPending[]  // 待处理的 heredoc
  byteTable: Uint32Array | null  // 延迟初始化的 UTF-8 查找表
}
```

**关键设计：双轨位置追踪**

JavaScript 字符串使用 UTF-16 编码，但 tree-sitter 的 AST 节点使用 UTF-8 字节偏移。解析器必须同时维护两种位置：

```typescript
// ASCII 快速路径（char index == byte index）
// 非 ASCII 时需要额外字节计算
function advance(L: Lexer): void {
  const c = L.src.charCodeAt(L.i)
  L.i++
  if (c < 0x80) L.b++          // ASCII: 1 byte
  else if (c < 0x800) L.b += 2  // 2-byte UTF-8
  else if (c >= 0xd800 && c <= 0xdbff) { L.b += 4; L.i++ }  // surrogate pair: 4 bytes
  else L.b += 3                  // 3-byte UTF-8
}
```

> 💡 **通俗理解**：就像一本中英文混排的书——英文字母占 1 格（ASCII = 1 byte），中文汉字占 3 格（3 bytes），emoji 占 4 格（4 bytes）。索引系统要同时记录"第几个字符"和"第几个字节"，因为下游安全分析需要字节级精度来定位可疑片段。

### 2.3 Token 类型

词法器识别的 Token 类型覆盖了 bash 语法的核心构造：

| Token 类型 | 含义 | 示例 |
|-----------|------|------|
| `WORD` | 普通词（命令名/参数） | `ls`, `-la`, `file.txt` |
| `NUMBER` | 文件描述符 | `2` (在 `2>&1` 中) |
| `OP` | 运算符 | `&&`, `\|\|`, `\|`, `;`, `>`, `>>` |
| `NEWLINE` | 换行 | `\n` |
| `DQUOTE` | 双引号字符串 | `"hello $world"` |
| `SQUOTE` | 单引号字符串 | `'literal text'` |
| `ANSI_C` | ANSI-C 引号 | `$'escape\n'` |
| `DOLLAR` | 变量展开 | `$VAR` |
| `DOLLAR_PAREN` | 命令替换 | `$(command)` |
| `DOLLAR_BRACE` | 参数展开 | `${VAR:-default}` |
| `DOLLAR_DPAREN` | 算术展开 | `$((1+2))` |
| `BACKTICK` | 反引号命令替换 | `` `command` `` |
| `LT_PAREN` | 进程替换（输入） | `<(sort file)` |
| `GT_PAREN` | 进程替换（输出） | `>(tee log)` |

### 2.4 语法树构建

解析器产出的节点与 tree-sitter-bash 的 AST 格式兼容，使得下游安全分析代码（ast.ts）无需关心解析器的具体实现：

```
TsNode 结构:
{
  type: string        // 节点类型 (如 'command', 'pipeline', 'list')
  text: string        // 原始文本
  startIndex: number  // UTF-8 起始字节偏移
  endIndex: number    // UTF-8 结束字节偏移
  children: TsNode[]  // 子节点
  namedChildren: TsNode[]  // 命名子节点
}
```

### 2.5 Heredoc 处理

Heredoc 是 bash 中最复杂的语法构造之一——它允许多行文本内联到命令中。解析器有专门的 `heredoc.ts`（733 行）处理这个问题：

```typescript
// 支持的 heredoc 格式（heredoc.ts）
const HEREDOC_START_PATTERN =
  /(?<!<)<<(?!<)(-)?[ \t]*(?:(['"])(\\?\w+)\2|\\?(\w+))/

// <<WORD    — 基本 heredoc
// <<'WORD'  — 单引号（不做变量展开）
// <<"WORD"  — 双引号
// <<-WORD   — 去除前导 tab
// <<\WORD   — 转义分隔符
```

**安全处理策略**：Heredoc 内容先被提取并替换为占位符，防止其中的 `$`、`` ` `` 等字符在解析阶段被误判为命令替换。解析完成后再恢复原始内容。

---

## 3. FAIL-CLOSED 安全分析器（ast.ts）

ast.ts（2,679 行）是整个管线的安全核心——它遍历语法树，提取结构化的命令信息，并在遇到任何不确定性时选择"关闭"（拒绝），而非"打开"（放行）。

### 3.1 核心原则：显式白名单

```typescript
// ast.ts 的安全模型

// 这些节点类型会被遍历（结构性容器）
const STRUCTURAL_TYPES = new Set([
  'program', 'list', 'pipeline', 'redirected_statement'
])

// 这些是命令分隔符
const SEPARATOR_TYPES = new Set([
  '&&', '||', '|', ';', '&', '|&', '\n'
])

// 这些节点类型被显式标记为危险
const DANGEROUS_TYPES = new Set([
  'command_substitution',   // $(...)
  'process_substitution',   // <(...)
  'expansion',              // ${...}
  'simple_expansion',       // $VAR
  'brace_expression',       // {a,b,c}
  'subshell',              // (...)
  'compound_statement',     // { ...; }
  'for_statement',          // for x in ...; do ...; done
  'while_statement',        // while ...; do ...; done
  // ... 更多
])

// 关键原则：任何不在白名单中的节点类型 → tooComplex()
// "我们绝不解释不理解的结构。如果 tree-sitter 产出了
//  一个我们没有显式列入白名单的节点，我们拒绝提取 argv。"
```

> 💡 **通俗理解**：就像药品审批——不是列出"所有有害成分"然后排除（那会遗漏未知毒物），而是列出"所有已证明安全的成分"然后只允许这些。任何新出现的、未经验证的成分，默认按"可能有害"处理。这就是 FAIL-CLOSED（默认关闭）vs FAIL-OPEN（默认打开）的区别。

### 3.2 产出类型

```typescript
// ast.ts 的三种输出
type ParseForSecurityResult =
  | {kind: 'simple', commands: SimpleCommand[]}  // 成功提取
  | {kind: 'too-complex', reason: string, nodeType?: string}  // 无法安全分析
  | {kind: 'parse-unavailable'}  // 解析器不可用（降级到 shell-quote）

// 成功提取时的命令结构
type SimpleCommand = {
  argv: string[]              // 完全去引号的参数列表
  envVars: {name, value}[]    // 前置环境变量 (如 NO_COLOR=1)
  redirects: Redirect[]       // 重定向 (>, >>, <, 等)
  text: string               // 原始源文本（用于 UI 显示）
}

type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string             // 目标路径或占位符
  fd?: number               // 文件描述符 (0/1/2)
}
```

### 3.3 占位符系统：安全追踪变量

当命令中包含变量展开或命令替换时，解析器不是简单拒绝，而是用占位符追踪：

```typescript
const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'
const VAR_PLACEHOLDER = '__TRACKED_VAR__'

// 示例：
// NOW=$(date) && jq --arg now "$NOW" ...
//   → argv: ['jq', '--arg', 'now', '__TRACKED_VAR__']
//   安全：因为 $NOW 来源已知（来自 $(date)）
//
// x=$(cmd) && echo $x
//   → argv: ['echo', '__CMDSUB_OUTPUT__']
//   安全：如果内层 cmd 单独通过了安全检查
```

这个设计避免了"一刀切拒绝所有变量展开"的过度保守——系统能分辨"安全的变量传递"和"恶意的命令注入"。

---

## 4. 23 项安全检查 + 1 个预留位（bashSecurity.ts）

bashSecurity.ts（2,592 行）对提取出的 `SimpleCommand[]` 执行 23 项实装安全检查（ID 1-23）并预留 1 个位（ID 24），每项有唯一的 analytics ID 用于监控告警：

| ID | 检查名称 | 检测内容 | 攻击场景示例 |
|----|---------|---------|------------|
| 1 | INCOMPLETE_COMMANDS | 语法错误/不完整命令 | 利用解析器差异绕过检查 |
| 2 | JQ_SYSTEM_FUNCTION | jq 的 @sh/@json/@uri 过滤器 | jq 执行系统级函数 |
| 3 | JQ_FILE_ARGUMENTS | jq 文件参数模式 | 通过 jq 读取敏感文件 |
| 4 | OBFUSCATED_FLAGS | 通过引号/通配符隐藏的 flag | `gi"t" pu"sh"` 绕过 git push 拦截 |
| 5 | SHELL_METACHARACTERS | `$`, `` ` ``, `[`, `*`, `?`, `{`, `\|`, `&`, `;` | 注入额外命令 |
| 6 | DANGEROUS_VARIABLES | `LD_*`, `DYLD_*`, `PATH`, `IFS` 等 | 劫持库加载/命令查找 |
| 7 | NEWLINES | 参数中包含换行符 | 多行展开绕过单行检查 |
| 8 | COMMAND_SUBSTITUTION | `$()`, 反引号, `<()` / `>()`（进程替换） | 嵌套命令执行 |
| 9 | INPUT_REDIRECTION | `<`, `<<`, `<&` | 注入标准输入 |
| 10 | OUTPUT_REDIRECTION | `>`, `>>`, `>&`, `&>` | 覆盖敏感文件 |
| 11 | IFS_INJECTION | 通过 $IFS 的词拆分 | `cat$IFS/etc/passwd` |
| 12 | GIT_COMMIT_SUBSTITUTION | git commit 中的变量展开 | commit message 中执行命令 |
| 13 | PROC_ENVIRON_ACCESS | 读取 `/proc/PID/environ` | 窃取进程环境变量（含密钥） |
| 14 | MALFORMED_TOKEN_INJECTION | 引号解析器漏洞 | 利用 shell-quote 库 bug |
| 15 | BACKSLASH_ESCAPED_WHITESPACE | `\ ` 和 `\<换行>` | 混淆命令边界 |
| 16 | BRACE_EXPANSION | `{a,b,c}` 模式 | 路径遍历 `{/etc/passwd,/etc/shadow}` |
| 17 | CONTROL_CHARACTERS | 0x00-0x1F, 0x7F | 不可见字符混淆 |
| 18 | UNICODE_WHITESPACE | 不可见 Unicode 空格 | NBSP/零宽空格混淆命令边界 |
| 19 | MID_WORD_HASH | 词中间的 # 号 | `cmd#evil` 混淆注释 |
| 20 | ZSH_DANGEROUS_COMMANDS | zmodload, emulate, zpty, ztcp | Zsh 特有的危险操作 |
| 21 | BACKSLASH_ESCAPED_OPERATORS | `\|`, `\&` 等 | 混淆管道/后台运算符 |
| 22 | COMMENT_QUOTE_DESYNC | 引号/注释状态不同步 | 利用 parser 和 bash 对注释的理解差异 |
| 23 | QUOTED_NEWLINE | 字符串内的换行 | 多行字符串绕过单行检查 |
| 24 | *(reserved)* | *(预留)* | *(未来扩展)* |

> 💡 **通俗理解**：这就像机场安检的违禁品清单——不是笼统地说"危险品不能带"，而是明确列出 24 类（刀具、液体、打火机、电池...），每类都有具体的检测方法和判定标准。而且清单还预留了 24 号位，方便未来发现新型威胁时扩展。

### 4.1 几个值得深入的检查

**检查 #4 — OBFUSCATED_FLAGS（混淆 flag）**

这个检查防止攻击者通过引号拆分来隐藏危险 flag：

```bash
# 正常命令——会被 "git push" 规则拦截
git push --force

# 混淆尝试——引号拆分后 shell 仍然执行 "git push --force"
gi"t" pu"sh" --fo"rce"

# 检查 #4 会在 AST 层面重建完整 token，识破混淆
```

**检查 #11 — IFS_INJECTION**

IFS（Internal Field Separator）是 bash 的词拆分变量。默认是空格/tab/换行，但如果被修改：

```bash
# 正常情况：IFS 是空格
echo hello world  # → echo "hello" "world"

# IFS 注入：如果 IFS 被设为 /
IFS=/ && cat$IFS"etc"$IFS"passwd"
# bash 看到的是：cat /etc/passwd

# 检查 #11 检测 $IFS 的任何使用
```

**检查 #18 — UNICODE_WHITESPACE**

不可见的 Unicode 空格字符可以让命令"看起来"和"实际执行"不同：

```
# 肉眼看到（使用 NBSP 替代空格）:
git\u00A0push  # 看起来像 "git push" 两个词

# bash 实际执行（NBSP 不是分词符）:
"git\u00A0push"  # 被当作一个词——可能绕过 "git push" 拦截规则

# 检查 #18 拒绝任何包含 Unicode 空格的命令
```

---

## 5. Git 安全协议

Git 安全是 Claude Code 命令安全中最精细的部分——因为 git 是开发者使用最频繁的命令，但也是攻击面最大的工具之一。

### 5.1 cd + git 复合命令攻击

`bashPermissions.ts` 中有一段关键的安全逻辑，专门检测"cd 到某目录后执行 git 命令"的模式：

```typescript
// bashPermissions.ts ~:2200-2225
// 问题：cd /malicious/dir && git status
// 看起来无害，但如果 /malicious/dir 是一个精心构造的
// bare git repo（包含恶意 core.fsmonitor 脚本），
// 那么 git status 会自动执行该脚本——任意代码执行！

if (compoundCommandHasCd) {
  const hasGitCommand = subcommands.some(cmd =>
    isNormalizedGitCommand(cmd)
  )
  if (hasGitCommand) {
    return {
      reason: 'Compound commands with cd and git require ' +
              'approval to prevent bare repository attacks'
    }
  }
}
```

**为什么 `cd && git status` 危险？**

1. 攻击者在 `/tmp/innocent-looking-dir/` 下放置 `HEAD`、`objects/`、`refs/` 文件
2. git 看到这些文件，认为这是一个 bare git repo
3. 攻击者在 `.git/config`（或 repo 自身配置）中设置 `core.fsmonitor = "malicious-script.sh"`
4. `git status` 在检查文件变更时**自动执行** `malicious-script.sh`
5. 结果：看似只读的 `git status` 变成了任意代码执行

**检测逻辑**：

```typescript
// 识别"归一化"的 git 命令（去除安全包装器）
function isNormalizedGitCommand(cmd: SimpleCommand): boolean {
  // 直接 git 命令
  if (cmd.argv[0] === 'git') return true

  // 带环境变量前缀: NO_COLOR=1 git ...
  if (cmd.envVars.length > 0 && cmd.argv[0] === 'git') return true

  // 通过 xargs: xargs git ...
  if (cmd.argv[0] === 'xargs' && cmd.argv[1] === 'git') return true

  // 去除安全包装器: nice/stdbuf/nohup/timeout/time git ...
  const SAFE_WRAPPERS = ['nice', 'stdbuf', 'nohup', 'timeout', 'time']
  // ... 递归剥离后检查是否是 git
}
```

### 5.2 只读 Git 命令白名单

不是所有 git 命令都需要用户确认——`git status`、`git log`、`git diff` 等只读命令可以安全自动执行。`readOnlyValidation.ts`（1,990 行）维护了一份精细的白名单：

```typescript
// readOnlyValidation.ts — Git 只读命令定义
const GIT_READ_ONLY_COMMANDS = {
  'diff': {
    safeFlags: {
      '--cached': 'none',      // flag 不带参数
      '--stat': 'none',
      '--name-only': 'none',
      '--word-diff': 'string', // flag 带字符串参数
      '-U': 'number',          // flag 带数字参数
      // ... 更多安全 flag
    },
    additionalCommandIsDangerousCallback(raw, args) {
      // 拒绝: git diff < file.patch (输入重定向)
      // 拒绝: 管道到写命令
    }
  },
  'log': { /* 类似结构 */ },
  'status': { /* 类似结构 */ },
  'show': { /* 类似结构 */ },
  'branch': { /* 只允许 --list 等只读 flag */ },
  'remote': { /* 只允许查看，不允许 add/remove */ },
  'blame': { /* 类似结构 */ },
  // ... 更多
}
```

> 💡 **通俗理解**：就像图书馆的权限系统——"借阅"（只读）和"修改藏书"（写入）是完全不同的权限级别。`git log` 只是翻看历史记录（借阅），可以自由进出；`git push --force` 是覆盖远程仓库（修改藏书），必须经过管理员确认。而且不只是区分"git log 安全"，还要区分"git log --format='%H' 安全"和"git log --format='%(trailers:key=Signed-off-by)' 可能不安全"——粒度细到每个 flag。

### 5.3 Sed 验证器

`sed` 是另一个需要特殊处理的命令——它既能读文件也能写文件，安全级别取决于具体的 sed 脚本：

```typescript
// sedValidation.ts (684 行) + sedEditParser.ts (322 行)
// 解析 sed 脚本来判断是"只读查看"还是"文件修改"

// 安全（只读）: sed -n '5p' file.txt    → 打印第5行
// 危险（写入）: sed -i 's/old/new/g' file.txt → 原地修改
// 复杂（需确认）: sed -e 'w /tmp/stolen' file.txt → 写入到其他文件
```

---

## 6. 权限规则系统

权限规则是用户与安全系统之间的"协商接口"——用户可以配置规则来授权某些命令自动执行。

### 6.1 规则格式

```
Bash(command:args)    — 精确匹配
Bash(command:*)       — 命令级通配
Bash(*)               — 全部放行（危险！）
```

### 6.2 规则匹配逻辑

`permissions/` 目录（9,409 行）实现了规则的解析、存储、匹配和建议：

```typescript
// 匹配示例
规则: Bash(git:*)
命令: git log --oneline    → ✅ 匹配，自动执行
命令: git push --force     → ✅ 匹配，自动执行（危险！）
命令: npm install          → ❌ 不匹配

规则: Bash(curl:https://)
命令: curl https://api.example.com  → ✅ 前缀匹配
命令: curl http://evil.com          → ❌ 协议不匹配
```

### 6.3 拒绝追踪

权限系统不只是做二元判定——它还追踪用户的拒绝行为，用于改善未来的权限建议：

```typescript
// 如果用户多次拒绝同类命令，系统会：
// 1. 提高该类命令的置信度（不再频繁询问）
// 2. 在建议规则时考虑用户偏好
// 3. 将拒绝模式上报 analytics（匿名化后）
```

---

## 7. 性能保护机制

解析一条 bash 命令不应该阻塞用户交互。系统设置了多层性能保护：

### 7.1 解析器层

```typescript
// bashParser.ts
PARSE_TIMEOUT_MS = 50      // 50ms 墙钟超时
MAX_NODES = 50_000         // 最多产出 5 万个 AST 节点

// 超时时返回 PARSE_ABORTED（不是 null）
// PARSE_ABORTED 是一个 Symbol，用于区分"解析失败"和"解析超时"
```

> 💡 **通俗理解**：就像考试限时——如果 X 光机扫描行李超过 50 毫秒还没出结果（可能是行李结构极其复杂的炸弹伪装），就直接标记为"可疑"送人工检查，而不是让整条安检队伍等着。

### 7.2 安全分析层

```typescript
// ast.ts
MAX_COMMAND_LENGTH = 10_000           // 超长命令直接拒绝
MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50  // 防止指数级复合命令
```

### 7.3 降级策略

当纯 TS 解析器不可用（或被 feature flag 关闭）时：

```
解析器不可用
  → ast.ts 返回 {kind: 'parse-unavailable'}
  → bashSecurity.ts 降级到传统 regex + shell-quote 库
  → bashPermissions.ts 使用更简单的权限检查
```

降级路径牺牲分析精度换取可用性——总比完全无法执行命令好。

---

## 8. 差异攻击防御

"差异攻击"（Differential Attack）利用解析器和实际 bash 对同一命令的不同理解来绕过安全检查。ast.ts 的前置检查专门防御这类攻击：

### 8.1 控制字符（检查 #17）

```
攻击: 命令中嵌入 0x00（NULL）
bash 行为: 静默丢弃 NULL 字符，执行剩余部分
解析器行为: 可能在 NULL 处截断，认为命令已结束
结果: 解析器认为命令安全，bash 实际执行了隐藏的后续命令

防御: 检测到 0x00-0x1F、0x7F → 立即返回 too-complex
```

### 8.2 Unicode 空格（检查 #18）

```
攻击: 使用 NBSP (U+00A0) 替代普通空格
bash 行为: NBSP 不是分词符，整个内容被当作一个词
解析器行为: 可能将 NBSP 当作空格，拆成两个词
结果: 解析器看到 "git push"（两个词），bash 执行 "git\xa0push"（一个词）

防御: 检测到 Unicode 空格字符 → 立即返回 too-complex
```

### 8.3 Zsh 特有语法

在 macOS 上 Claude Code 运行在 zsh 环境中，但解析器是按 bash 语法构建的。某些 zsh 扩展可能导致差异：

```
~[name]  — zsh 动态目录展开（bash 中无此语法）
=cmd     — zsh 等号展开（展开为 /usr/bin/cmd）
引号内的花括号展开  — zsh 支持，bash 不支持

防御: 检测到这些 zsh 特有语法 → 返回 too-complex
```

---

## 9. 设计哲学与局限性

### 9.1 三大设计原则

1. **FAIL-CLOSED 优于 FAIL-OPEN**：不确定时拒绝，而非放行。宁可多问用户一次，不可放过一条危险命令。

2. **白名单优于黑名单**：不是列出"所有危险命令"然后排除（会遗漏），而是列出"所有已知安全的模式"然后只允许这些。

3. **静态分析优于运行时拦截**：在命令执行前就分析其结构，而非在执行过程中拦截——因为有些命令一旦开始执行就无法安全中断。

### 9.2 局限性

| 局限 | 描述 | 影响 |
|------|------|------|
| **仅静态分析** | 不执行命令、不追踪运行时状态 | 无法检测依赖运行时状态的攻击（如 `eval $user_input`） |
| **有限的展开处理** | glob、参数展开标记为 too-complex | 包含 `*`、`${VAR}` 的命令会被拦截询问，即使实际安全 |
| **单命令粒度** | 每条命令独立分析 | 无法检测跨命令的攻击链（如第一条命令修改 PATH，第二条命令利用修改后的 PATH） |
| **Classifier 闭源** | ANT 内部有 ML 分类器辅助判定 | 开源版本缺少学习型安全分析，只有规则型 |
| **解析器覆盖率** | 纯 TS 重写可能未覆盖所有 bash 边缘情况 | 极端复杂的 bash 语法（如嵌套 heredoc + 进程替换）可能解析失败 |

### 9.3 为什么这个系统值得 35,000 行代码？

35,000 行代码——比很多完整的 Web 应用还大——全部用于"理解并验证一条 shell 命令"。这个投入合理吗？

从 Claude Code 的角度看，**完全合理**：

- BashTool 是唯一能直接影响用户文件系统的工具
- 一条错误的 `rm -rf /` 就足以造成不可逆的数据丢失
- AI 生成命令的不可预测性（比人工输入更需要安全检查）
- 企业用户对安全合规的硬性要求

这 35,000 行代码是 Claude Code 作为"可以在用户机器上自主行动的 AI"的安全基石。没有它，BashTool 就只是一个危险的 `exec()` 调用。

---

## 10. 批判与反思

### 10.1 工程复杂性 vs 安全收益

35,000 行安全代码本身也是攻击面——解析器 bug 可能被利用来绕过安全检查。这是"守护者悖论"：守护系统越复杂，其自身成为漏洞的概率也越高。

Anthropic 通过以下方式缓解这个风险：
- FAIL-CLOSED 设计确保解析器 bug 导致的是误拦截，而非误放行
- 50ms 超时防止 DoS 类攻击
- 双轨降级：主路径使用 `bashParser.ts`（纯 TS AST 解析器），当解析器不可用或 feature flag 关闭时，回退到轻量的 `shell-quote` 库做最小化 tokenization——后者提供的信息少，但至少能做基本命令名识别，比完全放弃解析更安全

### 10.2 用户体验代价

FAIL-CLOSED 的代价是频繁的权限确认弹窗。当用户执行复杂的 bash 脚本（包含变量展开、管道、循环）时，几乎每条命令都会触发确认。这可能导致：

- 用户疲劳：频繁点击"允许"，形成条件反射，失去安全判断
- 生产力损失：复杂操作需要多次人工确认
- 绕过动机：用户倾向于配置宽松的权限规则（如 `Bash(*)`），抵消安全设计

> 🔑 **深度洞察**：Bash AST 解析器是 Claude Code 中"安全与可用性"张力最集中的体现——它证明了在 AI 自主行动的时代，"理解命令"比"执行命令"更重要。35,000 行代码的投入不是过度工程，而是对一个根本性问题的诚实回答：**当 AI 可以在你的电脑上运行任何命令时，你需要什么级别的安全保障？**
