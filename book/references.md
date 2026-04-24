# 引用与致谢

> 本书的写作离不开社区的智慧。以下是我们引用、参考或受到启发的所有来源。向每一位贡献者致敬。

---

## 社区贡献者

在 Claude Code 2.1.88 源码公开事件（2026年3月31日）前后，中文技术社区爆发了一场前所未有的深度分析热潮。以下按首次引用顺序列出在本书中被直接引用或为本书提供重要启发的社区成员。

### 直接引用的社区声音

| 贡献者 | 平台 | 主要贡献 | 本书引用位置 |
|--------|------|----------|------------|
| **@idoubicc** | X/Twitter | open-agent-sdk 开源项目（1,658赞，321K浏览）；"Claude Code家后院起火，我让CC把桌椅搬出来盖了新房，大家免费住" | 序章 |
| **@IceBearMiner** | X/Twitter | "越花时间vibe coding，越觉得软件工程的重要性"；Harness Engineering 重要性论述 | 序章 |
| **@wquguru** | X/Twitter | harness-books 两本书（1,662赞，238K浏览）；"工具中的名词相同，不代表系统的骨架相同" | 序章、工具运行时 |
| **@anthropic_security_review** | X/Twitter | "23 checks is not paranoia — it's the minimum surface area coverage for a tool that runs arbitrary shell commands on a real OS." | BashTool安全防线 |

### 深度分析为本书提供重要参考的社区成员

| 贡献者 | 平台 | 主要贡献 | 影响力 |
|--------|------|----------|--------|
| **@Barret_China**（李靖） | X/Twitter | 用 Tulving 1972 三类记忆框架映射 Claude Code 记忆系统；CC vs LangMem/Mem0/Zep/OpenClaw 竞品对比 | 694赞，66K浏览 |
| **@tvytlx**（Xiao Tan） | X/Twitter | 最早的系统性深度技术报告之一，深度拆解4756个源码文件 | 3,413赞，924K浏览 |
| **@AlchainHust**（花叔） | X/Twitter | 《Claude Code 橙皮书》75页实战手册开源 | 3,339赞，300K浏览 |
| **@0xJoooe** | X/Twitter | Claude Code System Prompt 六大工程技巧提炼 | 402赞 |
| **@servasyy_ai** | X/Twitter | Harness Engineering 框架（源码公开前2天提出）；15章912行完整源码分析（cache_edits机制、三通道遥测追踪链、四层递进Compact、Flush Gate状态机——中文社区最全面的单篇技术分析）；CC vs OpenClaw Hooks哲学对比 | 698赞 + 404赞, 113K浏览 |
| **@yq_acc** | X/Twitter | 系统性效应论："移除任何一层，其余层的效果都会下降。这就是精良架构的本质" | 英中双语分析 |
| **@troyhua**（Troy Hua） | X/Twitter | 7层记忆 + Dreaming系统视频拆解；EverMind创始人，CMU对话系统博士 | 383赞，132K浏览 |
| **@Pluvio9yte** | X/Twitter | 《Vibe Coding的尽头其实是工程化》 | 344赞，145K浏览 |
| **@MaxForAI** | X/Twitter | 《从Claude Code公开流传的源码，看第一梯队AI Agent工程架构》，7张架构配图 | 399赞，138K浏览 |
| **@blackanger**（AlexZ） | X/Twitter | 《驾驭工程：从Claude Code源码到AI编码最佳实践》在线书 | 331赞，148K浏览 |
| **@jiayuan_jy** | X/Twitter | Multica 多Agent协作平台开源（"像Linear一样管理任务，但AI agent是一等公民"） | 950赞，310K浏览 |
| **@GoSailGlobal** | X/Twitter | AgentSkillsHub Top 10 榜单统计，源码公开后生态爆发的定量证据 | 51赞 |
| **@cryptonerdcn**（NerdC） | X/Twitter | 架构与Agent设计解析 + 隐藏彩蛋；claude-code-2188 源码备份；Buddy Web Demo | 73赞 |
| **@boniusex** | X/Twitter | 《Claude Code源码曝光：最值钱的功能，99%用户没用过》 | 62赞 |
| **@jesselaunz** | X/Twitter | PPT版源码分析（NotebookLM生成） | 47赞 |
| **@shuang** | X/Twitter | 将50年前Tulving论文与AI Agent记忆设计关联 | 学术回溯 |
| **@fried_rice** | X/Twitter | 最早发现并公开报告源码流出事件 | 事件首发 |

---

## 开源项目

Claude Code 源码公开催生了一场开源生态的集中爆发。源码公开后一周内，GitHub Agent Skills 趋势榜前 10 中有 6 个是 CC 相关项目。以下项目在本书中被提及或为本书提供了参考。

### 源码公开直接催生的项目

| 项目 | 星标 | 作者 | 描述 | 与本书的关系 |
|------|------|------|------|------------|
| **claw-code** | 121K+ | Sigrid Jin | Python/Rust 重写的 Claude Code，历史增长最快的 GitHub 项目（2小时内50K） | 序章事件叙事 |
| **open-agent-sdk** | — | @idoubicc | MIT 开源，函数调用式 SDK 替代方案 | 序章、系统评价（进程架构瓶颈佐证） |
| **open-agent-sdk-typescript** | 1,822 | codeany-ai | TypeScript SDK，无 CLI 依赖 | 序章项目统计 |
| **harness-books** | 1.1K | @wquguru | CC vs Codex Harness 对比书籍 | 序章、竞品分析参考 |
| **ccunpacked.dev** | — | 社区 | 英文可视化导览站，11步 Agent Loop 交互动画 | 序章、设计参考 |
| **byterover-cli** | 3,638 | campfirein | Agent 记忆层，跨session持久化 | 序章项目统计 |
| **taches-cc-resources** | 1,731 | glittercowboy | 配置合集 + 工作流 + 最佳实践 | 序章项目统计 |
| **claude-reviews-claude** | 988 | openedclaude | Claude 读自己源码的17章自我审查 | 序章项目统计 |
| **how-claude-code-works** | 808 | Windy3f3f3f3f | 架构 + Agent循环 + 工具机制剖析 | 序章项目统计 |
| **claude-code-from-scratch** | 472 | Windy3f3f3f3f | ~1300行TS手把手教学 | 序章项目统计 |
| **claude-code-prompts** | 322 | repowise-dev | 开箱即用 Prompt 模板 | 社区生态 |
| **Multica** | — | @jiayuan_jy | 多Agent协作平台 | 社区生态影响 |
| **Claude Code 橙皮书** | — | @AlchainHust（花叔） | 75页实战手册，飞书文档 | 竞品参考 |
| **驾驭工程** | — | @blackanger（AlexZ） | 在线书 zhanghandong.github.io | 竞品参考 |

### 在分析中被对比的竞品项目

| 项目 | 性质 | 在本书中的角色 |
|------|------|--------------|
| **GitHub Copilot** / **Copilot Workspace** | 微软/GitHub 的 AI 编程助手 | 多章竞品对比（多端策略、计划驱动工具调用、云端容器模式） |
| **Cursor** | AI-first 代码编辑器 | 多章竞品对比（RAG策略、Background Agents、.cursorrules 指令系统） |
| **Windsurf** | Codeium 推出的 AI 编辑器 | 竞品对比（Cascade Engine 上下文树、VS Code 扩展体系） |
| **Aider** | 开源终端 AI 编程助手 | 竞品对比（AST级Repo Map、ConversationSummaryMemory） |
| **Cline** | 开源 VS Code AI 扩展 | 竞品对比（扩展生态、交互模式） |
| **Continue** | 开源 AI 编程助手 | 竞品对比 |
| **Codex（OpenAI）** | OpenAI 的编程 Agent | 多章竞品对比（Rust重写、并行Agent工作流、AGENTS.md、OS级网络隔离） |
| **OpenCode** | 开源 CLI AI 工具（11万+ Stars） | 行业背景 |
| **Kimi Code** | 月之暗面推出的 AI 编程助手 | 竞品对比（Agent Swarm 架构、最多100个并发子智能体） |
| **Devin** | 自主 AI 开发者 | 竞品对比（Manage Devins、Human-in-the-loop） |
| **OpenClaw**（原 Clawdbot） | 开源全自主 Agent | 竞品对比（记忆系统哲学："记忆不是资产，正确使用记忆的能力才是"） |
| **GLM / Z.ai / Z Code** | 智谱 AI 编程平台 | 竞品对比（大参数量 MoE、面向国产算力与私有化部署） |
| **Google 的 AI 编程工具（产品名以官方为准）** | Google 的 AI 编程工具 | 竞品对比（Mission Control 架构、Artifacts 机制、Allow/Deny List） |
| **ForgeCode** | AI 编程工具 | Terminal Bench 基准测试对比（同模型下击败 Claude Code） |

---

## 学术与行业框架

本书在分析中引用了多个学术理论和行业框架，将 Claude Code 的工程实现与更广泛的知识体系连接。

### 认知科学

| 框架 | 提出者 | 年份 | 在本书中的应用 |
|------|--------|------|--------------|
| **三类记忆系统**（情境记忆/语义记忆/程序化记忆） | Endel Tulving | 1972 | 映射到 Claude Code 的记忆架构：jsonl对话存储（情境）、extractMemories + autoDream（语义）、feedback记忆类型（程序化） |

### 行业框架

| 框架 | 提出者 | 在本书中的应用 |
|------|--------|--------------|
| **Model + Runtime + Harness 三层架构** | Harrison Chase（LangChain 创始人） | 序章、架构分析的基础框架 |
| **三阶段演进**：提示工程(2023-24) → 上下文工程(2025) → 套控工程(2026) | @servasyy_ai / 社区共识 | 序章行业背景定位 |

### 计算机科学经典概念（贯穿全书的类比和映射）

以下经典概念在全书中被用作解释 Claude Code 工程决策的理论锚点：

- **操作系统**：Copy-on-Write（COW）、进程调度、虚拟文件系统、系统调用、fork()
- **分布式系统**：分布式追踪（OpenTelemetry Span）、断路器模式、最终一致性、WAL（Write-Ahead Log）
- **数据库**：缓存一致性、read-your-writes、追加写入 + 离线 compaction
- **计算机网络**：协议演进与向后兼容、ALPN 协商
- **安全工程**：多层防线（Defense in Depth）、最小权限原则、供应链攻击
- **软件工程**：API 废弃策略（Deprecation Strategy）、可观测性三支柱（Metrics/Tracing/Logging）

---

## 媒体与平台

以下媒体和平台的报道或分析文章为本书的行业背景和事件叙事提供了参考。

| 媒体/平台 | 语言 | 相关内容 |
|-----------|------|---------|
| **CyberNews** | 英文 | Claude Code 源码公开事件首发报道 |
| **DEV.to** | 英文 | Harness Engineering 框架文章，三阶段演进叙事来源 |
| **X / Twitter** | 中英文 | 社区讨论的主要阵地；22条直接相关推文总浏览量约3,350,000+ |
| **GitHub** | 英文 | 源码公开后的传播平台、衍生项目主要托管地 |
| **知乎** | 中文 | 深度技术分析文章（含4层压缩+950行Python复现） |
| **飞书 / Lark** | 中文 | 橙皮书等长篇内容的托管平台 |

---

## 工具与技术参考

以下工具和技术在本书中被分析、对比或作为技术背景提及。

### Claude Code 核心依赖栈

| 技术 | 角色 | 在本书中的覆盖 |
|------|------|--------------|
| **TypeScript** | 主语言（1,884 个文件） | 贯穿全书 |
| **Node.js / Bun** | 运行时 | 启动序列、Pre-import 并行优化 |
| **React / Ink** | 终端 UI 框架 | 终端UI章节（reconciler、虚拟DOM） |
| **Yoga Layout Engine** | 布局引擎（纯 TS 移植） | 终端UI章节（Flexbox 字符网格实现） |
| **Zod v4** | Schema 验证 | 设置系统章节（工程决策分析） |
| **Commander.js** | CLI 框架 | 启动序列章节 |
| **chalk** | 终端颜色 | 启动序列 |
| **marked** | Markdown 解析 | CLAUDE.md 加载系统（@include 解析） |

### Anthropic 专有依赖

| 包名 | 角色 | 分析状态 |
|------|------|---------|
| **@anthropic-ai/sdk** | 主 LLM API 调用 | 已分析 |
| **@anthropic-ai/bedrock-sdk** / **@anthropic-ai/vertex-sdk** | AWS Bedrock / GCP Vertex 接入 | 已分析 |
| **@anthropic-ai/claude-agent-sdk** | 子 Agent 能力 | 已分析 |
| **@anthropic-ai/sandbox-runtime** | 沙箱执行运行时（闭源） | 已分析（显式标注分析断裂） |
| **@modelcontextprotocol/sdk** | MCP 协议实现 | 已分析 |

### 可观测性与运维

| 技术 | 角色 | 在本书中的覆盖 |
|------|------|--------------|
| **OpenTelemetry** | 分布式追踪、度量、日志 | 遥测章节（Span层级、gRPC导出器） |
| **Datadog** | 事件分析后端 | 遥测章节（Client Token、事件路由） |
| **Honeycomb** | Tracing 后端 | 遥测章节（60KB截断限制、OTLP协议） |
| **GrowthBook** | Feature Flag / A-B 测试 | 多章节（tengu_ 前缀门控系统） |

### 安全相关

| 技术 | 角色 | 在本书中的覆盖 |
|------|------|--------------|
| **macOS seatbelt** / **sandbox-exec** | macOS 原生沙箱 | 沙箱系统章节 |
| **bubblewrap (bwrap)** | Linux 用户态沙箱 | 沙箱系统章节 |
| **gitleaks** | 密钥扫描规则 | 横切关注点（secretScanner.ts） |
| **@withfig/autocomplete** | 命令补全库（Fig） | BashTool 安全防线（命令规格注册） |

### 对比框架与工具

| 框架/工具 | 在本书中的角色 |
|-----------|--------------|
| **LangChain** / **LangGraph** | 多章竞品对比（AgentExecutor、Callbacks、ConversationSummaryMemory、图状态机编排） |
| **LangSmith** | AI 可观测性行业标杆对比（Run Tree 概念） |
| **LlamaIndex** | 上下文压缩竞品对比 |
| **LangMem** | 记忆系统竞品对比（向量数据库方案） |
| **Mem0** | 记忆系统竞品对比（语义索引方案） |
| **Zep** | 记忆系统竞品对比（知识图谱 + 向量混合） |
| **LiteLLM** / **Instructor** | 轻量替代方案提及 |
| **Vercel AI SDK** | 钩子系统对比（onToken / onFinish） |
| **CrewAI** | 多 Agent 框架对比 |
| **AutoGen** | 多 Agent 框架对比（"重代码"编排路线） |
| **AutoGPT** | 记忆策略对比（"每步都存储记忆"方式） |
| **Semantic Kernel** | Plugin → Planner 演进对比 |
| **E2B** | 沙箱方案对比（Code Interpreter SDK） |
| **Docker** / **Kubernetes** | 架构类比和安全方案对比（多处） |
| **MCP（Model Context Protocol）** | 扩展生态核心协议（77处提及） |

---

## 致谢

这本书的诞生，源于一次意外的源码公开事件，但它能走到今天，靠的是整个社区的集体智慧。

**感谢 Anthropic 工程团队。** 我们对你们的工程能力怀有真诚的敬意。Claude Code 是一个设计精良的系统，很多决策在深入分析后让人由衷佩服。本书中的批评同样出于真诚——指出设计取舍和潜在问题不是贬低，而是工程分析应有的态度。

**感谢社区分析者。** @tvytlx 的924K浏览深度报告、@AlchainHust 的75页橙皮书、@Barret_China 的Tulving框架映射、@0xJoooe 的Prompt工程六原则、@servasyy_ai 在源码公开前两天提出的Harness Engineering框架、@yq_acc 的系统性效应论、@troyhua 的7层记忆拆解——你们的工作为中文技术社区树立了深度分析的标杆。没有这些先行者的探索，本书很多章节的分析维度会窄得多。

**感谢开源建设者。** @idoubicc 把源码公开变成了开源契机，@wquguru 用两本书建立了对比框架，@jiayuan_jy 将协作需求落地为产品，ccunpacked.dev 用交互动画降低了理解门槛。你们证明了：一次源码公开事件，可以成为整个行业的学习资源。

**感谢行业思想者。** Harrison Chase 的三层架构框架为我们提供了分析坐标系，Endel Tulving 50年前的记忆理论在AI Agent时代焕发了新的生命力。从操作系统、分布式系统到认知心理学——计算机科学半个世纪积累的智慧，在这个新领域中一一得到验证。

**感谢每一位读者。** 这本书有88章、约39万字，能读到这里的你，本身就是对深度技术内容最好的投票。

---

> 如果我们遗漏了任何应该被致谢的贡献者或来源，请告知我们，我们将在后续版本中补充。

---

## 已知源码缺失清单

本书基于 Claude Code 2.1.88 从 `cli.js.map` 恢复的源码快照进行分析。以下模块在当前快照中被引用但宿主文件缺失，不影响主线行为分析，但本书不会对其内部实现做推测。

| 缺失模块 | 引用位置 | 性质 |
|---------|---------|------|
| `SendUserFileTool/` 执行宿主目录 | `tools.ts` require 引用、`ToolSearchTool/prompt.ts`、`Messages.tsx`、`conversationRecovery.ts` | 工具宿主簇缺口 |
| `UserCrossSessionMessage` 渲染组件 | `UserTextMessage.tsx` require 引用 | 渲染宿主缺口 |
| `peerSessions.js` 完整实现 | `SendMessageTool.ts` require 引用 | 发送宿主缺口 |
| `src/buddy/observer.ts`（fireCompanionObserver 定义） | `REPL.tsx` 调用、`AppStateStore.ts` 注释指向 | observer 宿主缺口 |
| `setReplBridgeActive()` 调用方 | `bootstrap/state.ts` 定义存在，全源码无调用 | capability gate writer 缺口 |
| `@anthropic-ai/sandbox-runtime` | 多处引用 | 闭源沙箱运行时包 |

> 这些缺失的共同特征是：系统的消费侧（reader/caller/renderer）完整存在，只是执行侧（writer/executor/host）在当前快照中不在。行为语义可从消费侧反推，但具体实现有待官方开源或后续版本确认。
