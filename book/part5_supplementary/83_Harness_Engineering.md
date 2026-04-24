# Harness Engineering：从 Claude Code 看 Agent 工程化范式

> **板块说明**：本章属于"补遗与延伸"板块——前面的 Part 1~6 逐章解析 Claude Code 的源码机制、子系统结构和工程哲学，回答"是什么、怎么做"。本章换一个视角，把这些机制放回更宽的行业坐标系里，回答"这套做法在整个 Agent 工程演化史里属于什么范式，它叫什么名字，背后有什么争论"。

---

## 引子：为什么要多讲一章

前面 Part 1~6 以 Claude Code 2.1.88 的源码为锚，讲 agent loop、工具调用、上下文压缩、子 agent、CLAUDE.md、Hooks、MCP……如果你跟到这里，你已经知道 Claude Code 是怎么运转的。

但你可能注意到一件有趣的事情：**行业里涌现出了一个新词——"Harness Engineering"**——而 Claude Code 本身，正是这个词语境下被反复引用的核心案例之一。

2026 年初前后，Anthropic、OpenAI、LangChain、Thoughtworks（Martin Fowler 站点）相继发表文章，都在谈"harness"。学术界随即跟上，arXiv 上出现了专门研究"agent harness"的论文。Hacker News 的热帖把它列为话题，批评者嘲讽它是"给旧瓶换了新标签"，支持者说它是"Agent 时代软件工程纪律的具体化"。

**这章存在的理由有三个：**

第一，名字本身就是知识。当工业界给一套实践起了名字，说明它的边界和内涵已经相对清晰。了解"harness engineering"这个词的来源、演化、争议，有助于把前 82 章学到的技术细节放进更大的认知框架。

第二，Claude Code 在这场命名运动里不是旁观者，而是直接当事人。Anthropic 自己的工程博客是"harness"一词的重要发源地之一，Claude Code 的 agent loop 被反复作为标准实现引用。白皮书如果不交代这层背景，会留下一个明显的空白。

第三，这场争论对你有实际价值。如果你在做自己的 Agent 应用，"harness engineering 是新范式还是旧概念穿新衣"这个争论的答案，直接影响你应该花多少工程精力在 harness 层。

---

## 1 概念溯源：这个词从哪里来

### 谁先用了这个词

调研覆盖了 37 个可成功抓取的来源，最早在 arxiv **标题**里使用"harness"加 agent 的学术论文，是 2025 年 7 月 15 日 Zhang、Yu、Hu、Jin、Zhang 等人发表的《General Modular Harness for LLM Agents in Multi-Turn Gaming Environments》（arXiv 2507.11633）。他们的"harness"定义为"感知-记忆-推理三模块的组合框架"，是从游戏 AI 研究的传统里独立演化出来的，和后来工业界的用法在概念外延上有差异。

工业界第一次把"agent harness"作为有系统性定义的工程概念正式使用，是 LangChain 工程师 Vivek Trivedy 在 **2025 年 9 月 23 日**发表的博文《The Claude Code SDK and the Birth of HaaS (Harness as a Service)》。他给出的定义原文如下：

> "External set of functionality to enhance a model's runtime execution. Examples include (1) conversation & context management, (2) a tool invocation layer (MCP/SDK tools), (3) permissions, (4) session & file-system state, (5) loop control & error handling, (6) basic observability/telemetry."

这个定义后来演化出更简洁的表述：**Agent = Model + Harness**，"If you're not the model, you're the harness."（Trivedy，LangChain Blog，2026-03-10）

💡 **通俗理解**：如果把 AI 模型比作一位厨师，那么 harness 就是整个厨房——炉灶、刀具、食材货架、操作规程、出菜标准、清洁制度。厨师一个人做不出一家餐厅；让他高效工作的是那套系统。

### Anthropic 的平行路径

Anthropic 的时间线值得单独梳理，因为它本身就是一个说明内部认知演化的活标本。

2025 年 9 月 29 日，Anthropic Applied AI 团队（Rajasekaran、Dixon、Ryan、Hadfield）发表了《Effective Context Engineering for AI Agents》。这篇文章的核心词是"**context engineering**"——"wrangling LLMs often requires thinking in context"——**文章里"harness"一词零次出现**。这说明 Anthropic 内部在 2025 年 9 月仍然用 context engineering 作为主要框架，尚未采用 harness 这个词。

同一天，Anthropic 另一篇文章（Shihipar 等，《Building Agents with the Claude Agent SDK》）把 Claude Code SDK 的底层叫做"agent harness"——这是 Anthropic 博客里第一次出现这个词，但在正文里的地位还不突出。

真正的转折点是 **2025 年 11 月 26 日**：Justin Young 发表《Effective Harnesses for Long-Running Agents》，这是 Anthropic 官方博客第一次**在标题里**使用"harness"，并在脚注中明确写道："System prompt, tools, and overall agent harness were otherwise identical."

随后，2026 年 1 月 9 日，Anthropic 发表《Demystifying Evals for AI Agents》，开始区分"evaluation harness"与"agent harness (scaffold)"，标志着术语在 Anthropic 内部走向系统化。

至 2026 年 3 月 24 日，Rajasekaran 发表《Harness Design for Long-Running Application Development》，这是 Anthropic 第二篇以 harness 为核心主题的博文，完成了内部框架的公开化。

### "Harness Engineering"这个组合词是谁造的

这里有一个细节容易混淆：**"agent harness"这个词和"harness engineering"这个组合词的来源不同**。

Trivedy 在 2025 年 9 月使用的是"harness as a service"（HaaS），Anthropic 在 2025 年 11 月开始使用"harness"作为产品术语——但"harness engineering"作为一个**专有的行业术语**，爆发点是 OpenAI 工程师 Ryan Lopopolo 于 **2026 年 2 月 11 日**发表的《Harness engineering: leveraging Codex in an agent-first world》。这篇文章虽然遭到了 403 反爬拦截，但通过 engineering.fyi 镜像、InfoQ、TheNeuron 等多个二次源完整还原了内容，后文第 3 节将详细讨论。

时间顺序整理如下：

```
Zhang 等 arxiv 游戏 AI (2025-07-15)
    ↓
Trivedy HaaS (2025-09-23)          ← 工业界首次系统定义
    ↓
Anthropic Young (2025-11-26)       ← Anthropic 标题首次采用
    ↓
OpenAI Lopopolo (2026-02-11)       ← "harness engineering"作为专有术语爆发
    ↓
LangChain、InfoQ、学术界跟进 (2026-02 至 2026-04)
```

需要说明的是：把 Anthropic 描述为"比 OpenAI 早 2.5 个月"使用 harness 这个词是准确的（2025-11-26 vs 2026-02-11），但"harness engineering"这个**组合术语**是 OpenAI 率先普及的。两者贡献的是不同的东西——Anthropic 先实践、先命名，OpenAI 后来用更响亮的叙事把这个词推向了行业流行词。

### 和相邻词的区分

"Harness"不是孤立存在的，它和几个已有词语有明确的边界。

LangChain 的三分法（2025-10-25）对此最清晰：**Agent Framework**（LangChain、CrewAI、OpenAI Agents SDK 等抽象层）、**Agent Runtime**（LangGraph、Temporal、Inngest 等生产执行引擎）、**Agent Harness**（Claude Code、Cursor 等"batteries-included"预置方案，含 prompt、工具处理、文件系统）。LangChain 自己也承认"边界是模糊的"。

OpenDev 论文（arXiv 2603.05344，Bui）给出了目前最清晰的 scaffolding vs harness 区分：**Scaffolding = 构建期**（system prompt 编译、tool schema 建立、subagent 注册，发生在对话生命周期开始之前）；**Harness = 运行期**（dispatching tools、compacting context、enforcing safety invariants、persisting state across turns）。这和 Anthropic 把 scaffold 和 harness 当同义词的用法有微妙差异，值得注意。

---

## 2 五代范式演化：行业认知怎么走到这里

以下是一个分析性框架，并非任何单一来源的直接引用，而是从多方调研材料提炼出的概念地图。

### 第 1 代：Pure Prompt（2022 年前后）

ChatGPT 刚出现时，工程师的主要工作是写一个好 prompt，发出去，收回来，结束。没有工具，没有循环，没有状态。每次对话都是无记忆的单轮交互。

💡 **通俗理解**：你给一个外卖平台发了一条短信，对方回了一条，交互结束。没有订单追踪、没有骑手实时定位、没有异常处理流程。

Claude Code 白皮书第 1 章到第 5 章描述的正是 Claude 的基础对话层；这一代范式就停在那个层次。

### 第 2 代：Tool Use（2023 年）

模型开始获得调用工具的能力——搜索引擎、代码执行器、文件读写。Function calling / tool use 成为主流接口。工程师需要定义 tool schema，处理模型的工具调用请求，返回执行结果。

💡 **通俗理解**：外卖平台开始接入地图、库存系统、支付接口——但每次接单还是一条独立请求，没有跨会话的记忆，没有自主决策循环。

Claude Code 第 7 章到第 14 章覆盖了这一层：bash 工具、file ops、MCP 工具调用系统。

### 第 3 代：Multi-Agent / Orchestration（2023-2024 年）

把多个模型拼成 pipeline，或者让一个"orchestrator"模型调度多个"worker"模型。CrewAI、AutoGen、LangGraph 都在这个思路下诞生。工程师的主要工作变成了"设计 agent 之间的协作关系"。

💡 **通俗理解**：外卖平台变成了一家物流公司——调度员、骑手、客服是不同角色，但整个流程还是靠人（工程师）事先画好流程图来驱动。

Claude Code 第 50 章到第 55 章讲到了子 agent（Task tool）和 subagent 产卵机制，这就是第 3 代的产物。

### 第 4 代：Harness（2025 年至今）

第 3 代的问题在于：orchestration 设计得再好，agent 还是会在细节上失败——格式错误、遗忘上下文、过早宣布完成、不知道怎么恢复工作现场。工程师发现，让 agent 可靠工作，不只要设计"谁干什么"，还要精心设计 agent **运行的环境本身**：进度文件、特性清单、启动脚本、lint 规则、反馈循环、垃圾回收……这整套环境，就是 harness。

Trivedy 的表述最简练：**Agent = Model + Harness**。模型负责推理，harness 负责让推理发生在正确的时间、拥有正确的信息、产出可验证的结果。

💡 **通俗理解**：赛车运动里"harness"原意是赛车手座椅上的安全带系统——不是发动机，不是轮胎，但没有它，再强的发动机也不安全。Harness Engineering 就是专门设计这套"安全带+仪表盘+赛道规则"的工程实践。

这一代的标志性实践：Young 的 initializer + coding agent 双组件方案、Lopopolo 的 AGENTS.md-as-table-of-contents、LangChain 的 generator-evaluator 反馈循环。Claude Code 本身就是这一代范式的代表实现。

### 第 5 代：端到端强化学习（行业争议中）

Noam Brown（OpenAI 推理研究员）等人认为，harness 本质上是"在 pre-training 和 post-training 不够强的情况下打补丁"。随着模型通过大量 RL 训练内化更强的自我校正能力，大多数 harness 会自然消失。这是"Bitter Lesson"的 Agent 版本：通用计算会打败专用工程。

但 Rajasekaran 本人（Anthropic）在 2026-03-24 的文章里给出了另一个观察：他用 Opus 4.5 搭建的三 agent GAN 架构，在升级到 Opus 4.6 之后**只是简化了 harness，而不是消除了它**——"the space of interesting harness combinations doesn't shrink as models improve. Instead, it moves."

这个争论在本章第 5 节展开。

---

## 3 三家主要实现对比

以下对比三个最具代表性的 harness 实现：Anthropic（Claude Code）、OpenAI（Codex Harness）、LangChain（DeepAgents + Trivedy 的方法论）。调研还覆盖了 Cursor、Cline、Aider，但这里聚焦在理念分歧最大的三家。

### Anthropic：Claude Code

**核心理念**："Thinnest possible wrapper"——harness 的作用是补模型之不足，不应过度设计。Rajasekaran 的金句："Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing."

**Agent Loop**：Claude Agent SDK 提供的三阶段循环（gather context → take action → verify work），支持跨 session 接力。Young 的方案是 initializer agent（首次建立环境：init.sh、claude-progress.txt、初始 git commit）+ coding agent（每次 session 做增量进展）。

**上下文管理**：两种模式并存——automatic compaction（原地摘要压缩，适合 Opus 4.x，因其 context anxiety 较弱）和 context reset（清空重来，配结构化 handoff artifact，原来是 Sonnet 4.5 必须的，因为 Sonnet 有明显的"上下文焦虑"）。Skills 系统通过 progressive disclosure 按需加载指令，防止 instruction budget 被预先占满。

**规范文件**：CLAUDE.md 是主要载体；Young 的多 session 系统额外用了 feature_list.json（over 200 features）和 claude-progress.txt；Rajasekaran 的 3-agent 系统用 sprint contract 文件做 agent 间通信。

**评估和反馈**：Rajasekaran 的 evaluator agent 仿照 GAN 架构，用 few-shot calibration 调教为"怀疑论者"，配 Playwright MCP 进行实际 UI 交互测试。

💡 **通俗理解**：Anthropic 的做法像一位极简主义装修师——能不装的就不装，只在墙上有裂缝的地方才打补丁。

**对应 Claude Code 章节**：agent loop → 第 6 章；context compaction → 第 28 章；CLAUDE.md / Skills → 第 36-37 章；Task tool / subagent → 第 51 章；MCP → 第 44-47 章。

### OpenAI：Codex Harness

**核心理念**："Humans steer. Agents execute."工程师的角色从"写代码"转变为"设计 agent 运行的环境"。

**实验规模**（来源：InfoQ、TheNeuron、Ignorance.ai、Lavaee、engineering.fyi 等五重拼接，均高度一致）：5 个月，起始 3 名工程师（后扩至 7 名），约 100 万行代码，约 1500 个 merged pull request，平均 3.5 PR/工程师/天，零 manually-written code，每行——包括应用逻辑、测试、CI 配置、文档、observability 工具——全部由 Codex agent 写出。

**上下文管理**：AGENTS.md 的核心用法是"目录"而非"手册"——约 100 行，仅作为指针，指向 `docs/` 下的结构化深度文档（design-docs、exec-plans、product-specs、references 等）。Lopopolo 的原话："Context is a scarce resource. A giant instruction file crowds out the task, the code, and the relevant docs." 应用层设计为对 Codex 可读（application legibility）：git worktree 启动、Chrome DevTools Protocol DOM inspection、Victoria Logs（LogQL）+ Victoria Metrics（PromQL）暴露运行时 observability。单次 Codex run 可独立运行 **6 小时以上**。

**架构约束**：层级依赖固定为 **Types → Config → Repo → Service → Runtime → UI**，通过自定义 linter 和 structural test 机械强制。口味偏好（taste invariants）被编码成 lint 规则，lint error message 本身就写成 remediation instruction 直接 inject 进 agent context。

**反馈循环**：后台 garbage collection agent 定期扫描 drift，开 refactoring PR（大多数 review under a minute，可 automerge）。早期每周五全天（约占每周 20% 时间）的人工 cleanup 被这个 agent 替代。

💡 **通俗理解**：如果说 Anthropic 的做法是极简主义装修师，OpenAI 的做法更像是建了一整套严格的楼盘质检体系——建筑规范、验收标准、自动巡检机器人——施工队（agent）在这套体系里干活，不会"装坏了没人知道"。

**关键数字来源**：以上数字均来自 InfoQ（2026-02-21）、Ignorance.ai（2026-02-22）、TheNeuron（2026-03-12）、Alex Lavaee（无日期）、engineering.fyi 的五重交叉比对，高度一致，可信。OpenAI 原文因 403 无法直接抓取，有这一信息空缺。

### LangChain：Trivedy 方法论 + DeepAgents

**核心理念**：把 harness 作为可研究、可迭代的独立对象，追求"harness 可移植性"。

Trivedy 的最重要实证是 2026-02-17 发表的《Improving Deep Agents with Harness Engineering》：LangChain 团队**只改 harness，不动模型**（gpt-5.2-codex 不变），把 Terminal Bench 2.0 成绩从 52.8% 提升到 66.5%（+13.7 百分点），跻身 Top 5。对照组 Claude Opus 4.6 在同一个（未针对 Opus 优化的）harness 下得分 59.6%，LangChain 评论："competitive but underperforming relative to Codex, attributed to harness not being optimized for Claude's specific characteristics."

这个实验的意涵是双重的：harness 确实能显著改变同一模型的表现；但 harness 有模型特异性，不能直接移植。

Trivedy 的三分法（framework/runtime/harness）是对整个行业的概念梳理，LangChain 自己承认"边界是模糊的"。其 Anatomy 文（2026-03-10）把 harness 界定为：conversation & context management、tool invocation layer、permissions、session & filesystem state、loop control & error handling、basic observability/telemetry——和 Anthropic 的实现基本吻合，但更偏向描述性定义而非规范性实现。

💡 **通俗理解**：LangChain 的角色更像是做餐饮管理咨询的——他们不开一家餐厅，而是把各家餐厅的最佳实践抽象出来，变成可复用的管理手册。

**关键对比数据表**（用于后续图表 brief）：

| 维度 | Anthropic (Claude Code) | OpenAI (Codex Harness) | LangChain |
|------|------------------------|------------------------|-----------|
| 核心信条 | "Thinnest wrapper"；harness 补差 | "Humans steer, agents execute" | "Agent = Model + Harness"，可移植 |
| loop 机制 | gather→act→verify；multi-session | Ralph Wiggum 持续循环；6h+ 独立运行 | generator-evaluator 反馈循环 |
| 上下文策略 | Compaction + Context Reset + Skills | AGENTS.md 目录（~100 行）+ structured docs | 可移植自然语言 harness（NLAH 方向） |
| 规范文件 | CLAUDE.md + feature_list.json | AGENTS.md + docs/ | .langchain/ rules（生态分散） |
| 多 agent | Task tool subagent；GAN 3-agent | Background GC agent；Skills with Owners | DeepAgents；generator/evaluator 对抗 |
| 关键数据 | 200+ features；DAW 构建 $124.70 | 1M 行代码；3.5 PR/人/天；6h+ per run | +13.7% Terminal Bench（仅改 harness） |
| 对模型能力的假设 | 随模型改进动态简化 harness | harness 承载"taste"，模型执行 | harness 可移植，不依赖特定模型 |

---

## 4 学术支撑：四篇 arXiv 论文全覆盖

调研文档记录了 4 篇直接以"harness"为研究对象的 arxiv 论文，全部覆盖如下。

### arXiv 2507.11633：General Modular Harness（Zhang 等，2025-07-15）

**作者**：Yuxuan Zhang、Haoyang Yu、Lanxiang Hu、Haojian Jin、Hao Zhang。**这是目前可查最早在 arxiv 标题里使用"harness"作为 agent 术语的学术论文**，比 Trivedy 的工业博文（2025-09-23）还早两个月，但两者相互独立，没有引用关系。

**研究内容**：为多轮游戏环境下的 LLM agent 提出模块化 harness 框架，由感知（perception）、记忆（memory）、推理（reasoning）三模块组成，可 plug-and-play 开关任意模块做受控消融实验。

**关键发现**：在 Sokoban、2048、Candy Crush、Tetris 四个游戏上，完整 harness 对比 unharnessed baseline 的提升具有统计显著性（配对 t-test p<0.05）；Candy Crush 中位提升 +217.50 分；模块贡献有任务特异性——感知模块主导 Sokoban（空间复杂）、Tetris，记忆模块主导 2048（长时规划）、Candy Crush。

**对 Harness 范式的贡献**：这篇论文的"harness"和工业界 Trivedy 的"harness"在概念上有差异——Zhang 等的定义更偏认知架构（感知-记忆-推理），Trivedy 的定义更偏工程组件（上下文管理-工具调用-权限-状态-loop 控制-可观测性）。但两者有一个共同内核：**harness 是模型之外、让模型可靠工作的组件集合**。这篇论文证明了 harness 组件对 agent 性能有可测量、可分解的因果影响——这是后来学术界大量跟进的基础。

### arXiv 2603.03329：AutoHarness（Lou 等，2026-02-10）

**作者**：Xinghua Lou、Miguel Lázaro-Gredilla、Antoine Dedieu、Carter Wendelken、Wolfgang Lehrach、Kevin P. Murphy（Google DeepMind）。

**研究内容**：提出 AutoHarness 框架，让 LLM 自动合成包裹自己的代码 harness，无需人工手写。动机来自对现有问题的观察：在 Kaggle GameArena 棋类对战中，78% 的 Gemini-2.5-Flash 失败案例归因于非法移动——这些移动不是次优决策，而是环境直接禁止的。

AutoHarness 提出三种 harness 变体：（1）action-filter（直接过滤非法动作）；（2）action-verifier（主要形式：control loop 调用 LLM 并拒绝不可接受的答案）；（3）code-as-policy（把整个策略编译成代码，完全消除 decision time 的 LLM 调用）。

**关键数据**：在 145 个 TextArena 游戏中达到 100% 合法动作率；2 人游戏中 Gemini-2.5-Flash + AutoHarness 对战 Gemini-2.5-Pro 胜率 56.3% vs 38.2%；code-as-policy 模式平均 reward 0.870，超过 GPT-5.2-High 的 0.844。自动合成过程平均使用 14.5 次 tree search iteration（Thompson sampling 引导）。

**对 Harness 范式的贡献**：AutoHarness 证明了"harness 本身可以由模型自动生成"，这在概念上开了一个新方向——**不是工程师手工设计 harness，而是模型自己发现自己需要什么约束**。这对应 Rajasekaran 的 evaluator agent 思路，也对应 Lopopolo 的"自定义 lint 规则由 Codex 自己写出（with 100% test coverage）"。

### arXiv 2603.25723：NLAH（Pan 等，2026-03-26）

**作者**：Linyue Pan、Lexiao Zou、Shuo Guo、Jingchen Ni、Hai-Tao Zheng。

**研究内容**：提出 Natural-Language Agent Harnesses（NLAH），把 harness 的控制逻辑从嵌入代码里的"隐式控制流"外化为可读、可编辑的自然语言 artifact。配套提出 Intelligent Harness Runtime（IHR），由 in-loop LLM（读 harness logic、current state、runtime charter）+ backend（terminal tools + multi-agent interface）+ runtime charter（定义 contracts/state/orchestration 语义）三部分组成。

NLAH 暴露的核心 harness 组件：**Contracts**（what artifacts must be produced, what gates must be satisfied）、**Roles**（solver/verifier/researcher/orchestrator）、**Stage structure**（plan→execute→verify→repair）、Adapters、State semantics、Failure taxonomy。

**关键数据**：SWE-bench Verified（125 samples）：Full IHR TRAE 74.4%，Full IHR Live-SWE 72.8%；OSWorld（36 samples）：Native OS-Symphony 30.4%，迁移到 NLAH 的版本 47.2%（+16.8 百分点）。

**对 Harness 范式的贡献**：这篇是目前学术界最正式地将"agent harness"当作**可研究的科学对象**来处理的论文。Related Work 直接引用了 Anthropic 的 Young 文（2025-11-26），以及"Building effective agents"，Claude Code 也被明确引用。NLAH 对 harness 的三维定义（Control/Contracts/State）是目前所有来源里最严谨的学术表述。

该论文还提出了一个值得关注的发现："Module effects concentrate on a small solved frontier rather than shifting the whole benchmark uniformly"——harness 组件的效果不会均匀分布在所有任务上，只在"模型自己差一点但做不到"的边界区域有显著作用。这和 Rajasekaran 的直觉完全吻合。

### arXiv 2603.05344：OpenDev（Bui，2026-03-05，v3 改 2026-03-13）

**作者**：Nghi D. Q. Bui。

**研究内容**：介绍用 Rust 实现的 terminal-native AI 编程 agent OpenDev，采用 compound AI system 架构（不同 LLM 分配不同认知工作）、双 agent 架构（规划与执行分离）、lazy tool discovery（减少 token 浪费）、adaptive context compaction（渐进压缩旧观察）、automated memory system（跨 session 积累项目特定知识）。

**关键贡献**：给出了目前最清晰的 scaffolding vs harness 区分（构建期 vs 运行期），并明确向 Claude Code 致敬——"Claude Code led this shift, demonstrating that a terminal-native agent could match or exceed IDE-integrated tools in real-world software engineering tasks."

五条 Lessons Learned 与 Claude Code 白皮书前 82 章高度呼应：Context Pressure as Central Constraint（对应第 28 章 compaction）、Long-Horizon Steering（对应第 31 章 memory 机制）、Safety Through Architecture（对应第 39 章权限模型）、Designing for Approximate Outputs（对应第 18 章工具调用容错）、Lazy Loading and Bounded Growth（对应第 36 章 Skills 渐进披露）。

**对 Harness 范式的贡献**：OpenDev 把 Claude Code 的"thin wrapper"哲学具体化为一套可实施的 Rust 架构，提供了一个独立的、工业级的 reference implementation，也是从工程实践角度对 harness 定义做出了规范化贡献。

---

## 5 行业批评：Harness 是新范式还是旧概念换新衣

### 怀疑阵营的核心论点

最强烈的批评来自两个方向，代表不同的动机。

**"新名旧物"批评**：Chayenne Zhao（@GenAI_is_real，X 帖子及 LinkedIn 文章《Harness Engineering Is Just Good Engineering With a New Name》）的观点最尖锐：

> "From prompt engineering to context engineering to harness engineering — every few months someone coins a new term, writes a 10,000-word essay, sprinkles in a few big-company case studies, and the whole community starts buzzing. It's the same thing every time: Design the environment your model runs in. This has existed since the day ChatGPT launched."

这个批评有一定道理。如果把 harness 理解为"让模型在好的环境里工作"，这确实不是新概念。但它混淆了"概念的存在"和"概念的系统化"——现代医学里的"卫生"概念在李斯特之前也"存在"，但给出可操作的、可传播的规范，本身就有价值。

**"Bitter Lesson"批评**：Noam Brown（OpenAI）等认为 harness 本质上是打补丁，最终会被更强的模型取代。METR 的研究发现专业 harness（Claude Code、Codex）相比 basic scaffold 的优势 negligible，Scale AI SWE-Atlas 也发现"harness choice 产生的性能差异在 within experimental error margins"。

swyx（Latent Space）在 2026-03-05 的文章里把这个争论构造成"**Big Model vs Big Harness**"：
- Big Model 阵营引用 Anthropic 内部说法："All the secret sauce, it's all in the model. And this is the thinnest possible wrapper."
- Big Harness 阵营援引 LangChain 的实证：只改 harness 让同一模型提升 13.7 百分点（Terminal Bench 2.0）。

swyx 自己的立场微妙："You can engineer your way above the Bitter Lesson, and harnesses can survive even reasoning paradigm changes."

HumanLayer 的 Kyle 提出了一个反直觉的发现：Terminal Bench 2.0 数据显示，Opus 4.6 在 Claude Code 的官方 harness 下排名 #33，但在 LangChain 重新设计的 harness 里排名 #5——这意味着**Claude Code 自己的 harness 可能反而限制了 Opus 4.6 的潜力**，因为 Codex 模型在 post-training 阶段被深度 coupled 到 `apply_patch` 工具，而 Claude Code 的 harness 也在 post-training 时期被深度 coupled 到 Claude 自身——两者都可能是"模型对自己的 harness 过拟合"。

### 支持阵营的核心论点

支持 harness engineering 作为独立工程纪律的论点，归根结底集中在以下几点：

第一，**分层是软件工程的基本方法**，OS 在应用层之下，网络协议栈在 OS 之下，没有人认为分层是"脚手架/拐杖"。Agent 时代的 harness 层，只是新的分层。

第二，**模型能力提升不会消灭 harness，只会改变 harness 的形态**。Rajasekaran 在 2026-03-24 的文章里记录了从 Opus 4.5 升级到 Opus 4.6 的过程：sprint 结构被简化，context reset 被移除，但 planner 和 evaluator 两个核心组件保留了。"The space of interesting harness combinations doesn't shrink as models improve. Instead, it moves."

第三，**NLAH 论文的发现提供了理论支撑**："Module effects concentrate on a small solved frontier"——harness 的作用区域不是全部任务，而是"模型自己差一点但做不到"的边界区域。随着模型变强，这个边界往外移，harness 在新的边界处继续有价值。

### 我的判断

"Harness Engineering 是脚手架/拐杖"这个批评建立在一个假设上：**终点是模型自己完成所有事情**。这个假设本身值得怀疑。

生产环境里，单一模型完成所有事情的方案有一个根本性弱点：**可解释性和可调试性极差**。当一个复杂任务失败时，你不知道是哪个步骤出了问题。Harness 层的存在，恰恰让各个组件的责任边界清晰——initializer 失败了，还是 evaluator 评分偏松了，还是 lint 规则覆盖不够？这和微服务为什么不会因为单体服务性能提升而消失，道理是一样的。

另一方面，"新名旧物"的批评失之于苛刻。**系统化命名本身就有生产力**。在 Trivedy 和 Lopopolo 给出清晰定义和可操作框架之前，每个工程师都在独立摸索"如何让 agent 不在长任务里失控"——现在有了可以交流的概念，社区的迭代速度明显提升。

综合来看，我认为 harness engineering 是**真实的工程需求的系统化表达**，而不是全新发明。它值得独立命名，值得作为工程规范来推广；但它也不应被包装成"颠覆性新范式"——它是成熟软件工程原则（分层、约束、反馈循环、渐进增量）在 LLM agent 场景的具体化。

---

## 6 对照 Claude Code 源码：Harness 的核心要素在哪里

Harness 有六类核心要素（取自 Trivedy 的原始定义，并对照 NLAH 的 Control/Contracts/State 三维）。下面逐一对照 Claude Code 的实际机制，标注对应的白皮书章节。

### 要素一：Conversation & Context Management（对话与上下文管理）

Claude Code 对应机制：
- **Context Compaction**：`compactConversation` 相关逻辑（第 28 章），原地摘要压缩，保留对话连续性
- **Context Reset**：`/clear` 命令（第 29 章），清空上下文，配合 CLAUDE.md 重新加载
- **Sub-agent as context firewall**：Task tool 产卵的子 agent 拥有独立 context window（第 51 章），主 agent 的 context 污染不会传播

Young 的 claude-progress.txt 是一种外部化的上下文传递机制——把不同 session 之间的"记忆"外包给文件系统而不是依赖 compaction 质量。这对应白皮书第 31 章关于外部 memory 的讨论。

### 要素二：Tool Invocation Layer（工具调用层）

Claude Code 对应机制：
- **内置工具集**（第 7-14 章）：bash、file read/write/edit/search、TodoWrite、Task 等
- **MCP 子系统**（第 44-47 章）：外部工具注入，Playwright MCP（浏览器自动化）是 Young 和 Rajasekaran 文中反复出现的具体工具
- **工具权限模型**（第 39 章）：工具调用需要用户授权，`--dangerouslySkipPermissions` 是跳过机制

Lopopolo 的 Chrome DevTools Protocol + LogQL/PromQL 是 OpenAI 在工具层的扩展，对应思路与 MCP 外部工具注入基本一致，但在可观测性方向的投入更深。

### 要素三：Permissions（权限）

Claude Code 对应机制：
- **Permission system**（第 39 章）：每次工具调用都需要用户确认或预先授权
- **CLAUDE.md 中的权限声明**（第 36 章）：通过 `allowed_tools` 和 `bash_command_allowlist` 等字段预配置
- **Hooks 作为权限扩展**（第 40 章）：PreToolUse/PostToolUse hooks 可以拦截特定工具调用，实现自定义权限逻辑

### 要素四：Session & File-System State（会话与文件系统状态）

Claude Code 对应机制：
- **Git 版本控制**：Claude Code 用 git 作为状态基础设施（第 17 章）；Young 的 coding agent 强制在每个 session 结束时 commit with descriptive message
- **CLAUDE.md 作为持久化知识**（第 36 章）：项目级指令文件跨 session 持久存在，是 harness 层最重要的状态载体
- **feature_list.json / claude-progress.txt**（Young 的方案）：这两个文件在 Claude Code 源码里没有硬编码对应，但 TodoWrite 工具（第 12 章）提供了类似的待办状态管理

Lopopolo 的 AGENTS.md + docs/ 目录体系对应 Claude Code 的 CLAUDE.md + Skills（SKILL.md）体系，两者设计理念基本一致（progressive disclosure / table of contents 原则）。

### 要素五：Loop Control & Error Handling（循环控制与错误处理）

Claude Code 对应机制：
- **Agent loop 主体**（第 6 章）：`gather context → take action → verify work` 的三阶段循环
- **Hooks 的 exit code 反馈机制**（第 40 章）：PostToolUse hook 返回 exit code 2 可以重新激活 agent；这正是 HumanLayer 的 Kyle 所说的"success must be silent, only failures produce verbose output"
- **错误恢复机制**（第 20 章）：工具失败时的 fallback、重试逻辑

Lopopolo 的"minimal blocking merge gates"和"correction is cheap, waiting is expensive"是循环控制哲学的 OpenAI 版本——和 Claude Code 的"agent loop 不因单次工具失败中断"的设计一致。

### 要素六：Basic Observability & Telemetry（可观测性与遥测）

Claude Code 对应机制：
- **对话历史记录**（第 15 章）：所有工具调用和返回都保留在对话历史里，是最基础的 observability
- **Debug 模式输出**（第 5 章）：`--debug` flag 暴露 token 统计、API 调用详情
- **Hooks 的 PostToolUse 日志**（第 40 章）：可以在每次工具调用后写日志

这里 Claude Code 和 OpenAI Codex Harness 的差距最显著：Lopopolo 的方案中 agent 可以用 LogQL 查应用日志、用 PromQL 查 metrics，可观测性深入到业务层，而 Claude Code 的内置 observability 更多是 conversation-level。这可能是 Claude Code 下一步演化的方向之一。

---

## 7 给读者的启示

如果你在构建自己的 Agent 应用，这一章的材料给出了几条可操作的参考。

**第一条：先让 agent 失败，再添加 harness 组件。** 不要一开始就设计完美的 harness。Kyle 的"Skill Issue"文章说得很实在：在 agent 真实失败之前"预防性"设计 harness，往往添加了大量无效组件。正确顺序是：最小化启动，观察 agent 在哪里失败，针对性地加入 harness 组件。ETH Zurich 的研究发现 LLM 生成的 agentfile 反而损害性能且多花 20% 以上 token，说明"自动生成 harness"这条路也要谨慎。

**第二条：用"load-bearing test"检验 harness 组件。** Rajasekaran 的金句值得反复读："Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing." 做法是逐一移除 harness 组件，看对结果的影响。如果移除某个组件对结果没有影响，它可能不是 load-bearing 的，可以删掉。

**第三条：CLAUDE.md / AGENTS.md 是目录，不是手册。** Lopopolo 的约 100 行 AGENTS.md 原则同样适用于你的 CLAUDE.md。给 agent 一个导航图，让它知道"有问题去哪里找详细信息"，而不是把所有规范堆在一个文件里。

**第四条：反馈循环比正向指令更有效。** Young 的"使用 Puppeteer MCP 进行端到端测试后性能 dramatically improved"，Rajasekaran 的"调教一个外部 evaluator 比让 generator 自我批评容易得多"——两个案例指向同一个设计原则：**可验证的失败比不可测量的成功更有价值**。构建 harness 时，先想"agent 怎么知道自己做错了"，再想"怎么让它做对"。

**第五条：Harness 有模型特异性，移植要小心。** LangChain 的实验证明，在 gpt-5.2-codex 上调优的 harness 让 Claude Opus 4.6 表现低于预期，反之亦然。这不是说 harness 不可移植，而是说移植时要重新 calibrate。Claude Code 的 CLAUDE.md 惯例和 OpenAI 的 AGENTS.md 在格式上可以借鉴，但具体 prompt 风格、工具调用模式、错误处理策略，要根据你用的底层模型重新验证。

---

## 8 引用清单

以下列出本章引用的全部主要来源，按时间顺序排列。抓取失败的来源标注二次源说明。

| 序号 | 作者 | 标题 | 发布日期 | URL | 状态 |
|------|------|------|----------|-----|------|
| 1 | Zhang, Yu, Hu, Jin, Zhang | General Modular Harness for LLM Agents in Multi-Turn Gaming Environments | 2025-07-15 | https://arxiv.org/abs/2507.11633 | 成功 |
| 2 | Vivek Trivedy | The Claude Code SDK and the Birth of HaaS | 2025-09-23 | https://www.vtrivedy.com/posts/claude-code-sdk-haas-harness-as-a-service/ | 成功 |
| 3 | Anthropic Applied AI team | Effective Context Engineering for AI Agents | 2025-09-29 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 成功 |
| 4 | Thariq Shihipar 等 | Building Agents with the Claude Agent SDK | 2025-09-29 | https://claude.com/blog/building-agents-with-the-claude-agent-sdk | 成功 |
| 5 | LangChain Accounts | Agent Frameworks, Runtimes, and Harnesses — oh my! | 2025-10-25（改 2025-11-04） | https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/ | 成功 |
| 6 | Justin Young（Anthropic） | Effective Harnesses for Long-Running Agents | 2025-11-26 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | 成功 |
| 7 | Anthropic（Grace/Hadfield/Olivares/De Jonghe） | Demystifying Evals for AI Agents | 2026-01-09 | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | 成功 |
| 8 | Lee Robinson（Cursor） | Best Practices for Coding with Agents | 2026-01-09 | https://cursor.com/blog/agent-best-practices | 成功 |
| 9 | Nicholas Carlini（Anthropic） | How I Used Claude to Write a C Compiler | 2026-02-05 | https://www.anthropic.com/engineering/building-c-compiler | 成功 |
| 10 | Lou, Lázaro-Gredilla, Dedieu 等（Google DeepMind） | AutoHarness: improving LLM agents by automatically synthesizing a code harness | 2026-02-10 | https://arxiv.org/abs/2603.03329 | 成功 |
| 11 | Ryan Lopopolo（OpenAI） | Harness engineering: leveraging Codex in an agent-first world | 2026-02-11 | https://openai.com/index/harness-engineering/ | **403，用 engineering.fyi 镜像 + InfoQ + TheNeuron + Lavaee + Emil Sit 五重拼接** |
| 12 | LangChain Accounts | Improving Deep Agents with Harness Engineering | 2026-02-17 | https://blog.langchain.com/improving-deep-agents-with-harness-engineering/ | 成功 |
| 13 | Leela Kumili（InfoQ） | OpenAI Introduces Harness Engineering | 2026-02-21 | https://www.infoq.com/news/2026/02/openai-harness-engineering-codex/ | 成功 |
| 14 | Charlie Guo（Ignorance.ai） | The Emerging "Harness Engineering" Playbook | 2026-02-22 | https://www.ignorance.ai/p/the-emerging-harness-engineering | 成功 |
| 15 | Alex Lavaee | OpenAI Agent-First Codebase Learnings | 无日期 | https://alexlavaee.me/blog/openai-agent-first-codebase-learnings/ | 成功 |
| 16 | Emil Sit | OpenAI Harness Engineering 笔记 | 2026-02-24 | https://www.emilsit.net/t/2026/02/openai-harness-engineering/ | 成功 |
| 17 | engineering.fyi | 镜像：Harness engineering: leveraging Codex in an agent-first world | 2026-02-11（镜像） | https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world | 成功（作为 OpenAI 原文主替代源） |
| 18 | swyx（Latent Space） | [AINews] Is Harness Engineering real? | 2026-03-05 | https://www.latent.space/p/ainews-is-harness-engineering-real | 成功 |
| 19 | Nghi D. Q. Bui | Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering | 2026-03-05（v3 改 2026-03-13） | https://arxiv.org/abs/2603.05344 | 成功 |
| 20 | Vivek Trivedy | The Anatomy of an Agent Harness | 2026-03-10（改 2026-03-16） | https://blog.langchain.com/the-anatomy-of-an-agent-harness/ | 成功 |
| 21 | Kyle @0xblacklight（HumanLayer） | Skill Issue: Harness Engineering for Coding Agents | 2026-03-12 | https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents | 成功 |
| 22 | Grant Harvey（TheNeuron） | OpenAI Harness Engineering: Ship 1M Lines of Code w/ Agents | 2026-03-12 | https://www.theneuron.ai/explainer-articles/openais-harness-engineering-playbook-how-to-ship-1m-lines-of-code-without-writing-any/ | 成功 |
| 23 | Prithvi Rajasekaran（Anthropic Labs） | Harness Design for Long-Running Application Development | 2026-03-24 | https://www.anthropic.com/engineering/harness-design-long-running-apps | 成功 |
| 24 | Pan, Zou, Guo, Ni, Zheng | Natural-Language Agent Harnesses | 2026-03-26 | https://arxiv.org/abs/2603.25723 | 成功 |
| 25 | Birgitta Böckeler（Thoughtworks，martinfowler.com） | Harness Engineering for Coding Agent Users | 2026-04-02 | https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html | 成功 |
| 26 | Chayenne Zhao | （X 帖子，批判性立场） | 约 2026-03 | https://x.com/GenAI_is_real/status/2036266930290696599 | **402 付费墙**，仅靠搜索摘要获取核心论点 |
| 27 | James Phoenix（Understanding Data） | Generator-Evaluator Harness Design | 2026-03-25 | https://understandingdata.com/posts/generator-evaluator-harness-design/ | 成功 |

---

*本章调研基于 2026-04-06 完成的深度调研文档，覆盖成功抓取 37 个来源（含 4 篇 arxiv 论文），失败 15 个来源均已标注替代二次源。所有引用数字均注明出处。*
