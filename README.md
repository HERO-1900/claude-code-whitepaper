# Claude Code 2.1.88 白皮书

> 一份社区驱动、源码级的 Claude Code 架构分析读物
> _A community-driven, source-level architectural analysis of Claude Code_

把一个跑了一年多、被千万开发者使用的 AI 编程 CLI **拆解到能复刻的颗粒度**——不是讲它能做什么，而是讲它**怎么被工程化地做出来**。

> Take a battle-tested AI coding CLI and disassemble it down to "you could rebuild it" granularity — not what it does, but **how it is engineered**.

---

## 一键访问 · Read it now

- 线上版（中文）：<https://insidecc.dev/>
- Live (English UI): <https://insidecc.dev/?lang=en>
- 源仓库（公仓镜像）：<https://github.com/HERO-1900/claude-code-whitepaper>

> 中英双语 · 三主题（dark / warm / light）· 移动端适配 · 无需登录、无需注册

---

## 项目规模 · By the numbers

| 指标 / Metric | 数字 / Number |
|------|------|
| 章节 · Chapters | **88** |
| 中文正文 · Chinese body text | **约 39 万字 / ~390K CJK chars** |
| 交互式图表 · Interactive SVG charts | **41** |
| 收录 Prompt 原文 · Verbatim prompts | **185** |
| 覆盖子系统 · Subsystems covered | Query Loop · Tool Runtime · Agent 编排 · Prompt Factory · 安全模型 · 状态持久化 · 扩展生态 · Token 经济 · 配置治理 · 终端 UI |

---

## 如何阅读 · Reading paths

整本书是「目录 + 5 大 Part」结构，按你的兴趣选一条线就能读：

| Part | 中文 | English | 适合谁 |
|------|------|---------|--------|
| **Part 0** | 序章：把 Claude Code 当 OS 看 | Prologue: Claude Code as an OS | 第一次接触，想建立整体心智模型 |
| **Part 1** | 认识这个系统 | Meet the system | 产品经理、架构师、想理解定位 |
| **Part 2** | 代码架构完全解构 / 好奇心驱动的深度问答 | Full code architecture + Q&A | 工程师、想动手复刻 |
| **Part 3** | 子系统完全解析（权限 / Agent / Prompt / 工具运行时 …） | Subsystem deep-dives | 想专研某个子系统 |
| **Part 4** | 工程哲学 | Engineering philosophy | 想看取舍背后的判断 |
| **Part 5** | 批判与超越 | Critique & beyond | 想跳出现有方案做下一代 |

**推荐路径 · Suggested paths**

- **30 分钟版**：Part 0 序章 → Part 1 任意 1 章 → Part 2 «代码地图» 一章
- **3 小时版**：Part 0 全 → Part 2 «代码架构完全解构» 全 → Part 3 任选 2 个子系统
- **完整精读**：从 Part 0 顺读到 Part 5，配合右侧目录里的「难度分级」筛选自己想看的层

> Each chapter is tagged with a difficulty rating (入门 / 进阶 / 深度) so you can filter the table of contents.

---

## 关键特性 · Features

- **中英双语**：所有章节、UI、目录、图表标签均提供 zh / en 双版本，右上角一键切换
- **三主题**：dark（专注）/ warm（Anthropic 风格暖色，默认）/ light（打印友好），跟随系统主题
- **41 张交互式 SVG 图表**：响应式 + 主题联动 + 移动端友好，所有图表内嵌于章节正文，不是外链贴图
- **难度分级**：每章标注「入门 / 进阶 / 深度」，目录支持按分级过滤
- **灵感板块**：「火花」（异想天开的微灵感）+「蓝图」（验证过的成熟方向），独立浏览路径
- **工具与命令目录**：把 Claude Code 的工具集 / Slash 命令做成可检索的网格视图
- **185 条 Prompt 全文收录**：第一手 Prompt 原文，不做摘要不做截断

> Bilingual UI · 3 themes · 41 responsive SVG charts · difficulty filters · spark & blueprint sections · full prompt corpus.

---

## 项目定位与合规声明 · Scope & disclaimers

**这是什么 · What this is**

- 对 Claude Code 这款 AI 编程 CLI 做的**源码级架构分析**（source-level architectural analysis）
- 学术研究取向：参考专利分析、论文综述、架构案例研究的写作模式
- 全部讨论聚焦在「系统如何被组织 / 工程取舍 / 可迁移的模式」，不是教程也不是 SDK 文档

**这不是什么 · What this is NOT**

- 不是 Claude Code 的再发布或替代品
- 不包含 Anthropic 的私有源码、私有 Prompt 之外的私有工程资产、内部文档
- 不是与 Anthropic 有任何官方关联的项目

**信息来源 · Information sources**

- 文中分析基于**社区流通的公开材料**（community-released materials），引用片段限于讨论所必需的最少范围，并以分析、教学、评论为目的
- 所有文字结论、图示、比喻均为作者独立研究、再表达的产物
- 商标说明：Claude Code、Claude、Anthropic 名称及相关商标归 Anthropic 所有

**如果你是权利方** · 认为本项目中任何具体片段需要调整，请通过 GitHub Issue 联系，会配合处理。

> The whitepaper is an architectural analysis intended for research, education, and commentary. It is independent of Anthropic. If you are a rights-holder and believe any specific passage warrants adjustment, please open a GitHub Issue.

---

## License

| 内容 / Content | 协议 / License |
|------|------|
| 章节正文、图示、可视化、设计稿 | **CC BY-NC-SA 4.0** |
| 站点运行时代码片段 / 演示用 snippet | **MIT** |

完整文本见 [`LICENSE`](LICENSE)。
- CC BY-NC-SA 4.0 摘要：可分享、可改编，须**署名**、**非商用**、衍生作品**以相同协议**发布。
- MIT：仅适用于站点运行时脚本、Markdown 中标记为示例的代码片段。

---

## 致谢 · Acknowledgements

- **作者** · @HERO-1900
- **AI 协作 · AI collaboration**：Claude Opus（架构判断 / 评审）· Claude Sonnet（写作执行）· Kimi K2（图表代码生成）· MiniMax M2.7（多模态评审）
- **致敬**：Anthropic 团队让一个公开可读的 AI Agent 系统达到了今天这个水平，让社区有机会研究、学习、再创作。

---

## 反馈 · Feedback

- **GitHub Issues**：纠错、补例、勘误、提问都欢迎 — <https://github.com/HERO-1900/claude-code-whitepaper/issues>
- **Star & Share**：如果这份工作对你有帮助，给仓库一个 Star，或转发给可能感兴趣的开发者
- 项目以**业余研究**形式维护，不承诺响应时间，也不提供商业支持

> Issues are welcome for corrections, additions, and discussion. This is a hobby research project — no SLAs, no commercial support.

---

_Last updated: 2026-04-26_
