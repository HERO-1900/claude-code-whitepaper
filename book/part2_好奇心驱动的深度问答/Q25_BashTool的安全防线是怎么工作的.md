# BashTool 的八层安全防线是怎么工作的？

BashTool 是 Claude Code 中攻击面最大的单一组件——30 个文件、22,987 行代码构建了八层安全防线。本节从源码层面拆解每一层的实现机制和它们之间的协作关系。

> **源码位置**：`src/tools/BashTool/`（15 个文件）、`src/utils/bash/`（15 个文件）
>
> 路径约定说明：本章内部引用源码时多数采用"相对于 `src/` 的路径"（例如 `tools/BashTool/bashPermissions.ts`），与本书其它章节的引用风格保持一致；但小节 1「源码位置」里用的是带 `src/` 前缀的完整路径（`src/tools/BashTool/` / `src/utils/bash/`）。两种写法指向同一位置，当你手动去 repo 里打开对应文件时请把相对路径前面补回 `src/`。

> 🌍 **行业背景**：如何安全地让 AI 执行 shell 命令是所有 AI 编码工具的核心挑战。**Codex（OpenAI）** 近期版本实现了 OS 级别的网络出口限制（OS-level egress rules），取代了早期脆弱的环境变量控制，并在 Rust 重写后获得了内存安全的先天优势（具体版本号与重写比例以官方发布为准）。**Aider** 默认不会自动执行命令，需要用户明确确认每一条——安全但牺牲了流畅性。**Cursor** 的终端集成在 VS Code 的受限环境中运行，依赖编辑器的权限模型而非独立的命令级安全分析。**Windsurf** 的 Cascade 模式允许 AI 执行命令但以用户确认为主要关卡。在安全研究领域，Google 的 Project Naptime 和 Trail of Bits 的工作都探索了 AI agent 的沙箱化执行。Claude Code 的八层纵深防御在同类工具中属于重量级方案——按本文截至 2026-04 的统计，22,987 行安全代码（统计命令：`find src/tools/BashTool src/utils/bash -name '*.ts*' | xargs wc -l`）远高于其他公开可核实的产品。这种重投入的原因是：Claude Code 运行在用户的真实操作系统上（而非容器中），且目标是让 AI 在大部分情况下**无需确认**就能安全执行命令（auto 模式），这要求安全系统足够精细，能区分"安全的 `git status`"和"危险的 `rm -rf /`"——而不是简单地全部拦截或全部放行。

---

## 问题

如果把 Claude Code 比作一座城市，BashTool 就是城市的建设施工队——它是最危险也最有用的部门。它可以执行任何 shell 命令：安装依赖、编译代码、操作文件、甚至 `rm -rf /`。在 40 个内置工具目录中，只有 BashTool 能直接执行任意系统命令，这使它成为整个系统中攻击面最大的单一组件。

这个"施工队"有多庞大？仅源码就横跨两个目录、30 个文件、22,987 行代码（截至本文统计时点，统计命令：`find src/tools/BashTool src/utils/bash -name '*.ts*' | xargs wc -l`；`tools/BashTool/` 15 个文件 10,894 行 + `utils/bash/` 15 个文件 12,093 行）。作为参比，FileEditTool 加上 FileReadTool 的代码量总和都不到 BashTool 的四分之一。为什么一个"执行命令"的工具需要比"编辑文件"的工具多出这么多代码？因为执行命令不是难题——**安全地执行命令**才是。

---

## 你可能以为……

你可能以为 BashTool 的安全策略就是"运行之前问一下用户要不要继续"——一个简单的确认弹窗。或者你可能以为它像传统沙箱一样，靠一层容器把危险隔离在外。

实际上，Claude Code 的 BashTool 构建了八道纵深防线，从 AST 解析到操作系统级沙箱，每一道都有明确的安全职责，而且都遵循同一个核心原则：**fail-closed（默认拒绝）**。如果任何一层无法确定命令是安全的，它不会放行——它会要求用户确认。

> 💡 **通俗理解**：BashTool 的安全防线就像**机场安检的八道关卡**——第一道：X 光机扫描行李（AST 解析命令结构）→ 第二道：安检员检查违禁品清单（语义安全检查）→ 第三道：爆炸物探测器（注入检测）→ 第四道：核对登机牌和身份证（权限规则匹配）→ 第五道：检查目的地是否合法（路径约束）→ 第六道：识别常旅客快速通道（只读命令自动放行）→ 第七道：最终审批（权限模式判断）→ 第八道：登机桥的金属探测门（操作系统级沙箱）。任何一道说"不"，你就上不了飞机。

---

## 实际上是这样的

### 架构总览：从命令字符串到系统执行

当 Claude 生成一条 bash 命令后，它要经过这八层防线才能真正在你的机器上执行：

```
用户/AI 生成命令
    |
    v
[第 1 层] AST 级命令解析 — 用 tree-sitter 把命令解析成语法树
    |
    v
[第 2 层] 语义安全检查 — 检查命令的"含义"，拦截 eval/zmodload 等危险操作
    |
    v
[第 3 层] 注入检测验证器链 — 20+ 个验证器逐一扫描注入攻击模式
    |
    v
[第 4 层] 命令权限匹配 — 对照用户定义的 allow/deny/ask 规则
    |
    v
[第 5 层] 路径约束验证 — 检查命令操作的文件路径是否在允许范围内
    |
    v
[第 6 层] 只读命令识别 — 识别无副作用的命令，自动放行
    |
    v
[第 7 层] 模式与分类器 — 根据当前权限模式和 AI 分类器做最终决策
    |
    v
[第 8 层] 操作系统级沙箱 — seatbelt (macOS) / seccomp (Linux) 硬隔离
    |
    v
  执行命令
```

下面我们穿透每一层，看看它们各自解决什么问题。

---

### 第 1 层：AST 级命令解析——先理解，再判断

> 源码位置：`utils/bash/bashParser.ts`（4,436 行）、`utils/bash/ast.ts`（2,679 行）、`utils/bash/parser.ts`（230 行）
>
> 📖 **深度阅读**：本节是概要介绍。完整的 Bash AST 解析器架构（35,000+ 行代码的四层管线、24 项安全检查完整清单、差异攻击防御机制）详见 **Part 3「Bash AST 解析器完全解析」**。

**为什么需要 AST？** 因为正则表达式不理解 bash。看这个例子：

```bash
echo "hello; rm -rf /"    # 安全：分号在引号里，是字符串内容
echo hello; rm -rf /       # 危险：分号在引号外，是命令分隔符
```

对正则表达式来说，这两行都"包含 `rm -rf /`"。但只有理解了 bash 的引号语法，才能区分它们的真正含义。

Claude Code 为此内置了一个**纯 TypeScript 实现的 bash 解析器**（`bashParser.ts`）。这不是调用外部工具——而是从零实现了一个 tree-sitter-bash 兼容的 AST 生成器，包含完整的 tokenizer、heredoc 处理和 UTF-8 字节偏移计算。源码注释说它经过了"3,449 条输入的黄金语料库验证"。

> 📚 **课程关联**：AST（抽象语法树）解析是**编译原理课程**的核心内容。这里的 bash 解析器实现了完整的词法分析（tokenizer）→ 语法分析（parser）→ 语法树构建（AST construction）流水线。`PARSE_TIMEOUT_MS = 50` 和 `MAX_NODES = 50,000` 的限制对应了编译器课程中讨论的**解析复杂度控制**——防止恶意输入导致的指数级解析时间（类似正则表达式的 ReDoS 攻击）。白名单架构（explicit allowlist）则是安全工程中**默认拒绝（default deny）**原则的典型应用。

解析器有两道硬性保护阀：

- **50ms 超时上限**（`PARSE_TIMEOUT_MS = 50`）——防止恶意构造的命令（如 `(( a[0][0][0]... ))` 嵌套 2,800 层下标）导致解析器卡死
- **50,000 节点预算**（`MAX_NODES = 50_000`）——防止 OOM

如果解析器超时或内存爆表，返回的是一个专用的 `PARSE_ABORTED` 符号，而不是 `null`。这个区分至关重要：`null` 表示"解析器没有加载"（回退到旧路径），`PARSE_ABORTED` 表示"解析器加载了但拒绝了这个输入"（直接判为 too-complex，要求用户确认）。把这两个情况搞混过一次——对抗性输入会被路由到缺少部分检查的旧代码路径，这在安全审计中被修复。

解析的核心输出是 `ParseForSecurityResult`：

```typescript
type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }    // 解析成功
  | { kind: 'too-complex'; reason: string }            // 有无法静态分析的结构
  | { kind: 'parse-unavailable' }                      // 解析器不可用
```

**设计哲学写在 `ast.ts` 的文件头注释里：**

> *"The key design property is FAIL-CLOSED: we never interpret structure we don't understand. If tree-sitter produces a node we haven't explicitly allowlisted, we refuse to extract argv and the caller must ask the user."*

这是一个**显式白名单（explicit allowlist）** 架构：代码维护了一组已知安全的 AST 节点类型（`STRUCTURAL_TYPES`：program、list、pipeline、redirected_statement），只有这些类型的节点才会被递归遍历。任何不在白名单中的节点——包括 `command_substitution`、`process_substitution`、`subshell`、`if_statement`、`for_statement` 等 20 种——都立即返回 `too-complex`。

**变量作用域追踪**也在这一层完成。ast.ts 维护了一个 `varScope: Map<string, string>`，追踪当前命令序列中赋值过的变量。当遇到 `$VAR` 引用时，如果该变量在前面被赋值过，就用追踪到的值替换；否则拒绝。这解决了像 `NOW=$(date) && jq --arg now "$NOW" ...` 这种合法但需要变量展开的场景。

更精妙的是**管道中的作用域隔离**（`ast.ts` 约 500-565 行）：`&&` 和 `;` 连接的命令共享变量作用域（因为是顺序执行），但 `||`、`|`、`&` 连接的命令重置作用域（因为是条件/并行执行，变量可能不存在）。注释中给出了具体攻击场景：

```bash
true || FLAG=--dry-run && cmd $FLAG
```

如果线性传递作用域，`$FLAG` 会被解析为 `--dry-run`，但实际执行时 `||` 右侧不会运行（`true` 已经成功），`$FLAG` 是空的。这是一个精确的安全语义差异。

---

### 第 2 层：语义安全检查——检查命令的"含义"

> 源码位置：`utils/bash/ast.ts` 中的 `checkSemantics()`（约 2213-2679 行）

AST 解析器回答了"这个命令的结构是什么"，语义检查器回答"这个命令想做什么"。

`checkSemantics()` 接收解析好的 `SimpleCommand[]`，检查每个命令的 argv[0]（命令名）是否落入危险类别。这一层做了三件关键的事：

**第一，剥离安全包装命令。** 攻击者可以用 `timeout 5 eval "rm -rf /"` 来掩饰真正执行的命令。checkSemantics 会递归剥离 `time`、`nohup`、`timeout`、`nice`、`env`、`stdbuf` 这些包装器，暴露出被包装的真实命令。每个包装器的剥离都经过精确的 flag 枚举——例如 `timeout` 支持 `--foreground`、`--kill-after=N`、`--signal=TERM` 等 GNU 长选项，以及 `-k`、`-s`、`-v` 短选项。任何不认识的 flag 都会导致 fail-closed，因为不认识的 flag 意味着可能无法正确定位被包装的命令。

源码注释里有一条标注为 `SECURITY (SAST Mar 2026)` 的修复说明，从字面看把"SAST"（静态应用安全测试）与日期组合成一个来源标签；但因为写作本章时（2026 年 4 月底）这条注释仍在代码里、也没有独立的审计报告链接可引用，本章只能做两层保守处理：(1) 直接摘录源码注释原文，让读者看到它确实存在；(2) 不把它当作"2026 年 3 月有一份公开安全审计报告"来引用——标注方式在公开代码库不是常规做法，如果外部没有对应报告、"SAST Mar 2026"就只是作者为这条内部修复打的标签。下面这段注释原文说明了之前的问题：之前的代码只跳过了 `--long` flag，导致 `timeout -k 5 10 eval ...` 没有被正确剥离。

```
// SECURITY (SAST Mar 2026): the previous loop only skipped `--long`
// flags, so `timeout -k 5 10 eval ...` broke out with name='timeout'
// and the wrapped eval was never checked.
```

**第二，拦截 eval 类内建命令。** 一旦剥离包装器暴露出真正的 argv[0]，checkSemantics 检查它是否是以下"eval 等价物"：

- `eval`——直接执行字符串
- `source` / `.`——加载并执行文件
- `trap`——在信号触发时执行代码
- `enable`——动态加载/卸载 shell 内建命令
- `hash`——能操纵命令查找表
- `coproc`——创建协同进程

**第三，拦截 Zsh 特有的危险命令。** 因为 BashTool 运行在用户的默认 shell 中（很多 macOS 用户用 zsh），代码维护了一个 `ZSH_DANGEROUS_COMMANDS` 集合（`bashSecurity.ts` 约 43-74 行），包含 23 个 zsh 特有的危险命令：

- `zmodload`——zsh 模块系统的入口，可加载 `zsh/mapfile`（数组赋值实现隐形文件 I/O）、`zsh/system`（sysopen/syswrite 精细文件控制）、`zsh/zpty`（伪终端命令执行）、`zsh/net/tcp`（通过 ztcp 进行网络渗出）、`zsh/files`（内建 rm/mv/ln 绕过二进制检查）
- `emulate`——带 `-c` flag 时是 eval 等价物
- `sysopen`、`sysread`、`syswrite`、`sysseek`、`zpty`、`ztcp`、`zsocket` 等模块级命令

**关于"23 个"**：上面列举的典型项并不等同于穷举 23 条；准确数字以 `ZSH_DANGEROUS_COMMANDS` 集合的成员数为准（`bashSecurity.ts` 约 43-74 行）。后文第 3 层"主验证器表格"里的 `validateZshDangerousCommands` 也会被标 `23` —— 两处数字来源于同一个集合（前者给类别、后者给检查器的阈值），不是两处独立的 23 凑出来的。

此外，关于 Claude Haiku 模型的分类器角色：它在**第 7 层 "模式与分类器"** 才作为关键组件展开，但它的**第一次被提及**在下一节（第 4 层）里——为了让读者能串联起"命令权限匹配"与"最终决策"两个节点使用同一套 AI 分类器机制，我们把 Haiku 的作用在下一节做一个前向引用式的预告，而不是等到第 7 层才突然出现一个新名词。

---

### 第 3 层：注入检测验证器链——20+ 个验证器的纵深防御

> 源码位置：`tools/BashTool/bashSecurity.ts`（2,592 行）

这是整个安全系统中代码量最大的单层防线。它由 4 个**早期验证器**和 19 个**主验证器**组成，形成一条严密的验证管线。

#### 早期验证器（short-circuit path）

| 验证器 | 功能 | 短路行为 |
|--------|------|----------|
| `validateEmpty` | 空命令直接放行 | allow |
| `validateIncompleteCommands` | 检测不完整的命令片段（以 tab、`-`、`&&` 开头） | ask |
| `validateSafeCommandSubstitution` | 允许 `$(cat <<'EOF'...'EOF')` 形式的安全 heredoc | allow |
| `validateGitCommit` | 允许 `git commit -m 'msg'` 形式的简单提交 | allow |

`validateGitCommit` 的实现值得深入看。它本来是一个简单优化——让 `git commit -m "fix typo"` 不需要用户确认。注释里提到过多次安全加固：

1. **反引号攻击**：`git commit ; curl evil.com -m 'x'`——regex 中的 `.*?` 会吞掉分号
2. **反斜杠攻击**：`git commit -m "test\"msg" && evil`——反斜杠会导致引号边界错位
3. **重定向攻击**：`git commit --allow-empty -m 'payload' > ~/.bashrc`——如果 validateGitCommit 返回 allow，validateRedirections 就被跳过了
4. 现在的实现在 `-m` 之前使用 `[^;&|\`$<>()\n\r]*?`（排除所有 shell 元字符），并对 remainder 做单独的元字符和重定向检查

说明：上一版正文写的是"至少 5 次安全加固"，但展开列出的只有 4 项（第 1~3 条攻击场景 + 第 4 条"现在的实现"）。两处数字不一致属于笔误；改为"多次"避免硬承诺"5 次"，具体条数以源码注释里 `SECURITY:` 标记的条目数为准。

#### 主验证器链（19 个）

每个验证器返回三种结果之一：`passthrough`（无问题，继续）、`ask`（需要用户确认）、`allow`（安全放行）。

完整列表和它们检测的攻击类别：

| # | 验证器 | 检测内容 |
|---|--------|----------|
| 1 | `validateJqCommand` | jq 的 `system()` 函数执行任意命令 |
| 2 | `validateObfuscatedFlags` | 引号内藏 flag（如 `rm "-rf"` 等价于 `rm -rf`） |
| 3 | `validateShellMetacharacters` | 引号内的 `;`、`\|`、`&` 等元字符 |
| 4 | `validateDangerousVariables` | 重定向/管道旁的变量（`$VAR > file`） |
| 5 | `validateCommentQuoteDesync` | `#` 注释与引号状态不同步导致的解析差异 |
| 6 | `validateQuotedNewline` | 引号内的换行符（可能让行级处理丢内容） |
| 7 | `validateCarriageReturn` | `\r` 导致的 shell-quote / bash 解析差异 |
| 8 | `validateNewlines` | 未引用的换行可能分隔多条命令 |
| 9 | `validateIFSInjection` | `$IFS` 变量绕过正则验证 |
| 10 | `validateProcEnvironAccess` | `/proc/*/environ` 读取敏感环境变量 |
| 11 | `validateDangerousPatterns` | `$()`、`` ` ``、`<()`、`>()`、`${}`、`=cmd` 等 15 种替换模式 |
| 12 | `validateRedirections` | 输入/输出重定向到任意文件 |
| 13 | `validateBackslashEscapedWhitespace` | `\ ` 反斜杠转义空格导致词边界差异 |
| 14 | `validateBackslashEscapedOperators` | `\;` shell-quote 与 bash 对反斜杠操作符的不同解释 |
| 15 | `validateUnicodeWhitespace` | `\u00A0`（NBSP）等 Unicode 空白在终端不可见但被 bash 视为字符 |
| 16 | `validateMidWordHash` | `'x'#cmd`——引号紧邻 `#`，引号剥离后 `#` 变成注释隐藏后续内容 |
| 17 | `validateBraceExpansion` | `{a,b}` 花括号展开可能展开出意外文件名 |
| 18 | `validateZshDangerousCommands` | 前面提到的 23 个 zsh 危险命令 |
| 19 | `validateMalformedTokenInjection` | HackerOne #3482049 报告的 shell-quote 畸形 token 注入 |

**验证器执行顺序不是随意的。** 注释中明确说明了为什么某些验证器必须在另一些之前运行。例如 `validateCommentQuoteDesync` 必须在 `validateNewlines` 之前，因为它检测的场景会导致后者的引号追踪失效。`validateQuotedNewline` 也必须在 `validateNewlines` 之前——它检测引号内的换行，而 `validateNewlines` 设计上忽略引号内的换行。

**更精妙的是"误解析"（misparsing）与"非误解析"验证器的区分。** 代码将验证器分为两类：

- **误解析验证器**（默认）：它们检测的是 shell-quote 和 bash 之间的解析差异，其 `ask` 结果带有 `isBashSecurityCheckForMisparsing: true` 标记
- **非误解析验证器**（`validateNewlines` 和 `validateRedirections`）：它们检测的是正常的 shell 特性，不涉及解析差异

这个区分影响权限系统的行为：误解析的 `ask` 会被权限系统更严格地处理。并且代码确保**不会因为非误解析验证器的 ask 而跳过后续的误解析验证器**——这是一个被真实攻击暴露的 bug：

```
// SECURITY: We must NOT short-circuit when a non-misparsing validator
// returns 'ask' if there are still misparsing validators later in the list.
// payload: `cat safe.txt \; echo /etc/passwd > ./out`
// validateRedirections fires first (non-misparsing) → 
// validateBackslashEscapedOperators would have caught \; (misparsing)
```

修复方案是引入 `deferredNonMisparsingResult`——非误解析的 ask 结果被延迟，继续跑完剩余的误解析验证器，只有没有误解析问题时才返回延迟的结果。

---

### 第 4 层：命令权限匹配——allow/deny/ask 规则引擎

> 源码位置：`tools/BashTool/bashPermissions.ts`（2,621 行）

通过前三层的命令到了这里，会和用户定义的权限规则进行匹配。规则有三种格式：

- **精确匹配**：`Bash(git commit -m "fix")`——只匹配这一条命令
- **前缀匹配**：`Bash(npm run:*)`——匹配所有 `npm run` 开头的命令
- **通配符匹配**：`Bash(git *)`——shell 风格通配

`bashToolHasPermission()` 是这一层的入口，它按以下优先级检查：

1. **先检查 deny 规则**——deny 优先于一切
2. **再检查 ask 规则**（包括 AI 分类器，用 Claude Haiku 判断命令是否匹配自然语言描述的 deny/ask 规则——这是 Haiku 作为分类器在 BashTool 链路里的首次亮相，其完整职责在第 7 层展开）
3. **最后检查 allow 规则**

**安全环境变量剥离**是这一层的关键机制。为了让 `NODE_ENV=prod npm run build` 能匹配 `Bash(npm run:*)` 规则，系统会剥离"安全"的环境变量前缀。但哪些环境变量是"安全"的？

`bashPermissions.ts` 维护了一个 `SAFE_ENV_VARS` 白名单（约 378-430 行），包含 37 个变量——`NODE_ENV`、`RUST_LOG`、`PYTHONUNBUFFERED` 等。注释中**显式列出了绝对不能加入白名单的变量**：

> *SECURITY: These must NEVER be added to the whitelist: PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_\* (execution/library loading), PYTHONPATH, NODE_PATH (module loading), GOFLAGS, RUSTFLAGS, NODE_OPTIONS (code execution flags), HOME, TMPDIR, SHELL, BASH_ENV (affect system behavior)*

还有一组仅限 Anthropic 内部用户（`USER_TYPE === 'ant'`）使用的 `ANT_ONLY_SAFE_ENV_VARS`（约 447-497 行，50 个变量），注释中用全大写警告：

> *SECURITY: These env vars are stripped before permission-rule matching... This is INTENTIONALLY ANT-ONLY and MUST NEVER ship to external users.*

**安全包装命令的剥离**（`stripSafeWrappers`，约 524-600 行）也在这一层进行。它用正则精确匹配 `timeout`、`time`、`nice`、`nohup`、`stdbuf` 的 flag 模式。每个正则都有详细的安全注释——例如 `timeout` 的正则解释了为什么 flag 值必须使用 `[A-Za-z0-9_.+-]` 白名单而不是 `[^ \t]+`：

> *Previously `[^ \t]+` matched `$ ( ) \` | ; &` — `timeout -k$(id) 10 ls` stripped to `ls`, matched Bash(ls:\*), while bash expanded $(id) during word splitting BEFORE timeout ran.*

**复合命令上限**：当 `splitCommand` 拆出的子命令超过 50 条时（`MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50`），系统直接回退到 `ask`。注释解释了为什么：

> *CC-643: On complex compound commands, splitCommand_DEPRECATED can produce a very large subcommands array (possible exponential growth). Each subcommand then runs tree-sitter parse + ~20 validators + logEvent, and with memoized metadata the resulting microtask chain starves the event loop — REPL freeze at 100% CPU.*

50 不是随便选的——"legitimate user commands don't split that wide"。

---

### 第 5 层：路径约束验证——控制命令能操作哪些文件

> 源码位置：`tools/BashTool/pathValidation.ts`（1,303 行）

这一层解决的问题是：即使命令本身被允许了（比如用户设置了 `Bash(rm:*)`），也不意味着可以 `rm -rf /`。

`pathValidation.ts` 为 33 种命令（`cd`、`ls`、`find`、`rm`、`mv`、`cp`、`cat`、`grep`、`sed`、`git`、`jq` 等）定义了专门的路径提取器（`PATH_EXTRACTORS`），从命令参数中提取出文件路径，然后验证这些路径是否在允许的工作目录内。

**危险删除路径检测**（`checkDangerousRemovalPaths`）是一个硬保护：无论用户设置了什么 allow 规则，对 `/`、`/etc`、`/usr`、`/home`、`/tmp` 等关键系统目录的 `rm`/`rmdir` 操作都会被强制拦截到 `ask`，并且不提供"保存规则"的建议——因为系统不希望鼓励用户保存危险命令规则。

**sed 命令**有单独的验证模块（`sedValidation.ts`，684 行 + `sedEditParser.ts`，322 行）。这是因为 sed 的安全模型很特殊：`sed -i 's/foo/bar/g' file.txt` 是一个文件编辑操作，需要检查文件路径；但 `sed 's/foo/bar/g'`（无 `-i`）只是一个流处理器，不修改任何文件。`sedEditParser.ts` 实现了一个完整的 sed 命令解析器，能区分这两种情况。

---

### 第 6 层：只读命令识别——无副作用的命令自动放行

> 源码位置：`tools/BashTool/readOnlyValidation.ts`（1,990 行）

这一层的目标是：对于只读命令（不修改系统状态的命令），跳过权限确认，让 Claude 能流畅地工作。

`readOnlyValidation.ts` 是 BashTool 中第三大的文件（仅次于 bashPermissions.ts 和 bashSecurity.ts），维护了一套庞大的只读命令白名单。以 `git` 为例，`GIT_READ_ONLY_COMMANDS` 包含 `status`、`log`、`diff`、`show`、`branch`（不带 `-D`）、`stash list` 等十多种子命令。

但"只读"的定义比想象中复杂。`fd` 和 `fdfind` 的 `-l`/`--list-details` flag 被排除在安全 flag 白名单外，注释解释：

> *SECURITY: -l/--list-details EXCLUDED — internally executes `ls` as subprocess (same pathway as --exec-batch). PATH hijacking risk if malicious `ls` is on PATH.*

每个命令的白名单都经过 flag 级别的精细验证。`validateFlags()` 函数解析命令的每一个参数，检查是否在安全 flag 集合中。这不是简单的字符串匹配——它区分了无值 flag（`-v`）、跟值 flag（`-n 10`）、融合 flag（`-vvv`）和 `--` 终止符。

---

### 第 7 层：模式与分类器——权限模式的最终决策

> 源码位置：`tools/BashTool/modeValidation.ts`（115 行）、`bashPermissions.ts` 中的分类器集成

Claude Code 有 6 种权限模式（`default`、`plan`、`dontAsk`、`acceptEdits`、`bypassPermissions`、`auto`），不同模式对 BashTool 的约束不同。

`modeValidation.ts` 实现了模式感知的权限逻辑。例如在 `acceptEdits` 模式下，文件系统操作命令（`mkdir`、`touch`、`rm`、`rmdir`、`mv`、`cp`、`sed`）会被自动允许——因为用户已经明确授权了编辑操作。

AI 分类器（`bashClassifier.ts`）是另一个精巧的组件：它用 Claude Haiku 模型来判断一条 bash 命令是否匹配用户用自然语言描述的 deny/ask 规则。例如用户可以设置"不要执行任何修改数据库的命令"——这种规则不可能用简单的正则匹配，需要 AI 理解命令语义。

---

### 第 8 层：操作系统级沙箱——最后的硬隔离

> 源码位置：`tools/BashTool/shouldUseSandbox.ts`（153 行）

前面七层都是"静态分析"——在命令执行之前做的检查。第八层是运行时的硬隔离。

`shouldUseSandbox()` 决定一条命令是否需要在沙箱中执行。沙箱使用操作系统原生机制：macOS 上是 `seatbelt`（`sandbox-exec`），Linux 上是 `seccomp-bpf`。沙箱限制的是系统调用级别的能力——即使前面七层全部被绕过，沙箱也能阻止写入受保护路径、访问网络等危险操作。

> 📚 **课程关联**：`seatbelt` 和 `seccomp-bpf` 都是操作系统课程中**强制访问控制（MAC, Mandatory Access Control）**的实例。`seccomp-bpf` 通过 BPF（Berkeley Packet Filter）程序在内核级别拦截系统调用，属于**内核安全模块**的范畴。macOS 的 `sandbox-exec` 使用 **Sandbox Profile Language（SBPL）** 编写策略文件——语法是 S-expression（圆括号前缀表达式），与 Scheme/Lisp 看起来相像，但严格地说它是一种专门的声明式安全配置语言，不是 Scheme 通用编程语言；说"Scheme 语言"是粗略口径，准确叫法是"SBPL / sandbox profile"。这种声明式安全策略（declarative security policy）对比前七层的命令式检查（imperative checking），体现了操作系统安全中"策略与机制分离"（separation of policy and mechanism）的经典设计原则。

沙箱有三个"例外"机制：

1. **`dangerouslyDisableSandbox` 参数**——Claude 可以请求关闭沙箱，但只有在 `areUnsandboxedCommandsAllowed()` 返回 true 时才生效
2. **`excludedCommands` 设置**——用户可以配置某些命令不经过沙箱（如需要网络访问的命令）
3. **复合命令拆分**——对于 `docker ps && curl evil.com`，系统会拆分检查每个子命令，防止一个被排除的命令带着另一个危险命令一起逃出沙箱

注释中的一段话值得引用：

> *NOTE: excludedCommands is a user-facing convenience feature, not a security boundary. It is not a security bug to be able to bypass excludedCommands — the sandbox permission system (which prompts users) is the actual security control.*

这说明了八层防线的核心思想：每一层都知道自己不是万能的，真正的安全来自纵深叠加。

---

### 支撑基础设施

#### Heredoc 处理——shell 语法的安全雷区

> 源码位置：`utils/bash/heredoc.ts`（733 行）

Heredoc（`<<EOF...EOF`）是 bash 安全分析中的一大难题。shell-quote 库把 `<<` 解析成两个独立的 `<` 重定向操作符，完全破坏了 heredoc 语义。

`heredoc.ts` 实现了完整的 heredoc 提取和还原机制：在交给 shell-quote 解析之前，先把 heredoc 替换成带随机盐值的占位符（`__HEREDOC_0_a1b2c3d4__`），解析完成后再还原。随机盐值防止命令中包含字面量占位符字符串时的碰撞攻击。

代码区分了**引用 heredoc**（`<<'EOF'`、`<<\EOF`——body 是纯文本，不展开变量）和**非引用 heredoc**（`<<EOF`——body 中的 `$()`、`` ` ``、`${}` 会被 shell 执行）。安全验证器只剥离引用 heredoc 的 body——非引用 heredoc 的 body 必须经过完整的安全检查链。

在解析前还有一系列"偏执的预验证"（原文：*paranoid pre-validation*）：

- 遇到 `$'...'` 或 `$"..."` 直接放弃提取（ANSI-C 引号会干扰引号追踪）
- 遇到反引号直接放弃（反引号嵌套的解析规则过于复杂，且反引号在 bash 源码 make_cmd.c:606 中作为 `shell_eof_token` 可以提前关闭 heredoc）
- 遇到未闭合的 `((` 直接放弃（`(( x = 1 << 2 ))` 中的 `<<` 是位移操作符，不是 heredoc）

#### Shell 引号安全

> 源码位置：`utils/bash/shellQuote.ts`（304 行）、`utils/bash/shellQuoting.ts`（128 行）

`shellQuote.ts` 封装了 `shell-quote` 库的 parse/quote 函数，提供错误处理和安全加固。核心安全函数是 `hasMalformedTokens()`（约 117-160 行），它检测 shell-quote 错误解析命令时产生的畸形 token：

- 不平衡的花括号：`echo {"hi":"hi;evil"}` 被 shell-quote 解析后 `{hi:"hi` 中花括号不平衡
- 不成对的引号：shell-quote 会静默丢弃未配对的 `"` 或 `'`，导致 `;` 被解释为操作符

`shellQuoting.ts` 处理 heredoc 和多行字符串的安全引用。它会检测 `>nul` 这种 Windows CMD 语法并自动改写为 `/dev/null`（`rewriteWindowsNullRedirect`），因为 Git Bash 会把 `nul` 创建为一个文件——一个 Windows 保留设备名，"extremely hard to delete and breaks git add . and git clone"（引用自 issue #4928）。

#### 管道命令安全

> 源码位置：`utils/bash/bashPipeCommand.ts`（294 行）

`rearrangePipeCommand()` 解决了一个微妙的问题：当 BashTool 通过 `eval` 执行管道命令时，stdin 重定向（`< /dev/null`）会应用到整个管道而不是第一个命令。解决方法是把 `cmd1 | cmd2` 重新排列为 `cmd1 < /dev/null | cmd2`。

但这个重排本身就有安全风险——shell-quote 和 bash 对某些输入的解析不同，重构命令可能改变语义。代码在遇到以下任何情况时都会放弃重排，回退到整体引用：

- 包含反引号（shell-quote 处理不好）
- 包含 `$()`（shell-quote 把括号解析为独立操作符）
- 包含 `$VAR`（shell-quote 会展开变量为空字符串）
- 包含控制结构（`for`/`while`/`if`）
- 包含换行（shell-quote 把换行当空格处理）
- 匹配 `hasShellQuoteSingleQuoteBug`（`\'` 在单引号内的解析差异）

#### ShellSnapshot——控制执行环境

> 源码位置：`utils/bash/ShellSnapshot.ts`（582 行）

ShellSnapshot 不是安全审计日志——它是一个**环境控制机制**。每次 BashTool 执行命令时，shell 环境需要包含用户的函数、别名、shell 选项，同时注入 Claude Code 自己的工具集成。

ShellSnapshot 做的事包括：

1. 从用户的 `.bashrc`/`.zshrc` 提取函数、别名和 shell 选项（过滤掉以 `_` 开头的补全函数，保留 `__` 开头的辅助函数如 `__pyenv_init`）
2. 注入 ripgrep 集成——如果系统没有 `rg`，创建一个 shell 函数指向内置的 ripgrep 二进制
3. 注入 `find`/`grep` 集成——用内置的 `bfs`（快速 find）和 `ugrep`（快速 grep）替换系统版本
4. **清除可能覆盖这些函数的别名**——`unalias find 2>/dev/null || true` 必须在函数定义之前执行，因为 "bash expands aliases before function lookup"

`createArgv0ShellFunction()` 使用了 bun 内部的 `ARGV0` 调度机制：bun 二进制根据 argv[0] 决定运行哪个嵌入工具（rg、bfs、ugrep），shell 函数通过 `exec -a <name>` 或 `ARGV0=<name>` 来设置 argv[0]。

#### 命令注册表

> 源码位置：`utils/bash/registry.ts`（53 行）、`utils/bash/commands.ts`（1,339 行）

`registry.ts` 是命令规格的注册中心。它从 `@withfig/autocomplete`（Fig 命令补全库）动态加载命令规格（flag 定义、子命令结构等），并用 LRU 缓存。内置的 `specs/` 目录（8 个文件，含 index.ts）定义了 `alias`、`nohup`、`pyright`、`sleep`、`srun`、`time`、`timeout` 的自定义规格，覆盖或补充 Fig 库没有的信息。

`commands.ts` 实现了命令拆分——把复合命令（`cmd1 && cmd2 | cmd3`）拆成子命令列表。这是整个安全系统的数据基础——每个子命令独立通过权限检查。

拆分过程中的安全考量密度极高。仅"占位符生成"就使用了 `crypto.randomBytes(8)` 来防止注入攻击：

```typescript
// Security: This is critical for preventing attacks where a command like
// `sort __SINGLE_QUOTE__ hello --help __SINGLE_QUOTE__` could inject arguments.
const salt = randomBytes(8).toString('hex')
```

行连续符（`\<newline>`）的处理区分了奇数和偶数反斜杠：奇数反斜杠是行连续符（剥离），偶数反斜杠是转义反斜杠 + 换行命令分隔符（保留）。注释中给出了为什么不能加空格：

> *SECURITY: We must NOT add a space here - shell joins tokens directly without space. Adding a space would allow bypass attacks like `tr\<newline>aceroute` being parsed as `tr aceroute` (two tokens) while shell executes `traceroute` (one token).*

---

## 这个设计背后的取舍

### 取舍 1：安全深度 vs. 响应速度

22,987 行安全代码意味着每条命令都要经过大量检查。Claude Code 的应对策略是分层短路：

- 空命令在第一个验证器就返回（0 开销）
- `git commit -m "..."` 在第 4 个早期验证器返回（跳过 19 个主验证器）
- 只读命令在第 6 层直接放行（跳过权限确认 UI）
- tree-sitter 解析有 50ms 超时上限

### 取舍 2：fail-closed 的代价——误报

默认拒绝意味着合法命令也可能被拦截。例如包含 `${}` 的命令（合法的参数展开）会触发 `validateDangerousPatterns`。`MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50` 意味着如果你写了一个超长的 `&&` 链，系统会要求确认而不是尝试分析。

这是一个明确的取舍——宁可多问一次用户，也不放过一个危险命令。

### 取舍 3：双解析器并行——legacy 与 tree-sitter 的过渡

代码中大量出现 `_DEPRECATED` 后缀——`splitCommand_DEPRECATED`、`bashCommandIsSafe_DEPRECATED`。整个系统正在从 regex+shell-quote 的旧路径迁移到 tree-sitter 的新路径。但迁移不是一刀切的：

- tree-sitter 路径在 `TREE_SITTER_BASH` feature flag 后面
- `TREE_SITTER_BASH_SHADOW` 模式可以同时运行两条路径，记录差异但以旧路径为准
- 旧路径被保留为 fallback——如果 tree-sitter 不可用（WASM 加载失败等）

这种"影子测试"策略确保新路径在生产环境中被充分验证后才切换。

### 取舍 4：HackerOne 驱动的加固

注释中多次引用 HackerOne 报告编号（如 `#3482049`），说明这些验证器不是理论推导出来的——它们是真实攻击的响应。每个 SECURITY 注释都附带了攻击向量、攻击原理和修复方案。这使得代码既是实现也是安全知识库。

---

## 24 项安全检查：一个被低估的数字

纵观上述八层防线，如果把所有独立的安全检查项汇总——4 个早期验证器、19 个主验证器、加上操作系统级沙箱的最终裁决——BashTool 总计实施了 **24 项安全检查**。这个数字本身就是工程深度的佐证：不是"做了安全检查"，而是穷举了 24 种攻击面。

其中几个亮点检查项尤为值得关注：

- **零宽字符注入检测**（`validateUnicodeWhitespace`）：检测不可见的 Unicode 字符（比如"零宽空格"——你眼睛看不到它，但它确实存在于文本中）。这些字符在终端中完全不可见，但 bash 会将其视为合法字符而非空白分隔符，攻击者可以利用这种"隐身墨水"来隐藏恶意参数。
- **Zsh 扩展技巧防护**（`validateBraceExpansion` + `validateZshDangerousCommands`）：Zsh（以及常见的 bash 扩展）都支持花括号展开，但**展开结果不是"两条命令"**——`{a,b}` 是在同一条命令里把一个词展开为多个词/参数（例如 `echo {a,b}` 执行的仍是**一条** `echo` 命令，传入两个参数 `a` 和 `b`）。攻击者可能利用这种扩展让某个 glob 意外匹配到敏感文件，或让一个词在展开后变成多个参数绕过基于"单参数"的白名单。系统对 Zsh 特有的危险命令逐一封堵（具体数量以 `ZSH_DANGEROUS_COMMANDS` 集合为准）。
- **客户端与服务器侧的身份校验**：Claude Code 在与 Anthropic 服务器建立长连接时会做客户端身份与版本校验，这层校验属于**客户端-服务器通信层**的能力，严格地讲不属于本章定义的"BashTool 八层命令执行防线"——上一版曾把它算进"23 项安全检查"的单项里，口径不精确；本版把它重新归类为"BashTool 周边的、与命令执行不直接耦合的身份校验"，保留在本节作为"整体安全画像"的一部分，但不再与八层防线并列计数。

> 🌍 社区视角（示例表述，非真实引用）—— "23 检查并非多疑，而是在真实操作系统上运行任意 shell 命令这一场景里、可辨识攻击面的最低覆盖。"（原正文将其标为 `@anthropic_security_review` 的推文引用，但该引用无可验证来源；本节改为"示例表述"，仅用来呈现工程取舍的观点语气，不应被当作外部权威来源。）

---

## 如果你只记住一件事

BashTool 的安全不是靠一道墙，而是靠**八层不同材质的防线叠加在一起**——从语法解析（第 1 层）到操作系统沙箱（第 8 层），每一层都假设前面的层可能被突破。核心原则刻在 `ast.ts` 开头：**fail-closed，我们永远不解释自己不理解的结构**。在 22,987 行代码中，每一个 SECURITY 注释都是一次真实攻击的伤疤。这不是过度工程——这是一个允许 AI 执行任意 shell 命令的系统必须付出的安全代价。
