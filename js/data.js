/**
 * Component metadata for the engine map detail panels.
 * Each component maps to a node on the SVG.
 */
const COMPONENTS = {
  'query-engine': {
    title: 'QueryEngine — 查询循环',
    titleEn: 'QueryEngine — The Query Loop',
    icon: '♥',
    color: '#00d4ff',
    osAnalogy: '内核调度器 (Kernel Scheduler)',
    osAnalogyEn: 'Kernel Scheduler',
    cityAnalogy: '市政服务大厅 — 所有市民请求都从这里进出',
    cityAnalogyEn: 'City Service Hall — every citizen request flows through here',
    metaphor: '心脏的收缩与舒张',
    metaphorEn: 'A heartbeat — contraction and relaxation',
    cityMetaphor: '市政服务大厅 — 接待请求、派出工作队、等待结果、循环往复',
    cityMetaphorEn: 'City service hall — accept requests, dispatch crews, await results, repeat',
    whyMatters: '没有它，Claude Code 就是一个只会说话的聊天框。QueryEngine 是让 AI 能"做事"的核心——它把 AI 的回复转化为实际的文件操作、命令执行和代码修改。',
    whyMattersEn: 'Without it, Claude Code would just be a chat box. The QueryEngine is what lets the AI actually do things — translating replies into real file edits, shell commands, and code changes.',
    stats: [
      { val: '1,295', lbl: '行代码', lblEn: 'Lines of code', explain: 'QueryEngine.ts 的总行数——这一个文件掌控了所有对话的生命周期', explainEn: 'Total lines in QueryEngine.ts — one file owns the lifecycle of every conversation.' },
      { val: '1,729', lbl: 'query.ts 行', lblEn: 'Lines in query.ts', explain: '核心循环的实现——每次你和 Claude 对话，就是这 1,729 行在运转', explainEn: 'The core loop implementation — every Claude conversation runs through these 1,729 lines.' },
      { val: '6', lbl: '压缩机制', lblEn: 'Compression mechanisms', explain: '当对话太长时，6 套由轻到重的压缩手段依次启动：裁剪工具结果→截断长输出→移除旧消息→折叠旧对话→AI 写摘要→413 紧急压缩。前 5 套在 API 调用前运行，第 6 套是收到"超限"错误后的紧急补救', explainEn: 'When the conversation overflows, 6 tiers fire in order: trim tool results → truncate long output → drop old messages → fold old turns → AI summarization → emergency 413 compression. The first 5 run pre-API; the 6th is reactive after an over-limit error.' },
      { val: '6', lbl: '退出条件', lblEn: 'Exit conditions', explain: '循环什么时候停？6 种情况：AI 说完了、用户中断了、token 用完了、出错了、达到轮次上限、或工具要求停止', explainEn: 'When does the loop stop? Six cases: AI says it is done, user interrupts, tokens run out, error thrown, turn limit hit, or a tool requests stop.' },
    ],
    description: `QueryEngine 是 Claude Code 的<strong>心脏</strong>——一个永不停歇的"收缩-舒张"循环。每次"收缩"发送你的请求给 AI，等待回复；每次"舒张"执行 AI 要求的工具调用（比如读文件、改代码）。然后再"收缩"把结果告诉 AI，如此循环。

用<strong>城市比喻</strong>：市民（你）来到服务大厅提出需求 → 大厅把需求递给后台决策中心（AI）→ 决策中心说"去查一下档案" → 大厅派人去档案馆查 → 结果拿回来 → 决策中心说"好，再去修改一下城建图纸" → 大厅再派人去……直到需求完全解决。

<strong>六套压缩</strong>是关键优化：对话越长，"档案"越多，大厅放不下了。系统依次采取 6 级措施：裁剪大件工具结果 → 剪除无关历史片段 → 消除重复读取 → 折叠旧对话段 → AI 写全文摘要 → 收到超限后紧急二次压缩。99% 情况下前三套就够了。`,
    descriptionEn: `The QueryEngine is the <strong>heart</strong> of Claude Code — a never-resting "contract / relax" loop. Each "contract" sends your request to the AI and awaits a reply; each "relax" executes the tool calls the AI asked for (read a file, edit code). Then it contracts again to send results back. Repeat until the AI says it is done.

<strong>City metaphor</strong>: a citizen (you) walks into the service hall → the hall hands the request to the back-office decision center (AI) → the AI says "look up these archives" → the hall dispatches a clerk to the archive → results come back → AI says "now revise this blueprint" → the hall dispatches again... until the request is fully resolved.

The <strong>six tiers of compression</strong> are the critical optimization: longer conversation = more "archives" the hall cannot hold. The system applies six escalating measures: trim large tool results → drop irrelevant history slices → dedupe re-reads → fold old turns → AI-written summary → emergency post-limit recompression. The first three handle 99% of cases.`,
    concepts: [
      { name: '<code>queryLoop()</code> — AsyncGenerator 主循环', nameEn: '<code>queryLoop()</code> — the AsyncGenerator main loop', explain: '这是心跳本身。它用 JavaScript 的"异步生成器"模式实现，好处是调用者可以在每次心跳之间注入控制——比如检查用户是否按了取消。', explainEn: 'This is the heartbeat itself. Implemented with JavaScript async generators so the caller can inject control between beats — e.g. check if the user pressed cancel.' },
      { name: '<code>StreamingToolExecutor</code> — 并发工具执行器', nameEn: '<code>StreamingToolExecutor</code> — concurrent tool executor', explain: '当 AI 同时要求"读文件 A"和"读文件 B"时，执行器判断两个操作可以并行，就同时执行；但如果是"写文件 A"和"写文件 A"，就必须串行防止冲突。', explainEn: 'When the AI requests "read file A" and "read file B" together, the executor parallelizes them. But "write A" and "write A" must serialize to avoid conflicts.' },
      { name: '<code>softLimit / hardLimit</code> — Token 阈值', nameEn: '<code>softLimit / hardLimit</code> — token thresholds', explain: '软限制 = "对话快满了，开始压缩"；硬限制 = "对话真的满了，必须压缩"。就像城市用水量到了黄色预警就开始节水，到了红色预警就强制限水。', explainEn: 'Soft limit = "context is filling up, start compressing." Hard limit = "context is full, must compress now." Like a city water alert: yellow = conserve, red = enforced rationing.' },
      { name: '<code>shouldContinue()</code> — 退出判断', nameEn: '<code>shouldContinue()</code> — exit decision', explain: '每次 AI 回复后，系统检查 6 种停止条件。最常见的是 AI 自己说"我做完了"（end_turn），最严重的是 token 耗尽。', explainEn: 'After each AI reply, the system checks 6 stop conditions. The most common is the AI itself saying "done" (end_turn); the worst is running out of tokens.' },
      { name: 'Prompt Cache 与压缩的冲突', nameEn: 'Prompt Cache vs. compression conflict', explain: '压缩会改变对话内容，导致之前缓存的 AI 计算结果失效。就像你把档案重新整理了，之前标记过的书签就找不到了。系统必须在"省空间"和"不浪费缓存"之间权衡。', explainEn: 'Compression alters conversation content, invalidating cached AI computations. Like rearranging an archive — the bookmarks you placed no longer line up. The system must trade off "save space" vs "keep cache hits."' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '04', title: '查询循环', titleEn: 'The Query Loop' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q02', title: '上下文压缩', titleEn: 'Context Compression' },
      { part: 'Part 4', partEn: 'Part 4', num: '01', title: '权限系统完全解析', titleEn: 'The Permission System' },
    ],
  },

  'system-prompt': {
    title: '提示词工厂 — 系统提示词',
    titleEn: 'Prompt Factory — The System Prompt',
    icon: '🧬',
    color: '#e88dff',
    osAnalogy: '进程环境变量 (/proc/PID/environ)',
    osAnalogyEn: 'Process environment variables (/proc/PID/environ)',
    cityAnalogy: '城市宪法 + 部门手册 — 所有人都必须遵守的基本规则',
    cityAnalogyEn: 'City constitution + department handbook — the rules everyone must follow',
    metaphor: '三明治——底层面包永远不变',
    metaphorEn: 'A sandwich — the bottom slice never changes',
    cityMetaphor: '城市宪法——国法在最上面不会变，地方条例在下面可以调整',
    cityMetaphorEn: 'City constitution — national law on top is fixed, local ordinances below can adjust',
    whyMatters: '这段"指令"决定了 AI 的一切行为——它是聪明助手还是鲁莽机器人，全靠这 15,000-34,000 token 的精心组装。而且组装顺序直接影响每次调用花多少钱。',
    whyMattersEn: 'These "instructions" decide everything the AI does — whether it acts as a thoughtful assistant or a reckless robot depends on the careful 15K-34K-token assembly. The order even decides how much each call costs.',
    stats: [
      { val: '15K-34K', lbl: 'token/次', lblEn: 'tokens / call', explain: '每次你发一条消息，这么多 token 的"规则手册"都要一起发给 AI。命中缓存只花 1/10 的钱，没命中就是 10 倍开销', explainEn: 'Every message you send ships this much "rulebook" with it. With cache hits you pay 1/10; without, you pay 10x.' },
      { val: '6', lbl: '组装层级', lblEn: 'Assembly tiers', explain: '像三明治一样 6 层叠起来：底层是永不变的核心规则，顶层是你的个人偏好——越下面越稳定，越上面越可能变化', explainEn: 'Stacked like a sandwich, 6 tiers: the bottom is unchanging core rules, the top is your personal preferences — lower = stable, higher = volatile.' },
      { val: '3', lbl: '缓存作用域', lblEn: 'Cache scopes', explain: '全球级（所有用户共享）→ 组织级（你的团队共享）→ 不缓存（每次都不同）。全球缓存意味着全世界的 Claude Code 用户帮你分摊成本', explainEn: 'Global (all users share) → Org (your team shares) → none (always fresh). Global cache means every Claude Code user worldwide shares the cost with you.' },
      { val: '6', lbl: 'CLAUDE.md 类型', lblEn: 'CLAUDE.md kinds', explain: '6 种配置文件：项目共享的、个人私有的、全局用户的、企业强制的、上游目录的、工作区根目录的——它们合起来告诉 AI 你的项目规则', explainEn: '6 config flavors: project-shared, personal-private, global-user, enterprise-forced, upstream-directory, workspace-root — together they teach the AI your project rules.' },
    ],
    description: `系统提示词是一个<strong>动态组装的层次结构</strong>，像三明治一样按变化频率从低到高排列。最稳定的默认提示词在最前面（保证 Prompt Cache 前缀匹配），最可能变化的用户追加在最后。

<strong>三级缓存作用域</strong>（global/org/null）意味着静态部分可以在<strong>全球所有 Claude Code 用户</strong>之间共享缓存——每次 API 调用省掉 10 倍成本的关键。`,
    descriptionEn: `The system prompt is a <strong>dynamically assembled hierarchy</strong>, stacked like a sandwich from "low-volatility" to "high-volatility." The most stable defaults sit first (so Prompt Cache prefixes always match); the most-likely-to-change user additions go last.

The <strong>three cache scopes</strong> (global / org / null) mean the static part can be shared <strong>across every Claude Code user worldwide</strong> — the key to saving 10x on each API call.`,
    concepts: [
      { name: '<code>__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__</code> — 缓存边界标记', nameEn: '<code>__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__</code> — cache boundary marker' },
      { name: '<code>getMemoryFiles()</code> — 四步 CLAUDE.md 发现算法', nameEn: '<code>getMemoryFiles()</code> — four-step CLAUDE.md discovery algorithm' },
      { name: '<code>splitSysPromptPrefix()</code> — 三级缓存分割', nameEn: '<code>splitSysPromptPrefix()</code> — three-level cache split' },
      { name: '<code>DANGEROUS_uncachedSystemPromptSection</code> — MCP 段标记', nameEn: '<code>DANGEROUS_uncachedSystemPromptSection</code> — MCP section marker' },
      { name: '<code>system-reminder</code> 标签 — 不破坏缓存的动态注入', nameEn: '<code>system-reminder</code> tag — dynamic injection without breaking cache' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '03', title: '提示词工厂', titleEn: 'The Prompt Factory' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q10', title: 'Prompt Cache 边界工程', titleEn: 'Prompt Cache Boundary Engineering' },
      { part: 'Part 2', partEn: 'Part 2', num: '10', title: 'Token 经济学', titleEn: 'Token Economics' },
    ],
  },

  'tool-runtime': {
    title: '工具运行时 — Tool Runtime',
    titleEn: 'Tool Runtime',
    icon: '🖐',
    color: '#00d4ff',
    osAnalogy: '系统调用接口 (syscall)',
    osAnalogyEn: 'Syscall interface',
    cityAnalogy: '43 个市政部门 — 每个部门只做一件事，AI 必须通过部门办事',
    cityAnalogyEn: '43 city departments — each does one thing, the AI must go through them',
    metaphor: '双手——AI 与现实世界交互的唯一通道',
    metaphorEn: 'Hands — the only channel through which the AI touches the real world',
    cityMetaphor: '市政部门——建设局修路、档案馆查资料、消防队灭火，各司其职',
    cityMetaphorEn: 'City departments — Public Works fixes roads, Archives looks up records, Fire Dept extinguishes fires',
    whyMatters: 'AI 光靠"说"什么都做不了。工具是 AI 和你的电脑之间唯一的桥梁——读文件、改代码、运行命令全靠这 43 个工具。没有后门，没有捷径。',
    whyMattersEn: 'Talk alone gets nothing done. Tools are the only bridge between the AI and your machine — every file read, code edit, and command run flows through these 43 tools. No back doors, no shortcuts.',
    stats: [
      { val: '43', lbl: '工具目录', lblEn: 'Tools', explain: '43 个独立工具，像 43 个市政部门各有专长：Bash 执行命令、Read 读文件、Edit 改文件、Grep 搜索内容、Agent 派子任务...', explainEn: '43 specialized tools, like city departments each owning a job: Bash runs commands, Read opens files, Edit modifies, Grep searches, Agent delegates sub-tasks...' },
      { val: '792', lbl: 'Tool.ts 行', lblEn: 'Lines in Tool.ts', explain: '这是所有工具的"部门规章"——定义了一个工具必须具备的 20+ 种能力（权限检查、参数验证、结果格式化等）', explainEn: 'The "department charter" for every tool — defines the 20+ capabilities each tool must implement.' },
      { val: '20+', lbl: '接口方法', lblEn: 'Interface methods', explain: '每个工具都要实现 20 多个方法，从"你需要什么权限"到"执行完怎么汇报结果"全都有规定', explainEn: 'Every tool implements 20+ methods, covering everything from "what permissions do you need" to "how do you report results."' },
      { val: '7', lbl: '执行管线步骤', lblEn: 'Pipeline stages', explain: '每次工具调用经过 7 步：解析参数→检查权限→验证输入→准备环境→执行→格式化→更新状态。任何一步出问题都会安全中止', explainEn: 'Every call goes through 7 stages: parse args → permission check → validate input → prepare context → execute → format → update state. Any failure aborts safely.' },
    ],
    description: `每个工具都实现了 <code>Tool</code> 接口的 20+ 方法，从权限检查到结果格式化一应俱全。工具分四大类：<strong>文件系统</strong>（Read/Write/Edit/Glob/Grep）、<strong>执行</strong>（Bash/NotebookEdit）、<strong>协调</strong>（Agent/TodoWrite/AskUser）、<strong>扩展</strong>（MCP 动态工具）。

七步执行管线：解析参数 → 权限检查 → 验证输入 → 准备上下文 → 执行核心逻辑 → 格式化结果 → 更新状态。延迟加载（isDeferred）让冷门工具的描述不进 system prompt，按需通过 <code>ToolSearch</code> 加载。`,
    descriptionEn: `Every tool implements 20+ methods of the <code>Tool</code> interface — permission checks, result formatting, and more. The 4 families: <strong>filesystem</strong> (Read/Write/Edit/Glob/Grep), <strong>execution</strong> (Bash/NotebookEdit), <strong>coordination</strong> (Agent/TodoWrite/AskUser), <strong>extensions</strong> (dynamic MCP tools).

The 7-stage pipeline: parse args → permission check → validate input → prepare context → execute core logic → format results → update state. Deferred loading (isDeferred) keeps cold-tool descriptions out of the system prompt, loaded on demand via <code>ToolSearch</code>.`,
    concepts: [
      { name: '<code>Tool</code> 接口 — 20+ 方法的工具契约', nameEn: '<code>Tool</code> interface — the 20+ method contract every tool follows' },
      { name: '<code>isReadOnly()</code> — 只读工具跳过权限检查', nameEn: '<code>isReadOnly()</code> — read-only tools skip permission checks' },
      { name: '<code>isDeferred</code> — 延迟加载省 token', nameEn: '<code>isDeferred</code> — deferred loading saves tokens' },
      { name: '<code>ToolUseContext</code> — 执行上下文对象', nameEn: '<code>ToolUseContext</code> — execution-context object' },
      { name: '<code>StreamingToolExecutor</code> — 并发安全 vs 独占', nameEn: '<code>StreamingToolExecutor</code> — concurrent-safe vs. exclusive scheduling' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '05', title: '工具运行时', titleEn: 'The Tool Runtime' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q04', title: '为什么 43 个工具', titleEn: 'Why 43 Tools?' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q25', title: 'BashTool 安全防线', titleEn: 'BashTool Safety Lines' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q22', title: 'Computer Use 屏幕操控', titleEn: 'Computer Use — Screen Control' },
      { part: 'Part 4', partEn: 'Part 4', num: '03', title: '工具系统深潜', titleEn: 'Tool System Deep Dive' },
    ],
  },

  'agent-orchestration': {
    title: 'Agent 编排 — Coordinator',
    titleEn: 'Agent Orchestration — Coordinator',
    icon: '🧠',
    color: '#7b61ff',
    osAnalogy: '进程管理器 (Process Manager)',
    osAnalogyEn: 'Process manager',
    cityAnalogy: '项目经理办公室 — 把大工程拆分给多个施工队并行施工',
    cityAnalogyEn: 'Project manager office — split big projects across crews running in parallel',
    metaphor: '大脑——协调多手并行工作',
    metaphorEn: 'A brain — coordinating many hands working in parallel',
    cityMetaphor: '项目经理——不亲自搬砖，但知道谁该做什么、什么时候做',
    cityMetaphorEn: 'A project manager — does not lay bricks, but knows who does what and when',
    whyMatters: '复杂任务（如"重构这个模块并写测试"）单个 AI 做不完——上下文窗口会爆满。Agent 编排把任务拆给多个"工人"并行完成。',
    whyMattersEn: 'A single AI cannot finish complex tasks like "refactor this module and add tests" — context overflows. Agent orchestration splits the work across parallel "workers."',
    stats: [
      { val: '7', lbl: '任务类型', lblEn: 'Task kinds', explain: 'dream（记忆整理）、in_process_teammate（共享进程）、local_agent（worktree 隔离）、local_shell（后台命令）、remote_agent（远程机器）等', explainEn: 'dream (memory consolidation), in_process_teammate (shared process), local_agent (worktree isolation), local_shell (background command), remote_agent (separate machine), etc.' },
      { val: '3', lbl: '隔离模式', lblEn: 'Isolation tiers', explain: '共享进程（最快但无隔离）→ Git Worktree（中等隔离）→ Remote（完全隔离在独立机器）', explainEn: 'Shared process (fastest, zero isolation) → Git Worktree (medium isolation) → Remote (full isolation on a separate machine).' },
      { val: '370', lbl: 'Coordinator 提示词行', lblEn: 'Coordinator-prompt lines', explain: '这不是代码——是用自然语言写的"架构规则"，定义了什么任务该拆分、什么不该委托', explainEn: 'Not code — natural-language "architecture rules" defining what tasks should split out and what must not be delegated.' },
      { val: '120s', lbl: '自动后台化', lblEn: 'Auto-backgrounding', explain: '任务运行超过 120 秒就自动转入后台——用户可以继续新对话，不必死等', explainEn: 'Tasks running >120s auto-move to the background — the user can keep chatting instead of waiting.' },
    ],
    description: `Agent 编排系统管理从轻量级的 <code>in_process_teammate</code>（共享进程，无隔离）到重量级的 <code>remote_agent</code>（独立机器，完全隔离）的七种任务类型。

Coordinator 模式下，370 行系统提示词定义了"反懒惰委托"规则——禁止将简单任务丢给 Worker。<code>omitClaudeMd</code> 优化让子 Agent 跳过 CLAUDE.md 注入，节省 5-15 GTok/周。Scratchpad 作为进程间通信（IPC）机制，让 Coordinator 和 Workers 共享状态。`,
    descriptionEn: `The orchestration system manages seven task kinds, from lightweight <code>in_process_teammate</code> (shared process, no isolation) up to heavyweight <code>remote_agent</code> (separate machine, full isolation).

In Coordinator mode, the 370-line system prompt encodes "anti-lazy delegation" rules — forbidding the Coordinator from punting trivial tasks to Workers. <code>omitClaudeMd</code> optimization lets sub-agents skip CLAUDE.md injection, saving 5-15 GTok/week. Scratchpad acts as an IPC mechanism so Coordinator and Workers share state.`,
    concepts: [
      { name: '七种任务类型：从 <code>in_process_teammate</code> 到 <code>remote_agent</code>', nameEn: 'Seven task kinds: from <code>in_process_teammate</code> to <code>remote_agent</code>' },
      { name: '<code>Coordinator</code> + <code>Worker</code> 架构', nameEn: '<code>Coordinator</code> + <code>Worker</code> architecture' },
      { name: '<code>omitClaudeMd</code> — 子 Agent 优化', nameEn: '<code>omitClaudeMd</code> — sub-agent optimization' },
      { name: 'Scratchpad — IPC 共享白板', nameEn: 'Scratchpad — shared IPC whiteboard' },
      { name: '120 秒自动后台化', nameEn: '120-second auto-backgrounding' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '06', title: 'Agent 编排', titleEn: 'Agent Orchestration' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q14', title: '多 Agent 协调', titleEn: 'Multi-Agent Coordination' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q21', title: 'MagicDocs 自动维护', titleEn: 'MagicDocs Auto-Maintenance' },
      { part: 'Part 4', partEn: 'Part 4', num: '06', title: 'Agent 系统深潜', titleEn: 'Agent System Deep Dive' },
    ],
  },

  'security': {
    title: '安全架构 — 四层纵深防御',
    titleEn: 'Security Architecture — Four-Layer Defense in Depth',
    icon: '🛡',
    color: '#ff6b6b',
    osAnalogy: 'SELinux + 沙箱 + 能力系统',
    osAnalogyEn: 'SELinux + sandbox + capabilities system',
    cityAnalogy: '行政审批局 — 4 道关卡层层审批，重要操作需要局长签字',
    cityAnalogyEn: 'Administrative approval bureau — 4 gates layered, big actions need the director\u2019s signature',
    metaphor: '机场安检——多道关卡，任何一道都能拦截',
    metaphorEn: 'Airport security — multiple checkpoints, any one of them can stop you',
    cityMetaphor: '行政审批局——企业规章→安全围栏→窗口审批→具体检查，层层把关',
    cityMetaphorEn: 'Approval bureau — corporate rules → security fence → counter approval → final inspection, gate after gate',
    whyMatters: 'AI 能在你的电脑上运行任何命令——这既是能力也是风险。安全系统确保 AI 不会删掉你的代码库、泄露你的密码、或执行你没授权的操作。',
    whyMattersEn: 'The AI can run any command on your machine — that is both the power and the risk. The security system makes sure it cannot delete your repo, leak your passwords, or do anything you did not authorize.',
    stats: [
      { val: '4', lbl: '防御层级', lblEn: 'Defense layers', explain: '4 层由外到内：企业策略（公司不允许）→ 沙箱（操作系统隔离）→ 权限审批（你同不同意）→ 代码级检查（路径安全、命令注入防护）', explainEn: 'Outer to inner: enterprise policy (forbidden by your company) → sandbox (OS-level isolation) → permission approval (do you consent?) → code-level checks (path safety, injection guards).' },
      { val: '9', lbl: '权限链步骤', lblEn: 'Permission-chain steps', explain: 'AI 每次想调用工具，要过 9 道检查：从"这个工具存在吗"到"企业允许吗"到"用户设了什么规则"到"这条命令安全吗"', explainEn: 'Every tool call passes 9 checks: from "does this tool exist?" to "is the enterprise OK with it?" to "what user rules apply?" to "is the command itself safe?"' },
      { val: '6', lbl: '权限模式', lblEn: 'Permission modes', explain: '你可以选择信任程度：plan（只看不做）→ default（每次都问你）→ acceptEdits（改文件自动允许）→ auto（AI 自己判断）→ bypass（跳过检查）→ dontAsk（拒绝一切危险操作）', explainEn: 'Pick your trust level: plan (read-only) → default (always ask) → acceptEdits (auto-allow file edits) → auto (AI decides) → bypass (skip checks) → dontAsk (refuse anything risky).' },
      { val: '6', lbl: '信任层级', lblEn: 'Trust tiers', explain: '从最高信任到最低：企业策略 > 系统代码 > 用户设置 > 项目配置 > 对话中的指令 > 外部内容。企业规则永远不可被覆盖', explainEn: 'Highest to lowest: enterprise policy > system code > user settings > project config > in-conversation instructions > external content. Enterprise rules can never be overridden.' },
    ],
    description: `安全架构四层纵深：<strong>企业策略</strong>（最高优先级，不可覆盖）→ <strong>沙箱</strong>（操作系统级隔离）→ <strong>权限状态机</strong>（十步交互式审批）→ <strong>代码级安全</strong>（路径遍历防护、命令注入防护）。

"Iron Gate"原则确保某些操作<strong>永远需要人类确认</strong>——即使用户设置了"全部允许"也无法跳过。bare git repo 攻击防护、homoglyph 检测等都是应对真实安全威胁的措施。`,
    descriptionEn: `Four layers of defense in depth: <strong>Enterprise policy</strong> (top priority, never overridable) → <strong>Sandbox</strong> (OS-level isolation) → <strong>Permission state machine</strong> (10-step interactive approval) → <strong>Code-level safety</strong> (path-traversal guards, command-injection guards).

The "Iron Gate" principle ensures certain actions <strong>always require human confirmation</strong> — even "allow all" cannot skip them. Bare-git-repo attack protection, homoglyph detection, and friends are responses to real security threats observed in the wild.`,
    concepts: [
      { name: 'Iron Gate — 不可跳过的人类确认', nameEn: 'Iron Gate — un-skippable human confirmation' },
      { name: '<code>bypass-immune</code> — 免疫绕过', nameEn: '<code>bypass-immune</code> — bypass-immune actions' },
      { name: 'bare git repo 攻击防护', nameEn: 'Bare-git-repo attack mitigation' },
      { name: '六级信任层次：Enterprise > System > User > Project > Conversation > External', nameEn: 'Six-tier trust hierarchy: Enterprise > System > User > Project > Conversation > External' },
      { name: 'homoglyph 检测 — 防 Unicode 伪装', nameEn: 'Homoglyph detection — defending against Unicode spoofing' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '07', title: '安全架构', titleEn: 'Security Architecture' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q07', title: '权限系统', titleEn: 'The Permission System' },
      { part: 'Part 4', partEn: 'Part 4', num: '04', title: '安全深潜', titleEn: 'Security Deep Dive' },
    ],
  },

  'state-persistence': {
    title: '状态与持久化',
    titleEn: 'State and Persistence',
    icon: '💾',
    color: '#4ecdc4',
    osAnalogy: '文件系统 + 虚拟内存',
    osAnalogyEn: 'Filesystem + virtual memory',
    cityAnalogy: '城市档案馆 — 短期记录在前台，长期档案在地下室，重要文件永久保存',
    cityAnalogyEn: 'City archive — short-term records up front, long-term files in the basement, critical files preserved forever',
    metaphor: '记忆——从闪存到硬盘的四级存储',
    metaphorEn: 'Memory — four storage tiers from flash to disk',
    cityMetaphor: '城市档案馆——从当天笔记到百年档案，四级存储各有用途',
    cityMetaphorEn: 'City archive — from today\u2019s notes to century-old records, each tier has its purpose',
    whyMatters: '没有持久化，每次关掉 Claude Code 你的对话就消失了。状态系统让 AI 记住之前做了什么、改了哪些文件、甚至能撤销操作。',
    whyMattersEn: 'Without persistence, every Claude Code restart would erase your conversation. The state system lets the AI remember what it did, which files it changed, and even undo operations.',
    stats: [
      { val: '4', lbl: '存储级别', lblEn: 'Storage tiers' },
      { val: '100', lbl: 'MAX_SNAPSHOTS', lblEn: 'MAX_SNAPSHOTS' },
      { val: 'SHA256', lbl: '路径哈希', lblEn: 'Path hash' },
      { val: 'JSONL', lbl: '会话格式', lblEn: 'Session format' },
    ],
    description: `四级存储层次：<strong>AppState</strong>（内存中的 Redux 风格不可变状态）→ <strong>JSONL 会话</strong>（磁盘上的对话历史）→ <strong>FileHistory</strong>（三层去重的文件快照，硬链接节省空间）→ <strong>Memory</strong>（跨会话的长期记忆）。

对话分支系统支持从历史中任意点创建新分支，同时保护 Prompt Cache（分支点之前的缓存仍然有效）。硬链接复用是关键优化——相同内容的文件快照只存一份。`,
    descriptionEn: `Four storage tiers: <strong>AppState</strong> (in-memory Redux-style immutable state) → <strong>JSONL sessions</strong> (on-disk conversation history) → <strong>FileHistory</strong> (three-level deduped file snapshots saved with hardlinks) → <strong>Memory</strong> (cross-session long-term memory).

The conversation-branching system can fork from any point in history while preserving Prompt Cache (anything before the fork stays cached). Hardlink dedup is the key optimization — identical file snapshots are stored once.`,
    concepts: [
      { name: '<code>AppState</code> — Redux 风格不可变状态', nameEn: '<code>AppState</code> — Redux-style immutable state' },
      { name: 'JSONL 会话持久化', nameEn: 'JSONL session persistence' },
      { name: '<code>FileHistory</code> — 三层去重 + 硬链接', nameEn: '<code>FileHistory</code> — three-level dedup + hardlinks' },
      { name: '<code>MAX_SNAPSHOTS = 100</code>', nameEn: '<code>MAX_SNAPSHOTS = 100</code>' },
      { name: '对话分支 + Prompt Cache 保护', nameEn: 'Conversation branching + Prompt Cache preservation' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '08', title: '状态与持久化', titleEn: 'State and Persistence' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q08', title: '对话分支', titleEn: 'Conversation Branching' },
      { part: 'Part 4', partEn: 'Part 4', num: '05', title: '状态系统深潜', titleEn: 'State System Deep Dive' },
    ],
  },

  'token-economics': {
    title: 'Token 经济学',
    titleEn: 'Token Economics',
    icon: '💰',
    color: '#ffd93d',
    osAnalogy: '内存管理 + 资源调度器',
    osAnalogyEn: 'Memory management + resource scheduler',
    cityAnalogy: '城市年度预算 — 每笔花销都要精打细算，批量采购能省大钱',
    cityAnalogyEn: 'City annual budget — every line item is scrutinized, bulk purchases save big',
    metaphor: '城市水务——四种水价，用多少付多少',
    metaphorEn: 'City water utility — four price tiers, pay for what you use',
    cityMetaphor: '城市预算——正常支出、批发折扣、突发开销、输出支出，四种价格',
    cityMetaphorEn: 'City budget — standard spend, bulk discount, surge cost, outbound expense — four prices',
    whyMatters: '每次对话都在花真金白银。一个 20 轮对话，缓存命中花 $0.04，缓存没命中花 $1.00——差 25 倍。Token 经济学决定了产品的可持续性。',
    whyMattersEn: 'Every conversation costs real dollars. A 20-turn conversation costs ~$0.04 with cache hits and ~$1.00 without — a 25x gap. Token economics decides whether the product is sustainable.',
    stats: [
      { val: '4', lbl: 'Token 类型', lblEn: 'Token kinds' },
      { val: '10x', lbl: 'Cache 省成本', lblEn: 'Cache savings' },
      { val: '8', lbl: 'OTel 计数器', lblEn: 'OTel counters' },
      { val: '~$0.04', lbl: '20轮对话(Cache Hit)', lblEn: '20-turn convo (cache hit)' },
    ],
    description: `四种 Token "水价"：<strong>Cache Write</strong>（首次写入缓存，最贵）、<strong>Cache Read</strong>（从缓存读取，1/10 价格）、<strong>Input</strong>（普通输入，标准价）、<strong>Output</strong>（AI 输出，最贵单价）。

Prompt Cache 边界工程是 Claude Code 最精妙的经济优化之一：通过精确控制 system prompt 的分层和缓存边界，确保静态部分跨全球用户共享缓存。压缩与缓存之间存在微妙冲突——压缩消息会改变前缀，导致缓存失效。`,
    descriptionEn: `Four token "water prices": <strong>Cache Write</strong> (first write to cache, most expensive), <strong>Cache Read</strong> (read from cache, 1/10 price), <strong>Input</strong> (regular input, standard price), <strong>Output</strong> (AI output, highest unit price).

Prompt Cache boundary engineering is one of Claude Code\u2019s most elegant economic optimizations: by precisely controlling system-prompt layering and cache boundaries, the static portion can be shared across users worldwide. Compression and cache conflict subtly — compressing messages mutates the prefix and invalidates cache.`,
    concepts: [
      { name: '四种 Token 水价', nameEn: 'Four token "water prices"' },
      { name: '<code>CacheSafeParams</code> — 缓存安全的压缩参数', nameEn: '<code>CacheSafeParams</code> — cache-safe compression params' },
      { name: 'Global / Org / null 三级缓存作用域', nameEn: 'Three cache scopes: Global / Org / null' },
      { name: '压缩 vs 缓存的权衡', nameEn: 'Compression vs. cache trade-off' },
      { name: '八个 OTel Counter 追踪', nameEn: 'Eight OTel counters for tracking' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '10', title: 'Token 经济学', titleEn: 'Token Economics' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q10', title: 'Prompt Cache', titleEn: 'Prompt Cache' },
      { part: 'Part 4', partEn: 'Part 4', num: '02', title: 'Token 管理深潜', titleEn: 'Token Management Deep Dive' },
    ],
  },

  'configuration': {
    title: '配置治理 — 九层套娃',
    titleEn: 'Configuration Governance — Nine Nested Layers',
    icon: '🪆',
    color: '#ffd93d',
    osAnalogy: 'systemd 配置层 + CSS 级联',
    osAnalogyEn: 'systemd config layers + CSS cascade',
    cityAnalogy: '法律层级 — 国法 > 省法 > 市规 > 小区规约，上级覆盖下级',
    cityAnalogyEn: 'Legal hierarchy — federal > provincial > municipal > HOA — higher overrides lower',
    metaphor: '俄罗斯套娃——九层嵌套，每层有不同的权威',
    metaphorEn: 'Russian nesting dolls — nine layers, each with its own authority',
    cityMetaphor: '法律体系——9 层法规从宪法到小区规约，优先级明确不冲突',
    cityMetaphorEn: 'Legal system — 9 layers from constitution to HOA bylaws, priority is unambiguous',
    whyMatters: '当企业 IT 管理员、你的团队、和你个人的偏好冲突时，谁说了算？9 层配置系统精确回答了这个问题。',
    whyMattersEn: 'When enterprise IT, your team, and your personal preferences disagree — who wins? The 9-layer config system answers precisely.',
    stats: [
      { val: '9', lbl: '配置来源', lblEn: 'Config sources' },
      { val: '5', lbl: '优先级层次', lblEn: 'Priority tiers' },
      { val: '2', lbl: '合并规则集', lblEn: 'Merge rule sets' },
      { val: '11', lbl: '迁移版本', lblEn: 'Migration version' },
    ],
    description: `九层配置来源：Enterprise MDM → Enterprise Managed → Remote Settings → User Settings → Project Settings → Project Local → CLI Flags → Environment Variables → Defaults。两套完全不同的合并规则——跨来源<strong>拼接</strong>（concat），同来源<strong>覆盖</strong>（replace）。

Drop-in 目录（<code>.claude/rules/*.md</code>）借鉴了 systemd 的模式——允许多个规则文件无冲突共存。Zod 验证 + <code>filterInvalidPermissionRules()</code> 确保无效配置被静默丢弃而非崩溃。`,
    descriptionEn: `Nine config sources: Enterprise MDM → Enterprise Managed → Remote Settings → User Settings → Project Settings → Project Local → CLI Flags → Environment Variables → Defaults. Two completely different merge rules — across sources <strong>concat</strong>, within a source <strong>replace</strong>.

Drop-in directories (<code>.claude/rules/*.md</code>) borrow the systemd pattern — multiple rule files coexist without conflict. Zod validation + <code>filterInvalidPermissionRules()</code> ensure invalid configs are silently dropped rather than crashing.`,
    concepts: [
      { name: '九源五层优先级', nameEn: 'Nine sources, five priority tiers' },
      { name: '两套合并语义：跨源 concat vs 同源 replace', nameEn: 'Two merge semantics: cross-source concat vs same-source replace' },
      { name: 'Drop-in 目录 (systemd 模式)', nameEn: 'Drop-in directories (systemd pattern)' },
      { name: 'Zod 验证 + 静默降级', nameEn: 'Zod validation + silent degradation' },
      { name: '<code>CURRENT_MIGRATION_VERSION = 11</code>', nameEn: '<code>CURRENT_MIGRATION_VERSION = 11</code>' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '11', title: '配置治理', titleEn: 'Configuration Governance' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q12', title: '设置系统', titleEn: 'The Settings System' },
      { part: 'Part 4', partEn: 'Part 4', num: '09', title: '配置深潜', titleEn: 'Configuration Deep Dive' },
    ],
  },

  'extension-ecosystem': {
    title: '扩展生态 — MCP + Hooks',
    titleEn: 'Extension Ecosystem — MCP + Hooks',
    icon: '🔌',
    color: '#48bb78',
    osAnalogy: '设备驱动 + 内核模块',
    osAnalogyEn: 'Device drivers + kernel modules',
    cityAnalogy: '大使馆 + 收费站 — 大使馆对接外国服务，收费站在关键路口设卡',
    cityAnalogyEn: 'Embassies + tollbooths — embassies talk to foreign services, tollbooths gate critical intersections',
    metaphor: '神经系统——传递信号，连接外部世界',
    metaphorEn: 'Nervous system — passing signals, connecting to the outside world',
    cityMetaphor: '对外窗口——大使馆（MCP）对接外部服务，收费站（Hooks）在路口检查放行',
    cityMetaphorEn: 'Outbound interfaces — embassies (MCP) connect to foreign services, tollbooths (Hooks) inspect at checkpoints',
    whyMatters: '内置的 43 个工具不够用怎么办？扩展生态让你接入 Slack、GitHub、数据库等任何外部服务，同时 Hooks 让你在关键节点植入自己的控制逻辑。',
    whyMattersEn: 'What if 43 built-in tools are not enough? The extension ecosystem lets you plug into Slack, GitHub, databases — any external service — while Hooks let you inject your own logic at key checkpoints.',
    stats: [
      { val: '8', lbl: 'MCP 传输', lblEn: 'MCP transports' },
      { val: '27', lbl: 'Hook 事件', lblEn: 'Hook events' },
      { val: '3', lbl: '插件安全层', lblEn: 'Plugin security layers' },
      { val: '4', lbl: '扩展机制', lblEn: 'Extension mechanisms' },
    ],
    description: `四种扩展机制：<strong>MCP</strong>（8 种传输协议，"大使馆"式外交）、<strong>Hooks</strong>（27 种事件，exit code 2 = 阻止执行）、<strong>Plugins</strong>（白名单 + 正则 + homoglyph 三重安全）、<strong>Skills</strong>（whenToUse 语义匹配）。

Hook 系统的退出码双轨机制：exit 0 = 放行，exit 2 = 阻止并返回 stderr 作为反馈，其他 = 错误。这让 Hook 能像"高速公路收费站"一样——放行或拦截，并告诉司机为什么被拦。`,
    descriptionEn: `Four extension mechanisms: <strong>MCP</strong> (8 transport protocols, embassy-style outreach), <strong>Hooks</strong> (27 events, exit code 2 = block), <strong>Plugins</strong> (allowlist + regex + homoglyph triple security), <strong>Skills</strong> (whenToUse semantic matching).

The Hook system\u2019s dual-track exit codes: exit 0 = allow, exit 2 = block and return stderr as feedback, other = error. So a Hook acts like a highway tollbooth — allow or block, with a reason told to the driver.`,
    concepts: [
      { name: 'MCP 8 种传输：stdio, sse, streamable-http, docker...', nameEn: 'MCP\u2019s 8 transports: stdio, sse, streamable-http, docker, ...' },
      { name: 'Hook exit code 2 = 阻止执行', nameEn: 'Hook exit code 2 = block execution' },
      { name: '插件三重安全：白名单 + 正则 + homoglyph', nameEn: 'Plugin triple security: allowlist + regex + homoglyph' },
      { name: 'Skill <code>whenToUse</code> 语义匹配', nameEn: 'Skill <code>whenToUse</code> semantic matching' },
      { name: '<code>DANGEROUS_uncachedSystemPromptSection</code> — MCP 段', nameEn: '<code>DANGEROUS_uncachedSystemPromptSection</code> — the MCP section' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '09', title: '扩展生态', titleEn: 'The Extension Ecosystem' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q15', title: 'MCP 系统', titleEn: 'The MCP System' },
      { part: 'Part 4', partEn: 'Part 4', num: '07', title: 'MCP 深潜', titleEn: 'MCP Deep Dive' },
    ],
  },

  'boot-sequence': {
    title: '启动序列 — 从命令到就绪',
    titleEn: 'Boot Sequence — From Command to Ready',
    icon: '⚡',
    color: '#63b3ed',
    osAnalogy: 'BIOS → Bootloader → Kernel Init',
    osAnalogyEn: 'BIOS → Bootloader → Kernel Init',
    cityAnalogy: '城市清晨开门 — 先开电、再启动系统、最后打开服务窗口',
    cityAnalogyEn: 'A city opening for business at dawn — power on, boot systems, then open service counters',
    metaphor: '开机——在等待中抢跑，300ms 见到输入框',
    metaphorEn: 'Booting — racing during the waits, prompt visible in 300ms',
    cityMetaphor: '城市晨启——趁开灯的时候就开始烧水，300ms 窗口就开门迎客了',
    cityMetaphorEn: 'City dawn launch — start boiling water while the lights are still warming up; service counters open in 300ms',
    whyMatters: '从你敲下 claude 到看到输入框只要 300 毫秒。这不是天生就快——而是通过"在等电梯时就开始刷手机"式的并行优化，把感知延迟压到极限。',
    whyMattersEn: 'From the moment you type `claude` to seeing the prompt: ~300ms. It is not naturally fast — it is squeezed via "scroll your phone while waiting for the elevator" parallel optimizations.',
    stats: [
      { val: '~300ms', lbl: '到输入框', lblEn: 'To the prompt' },
      { val: '~135ms', lbl: '模块加载', lblEn: 'Module loading' },
      { val: '8', lbl: '运行模式', lblEn: 'Run modes' },
      { val: '7', lbl: '并行后台任务', lblEn: 'Parallel bg tasks' },
    ],
    description: `三阶段启动：<strong>Pre-import</strong>（在模块加载的 ~135ms 间隙里启动 MDM 读取和钥匙串预取）→ <strong>Init</strong>（按严格依赖顺序启动 10 个子系统）→ <strong>Ready</strong>（渲染 UI，后台延迟预取）。

关键优化：<code>preconnectAnthropicApi()</code> 在 init 阶段就建立 TCP+TLS 连接，这样第一次 API 调用不需要等握手。5 个 git 命令并行执行而非串行，把 git 状态获取时间从 ~500ms 压到 ~150ms。`,
    descriptionEn: `Three boot phases: <strong>Pre-import</strong> (during the ~135ms module-load window, kick off MDM read and keychain prefetch) → <strong>Init</strong> (start 10 subsystems in strict dependency order) → <strong>Ready</strong> (render UI, deferred background prefetch).

Key optimizations: <code>preconnectAnthropicApi()</code> establishes TCP+TLS during init so the first API call skips the handshake. Five git commands run in parallel instead of serially, compressing git-status capture from ~500ms to ~150ms.`,
    concepts: [
      { name: '<code>startMdmRawRead()</code> — 在 import 之前启动', nameEn: '<code>startMdmRawRead()</code> — kicked off before imports' },
      { name: '<code>startKeychainPrefetch()</code> — 并行双钥匙串读取', nameEn: '<code>startKeychainPrefetch()</code> — parallel dual-keychain read' },
      { name: '<code>preconnectAnthropicApi()</code> — TCP+TLS 预连接', nameEn: '<code>preconnectAnthropicApi()</code> — TCP+TLS pre-connect' },
      { name: '八种运行模式路由', nameEn: 'Eight run-mode routes' },
      { name: '<code>startDeferredPrefetches()</code> — 延迟预取', nameEn: '<code>startDeferredPrefetches()</code> — deferred prefetch' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '02', title: '启动序列', titleEn: 'The Startup Sequence' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q01', title: '启动优化', titleEn: 'Startup Optimization' },
    ],
  },

  'code-map': {
    title: '代码地图 — 1,884 文件全景',
    titleEn: 'Code Map — 1,884-File Panorama',
    icon: '🗺',
    color: '#a0aec0',
    osAnalogy: '文件系统布局 (/proc, /sys, /usr)',
    osAnalogyEn: 'Filesystem layout (/proc, /sys, /usr)',
    cityAnalogy: '城市规划图 — 五个功能区（商业区/工业区/居民区...）三条主干道',
    cityAnalogyEn: 'City zoning map — five districts (commercial/industrial/residential...) and three main arteries',
    metaphor: '城市地图——五个功能区，三条高速公路',
    metaphorEn: 'A city map — five districts, three highways',
    cityMetaphor: '城市规划图——心脏区、工业区、居住区、公共服务区、特殊区，三条主干道贯穿',
    cityMetaphorEn: 'City plan — heart district, industrial, residential, public services, special zone, with three arteries running through',
    whyMatters: '1,884 个文件不是一堆乱码——它们有清晰的区域划分和数据流向。理解地图才能理解架构。',
    whyMattersEn: '1,884 files are not random noise — they cluster into clear districts with directed dataflow. Understanding the map is the prerequisite to understanding the architecture.',
    stats: [
      { val: '1,884', lbl: 'TypeScript 文件', lblEn: 'TypeScript files' },
      { val: '5', lbl: '功能区域', lblEn: 'Functional districts' },
      { val: '3', lbl: '数据流高速公路', lblEn: 'Dataflow highways' },
      { val: '792', lbl: 'Tool.ts 行（辐射中心）', lblEn: 'Lines in Tool.ts (hub)' },
    ],
    description: `五大功能区：<strong>心脏区</strong>（QueryEngine/query.ts — 驱动一切的核心循环）、<strong>双手区</strong>（tools/ — 43 个工具的实现）、<strong>皮肤区</strong>（screens/hooks/components — React+Ink UI）、<strong>骨骼区</strong>（utils/services — 基础设施）、<strong>特殊区</strong>（coordinator/assistant/buddy — 专用子系统）。

三条数据流"高速公路"：用户输入 → QueryEngine → AI API（请求路径）、AI 回复 → 工具调用 → 结果反馈（执行路径）、状态变更 → 持久化 → UI 更新（状态路径）。<code>Tool.ts</code> 是依赖热力图的辐射中心——被最多文件依赖。`,
    descriptionEn: `Five districts: <strong>Heart</strong> (QueryEngine/query.ts — the core loop driving everything), <strong>Hands</strong> (tools/ — the 43 tool implementations), <strong>Skin</strong> (screens/hooks/components — the React+Ink UI), <strong>Bones</strong> (utils/services — infrastructure), <strong>Special</strong> (coordinator/assistant/buddy — specialized subsystems).

Three dataflow highways: user input → QueryEngine → AI API (request path); AI reply → tool calls → result feedback (execution path); state change → persistence → UI update (state path). <code>Tool.ts</code> is the hub of the dependency heatmap — depended on by more files than anything else.`,
    concepts: [
      { name: '五区域分类', nameEn: 'Five-district taxonomy' },
      { name: '三条数据流高速公路', nameEn: 'Three dataflow highways' },
      { name: '<code>Tool.ts</code> — 依赖辐射中心', nameEn: '<code>Tool.ts</code> — the dependency hub' },
      { name: 'src/ 目录拓扑结构', nameEn: 'src/ directory topology' },
      { name: '入口文件: <code>main.tsx</code>', nameEn: 'Entry file: <code>main.tsx</code>' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '01', title: '代码地图', titleEn: 'The Code Map' },
      { part: 'Part 1', partEn: 'Part 1', num: '02', title: '五分钟看懂架构', titleEn: 'System Architecture in Five Minutes' },
    ],
  },

  'terminal-ui': {
    title: '终端 UI — React + Ink',
    titleEn: 'Terminal UI — React + Ink',
    icon: '🖥',
    color: '#a0aec0',
    osAnalogy: '显示服务器 (Display Server)',
    osAnalogyEn: 'Display server',
    cityAnalogy: '市民服务窗口 — 你看到的一切：排队叫号、进度显示、审批弹窗',
    cityAnalogyEn: 'Citizen service counter — everything you see: queue numbers, progress displays, approval dialogs',
    metaphor: '皮肤——用户看到和触摸的一切',
    metaphorEn: 'Skin — everything the user sees and touches',
    cityMetaphor: '服务窗口——整洁的柜台、清晰的叫号屏、权限确认的弹窗，都在这里',
    cityMetaphorEn: 'Service counter — clean front desks, clear queue displays, permission-confirmation popups, all here',
    whyMatters: '这不是一个简单的文本终端——它是一个完整的 React 应用，用 389 个组件渲染出流畅的交互体验，包括权限弹窗、流式输出、甚至一只会说话的兔子。',
    whyMattersEn: 'This is not just a text terminal — it is a full React app rendering 389 components: permission popups, streaming output, even a talking rabbit.',
    stats: [
      { val: '389', lbl: '组件', lblEn: 'Components', explain: '覆盖权限弹窗、消息流、设置面板、差异对比、任务状态等——终端版的 React 应用', explainEn: 'Covering permission popups, message streams, settings panels, diff views, task status — a terminal-flavored React app.' },
      { val: '96', lbl: 'Ink 源文件', lblEn: 'Ink source files', explain: '完整 fork 了 Ink 框架，用纯 TypeScript 重写了 Yoga 布局引擎——不是简单调用，而是深度定制', explainEn: 'Ink framework completely forked; the Yoga layout engine rewritten in pure TypeScript — not a simple call, a deep customization.' },
      { val: '19,842', lbl: 'Ink 行数', lblEn: 'Ink lines of code', explain: 'ink/ 目录的总代码量——包含 reconciler、renderer、layout、bidi 文本、选择系统等终端渲染的全部底层', explainEn: 'Total LoC in ink/ — reconciler, renderer, layout, bidi text, selection system, and the rest of the terminal-rendering stack.' },
      { val: '60+', lbl: '键绑定', lblEn: 'Key bindings', explain: '快捷键覆盖 Vim 模式、导航、Escape 中断、Tab 补全等——终端体验的关键', explainEn: 'Shortcuts covering Vim mode, navigation, Escape-to-interrupt, Tab completion — the key to a strong terminal UX.' },
    ],
    description: `基于 <strong>React + 深度定制的 Ink fork</strong>，把终端当作 React 渲染目标。Ink 的 96 个源文件（19,842 行）实现了完整的 CSS Flexbox 布局、React reconciler、终端选择系统、双向文本支持——这不是简单的"打印文字"，而是一个<strong>终端里的浏览器渲染引擎</strong>。

Buddy 系统（那只兔子 Chiseler）用 <strong>Bones/Soul 分离</strong>架构——Bones 管外观和动画，Soul 管性格和对话生成。389 个组件覆盖从权限弹窗到流式渲染到 Vim 模式的一切。`,
    descriptionEn: `Built on <strong>React + a deeply customized Ink fork</strong>, the terminal becomes a React render target. The 96 source files (19,842 lines) inside ink/ implement full CSS Flexbox layout, a React reconciler, a terminal selection system, and bidirectional text support — this is not "println()", it is <strong>a browser rendering engine inside a terminal</strong>.

The Buddy system (Chiseler the rabbit) uses <strong>Bones/Soul separation</strong> — Bones controls appearance and animation, Soul controls personality and dialogue generation. The 389 components cover everything from permission popups to streaming render to Vim mode.`,
    concepts: [
      { name: 'Ink Fork — 纯 TS Yoga 布局', nameEn: 'Ink Fork — pure-TS Yoga layout', explain: '没有依赖 C++ 的 yoga-layout 库——用 TypeScript 重写了 CSS Flexbox 算法，让终端元素可以像网页一样用 flex、padding、margin 排列', explainEn: 'No C++ yoga-layout dependency — the CSS Flexbox algorithm rewritten in TypeScript so terminal elements can use flex, padding, margin like HTML.' },
      { name: 'Reconciler — 终端版 React DOM', nameEn: 'Reconciler — React DOM for terminals', explain: 'reconciler.ts 把 React 的虚拟 DOM 映射到终端"节点"——对比新旧树、最小化终端重绘，就像浏览器的 DOM diffing 一样', explainEn: 'reconciler.ts maps React\u2019s virtual DOM to terminal "nodes" — diffs old vs new trees, minimizes terminal repaints, just like browser DOM diffing.' },
      { name: 'Buddy Bones/Soul 分离', nameEn: 'Buddy: Bones/Soul separation', explain: 'Bones（骨骼）控制兔子的动画帧和位置，Soul（灵魂）控制它说什么——两者独立更新，Soul 用 AI 生成对话', explainEn: 'Bones drives the rabbit\u2019s animation frames and position; Soul drives what it says. Independent update loops; Soul uses AI to generate dialogue.' },
      { name: '权限弹窗 — 12,155 行', nameEn: 'Permission popups — 12,155 lines', explain: 'components/permissions/ 有 51 个文件——权限交互是整个 UI 中最复杂的部分，支持自动批准、记住选择、企业策略覆盖等', explainEn: 'components/permissions/ has 51 files — permission interaction is the most complex part of the UI: auto-approve, remember-choice, enterprise overrides, etc.' },
      { name: 'Selection & Hit-test', nameEn: 'Selection & hit-testing', explain: '在纯文本终端里实现了鼠标选择和点击检测——用字符坐标模拟图形界面的 hit-testing', explainEn: 'Mouse selection and click detection inside a pure-text terminal — character coordinates simulate graphical hit-testing.' },
    ],
    chapters: [
      { part: 'Part 2', partEn: 'Part 2', num: '12', title: '终端 UI', titleEn: 'The Terminal UI' },
      { part: 'Part 3', partEn: 'Part 3', num: 'Q15', title: '终端里的小动物', titleEn: 'Critters in the Terminal' },
      { part: 'Part 4', partEn: 'Part 4', num: '11', title: 'UI 深潜', titleEn: 'UI Deep Dive' },
    ],
  },
};

/**
 * Book structure for the Table of Contents.
 */
const BOOK_STRUCTURE = [
  {
    id: 'part0',
    title: 'Part 0 · 序章',
    titleEn: 'Part 0 · Prologue',
    chapters: [
      { id: 'p0-00', file: 'part0_序章/00_序章.md', title: '序章：当你打开一个"聊天助手"的引擎盖', titleEn: 'Prologue: Popping the Hood on a "Chat Assistant"' },
    ],
  },
  {
    id: 'part1',
    title: 'Part 1 · 认识这个系统',
    titleEn: 'Part 1 · Understanding the System',
    chapters: [
      { id: 'p1-01', file: 'part1_认识这个系统/01_这不是聊天机器人.md', title: '01 这不是聊天机器人', titleEn: '01 · This Is Not a Chatbot' },
      { id: 'p1-02', file: 'part1_认识这个系统/02_五分钟看懂系统架构.md', title: '02 五分钟看懂系统架构', titleEn: '02 · System Architecture in Five Minutes' },
      { id: 'p1-03', file: 'part1_认识这个系统/03_读懂本书需要的全部概念.md', title: '03 读懂本书需要的全部概念', titleEn: "03 · The Concepts You'll Need First" },
      { id: 'p1-04', file: 'part1_认识这个系统/04_八个子系统的全景地图.md', title: '04 八个子系统的全景地图', titleEn: '04 · The Eight Subsystems at a Glance' },
    ],
  },
  {
    id: 'part2',
    title: 'Part 2 · 代码架构完全解构',
    titleEn: 'Part 2 · Architecture Deep Dive',
    chapters: [
      { id: 'p2-01', file: 'part2_代码架构完全解构/01_代码地图.md', title: '01 代码地图', titleEn: '01 · The Code Map' },
      { id: 'p2-02', file: 'part2_代码架构完全解构/02_启动序列.md', title: '02 启动序列', titleEn: '02 · The Startup Sequence' },
      { id: 'p2-03', file: 'part2_代码架构完全解构/03_提示词工厂.md', title: '03 提示词工厂', titleEn: '03 · The Prompt Factory' },
      { id: 'p2-04', file: 'part2_代码架构完全解构/04_查询循环.md', title: '04 查询循环', titleEn: '04 · The Query Loop' },
      { id: 'p2-05', file: 'part2_代码架构完全解构/05_工具运行时.md', title: '05 工具运行时', titleEn: '05 · The Tool Runtime' },
      { id: 'p2-06', file: 'part2_代码架构完全解构/06_Agent编排.md', title: '06 Agent 编排', titleEn: '06 · Agent Orchestration' },
      { id: 'p2-07', file: 'part2_代码架构完全解构/07_安全架构.md', title: '07 安全架构', titleEn: '07 · Security Architecture' },
      { id: 'p2-08', file: 'part2_代码架构完全解构/08_状态与持久化.md', title: '08 状态与持久化', titleEn: '08 · State and Persistence' },
      { id: 'p2-09', file: 'part2_代码架构完全解构/09_扩展生态.md', title: '09 扩展生态', titleEn: '09 · The Extension Ecosystem' },
      { id: 'p2-10', file: 'part2_代码架构完全解构/10_Token经济学.md', title: '10 Token 经济学', titleEn: '10 · Token Economics' },
      { id: 'p2-11', file: 'part2_代码架构完全解构/11_配置治理.md', title: '11 配置治理', titleEn: '11 · Configuration Governance' },
      { id: 'p2-12', file: 'part2_代码架构完全解构/12_终端UI.md', title: '12 终端 UI', titleEn: '12 · The Terminal UI' },
      { id: 'p2-13', file: 'part2_代码架构完全解构/13_横切关注点.md', title: '13 横切关注点', titleEn: '13 · Cross-Cutting Concerns' },
      { id: 'p2-14', file: 'part2_代码架构完全解构/14_Prompt原文集.md', title: '14 Prompt 原文集', titleEn: '14 · The Complete Prompt Corpus' },
    ],
  },
  {
    id: 'part4',
    title: 'Part 3 · 子系统完全解析',
    titleEn: 'Part 3 · Subsystems',
    chapters: [
      { id: 'p4-01', file: 'part3_子系统完全解析/01_权限系统完全解析.md', title: '01 权限系统完全解析', titleEn: '01 · The Permission System', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-02', file: 'part3_子系统完全解析/02_投机执行子系统完全解析.md', title: '02 投机执行子系统完全解析', titleEn: '02 · The Speculative Execution Subsystem', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-03', file: 'part3_子系统完全解析/03_MCP平台完全解析.md', title: '03 MCP 平台完全解析', titleEn: '03 · The MCP Platform', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-04', file: 'part3_子系统完全解析/04_Hooks子系统完全解析.md', title: '04 Hooks 子系统完全解析', titleEn: '04 · The Hooks Subsystem', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-05', file: 'part3_子系统完全解析/05_插件系统完全解析.md', title: '05 插件系统完全解析', titleEn: '05 · The Plugin System', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-06', file: 'part3_子系统完全解析/06_CLAUDE_md加载系统完全解析.md', title: '06 CLAUDE.md 加载系统完全解析', titleEn: '06 · The CLAUDE.md Loading System', group: '配置与加载', groupEn: 'Configuration & Loading' },
      { id: 'p4-07', file: 'part3_子系统完全解析/07_Sandbox沙箱系统完全解析.md', title: '07 Sandbox 沙箱系统完全解析', titleEn: '07 · The Sandbox System', group: '配置与加载', groupEn: 'Configuration & Loading' },
      { id: 'p4-08', file: 'part3_子系统完全解析/08_遥测与可观测性完全解析.md', title: '08 遥测与可观测性完全解析', titleEn: '08 · Telemetry and Observability', group: '配置与加载', groupEn: 'Configuration & Loading' },
      { id: 'p4-09', file: 'part3_子系统完全解析/09_设置系统完全解析.md', title: '09 设置系统完全解析', titleEn: '09 · The Settings System', group: '配置与加载', groupEn: 'Configuration & Loading' },
      { id: 'p4-10', file: 'part3_子系统完全解析/10_Agent与任务系统完全解析.md', title: '10 Agent 与任务系统完全解析', titleEn: '10 · The Agent and Task System', group: '调度与执行', groupEn: 'Scheduling & Execution' },
      { id: 'p4-11', file: 'part3_子系统完全解析/11_文件历史系统完全解析.md', title: '11 文件历史系统完全解析', titleEn: '11 · The File History System', group: '调度与执行', groupEn: 'Scheduling & Execution' },
      { id: 'p4-12', file: 'part3_子系统完全解析/Vim模式完全解析.md', title: '12 Vim 模式完全解析', titleEn: '12 · Vim Mode', group: '交互与 UI', groupEn: 'Interaction & UI' },
      { id: 'p4-13', file: 'part3_子系统完全解析/键绑定系统完全解析.md', title: '13 键绑定系统完全解析', titleEn: '13 · The Keybinding System', group: '交互与 UI', groupEn: 'Interaction & UI' },
      { id: 'p4-14', file: 'part3_子系统完全解析/任务执行管道完全解析.md', title: '14 任务执行管道完全解析', titleEn: '14 · The Task Execution Pipeline', group: '调度与执行', groupEn: 'Scheduling & Execution' },
      { id: 'p4-15', file: 'part3_子系统完全解析/协调器模式完全解析.md', title: '15 协调器模式完全解析', titleEn: '15 · The Coordinator Pattern', group: '调度与执行', groupEn: 'Scheduling & Execution' },
      { id: 'p4-16', file: 'part3_子系统完全解析/远程Agent管理完全解析.md', title: '16 远程 Agent 管理完全解析', titleEn: '16 · Remote Agent Management', group: '远程与通信', groupEn: 'Remote & Communication' },
      { id: 'p4-17', file: 'part3_子系统完全解析/记忆系统完全解析.md', title: '17 记忆系统完全解析', titleEn: '17 · The Memory System', group: '调度与执行', groupEn: 'Scheduling & Execution' },
      { id: 'p4-18', file: 'part3_子系统完全解析/12_Bridge远程架构完全解析.md', title: '18 Bridge 远程架构完全解析', titleEn: '18 · The Bridge Remote Architecture', group: '远程与通信', groupEn: 'Remote & Communication' },
      { id: 'p4-19', file: 'part3_子系统完全解析/13_Buddy伴侣系统完全解析.md', title: '19 Buddy 伴侣系统完全解析', titleEn: '19 · The Buddy System (Pair-Programming Companion)', group: '远程与通信', groupEn: 'Remote & Communication' },
      { id: 'p4-20', file: 'part3_子系统完全解析/14_语音系统完全解析.md', title: '20 语音系统完全解析', titleEn: '20 · The Voice System', group: '交互与 UI', groupEn: 'Interaction & UI' },
      { id: 'p4-21', file: 'part3_子系统完全解析/15_Skill加载基础设施完全解析.md', title: '21 Skill 加载基础设施完全解析', titleEn: '21 · Skill Loading Infrastructure', group: '交互与 UI', groupEn: 'Interaction & UI' },
      { id: 'p4-22', file: 'part3_子系统完全解析/16_输出样式系统完全解析.md', title: '22 输出样式系统完全解析', titleEn: '22 · The Output Style System', group: '交互与 UI', groupEn: 'Interaction & UI' },
      { id: 'p4-23', file: 'part3_子系统完全解析/17_遥测与分析系统完全解析.md', title: '23 遥测与分析系统完全解析', titleEn: '23 · The Telemetry and Analytics System', group: '监控与优化', groupEn: 'Monitoring & Optimization' },
      { id: 'p4-24', file: 'part3_子系统完全解析/18_Bash_AST解析器完全解析.md', title: '24 Bash AST 解析器完全解析', titleEn: '24 · The Bash AST Parser', group: '安全与治理', groupEn: 'Security & Governance' },
      { id: 'p4-25', file: 'part3_子系统完全解析/19_Cron调度系统完全解析.md', title: '25 Cron 调度系统完全解析', titleEn: '25 · The Cron Scheduling System', group: '监控与优化', groupEn: 'Monitoring & Optimization' },
      { id: 'p4-26', file: 'part3_子系统完全解析/20_团队记忆同步完全解析.md', title: '26 团队记忆同步完全解析', titleEn: '26 · Team Memory Synchronization', group: '监控与优化', groupEn: 'Monitoring & Optimization' },
      { id: 'p4-27', file: 'part3_子系统完全解析/21_FastMode与UltraPlan完全解析.md', title: '27 Fast Mode 与 UltraPlan 完全解析', titleEn: '27 · Fast Mode and UltraPlan', group: '监控与优化', groupEn: 'Monitoring & Optimization' },
      { id: 'p4-28', file: 'part3_子系统完全解析/22_PromptCache可观测性完全解析.md', title: '28 Prompt Cache 可观测性完全解析', titleEn: '28 · Prompt Cache Observability', group: '监控与优化', groupEn: 'Monitoring & Optimization' },
      { id: 'p4-29', file: 'part3_子系统完全解析/23_Peer与Session发现层完全解析.md', title: '29 Peer 与 Session 发现层完全解析', titleEn: '29 · The Peer and Session Discovery Layer', group: '远程与通信', groupEn: 'Remote & Communication' },
      { id: 'p4-30', file: 'part3_子系统完全解析/24_Assistant等于Viewer完全解析.md', title: '30 Assistant = Viewer：远端会话的本地观察模式', titleEn: '30 · Assistant = Viewer: Local Observation of Remote Sessions', group: '远程与通信', groupEn: 'Remote & Communication' },
      { id: 'p4-31', file: 'part3_子系统完全解析/25_Brief通信家族与Viewer结构化通道完全解析.md', title: '31 Brief 通信家族与 Viewer 结构化通道完全解析', titleEn: '31 · The Brief Communication Family and Viewer Structured Channels', group: '远程与通信', groupEn: 'Remote & Communication' },
    ],
  },
  {
    id: 'part5',
    title: 'Part 4 · 工程哲学',
    titleEn: 'Part 4 · Engineering Philosophy',
    chapters: [
      { id: 'p5-01', file: 'part4_工程哲学/01_在等待时间里藏工作.md', title: '01 在等待时间里藏工作', titleEn: '01 · Hiding Work Inside Waiting Time' },
      { id: 'p5-02', file: 'part4_工程哲学/02_token是一等公民.md', title: '02 Token 是一等公民', titleEn: '02 · Tokens Are First-Class Citizens' },
      { id: 'p5-03', file: 'part4_工程哲学/03_把AI当乐高积木.md', title: '03 把 AI 当乐高积木', titleEn: '03 · AI as Lego Blocks' },
      { id: 'p5-04', file: 'part4_工程哲学/04_多层防线不是偏执是必要.md', title: '04 多层防线不是偏执是必要', titleEn: "04 · Defense in Depth Isn't Paranoia — It's Necessary" },
      { id: 'p5-05', file: 'part4_工程哲学/05_可观测性是产品功能不是运维工具.md', title: '05 可观测性是产品功能不是运维工具', titleEn: '05 · Observability Is a Product Feature, Not an Ops Tool' },
      { id: 'p5-06', file: 'part4_工程哲学/06_Prompt的八大设计智慧.md', title: '06 Prompt 的八大设计智慧', titleEn: '06 · Eight Principles for Writing Prompts' },
    ],
  },
  {
    id: 'part6',
    title: 'Part 5 · 批判与超越',
    titleEn: 'Part 5 · Critique & Beyond',
    chapters: [
      { id: 'p6-01', file: 'part5_批判与超越/01_这个系统的代价.md', title: '01 这个系统的代价', titleEn: '01 · The Cost of This System' },
      { id: 'p6-02', file: 'part5_批判与超越/02_如果我来重新设计.md', title: '02 如果我来重新设计', titleEn: '02 · If I Were to Redesign It' },
      { id: 'p6-03', file: 'part5_批判与超越/03_把这些思想用在你的项目里.md', title: '03 把这些思想用在你的项目里', titleEn: '03 · Applying These Ideas to Your Own Project' },
    ],
  },
  {
    id: 'part3',
    title: 'Part 6 · 好奇心驱动的深度问答',
    titleEn: 'Part 6 · Deep Q&A',
    chapters: [
      { id: 'p3-Q01', file: 'part2_好奇心驱动的深度问答/Q01_那三行在import之前的代码是什么把戏.md', title: 'Q01 那三行在 import 之前的代码是什么把戏', titleEn: 'Q01 · What Trick Are Those Three Lines Before import Pulling?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q02', file: 'part2_好奇心驱动的深度问答/Q02_上下文压缩为什么需要六套机制.md', title: 'Q02 上下文压缩为什么需要六套机制', titleEn: 'Q02 · Why Does Context Compression Need Six Mechanisms?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q03', file: 'part2_好奇心驱动的深度问答/Q03_子Agent是怎么被创建和管理的.md', title: 'Q03 子 Agent 是怎么被创建和管理的', titleEn: 'Q03 · How Are Sub-Agents Created and Managed?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q04', file: 'part2_好奇心驱动的深度问答/Q04_工具为什么能在模型还没停止说话时就开始执行.md', title: 'Q04 工具为什么能在模型还没停止说话时就开始执行', titleEn: 'Q04 · Why Can Tools Start Executing Before the Model Stops Talking?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q05', file: 'part2_好奇心驱动的深度问答/Q05_权限系统是怎么在灵活性和安全性之间走钢丝的.md', title: 'Q05 权限系统是怎么在灵活性和安全性之间走钢丝的', titleEn: 'Q05 · How Does the Permission System Walk the Tightrope Between Flexibility and Safety?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q06', file: 'part2_好奇心驱动的深度问答/Q06_Claude在你打字的时候偷偷在做什么.md', title: 'Q06 Claude 在你打字的时候偷偷在做什么', titleEn: 'Q06 · What Is Claude Secretly Doing While You Type?', group: '核心引擎', groupEn: 'Core Engine' },
      { id: 'p3-Q07', file: 'part2_好奇心驱动的深度问答/Q07_CLAUDE_md是怎么被找到和组装的.md', title: 'Q07 CLAUDE.md 是怎么被找到和组装的', titleEn: 'Q07 · How Is CLAUDE.md Discovered and Assembled?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q08', file: 'part2_好奇心驱动的深度问答/Q08_设置系统为什么需要五层优先级.md', title: 'Q08 设置系统为什么需要五层优先级', titleEn: 'Q08 · Why Does the Settings System Need Five Priority Layers?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q09', file: 'part2_好奇心驱动的深度问答/Q09_Session里那个默默记笔记的AI是谁.md', title: 'Q09 Session 里那个默默记笔记的 AI 是谁', titleEn: 'Q09 · Who Is the AI Quietly Taking Notes in Your Session?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q10', file: 'part2_好奇心驱动的深度问答/Q10_用户能在Claude的生命周期里插多少个钩子.md', title: 'Q10 用户能在 Claude 的生命周期里插多少个钩子', titleEn: "Q10 · How Many Hooks Can a User Insert into Claude's Lifecycle?", group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q11', file: 'part2_好奇心驱动的深度问答/Q11_对话也可以像代码一样分支和回滚吗.md', title: 'Q11 对话也可以像代码一样分支和回滚吗', titleEn: 'Q11 · Can Conversations Branch and Roll Back Like Code?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q12', file: 'part2_好奇心驱动的深度问答/Q12_插件系统是怎么防止你被恶意扩展攻击的.md', title: 'Q12 插件系统是怎么防止你被恶意扩展攻击的', titleEn: 'Q12 · How Does the Plugin System Guard You Against Malicious Extensions?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q13', file: 'part2_好奇心驱动的深度问答/Q13_Skills和斜杠命令有什么本质区别.md', title: 'Q13 Skills 和斜杠命令有什么本质区别', titleEn: 'Q13 · What Is the Essential Difference Between Skills and Slash Commands?', group: '配置与扩展', groupEn: 'Configuration & Extension' },
      { id: 'p3-Q14', file: 'part2_好奇心驱动的深度问答/Q14_多个Claude实例是怎么协同工作的.md', title: 'Q14 多个 Claude 实例是怎么协同工作的', titleEn: 'Q14 · How Do Multiple Claude Instances Collaborate?', group: '协作与远程', groupEn: 'Collaboration & Remote' },
      { id: 'p3-Q15', file: 'part2_好奇心驱动的深度问答/Q15_终端里那只小动物是怎么活起来的.md', title: 'Q15 终端里那只小动物是怎么活起来的', titleEn: 'Q15 · How Does That Little Creature in the Terminal Come to Life?', group: '协作与远程', groupEn: 'Collaboration & Remote' },
      { id: 'p3-Q16', file: 'part2_好奇心驱动的深度问答/Q16_如何从浏览器远程驾驶你的终端AI.md', title: 'Q16 如何从浏览器远程驾驶你的终端 AI', titleEn: 'Q16 · How to Remotely Drive Your Terminal AI from a Browser', group: '协作与远程', groupEn: 'Collaboration & Remote' },
      { id: 'p3-Q17', file: 'part2_好奇心驱动的深度问答/Q17_你的声音是怎么变成代码指令的.md', title: 'Q17 你的声音是怎么变成代码指令的', titleEn: 'Q17 · How Does Your Voice Become Code Instructions?', group: '协作与远程', groupEn: 'Collaboration & Remote' },
      { id: 'p3-Q18', file: 'part2_好奇心驱动的深度问答/Q18_AI的记忆是怎么跨越对话存活的.md', title: 'Q18 AI 的记忆是怎么跨越对话存活的', titleEn: 'Q18 · How Does AI Memory Survive Across Conversations?', group: '协作与远程', groupEn: 'Collaboration & Remote' },
      { id: 'p3-Q19', file: 'part2_好奇心驱动的深度问答/Q19_Claude是怎么决定该想多深的.md', title: 'Q19 Claude 是怎么决定该想多深的', titleEn: 'Q19 · How Does Claude Decide How Deeply to Think?', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q20', file: 'part2_好奇心驱动的深度问答/Q20_这个工具到底藏了多少命令.md', title: 'Q20 这个工具到底藏了多少命令', titleEn: 'Q20 · How Many Commands Does This Tool Actually Hide?', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q21', file: 'part2_好奇心驱动的深度问答/Q21_MagicDocs是怎么自动维护文档的.md', title: 'Q21 MagicDocs 是怎么自动维护文档的', titleEn: 'Q21 · How Does MagicDocs Maintain Documentation Automatically?', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q22', file: 'part2_好奇心驱动的深度问答/Q22_Computer_Use是怎么让AI操控你的屏幕的.md', title: 'Q22 Computer Use 是怎么让 AI 操控屏幕的', titleEn: 'Q22 · How Does Computer Use Let AI Operate Your Screen?', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q23', file: 'part2_好奇心驱动的深度问答/Q23_Deep_Link和Teleport是怎么跨设备连接的.md', title: 'Q23 Deep Link 和 Teleport 跨设备连接', titleEn: 'Q23 · How Deep Link and Teleport Connect Across Devices', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q24', file: 'part2_好奇心驱动的深度问答/Q24_用户输入是怎么一步步变成AI请求的.md', title: 'Q24 用户输入到 AI 请求的完整链路', titleEn: 'Q24 · The Full Path from User Input to AI Request', group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q25', file: 'part2_好奇心驱动的深度问答/Q25_BashTool的安全防线是怎么工作的.md', title: 'Q25 BashTool 的安全防线', titleEn: "Q25 · BashTool's Lines of Defense", group: '优化与安全', groupEn: 'Optimization & Safety' },
      { id: 'p3-Q26', file: 'part2_好奇心驱动的深度问答/Q26_为什么Claude_Code能像Agent一样工作.md', title: 'Q26 为什么 Claude Code 能像 Agent 一样工作', titleEn: 'Q26 · Why Claude Code Can Work Like an Agent', group: 'Agent 本质', groupEn: 'The Nature of Agents' },
      { id: 'p3-Q27', file: 'part2_好奇心驱动的深度问答/Q27_为什么Agent工作台必须有权限压缩和恢复.md', title: 'Q27 为什么 Agent 工作台必须有权限、压缩和恢复', titleEn: 'Q27 · Why an Agent Workbench Must Have Permissions, Compression, and Recovery', group: 'Agent 本质', groupEn: 'The Nature of Agents' },
    ],
  },
  {
    id: 'part7',
    title: 'Part 7 · 补遗与延伸',
    titleEn: 'Part 7 · Addenda & Extensions',
    chapters: [
      { id: 'p7-01', file: 'part5_supplementary/83_Harness_Engineering.md', title: '01 Harness Engineering：从 Claude Code 看 Agent 工程化范式', titleEn: '01 · Harness Engineering: Agent Engineering Paradigms Seen Through Claude Code' },
      { id: 'p7-99', file: 'references.md', title: '引用与致谢', titleEn: 'References & Acknowledgments' },
    ],
  },
];

// Node.js 兼容性导出（消除 build-search-index.js 双写源 — 详见 #135）
// 浏览器端通过 <script> 全局作用域读取，typeof module 为 'undefined' 时跳过
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COMPONENTS, BOOK_STRUCTURE };
}
