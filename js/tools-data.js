/**
 * Claude Code Tool & Command Catalog
 * Extracted from source: cc-recovered-main/src/tools/ and src/commands/
 * Source version: Claude Code 2.1.88 (community-released / recovered from source map)
 * Generated: 2026-04-03
 *
 * gated = true  means the tool requires a feature flag, GrowthBook gate,
 *                or runtime condition (e.g. isAgentSwarmsEnabled) to appear.
 * gated = false means the tool ships enabled by default in production builds.
 */

const TOOL_CATALOG = [
  // ─────────────────────────── File Operations ───────────────────────────
  {
    category: '文件操作',
    categoryEn: 'File Operations',
    color: '#6BA368',
    tools: [
      {
        name: 'Read',
        desc: '读取本地文件系统中的文件，支持图片/PDF/Notebook，带行号输出',
        descEn: 'Reads local files with line numbers; supports images, PDFs, and notebooks',
        gated: false,
        lines: 1183,
        file: 'FileReadTool/FileReadTool.ts'
      },
      {
        name: 'Edit',
        desc: '对文件执行精确字符串替换（old_string -> new_string），支持 replace_all',
        descEn: 'Performs exact string replacements in files (old_string -> new_string) with optional replace_all',
        gated: false,
        lines: 625,
        file: 'FileEditTool/FileEditTool.ts'
      },
      {
        name: 'Write',
        desc: '将内容写入本地文件系统（创建新文件或完整重写）',
        descEn: 'Writes content to the local filesystem, creating new files or fully overwriting existing ones',
        gated: false,
        lines: 434,
        file: 'FileWriteTool/FileWriteTool.ts'
      },
      {
        name: 'NotebookEdit',
        desc: '编辑 Jupyter Notebook (.ipynb) 的指定单元格，支持替换/插入/删除',
        descEn: 'Edits cells in Jupyter notebooks (.ipynb); supports replace, insert, and delete operations',
        gated: false,
        lines: 490,
        file: 'NotebookEditTool/NotebookEditTool.ts'
      },
    ]
  },

  // ─────────────────────────── Execution ───────────────────────────
  {
    category: '命令执行',
    categoryEn: 'Execution',
    color: '#E8A838',
    tools: [
      {
        name: 'Bash',
        desc: '在 bash shell 中执行命令，支持超时、后台运行和沙箱隔离',
        descEn: 'Runs commands in a bash shell with timeout, background execution, and sandbox isolation',
        gated: false,
        lines: 1143,
        file: 'BashTool/BashTool.tsx'
      },
      {
        name: 'PowerShell',
        desc: 'Windows 平台的 PowerShell 命令执行器，与 Bash 工具互斥',
        descEn: 'PowerShell command executor for Windows; mutually exclusive with the Bash tool',
        gated: false,
        lines: 1000,
        file: 'PowerShellTool/PowerShellTool.tsx',
        note: 'Windows only; isEnabled() always true but platform-guarded'
      },
    ]
  },

  // ─────────────────────────── Search & Fetch ───────────────────────────
  {
    category: '搜索与获取',
    categoryEn: 'Search & Fetch',
    color: '#5B8DEF',
    tools: [
      {
        name: 'Glob',
        desc: '基于 glob 模式的快速文件名匹配搜索，按修改时间排序返回',
        descEn: 'Fast filename matching with glob patterns; results sorted by modification time',
        gated: false,
        lines: 198,
        file: 'GlobTool/GlobTool.ts'
      },
      {
        name: 'Grep',
        desc: '基于 ripgrep 的文件内容正则搜索，支持上下文行、类型过滤和多种输出模式',
        descEn: 'Regex content search powered by ripgrep; supports context lines, type filters, and multiple output modes',
        gated: false,
        lines: 577,
        file: 'GrepTool/GrepTool.ts'
      },
      {
        name: 'WebFetch',
        desc: '获取指定 URL 内容并转为 Markdown，用小模型按 prompt 提取信息',
        descEn: 'Fetches a URL, converts it to Markdown, and extracts information with a small model driven by your prompt',
        gated: false,
        lines: 318,
        file: 'WebFetchTool/WebFetchTool.ts'
      },
      {
        name: 'WebSearch',
        desc: '调用 Anthropic 内置 Web 搜索 API 获取实时网络搜索结果',
        descEn: 'Calls the Anthropic built-in web search API for real-time search results',
        gated: false,
        lines: 435,
        file: 'WebSearchTool/WebSearchTool.ts',
        note: 'Enabled for firstParty and Vertex (Claude 4.0+)'
      },
      {
        name: 'LSP',
        desc: '通过 Language Server Protocol 获取代码智能：跳转定义、查找引用、悬停信息、符号列表',
        descEn: 'Queries Language Server Protocol for code intelligence: go-to-definition, find references, hover info, and symbol lists',
        gated: false,
        lines: 860,
        file: 'LSPTool/LSPTool.ts',
        note: 'shouldDefer: true; isEnabled() requires LSP server connected'
      },
      {
        name: 'ToolSearch',
        desc: '搜索和加载被延迟加载 (deferred) 的工具定义，支持关键词和 select: 精确匹配',
        descEn: 'Searches and loads deferred tool definitions; supports keyword queries and exact select: matching',
        gated: false,
        lines: 471,
        file: 'ToolSearchTool/ToolSearchTool.ts'
      },
    ]
  },

  // ─────────────────────────── Agents & Tasks ───────────────────────────
  {
    category: '代理与任务',
    categoryEn: 'Agents & Tasks',
    color: '#B07CD8',
    tools: [
      {
        name: 'Agent',
        desc: '创建子代理执行复杂子任务，支持后台运行、远程执行、worktree 隔离和 fork 模式',
        descEn: 'Spawns subagents for complex subtasks; supports background execution, remote runs, worktree isolation, and fork mode',
        gated: false,
        lines: 1397,
        file: 'AgentTool/AgentTool.tsx',
        note: 'Legacy name: Task. Feature flags: KAIROS, COORDINATOR_MODE, PROACTIVE add extra capabilities'
      },
      {
        name: 'Skill',
        desc: '在主对话中执行 slash command / skill（插件、内置技能、远程技能搜索）',
        descEn: 'Executes a slash command or skill inline in the main conversation, covering plugins, built-in skills, and remote skill search',
        gated: false,
        lines: 1108,
        file: 'SkillTool/SkillTool.ts',
        note: 'feature(EXPERIMENTAL_SKILL_SEARCH) gates remote skill marketplace search'
      },
      {
        name: 'TaskCreate',
        desc: '在 v2 任务列表中创建新任务，支持元数据和状态跟踪',
        descEn: 'Creates a new task in the v2 task list with metadata and status tracking',
        gated: true,
        lines: 138,
        file: 'TaskCreateTool/TaskCreateTool.ts',
        note: 'Gated by isTodoV2Enabled()'
      },
      {
        name: 'TaskGet',
        desc: '按 ID 检索任务的详细信息（状态、描述、阻塞关系）',
        descEn: 'Retrieves a task by ID, including status, description, and blocking relationships',
        gated: true,
        lines: 128,
        file: 'TaskGetTool/TaskGetTool.ts',
        note: 'Gated by isTodoV2Enabled()'
      },
      {
        name: 'TaskList',
        desc: '列出当前会话中所有任务及其状态',
        descEn: 'Lists every task in the current session along with its status',
        gated: true,
        lines: 116,
        file: 'TaskListTool/TaskListTool.ts',
        note: 'Gated by isTodoV2Enabled()'
      },
      {
        name: 'TaskUpdate',
        desc: '更新任务的状态、描述、所有者和阻塞关系',
        descEn: 'Updates a task\'s status, description, owner, and blocking relationships',
        gated: true,
        lines: 406,
        file: 'TaskUpdateTool/TaskUpdateTool.ts',
        note: 'Gated by isTodoV2Enabled()'
      },
      {
        name: 'TaskOutput',
        desc: '获取后台任务（Agent/Shell）的输出，支持阻塞等待和超时',
        descEn: 'Fetches output from background tasks (Agent or Shell) with optional blocking wait and timeout',
        gated: false,
        lines: 583,
        file: 'TaskOutputTool/TaskOutputTool.tsx'
      },
      {
        name: 'TaskStop',
        desc: '终止一个正在运行的后台任务（Agent 或 Shell 进程）',
        descEn: 'Terminates a running background task (Agent or Shell process)',
        gated: false,
        lines: 131,
        file: 'TaskStopTool/TaskStopTool.ts',
        note: 'Aliases: KillShell (deprecated)'
      },
      {
        name: 'TodoWrite',
        desc: '管理会话级 TODO 清单（v1 版本），跟踪多步骤任务进度',
        descEn: 'Manages the session-level TODO list (v1) to track progress on multi-step tasks',
        gated: false,
        lines: 115,
        file: 'TodoWriteTool/TodoWriteTool.ts',
        note: 'Disabled when isTodoV2Enabled(); being replaced by TaskCreate/Update'
      },
    ]
  },

  // ─────────────────────────── Multi-Agent / Swarm ───────────────────────────
  {
    category: '多代理协作',
    categoryEn: 'Multi-Agent / Swarm',
    color: '#E86850',
    tools: [
      {
        name: 'SendMessage',
        desc: '向团队中其他代理发送消息（支持关闭请求、计划审批等结构化消息）',
        descEn: 'Sends messages to other agents on the team, including structured messages such as shutdown requests and plan approvals',
        gated: true,
        lines: 917,
        file: 'SendMessageTool/SendMessageTool.ts',
        note: 'Gated by isAgentSwarmsEnabled(); feature(UDS_INBOX) adds cross-session messaging'
      },
      {
        name: 'TeamCreate',
        desc: '创建新的代理群（swarm team），初始化团队文件和任务目录',
        descEn: 'Creates a new swarm team and initializes its files and task directory',
        gated: true,
        lines: 240,
        file: 'TeamCreateTool/TeamCreateTool.ts',
        note: 'Gated by isAgentSwarmsEnabled()'
      },
      {
        name: 'TeamDelete',
        desc: '解散代理群并清理团队目录和任务状态',
        descEn: 'Disbands an agent swarm and cleans up its directory and task state',
        gated: true,
        lines: 139,
        file: 'TeamDeleteTool/TeamDeleteTool.ts',
        note: 'Gated by isAgentSwarmsEnabled()'
      },
    ]
  },

  // ─────────────────────────── Planning ───────────────────────────
  {
    category: '规划模式',
    categoryEn: 'Planning',
    color: '#2EC4B6',
    tools: [
      {
        name: 'EnterPlanMode',
        desc: '请求进入规划模式，用于复杂任务的方案设计阶段',
        descEn: 'Requests entry into plan mode for the design phase of complex tasks',
        gated: false,
        lines: 126,
        file: 'EnterPlanModeTool/EnterPlanModeTool.ts',
        note: 'feature(KAIROS/KAIROS_CHANNELS) + plan interview phase gate additional behavior'
      },
      {
        name: 'ExitPlanMode',
        desc: '退出规划模式，提交计划并可选切换到自动执行模式',
        descEn: 'Exits plan mode, submits the plan, and optionally transitions into auto-execution mode',
        gated: false,
        lines: 493,
        file: 'ExitPlanModeTool/ExitPlanModeV2Tool.ts',
        note: 'V2 version; feature(TRANSCRIPT_CLASSIFIER) gates auto-mode transitions'
      },
      {
        name: 'EnterWorktree',
        desc: '创建 Git worktree 隔离环境，让代理在独立分支上工作',
        descEn: 'Creates an isolated Git worktree so the agent can work on a separate branch',
        gated: false,
        lines: 127,
        file: 'EnterWorktreeTool/EnterWorktreeTool.ts'
      },
      {
        name: 'ExitWorktree',
        desc: '退出 Git worktree 隔离环境，可选保留或删除 worktree',
        descEn: 'Exits the Git worktree environment, optionally keeping or deleting the worktree',
        gated: false,
        lines: 329,
        file: 'ExitWorktreeTool/ExitWorktreeTool.ts'
      },
    ]
  },

  // ─────────────────────────── MCP ───────────────────────────
  {
    category: 'MCP 集成',
    categoryEn: 'MCP (Model Context Protocol)',
    color: '#FF6B6B',
    tools: [
      {
        name: 'MCPTool',
        desc: 'MCP 工具的通用执行框架，实际工具名和 schema 由 MCP 服务端动态提供',
        descEn: 'Generic execution framework for MCP tools; the real name and schema are supplied dynamically by the MCP server',
        gated: false,
        lines: 77,
        file: 'MCPTool/MCPTool.ts',
        note: 'Base template; real name/schema/call overridden by mcpClient.ts per MCP server'
      },
      {
        name: 'McpAuth',
        desc: 'MCP 服务器 OAuth 认证伪工具——启动 OAuth 流程并返回授权 URL',
        descEn: 'Pseudo-tool for MCP server OAuth authentication; launches the OAuth flow and returns the authorization URL',
        gated: false,
        lines: 215,
        file: 'McpAuthTool/McpAuthTool.ts',
        note: 'Created dynamically for unauthenticated MCP servers; replaced by real tools after auth'
      },
      {
        name: 'ListMcpResources',
        desc: '列出已连接 MCP 服务器提供的所有资源（URI、名称、描述）',
        descEn: 'Lists every resource exposed by connected MCP servers, including URI, name, and description',
        gated: false,
        lines: 123,
        file: 'ListMcpResourcesTool/ListMcpResourcesTool.ts'
      },
      {
        name: 'ReadMcpResource',
        desc: '从指定 MCP 服务器读取特定资源内容（文本或二进制）',
        descEn: 'Reads a specific resource, text or binary, from a given MCP server',
        gated: false,
        lines: 158,
        file: 'ReadMcpResourceTool/ReadMcpResourceTool.ts'
      },
    ]
  },

  // ─────────────────────────── Communication ───────────────────────────
  {
    category: '用户交互',
    categoryEn: 'Communication',
    color: '#F4A261',
    tools: [
      {
        name: 'SendUserMessage',
        desc: '向用户发送消息（Brief/Chat 模式下的主要输出通道），支持附件和主动通知',
        descEn: 'Sends messages to the user as the primary output channel in Brief/Chat modes; supports attachments and proactive notifications',
        gated: true,
        lines: 204,
        file: 'BriefTool/BriefTool.ts',
        note: 'Gated by feature(KAIROS||KAIROS_BRIEF) + GrowthBook gate; Legacy name: Brief'
      },
      {
        name: 'AskUserQuestion',
        desc: '向用户提出多选题以收集信息、澄清歧义或获取偏好决策',
        descEn: 'Asks the user a multiple-choice question to gather information, resolve ambiguity, or capture a preference',
        gated: false,
        lines: 265,
        file: 'AskUserQuestionTool/AskUserQuestionTool.tsx',
        note: 'Disabled when KAIROS channels are active (no TUI for multi-choice)'
      },
    ]
  },

  // ─────────────────────────── System / Configuration ───────────────────────────
  {
    category: '系统与配置',
    categoryEn: 'System & Configuration',
    color: '#8D99AE',
    tools: [
      {
        name: 'Config',
        desc: '读取或设置 Claude Code 配置项（主题、模型、权限模式等）',
        descEn: 'Reads or sets Claude Code configuration values such as theme, model, and permission mode',
        gated: false,
        lines: 467,
        file: 'ConfigTool/ConfigTool.ts'
      },
      {
        name: 'Sleep',
        desc: '等待指定时长（用户可中断），替代 Bash sleep，不占用 shell 进程',
        descEn: 'Waits for a specified duration (user-interruptible) as a shell-free alternative to Bash sleep',
        gated: false,
        lines: 17,
        file: 'SleepTool/prompt.ts',
        note: 'Prompt-only definition (no main .ts file); tool built elsewhere'
      },
      {
        name: 'StructuredOutput',
        desc: '非交互式会话中用于结构化输出的合成工具（SDK 模式专用）',
        descEn: 'Synthetic tool for emitting structured output in non-interactive sessions (SDK mode only)',
        gated: true,
        lines: 163,
        file: 'SyntheticOutputTool/SyntheticOutputTool.ts',
        note: 'Only enabled in non-interactive (SDK) sessions'
      },
    ]
  },

  // ─────────────────────────── Scheduling & Remote ───────────────────────────
  {
    category: '定时与远程',
    categoryEn: 'Scheduling & Remote',
    color: '#00B4D8',
    tools: [
      {
        name: 'CronCreate',
        desc: '创建定时或一次性 cron 任务，支持持久化到磁盘跨会话存活',
        descEn: 'Creates recurring or one-off cron jobs that persist across sessions on disk',
        gated: true,
        lines: 157,
        file: 'ScheduleCronTool/CronCreateTool.ts',
        note: 'Gated by isKairosCronEnabled()'
      },
      {
        name: 'CronList',
        desc: '列出当前所有活跃的 cron 定时任务',
        descEn: 'Lists every active cron job in the current session',
        gated: true,
        lines: 67,
        file: 'ScheduleCronTool/CronListTool.ts',
        note: 'Gated by isKairosCronEnabled()'
      },
      {
        name: 'CronDelete',
        desc: '取消一个已创建的 cron 定时任务',
        descEn: 'Cancels a previously created cron job',
        gated: true,
        lines: 78,
        file: 'ScheduleCronTool/CronDeleteTool.ts',
        note: 'Gated by isKairosCronEnabled()'
      },
      {
        name: 'RemoteTrigger',
        desc: '管理 claude.ai 远程触发器（scheduled agents），支持 CRUD 和手动触发',
        descEn: 'Manages claude.ai remote triggers (scheduled agents) with CRUD operations and manual firing',
        gated: true,
        lines: 161,
        file: 'RemoteTriggerTool/RemoteTriggerTool.ts',
        note: 'Gated by GrowthBook tengu_surreal_dali + policy allow_remote_sessions'
      },
    ]
  },

  // ─────────────────────────── Internal / Testing ───────────────────────────
  {
    category: '内部/测试',
    categoryEn: 'Internal & Testing',
    color: '#ADB5BD',
    tools: [
      {
        name: 'TestingPermission',
        desc: '测试用权限工具，仅在测试环境中启用',
        descEn: 'Permission tool used only in test environments',
        gated: true,
        lines: 73,
        file: 'testing/TestingPermissionTool.tsx',
        note: 'isEnabled() checks NODE_ENV === "test"'
      },
      {
        name: 'REPLTool (primitives)',
        desc: 'REPL 模式下隐藏原始工具（Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/Agent）的注册表',
        descEn: 'Registry of primitive tools (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent) hidden while in REPL mode',
        gated: true,
        lines: 39,
        file: 'REPLTool/primitiveTools.ts',
        note: 'Not a standalone tool; defines which tools are hidden in REPL mode'
      },
    ]
  },
];

// ═══════════════════════════════════════════════════════════════
//  SLASH COMMANDS — from src/commands/
// ═══════════════════════════════════════════════════════════════

const COMMAND_CATALOG = [
  // ─────────────────────────── Setup & Config ───────────────────────────
  {
    category: '设置与配置',
    categoryEn: 'Setup & Config',
    commands: [
      { name: '/init', desc: '初始化 CLAUDE.md 文件并可选生成 skills/hooks（分析代码库）', descEn: 'Initializes CLAUDE.md and optionally generates skills/hooks by analyzing the codebase', gated: false },
      { name: '/config', desc: '打开配置面板', descEn: 'Opens the configuration panel', gated: false },
      { name: '/login', desc: '登录 Anthropic 账号', descEn: 'Logs in to your Anthropic account', gated: false },
      { name: '/logout', desc: '退出 Anthropic 账号', descEn: 'Logs out of your Anthropic account', gated: false },
      { name: '/doctor', desc: '诊断和验证 Claude Code 安装与配置', descEn: 'Diagnoses and verifies your Claude Code installation and configuration', gated: false },
      { name: '/permissions', desc: '管理工具的允许/拒绝权限规则', descEn: 'Manages allow and deny permission rules for tools', gated: false },
      { name: '/hooks', desc: '查看工具事件的钩子配置', descEn: 'Views hook configuration for tool events', gated: false },
      { name: '/theme', desc: '更换主题', descEn: 'Changes the theme', gated: false },
      { name: '/color', desc: '设置当前会话的提示栏颜色', descEn: 'Sets the prompt bar color for the current session', gated: false },
      { name: '/model', desc: '设置 AI 模型（动态显示当前模型）', descEn: 'Sets the AI model; dynamically shows the current selection', gated: false },
      { name: '/fast', desc: '切换快速模式（仅用小模型）', descEn: 'Toggles fast mode, which uses only the small model', gated: false },
      { name: '/effort', desc: '设置模型推理的努力等级', descEn: 'Sets the reasoning effort level for the model', gated: false },
      { name: '/output-style', desc: '（已废弃）更改输出样式，请用 /config', descEn: 'Deprecated: change output style via /config instead', gated: false },
      { name: '/keybindings', desc: '打开或创建键位绑定配置文件', descEn: 'Opens or creates the keybindings configuration file', gated: false },
      { name: '/terminal-setup', desc: '安装 Shift+Enter 换行键绑定', descEn: 'Installs the Shift+Enter newline keybinding', gated: false },
      { name: '/sandbox-toggle', desc: '切换沙箱隔离模式的开/关', descEn: 'Toggles sandbox isolation mode on or off', gated: false },
      { name: '/vim', desc: '在 Vim 和普通编辑模式之间切换', descEn: 'Switches between Vim and normal edit modes', gated: false },
      { name: '/privacy-settings', desc: '查看和更新隐私设置', descEn: 'Views and updates privacy settings', gated: false },
      { name: '/memory', desc: '编辑 Claude 记忆文件 (CLAUDE.md)', descEn: 'Edits the Claude memory file (CLAUDE.md)', gated: false },
      { name: '/add-dir', desc: '添加新的工作目录', descEn: 'Adds a new working directory', gated: false },
    ]
  },

  // ─────────────────────────── Session & Navigation ───────────────────────────
  {
    category: '会话与导航',
    categoryEn: 'Session & Navigation',
    commands: [
      { name: '/clear', desc: '清除对话历史并释放上下文空间', descEn: 'Clears conversation history and frees up context space', gated: false },
      { name: '/compact', desc: '清除历史但保留摘要在上下文中（可自定义摘要指令）', descEn: 'Clears history but keeps a summary in context; accepts custom summarization instructions', gated: false },
      { name: '/resume', desc: '恢复之前的对话', descEn: 'Resumes a previous conversation', gated: false },
      { name: '/rename', desc: '重命名当前对话', descEn: 'Renames the current conversation', gated: false },
      { name: '/branch', desc: '在当前位置创建对话的分支', descEn: 'Branches the conversation at the current point', gated: false },
      { name: '/exit', desc: '退出 REPL', descEn: 'Exits the REPL', gated: false },
      { name: '/session', desc: '显示远程会话 URL 和 QR 码', descEn: 'Displays the remote session URL and QR code', gated: false },
      { name: '/tag', desc: '给当前会话切换可搜索的标签', descEn: 'Toggles a searchable tag on the current session', gated: false },
      { name: '/rewind', desc: '将代码和/或对话回退到之前的状态', descEn: 'Rewinds code and/or conversation to a previous state', gated: false },
    ]
  },

  // ─────────────────────────── Info & Diagnostics ───────────────────────────
  {
    category: '信息与诊断',
    categoryEn: 'Info & Diagnostics',
    commands: [
      { name: '/help', desc: '显示帮助和可用命令', descEn: 'Shows help and available commands', gated: false },
      { name: '/status', desc: '显示版本、模型、账号、API 连接和工具状态', descEn: 'Shows version, model, account, API connection, and tool status', gated: false },
      { name: '/cost', desc: '显示当前会话的总费用和时长', descEn: 'Shows the current session\'s total cost and duration', gated: false },
      { name: '/usage', desc: '显示当前计划使用限额', descEn: 'Shows the usage limits for your current plan', gated: false },
      { name: '/context', desc: '将当前上下文使用量可视化为彩色网格', descEn: 'Visualizes current context usage as a colored grid', gated: false },
      { name: '/files', desc: '列出当前在上下文中的所有文件', descEn: 'Lists every file currently in context', gated: false },
      { name: '/diff', desc: '查看未提交的变更和每轮 diff', descEn: 'Views uncommitted changes and per-turn diffs', gated: false },
      { name: '/stats', desc: '显示你的 Claude Code 使用统计和活动', descEn: 'Shows your Claude Code usage statistics and activity', gated: false },
      { name: '/release-notes', desc: '查看版本更新说明', descEn: 'Views the release notes', gated: false },
      { name: '/version', desc: '显示当前运行的版本（非自动更新下载的版本）', descEn: 'Shows the currently running version, not the auto-updated download', gated: true },
    ]
  },

  // ─────────────────────────── Output & Export ───────────────────────────
  {
    category: '输出与导出',
    categoryEn: 'Output & Export',
    commands: [
      { name: '/copy', desc: '复制 Claude 最后的回复到剪贴板（/copy N 复制第 N 个最近的）', descEn: 'Copies Claude\'s last reply to the clipboard; /copy N copies the Nth most recent', gated: false },
      { name: '/export', desc: '导出当前对话到文件或剪贴板', descEn: 'Exports the current conversation to a file or the clipboard', gated: false },
    ]
  },

  // ─────────────────────────── Development Workflow ───────────────────────────
  {
    category: '开发工作流',
    categoryEn: 'Development Workflow',
    commands: [
      { name: '/review', desc: '审查一个 Pull Request', descEn: 'Reviews a pull request', gated: false },
      { name: '/security-review', desc: '对当前分支待提交变更执行安全审查', descEn: 'Runs a security review over pending changes on the current branch', gated: false },
      { name: '/pr_comments', desc: '获取 GitHub PR 上的评论', descEn: 'Fetches comments from a GitHub pull request', gated: false },
      { name: '/plan', desc: '启用规划模式或查看当前会话计划', descEn: 'Enables plan mode or views the current session\'s plan', gated: false },
      { name: '/btw', desc: '提一个快速旁支问题而不打断主对话', descEn: 'Asks a quick side question without interrupting the main thread', gated: false },
      { name: '/advisor', desc: '配置顾问模型', descEn: 'Configures the advisor model', gated: false },
    ]
  },

  // ─────────────────────────── Integrations ───────────────────────────
  {
    category: '集成与扩展',
    categoryEn: 'Integrations & Extensions',
    commands: [
      { name: '/mcp', desc: '管理 MCP 服务器', descEn: 'Manages MCP servers', gated: false },
      { name: '/plugin', desc: '管理 Claude Code 插件', descEn: 'Manages Claude Code plugins', gated: false },
      { name: '/skills', desc: '列出可用的 skills', descEn: 'Lists available skills', gated: false },
      { name: '/reload-plugins', desc: '在当前会话中激活待生效的插件变更', descEn: 'Activates pending plugin changes in the current session', gated: false },
      { name: '/agents', desc: '管理 agent 配置', descEn: 'Manages agent configurations', gated: false },
      { name: '/ide', desc: '管理 IDE 集成并显示状态', descEn: 'Manages IDE integrations and shows their status', gated: false },
      { name: '/install-github-app', desc: '为仓库设置 Claude GitHub Actions', descEn: 'Sets up Claude GitHub Actions for your repository', gated: false },
      { name: '/install-slack-app', desc: '安装 Claude Slack 应用', descEn: 'Installs the Claude Slack app', gated: false },
      { name: '/desktop', desc: '在 Claude Desktop 中继续当前会话', descEn: 'Continues the current session in Claude Desktop', gated: false },
      { name: '/mobile', desc: '显示 QR 码以下载 Claude 移动端 App', descEn: 'Shows a QR code to download the Claude mobile app', gated: false },
      { name: '/chrome', desc: 'Claude in Chrome (Beta) 设置', descEn: 'Configures Claude in Chrome (Beta)', gated: false },
    ]
  },

  // ─────────────────────────── Account & Billing ───────────────────────────
  {
    category: '账号与计费',
    categoryEn: 'Account & Billing',
    commands: [
      { name: '/upgrade', desc: '升级到 Max 计划获取更高限额和更多 Opus', descEn: 'Upgrades to the Max plan for higher limits and more Opus access', gated: false },
      { name: '/extra-usage', desc: '配置额外用量以在达到限额后继续工作', descEn: 'Configures extra usage so you can keep working after hitting limits', gated: false },
      { name: '/rate-limit-options', desc: '达到限额时显示可用选项', descEn: 'Shows available options when you hit rate limits', gated: false },
      { name: '/passes', desc: '推荐码奖励管理（动态描述）', descEn: 'Manages referral-code rewards; description is dynamic', gated: false },
      { name: '/feedback', desc: '提交关于 Claude Code 的反馈', descEn: 'Submits feedback about Claude Code', gated: false },
      { name: '/stickers', desc: '订购 Claude Code 贴纸', descEn: 'Orders Claude Code stickers', gated: false },
    ]
  },

  // ─────────────────────────── Background & Tasks ───────────────────────────
  {
    category: '后台与任务',
    categoryEn: 'Background & Tasks',
    commands: [
      { name: '/tasks', desc: '列出和管理后台任务', descEn: 'Lists and manages background tasks', gated: false },
    ]
  },

  // ─────────────────────────── Feature-Gated Commands ───────────────────────────
  {
    category: '实验性/门控命令',
    categoryEn: 'Feature-Gated Commands',
    commands: [
      { name: '/ultraplan', desc: '~10-30 分钟，在 Claude Code on the web 上起草高级计划', descEn: 'Drafts an advanced plan on Claude Code on the web; takes roughly 10-30 minutes', gated: true, gate: 'feature(ULTRAPLAN)' },
      { name: '/ultrareview', desc: '~10-20 分钟，在远端查找并验证分支中的 bug', descEn: 'Finds and verifies bugs on a branch remotely; takes roughly 10-20 minutes', gated: true, gate: 'review.ts export' },
      { name: '/brief', desc: '切换 brief-only 模式（仅 SendUserMessage 输出）', descEn: 'Toggles brief-only mode, which emits output only through SendUserMessage', gated: true, gate: 'feature(KAIROS||KAIROS_BRIEF)' },
      { name: '/voice', desc: '切换语音模式', descEn: 'Toggles voice mode', gated: true, gate: 'feature(VOICE_MODE)' },
      { name: '/bridge', desc: '连接此终端用于远程控制会话', descEn: 'Connects this terminal for remote-controlled sessions', gated: true, gate: 'feature(BRIDGE_MODE)' },
      { name: '/web-setup', desc: '在 web 上设置 Claude Code（需要连接 GitHub 账号）', descEn: 'Sets up Claude Code on the web; requires a connected GitHub account', gated: true, gate: 'feature(CCR_REMOTE_SETUP) + GrowthBook' },
      { name: '/remote-env', desc: '配置 teleport 会话的默认远程环境', descEn: 'Configures the default remote environment for teleport sessions', gated: false },
      { name: '/insights', desc: '生成分析你 Claude Code 会话的报告', descEn: 'Generates a report analyzing your Claude Code sessions', gated: false },
      { name: '/statusline', desc: '设置 Claude Code 状态栏 UI', descEn: 'Configures the Claude Code status line UI', gated: false },
      { name: '/thinkback', desc: '你的 2025 Claude Code 年度回顾', descEn: 'Your 2025 Claude Code year in review', gated: false },
      { name: '/thinkback-play', desc: '播放 thinkback 动画', descEn: 'Plays the thinkback animation', gated: false },
    ]
  },

  // ─────────────────────────── Internal-Only (ant) ───────────────────────────
  {
    category: '内部命令（仅 Anthropic 员工）',
    categoryEn: 'Internal-Only (Anthropic)',
    commands: [
      { name: '/commit', desc: '创建 git commit', descEn: 'Creates a git commit', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/commit-push-pr', desc: '提交、推送并打开 PR', descEn: 'Commits, pushes, and opens a pull request', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/backfill-sessions', desc: '回填会话数据', descEn: 'Backfills session data', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/break-cache', desc: '破坏提示缓存', descEn: 'Invalidates the prompt cache', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/bughunter', desc: '自动化 bug 搜索', descEn: 'Runs automated bug hunting', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/ctx_viz', desc: '上下文可视化调试', descEn: 'Debugs context via visualization', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/good-claude', desc: '内部正反馈命令', descEn: 'Internal positive-feedback command', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/issue', desc: '创建 issue', descEn: 'Creates an issue', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/init-verifiers', desc: '初始化验证器', descEn: 'Initializes verifiers', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/mock-limits', desc: '模拟速率限制', descEn: 'Simulates rate limits', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/bridge-kick', desc: '注入 bridge 故障状态用于手动恢复测试', descEn: 'Injects a bridge failure state to test manual recovery', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/reset-limits', desc: '重置速率限制', descEn: 'Resets rate limits', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/summary', desc: '生成摘要', descEn: 'Generates a summary', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/share', desc: '分享会话', descEn: 'Shares the session', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/teleport', desc: '传送到远程环境', descEn: 'Teleports into a remote environment', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/ant-trace', desc: 'Anthropic 内部追踪', descEn: 'Anthropic internal tracing', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/perf-issue', desc: '性能问题报告', descEn: 'Reports a performance issue', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/env', desc: '环境变量管理', descEn: 'Manages environment variables', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/oauth-refresh', desc: 'OAuth 令牌刷新', descEn: 'Refreshes the OAuth token', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/debug-tool-call', desc: '工具调用调试', descEn: 'Debugs tool calls', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/autofix-pr', desc: '自动修复 PR 问题', descEn: 'Auto-fixes issues on a pull request', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/onboarding', desc: '新手引导流程', descEn: 'Runs the onboarding flow', gated: true, gate: 'USER_TYPE=ant' },
      { name: '/heapdump', desc: '将 JS 堆转储到 ~/Desktop', descEn: 'Dumps the JS heap to ~/Desktop', gated: true, gate: 'USER_TYPE=ant' },
    ]
  },
];

// ═══════════════════════════════════════════════════════════════
//  Summary statistics
// ═══════════════════════════════════════════════════════════════

const TOOL_STATS = {
  totalTools: TOOL_CATALOG.reduce((sum, cat) => sum + cat.tools.length, 0),
  totalCommands: COMMAND_CATALOG.reduce((sum, cat) => sum + cat.commands.length, 0),
  gatedTools: TOOL_CATALOG.reduce((sum, cat) => sum + cat.tools.filter(t => t.gated).length, 0),
  gatedCommands: COMMAND_CATALOG.reduce((sum, cat) => sum + cat.commands.filter(c => c.gated).length, 0),
  totalSourceLines: TOOL_CATALOG.reduce((sum, cat) => sum + cat.tools.reduce((s, t) => s + t.lines, 0), 0),
  categories: {
    tools: TOOL_CATALOG.length,
    commands: COMMAND_CATALOG.length,
  },
};

// ═══════════════════════════════════════════════════════════════
//  HIDDEN / UNRELEASED FEATURES
// ═══════════════════════════════════════════════════════════════

const HIDDEN_FEATURES = [
  {
    name: 'Buddy',
    flag: 'BUDDY',
    icon: '🐕',
    status: 'gated',
    color: '#ffd93d',
    desc: 'AI 配对编程伙伴。一个始终在旁的 Agent，主动观察你的工作，适时提供建议，而不是等你提问。',
    descEn: 'AI pair-programming partner. An always-on Agent that watches your work and offers suggestions proactively, instead of waiting for you to ask.',
    source: 'src/commands/buddy/',
    detail: '通过 feature(\'BUDDY\') 门控。独立的命令入口，有自己的 React 组件和状态管理。',
    detailEn: 'Gated by feature(\'BUDDY\'). Ships as a standalone command entry point with its own React components and state management.',
  },
  {
    name: 'Kairos',
    flag: 'KAIROS',
    icon: '⏰',
    status: 'gated',
    color: '#e88dff',
    desc: '主动式助手模式。Kairos 不等你发指令——它监控项目变化、代码库状态，主动发现问题并提出改进建议。',
    descEn: 'Proactive assistant mode. Kairos does not wait for commands — it monitors project changes and codebase state, surfacing issues and suggesting improvements on its own.',
    source: 'src/commands/proactive.js, brief.js, assistant/',
    detail: '门控 3 个子命令：proactive（主动监控）、brief（简报生成）、assistant（全功能助手）。还关联 KAIROS_BRIEF 和 KAIROS_GITHUB_WEBHOOKS。',
    detailEn: 'Gates three subcommands: proactive (active monitoring), brief (briefing generation), and assistant (full-featured helper). Also linked to KAIROS_BRIEF and KAIROS_GITHUB_WEBHOOKS.',
  },
  {
    name: 'UltraPlan',
    flag: 'ULTRAPLAN',
    icon: '📜',
    status: 'gated',
    color: '#7b61ff',
    desc: '超级规划系统。当检测到关键词触发时，自动启用深度多步规划，生成结构化执行方案。',
    descEn: 'Deep planning mode. Detects trigger keywords and automatically enables multi-step planning, producing a structured execution plan.',
    source: 'src/commands/ultraplan.js',
    detail: '在 processUserInput 中通过关键词匹配触发。门控后仅内部可用。关联 UltraPlan 检测逻辑。',
    detailEn: 'Triggered by keyword matching inside processUserInput. Gated and internal-only. Hooks into the UltraPlan detection logic.',
  },
  {
    name: 'Bridge',
    flag: 'BRIDGE_MODE',
    icon: '🌉',
    status: 'gated',
    color: '#4ecdc4',
    desc: '跨设备桥接模式。让 Claude Code 作为远端 Agent 被控制——IDE 扩展、Web 界面、甚至另一个 Claude Code 实例都可以连接。',
    descEn: 'Cross-device bridge mode. Turns Claude Code into a remote Agent that can be driven by IDE extensions, web UIs, or even another Claude Code instance.',
    source: 'src/commands/bridge/, src/bridge/',
    detail: '31 个文件 / 12,613 行。包含 WebSocket 服务器、权限代理、安全过滤。与 Daemon 模式配合实现后台常驻。',
    detailEn: '31 files / 12,613 lines. Includes a WebSocket server, permission proxy, and safety filters. Pairs with Daemon mode for persistent background operation.',
  },
  {
    name: 'Daemon',
    flag: 'DAEMON',
    icon: '👻',
    status: 'gated',
    color: '#ff6b6b',
    desc: '后台守护进程。让 Claude Code 在后台持续运行，通过 Remote Control Server 接收外部指令。',
    descEn: 'Background daemon process. Keeps Claude Code running continuously and accepts external commands through a Remote Control Server.',
    source: 'src/commands/remoteControlServer/',
    detail: '需要 DAEMON + BRIDGE_MODE 双门控。提供 HTTP API 接口，外部系统可以通过 REST 调用驱动 Claude Code。',
    detailEn: 'Requires both DAEMON and BRIDGE_MODE flags. Exposes an HTTP API so external systems can drive Claude Code via REST calls.',
  },
  {
    name: 'UDS Inbox',
    flag: 'UDS_INBOX',
    icon: '📬',
    status: 'gated',
    color: '#63b3ed',
    desc: 'Unix Domain Socket 消息系统。多个 Claude Code 实例之间通过 UDS 文件直接通信，实现进程间协调。',
    descEn: 'Unix Domain Socket messaging system. Multiple Claude Code instances talk directly through UDS files to coordinate across processes.',
    source: 'src/commands/peers/',
    detail: '关联 /peers 命令。每个实例监听自己的 UDS 文件，其他实例通过写入该文件发送消息。比网络通信更安全更快。',
    detailEn: 'Paired with the /peers command. Each instance listens on its own UDS file; other instances send messages by writing to that file. Safer and faster than network-based IPC.',
  },
  {
    name: 'Auto-Dream',
    flag: '(内置)',
    flagEn: '(built-in)',
    icon: '💤',
    status: 'built-in',
    color: '#9b7cb8',
    desc: '后台记忆整合 Agent。在你不使用 Claude Code 时，它悄悄醒来整理记忆、更新 CLAUDE.md、清理过时信息。',
    descEn: "Background memory-consolidation Agent. While you're away, it quietly wakes up to organize memory, update CLAUDE.md, and prune stale information.",
    source: 'src/tasks/ · DreamTask',
    detail: '三门触发：距上次 ≥24h、累计 ≥5 次会话、获取文件锁。四阶段执行：回顾→分析→行动→报告。全部由 prompt 驱动，无硬编码逻辑。',
    detailEn: 'Three-gate trigger: 24h since last run, 5+ accumulated sessions, and acquiring a file lock. Runs in four phases — review, analyze, act, report — entirely prompt-driven with no hard-coded logic.',
  },
  {
    name: 'Voice',
    flag: 'VOICE_MODE',
    icon: '🎙',
    status: 'gated',
    color: '#f6ad55',
    desc: '语音交互模式。用语音与 Claude Code 对话，支持语音输入和语音输出。',
    descEn: 'Voice interaction mode. Talk to Claude Code by voice, with both speech input and speech output.',
    source: 'src/commands/voice/',
    detail: '通过 feature(\'VOICE_MODE\') 门控。独立的语音处理管线。',
    detailEn: 'Gated by feature(\'VOICE_MODE\'). Ships as an independent speech processing pipeline.',
  },
  {
    name: 'Torch',
    flag: 'TORCH',
    icon: '🔦',
    status: 'gated',
    color: '#fc8181',
    desc: '未公开的实验性功能。代码中仅有简短引用，具体功能尚不明确。',
    descEn: 'Undocumented experimental feature — referenced a few times in the source, with no clear purpose yet.',
    source: 'src/commands/torch.js',
    detail: '通过 feature(\'TORCH\') 门控。最神秘的隐藏功能之一。',
    detailEn: 'Gated by feature(\'TORCH\'). One of the most mysterious hidden features in the codebase.',
  },
  {
    name: 'Fork Subagent',
    flag: 'FORK_SUBAGENT',
    icon: '🍴',
    status: 'gated',
    color: '#68d391',
    desc: '进程分叉子 Agent。不通过 Agent 工具，而是直接 fork 当前进程创建子 Agent，共享内存状态。',
    descEn: 'Process-forked sub-Agent. Instead of using the Agent tool, it forks the current process directly to spawn a sub-Agent that shares in-memory state.',
    source: 'src/commands/fork/',
    detail: '实验性的轻量级 Agent 派生方式。比标准 Agent 工具更快启动，但隔离性较弱。',
    detailEn: 'An experimental lightweight way to spawn Agents. Starts faster than the standard Agent tool but provides weaker isolation.',
  },
  {
    name: 'Thinkback',
    flag: '(内置)',
    flagEn: '(built-in)',
    icon: '🔮',
    status: 'built-in',
    color: '#b794f4',
    desc: '思维回溯系统。记录 AI 的推理过程，允许用户回放和审查 AI 的"思考链"。',
    descEn: 'Thought-replay system. Records the AI\'s reasoning process so users can replay and review its chain of thought.',
    source: 'src/commands/thinkback/, thinkback-play/',
    detail: '两个配套命令：thinkback（记录）和 thinkback-play（回放）。让 AI 的推理过程可观察、可审计。',
    detailEn: 'Two paired commands: thinkback (record) and thinkback-play (replay). Makes the AI\'s reasoning observable and auditable.',
  },
  {
    name: 'Workflows',
    flag: 'WORKFLOW_SCRIPTS',
    icon: '🔄',
    status: 'gated',
    color: '#76e4f7',
    desc: '工作流脚本系统。预定义可复用的多步骤自动化工作流，一键执行复杂操作。',
    descEn: 'Workflow script system. Predefined, reusable multi-step automation workflows that execute complex operations with a single command.',
    source: 'src/commands/workflows/, src/tools/WorkflowTool/',
    detail: '包含 WorkflowTool 工具和 /workflows 命令。通过 feature(\'WORKFLOW_SCRIPTS\') 门控。',
    detailEn: 'Includes the WorkflowTool and the /workflows command. Gated by feature(\'WORKFLOW_SCRIPTS\').',
  },
];

// ===== ARCHITECTURE DATA (for treemap visualization) =====
const ARCHITECTURE = {
  name: 'src/', files: 1884, lines: 512674,
  desc: 'Claude Code 2.1.88 — 完整 TypeScript 源码',
  descEn: 'Claude Code 2.1.88 — Complete TypeScript source',
  children: [
    { name: 'utils/', files: 564, lines: 180472, color: '#48bb78',
      desc: '核心工具库：权限、Bash 解析、插件、消息处理、会话存储',
      descEn: 'Core utilities: permissions, Bash parser, plugins, message handling, session storage',
      children: [
        { name: 'bash/', files: 15, lines: 12093, desc: 'Bash AST 解析与执行安全', descEn: 'Bash AST parsing and execution safety' },
        { name: 'permissions/', files: 24, lines: 9409, desc: '权限系统：文件规则、Shell 分类、YOLO 分类器', descEn: 'Permission system: file rules, shell classifiers, YOLO classifier' },
        { name: 'plugins/', files: 18, lines: 5945, desc: '插件系统：加载器、商店、沙盒', descEn: 'Plugin system: loader, marketplace, sandbox' },
        { name: 'messages.ts', files: 1, lines: 5512, desc: '消息创建与格式化（最大单文件之一）', descEn: 'Message creation and formatting (one of the largest single files)' },
        { name: 'sessionStorage.ts', files: 1, lines: 5105, desc: '会话状态持久化', descEn: 'Session state persistence' },
        { name: 'hooks/', files: 17, lines: 3721, desc: 'React Hooks 封装', descEn: 'React Hooks wrappers' },
        { name: 'model/', files: 16, lines: 2710, desc: '模型选择与管理', descEn: 'Model selection and management' },
        { name: 'nativeInstaller/', files: 5, lines: 3018, desc: '原生工具安装器', descEn: 'Native tool installer' },
        { name: 'computerUse/', files: 15, lines: 2161, desc: 'Computer Use 集成', descEn: 'Computer Use integration' },
        { name: 'claudeInChrome/', files: 7, lines: 2337, desc: 'Chrome 扩展/深度链接', descEn: 'Chrome extension and deep-link integration' },
        { name: 'deepLink/', files: 6, lines: 1388, desc: '深度链接支持', descEn: 'Deep-link support' },
        { name: 'git/', files: 3, lines: 1075, desc: 'Git 集成工具', descEn: 'Git integration utilities' },
      ]
    },
    { name: 'components/', files: 389, lines: 81546, color: '#ffd93d',
      desc: 'React 终端 UI 组件：消息渲染、输入框、权限提示',
      descEn: 'React terminal UI components: message rendering, input fields, permission prompts',
      children: [
        { name: 'messages/', files: 33, lines: 5509, desc: '消息渲染组件', descEn: 'Message rendering components' },
        { name: 'PromptInput/', files: 21, lines: 5161, desc: '输入框组件系统', descEn: 'Input field component system' },
        { name: 'mcp/', files: 12, lines: 3872, desc: 'MCP 连接管理 UI', descEn: 'MCP connection management UI' },
        { name: 'agents/', files: 13, lines: 3021, desc: 'Agent UI 组件', descEn: 'Agent UI components' },
        { name: 'CustomSelect/', files: 10, lines: 3019, desc: '自定义选择组件', descEn: 'Custom select components' },
        { name: 'permissions/', files: 15, lines: 2728, desc: '权限提示 UI', descEn: 'Permission prompt UI' },
        { name: 'LogoV2/', files: 15, lines: 2482, desc: 'Logo 与品牌组件', descEn: 'Logo and branding components' },
        { name: 'design-system/', files: 16, lines: 2238, desc: '设计系统与基础组件', descEn: 'Design system and base components' },
      ]
    },
    { name: 'services/', files: 130, lines: 53680, color: '#7b61ff',
      desc: '后端服务层：API 客户端、MCP、分析、压缩、LSP',
      descEn: 'Backend service layer: API client, MCP, analytics, compaction, LSP',
      children: [
        { name: 'mcp/', files: 23, lines: 12310, desc: 'MCP 客户端、认证、配置、服务器管理', descEn: 'MCP client, auth, config, and server management' },
        { name: 'api/', files: 20, lines: 10477, desc: 'Claude API 客户端、错误处理、重试', descEn: 'Claude API client, error handling, and retries' },
        { name: 'analytics/', files: 9, lines: 4040, desc: '事件日志、GrowthBook 集成', descEn: 'Event logging and GrowthBook integration' },
        { name: 'compact/', files: 11, lines: 3960, desc: '会话压缩与摘要', descEn: 'Session compaction and summarization' },
        { name: 'lsp/', files: 7, lines: 2460, desc: 'Language Server Protocol 集成', descEn: 'Language Server Protocol integration' },
        { name: 'teamMemorySync/', files: 5, lines: 2167, desc: '团队 Agent 记忆同步', descEn: 'Team Agent memory sync' },
        { name: 'plugins/', files: 3, lines: 1616, desc: '插件服务管理', descEn: 'Plugin service management' },
        { name: 'oauth/', files: 5, lines: 1051, desc: 'OAuth 令牌管理', descEn: 'OAuth token management' },
      ]
    },
    { name: 'tools/', files: 184, lines: 50828, color: '#00d4ff',
      desc: '40 个内置工具目录：Bash、Agent、文件操作、搜索',
      descEn: '40 built-in tool directories: Bash, Agent, file ops, search',
      children: [
        { name: 'BashTool/', files: 18, lines: 12411, desc: 'Bash/Shell 执行 + 权限检查', descEn: 'Bash/Shell execution with permission checks' },
        { name: 'PowerShellTool/', files: 14, lines: 8959, desc: 'PowerShell 执行（Windows）', descEn: 'PowerShell execution (Windows)' },
        { name: 'AgentTool/', files: 14, lines: 6072, desc: 'Agent 创建与管理', descEn: 'Agent creation and management' },
        { name: 'LSPTool/', files: 6, lines: 2005, desc: '语言服务器查询', descEn: 'Language server queries' },
        { name: 'FileEditTool/', files: 6, lines: 1812, desc: '文件编辑 + Diff', descEn: 'File editing with diff' },
        { name: 'FileReadTool/', files: 5, lines: 1602, desc: '文件读取操作', descEn: 'File read operations' },
        { name: 'SkillTool/', files: 4, lines: 1477, desc: 'Skill 调用系统', descEn: 'Skill invocation system' },
        { name: 'SendMessageTool/', files: 4, lines: 997, desc: '跨 Agent 消息发送', descEn: 'Cross-Agent message dispatch' },
        { name: 'GrepTool/', files: 3, lines: 795, desc: '文本搜索（ripgrep）', descEn: 'Text search (ripgrep)' },
      ]
    },
    { name: 'commands/', files: 189, lines: 26428, color: '#e88dff',
      desc: '86 个 CLI 命令：插件、IDE、MCP、设置',
      descEn: '86 CLI commands: plugins, IDE, MCP, settings',
      children: [
        { name: 'plugin/', files: 3, lines: 7575, desc: '插件安装与管理', descEn: 'Plugin installation and management' },
        { name: 'install-github-app/', files: 2, lines: 2352, desc: 'GitHub 集成设置', descEn: 'GitHub integration setup' },
        { name: 'ide/', files: 2, lines: 656, desc: 'IDE 集成命令', descEn: 'IDE integration commands' },
        { name: 'mcp/', files: 2, lines: 642, desc: 'MCP 服务器管理', descEn: 'MCP server management' },
        { name: 'thinkback/', files: 2, lines: 566, desc: '扩展思维支持', descEn: 'Extended thinking support' },
        { name: 'bridge/', files: 2, lines: 534, desc: 'Bridge/远程模式命令', descEn: 'Bridge and remote-mode commands' },
        { name: 'review/', files: 2, lines: 482, desc: '代码审查命令', descEn: 'Code review commands' },
      ]
    },
    { name: 'ink/', files: 96, lines: 19842, color: '#ff6b6b',
      desc: '终端渲染框架：React → Yoga → ANSI',
      descEn: 'Terminal rendering framework: React to Yoga to ANSI',
      children: [
        { name: 'termio/', files: 9, lines: 2271, desc: '终端 I/O 处理', descEn: 'Terminal I/O handling' },
        { name: 'components/', files: 18, lines: 2228, desc: '终端 UI 组件', descEn: 'Terminal UI components' },
        { name: 'events/', files: 10, lines: 797, desc: '事件处理', descEn: 'Event handling' },
        { name: 'hooks/', files: 12, lines: 677, desc: '终端专用 Hooks', descEn: 'Terminal-specific Hooks' },
        { name: 'layout/', files: 4, lines: 563, desc: 'Yoga 布局引擎', descEn: 'Yoga layout engine' },
      ]
    },
    { name: 'hooks/', files: 104, lines: 19204, color: '#f6ad55',
      desc: 'React Hooks 状态管理层',
      descEn: 'React Hooks state management layer',
      children: [
        { name: 'primary/', files: 85, lines: 16476, desc: '核心状态 Hooks', descEn: 'Core state Hooks' },
        { name: 'notifs/', files: 16, lines: 1342, desc: '通知管理 Hooks', descEn: 'Notification management Hooks' },
        { name: 'toolPermission/', files: 2, lines: 626, desc: '权限请求 Hooks', descEn: 'Permission request Hooks' },
      ]
    },
    { name: 'bridge/', files: 31, lines: 12613, color: '#63b3ed',
      desc: '远程模式与云运行时集成',
      descEn: 'Remote mode and cloud runtime integration',
      children: [
        { name: 'bridgeMain.ts', files: 1, lines: 2999, desc: '主 Bridge 编排器', descEn: 'Main Bridge orchestrator' },
        { name: 'replBridge.ts', files: 1, lines: 2406, desc: 'REPL 运行时桥', descEn: 'REPL runtime bridge' },
        { name: 'remoteBridgeCore.ts', files: 1, lines: 1008, desc: '核心远程协议', descEn: 'Core remote protocol' },
      ]
    },
    { name: 'cli/', files: 19, lines: 12353, color: '#4ecdc4',
      desc: 'CLI 参数解析与终端输出',
      descEn: 'CLI argument parsing and terminal output',
      children: [
        { name: 'print.ts', files: 1, lines: 5594, desc: '终端输出格式化', descEn: 'Terminal output formatting' },
        { name: 'init.ts', files: 1, lines: 1767, desc: '初始化序列', descEn: 'Initialization sequence' },
      ]
    },
    { name: 'screens/', files: 3, lines: 5977, color: '#9b7cb8',
      desc: '全屏 UI 视图',
      descEn: 'Full-screen UI views',
      children: [
        { name: 'REPL.tsx', files: 1, lines: 5005, desc: '主 REPL 界面（最大组件）', descEn: 'Main REPL interface (largest single component)' },
      ]
    },
    { name: 'keybindings/', files: 14, lines: 3159, color: '#76e4f7', desc: '键盘快捷键定义与处理', descEn: 'Keyboard shortcut definitions and handling' },
    { name: 'constants/', files: 21, lines: 2648, color: '#cbd5e0', desc: '应用常量与配置', descEn: 'Application constants and configuration' },
    { name: 'types/', files: 7, lines: 2071, color: '#a0aec0', desc: 'TypeScript 类型定义', descEn: 'TypeScript type definitions' },
    { name: 'memdir/', files: 8, lines: 1736, color: '#68d391', desc: '记忆目录持久化', descEn: 'Memory directory persistence' },
    { name: 'vim/', files: 5, lines: 1513, color: '#fc8181', desc: 'Vim 键绑定支持', descEn: 'Vim keybinding support' },
    { name: 'entrypoints/', files: 5, lines: 1437, color: '#b794f4', desc: '应用入口点', descEn: 'Application entry points' },
    { name: 'skills/', files: 3, lines: 1350, color: '#fbb6ce', desc: '内置 Skill 系统', descEn: 'Built-in Skill system' },
    { name: 'buddy/', files: 6, lines: 1298, color: '#fefcbf', desc: 'Buddy 伴侣 Agent 系统', descEn: 'Buddy companion Agent system' },
    { name: 'state/', files: 6, lines: 1190, color: '#c6f6d5', desc: '应用状态管理', descEn: 'Application state management' },
    { name: 'remote/', files: 4, lines: 1127, color: '#bee3f8', desc: '远程 Agent 与会话管理', descEn: 'Remote Agent and session management' },
    { name: 'context/', files: 9, lines: 1004, color: '#e9d8fd', desc: 'React Context 提供者', descEn: 'React Context providers' },
  ]
};

// Make available globally (for non-module contexts) and as exports
if (typeof window !== 'undefined') {
  window.TOOL_CATALOG = TOOL_CATALOG;
  window.COMMAND_CATALOG = COMMAND_CATALOG;
  window.TOOL_STATS = TOOL_STATS;
  window.HIDDEN_FEATURES = HIDDEN_FEATURES;
  window.ARCHITECTURE = ARCHITECTURE;
}
