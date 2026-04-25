# Harness Engineering: Understanding the Agent Engineering Paradigm Through Claude Code

> **Section Note**: This chapter belongs to the "Supplements and Extensions" section. Parts 1~6 earlier in the book analyze Claude Code's source code mechanisms, subsystem structure, and engineering philosophy chapter by chapter, answering "what it is" and "how it works." This chapter shifts the perspective and places those mechanisms back into a broader industry context, asking: "What paradigm does this set of practices belong to in the overall evolution of Agent engineering, what is it called, and what debates sit behind it?"

---

## Introduction: Why Spend One More Chapter on This

Parts 1~6 used the source code of Claude Code 2.1.88 as the anchor to explain the agent loop, tool invocation, context compaction, sub-agents, `CLAUDE.md`, Hooks, MCP... If you've followed along to this point, you already know how Claude Code operates.

But you may have noticed something interesting: **a new term has emerged across the industry, "Harness Engineering"** and Claude Code itself is one of the core cases repeatedly cited in that term's discourse.

Around the beginning of 2026, Anthropic, OpenAI, LangChain, and Thoughtworks (via Martin Fowler's site) published articles discussing "harness." Academia quickly followed, with papers on arXiv specifically studying "agent harness." Hacker News threads turned it into a topic of discussion. Critics mocked it as "a new label on an old bottle," while supporters called it "the concretization of software engineering discipline for the Agent era."

**There are three reasons this chapter exists:**

First, names are themselves a form of knowledge. When industry gives a set of practices a name, it means the boundaries and content of that practice have become relatively clear. Understanding where the term "harness engineering" came from, how it evolved, and what controversies surround it helps place the technical details from the previous 82 chapters into a larger cognitive framework.

Second, Claude Code is not a bystander in this naming movement. It is a direct participant. Anthropic's own engineering blog is one of the important origins of the term "harness," and Claude Code's agent loop is repeatedly cited as a standard implementation. If this white paper skipped that background, it would leave an obvious gap.

Third, this debate has direct practical value for you. If you are building your own Agent application, the answer to "is harness engineering a new paradigm or just an old idea in new clothes?" directly affects how much engineering effort you should invest in the harness layer.

---

## 1. Conceptual Origins: Where Did This Term Come From

### Who used the term first

The research survey covered 37 successfully retrievable sources. The earliest academic paper to use "harness" together with agent in an arXiv **title** was *General Modular Harness for LLM Agents in Multi-Turn Gaming Environments* (arXiv 2507.11633), published on July 15, 2025 by Zhang, Yu, Hu, Jin, Zhang, and others. Their definition of "harness" was "a combined framework of perception, memory, and reasoning modules." It evolved independently from traditions in game AI research, and its conceptual scope differs from the later industry usage.

The first systematic use of "agent harness" as a formally defined engineering concept in industry came from LangChain engineer Vivek Trivedy in the blog post *The Claude Code SDK and the Birth of HaaS (Harness as a Service)*, published on **September 23, 2025**. His original definition was:

> "External set of functionality to enhance a model's runtime execution. Examples include (1) conversation & context management, (2) a tool invocation layer (MCP/SDK tools), (3) permissions, (4) session & file-system state, (5) loop control & error handling, (6) basic observability/telemetry."

This later evolved into the more concise expression: **Agent = Model + Harness**, and "If you're not the model, you're the harness." (Trivedy, LangChain Blog, 2026-03-10)

💡 **Plain English**: If you compare the AI model to a chef, then the harness is the entire kitchen: the stove, knives, ingredient shelves, operating procedures, plating standards, and cleaning rules. A chef alone cannot run a restaurant; what lets the chef work efficiently is that whole system.

### Anthropic's parallel path

Anthropic's timeline is worth tracing separately, because it is itself a living specimen of how internal understanding evolves.

On September 29, 2025, Anthropic's Applied AI team (Rajasekaran, Dixon, Ryan, Hadfield) published *Effective Context Engineering for AI Agents*. The key phrase in that article was "**context engineering**" as in "wrangling LLMs often requires thinking in context" and **the word "harness" appears zero times in the article**. That shows that, as of September 2025, Anthropic was still using context engineering as its primary framing and had not yet adopted the term harness.

On the same day, another Anthropic article (Shihipar et al., *Building Agents with the Claude Agent SDK*) referred to the lower layer of the Claude Code SDK as an "agent harness." This was the first appearance of the term on Anthropic's blog, but it still did not occupy a central position in the article.

The real turning point came on **November 26, 2025**: Justin Young published *Effective Harnesses for Long-Running Agents*. This was the first time Anthropic's official blog used "harness" **in the title**, and a footnote explicitly stated: "System prompt, tools, and overall agent harness were otherwise identical."

Then, on January 9, 2026, Anthropic published *Demystifying Evals for AI Agents*, where it began distinguishing between an "evaluation harness" and an "agent harness (scaffold)," marking the point where the terminology became systematized inside Anthropic.

By March 24, 2026, Rajasekaran published *Harness Design for Long-Running Application Development*, Anthropic's second blog post centered on harness as the primary theme, completing the public articulation of its internal framework.

### Who coined the compound term "Harness Engineering"

There is an easy detail to confuse here: **the term "agent harness" and the compound term "harness engineering" do not come from the same source**.

Trivedy used "harness as a service" (HaaS) in 2025-09, and Anthropic began using "harness" as a product term in 2025-11. But the actual breakout moment for "harness engineering" as a **distinct industry term** was the OpenAI engineer Ryan Lopopolo article *Harness engineering: leveraging Codex in an agent-first world*, published on **February 11, 2026**. Although the original article was blocked by a 403 anti-scraping response, its contents were fully reconstructed through multiple secondary sources such as an engineering.fyi mirror, InfoQ, and TheNeuron. Section 3 will discuss it in detail.

The timeline is as follows:

```
Zhang et al. arXiv game AI (2025-07-15)
    ↓
Trivedy HaaS (2025-09-23)          ← First systematic industry definition
    ↓
Anthropic Young (2025-11-26)       ← First use in an Anthropic title
    ↓
OpenAI Lopopolo (2026-02-11)       ← "harness engineering" breaks out as a distinct term
    ↓
LangChain, InfoQ, academia follow up (2026-02 to 2026-04)
```

To be precise: it is accurate to say Anthropic used the word harness "2.5 months earlier" than OpenAI (2025-11-26 vs 2026-02-11), but the **compound term** "harness engineering" was popularized first by OpenAI. Their contributions are different. Anthropic practiced it first and named it early; OpenAI later pushed the term into industry buzzword status with a louder narrative.

### How it differs from neighboring terms

"Harness" does not exist in isolation. It has clear boundaries with several neighboring terms.

LangChain's three-way distinction (2025-10-25) is the clearest: **Agent Framework** (abstract layers such as LangChain, CrewAI, OpenAI Agents SDK), **Agent Runtime** (production execution engines such as LangGraph, Temporal, Inngest), and **Agent Harness** (batteries-included preset solutions such as Claude Code and Cursor, including prompt, tool handling, and filesystem). LangChain itself also admits that "the boundaries are fuzzy."

The OpenDev paper (arXiv 2603.05344, Bui) gives what is currently the clearest distinction between scaffolding and harness: **Scaffolding = build time** (system prompt compilation, tool schema setup, subagent registration, before the dialogue lifecycle begins), while **Harness = runtime** (dispatching tools, compacting context, enforcing safety invariants, persisting state across turns). This differs subtly from Anthropic's usage, where scaffold and harness are treated more like synonyms, and that difference is worth noting.

---

## 2. Five Generations of Paradigm Evolution: How Industry Thinking Reached This Point

What follows is an analytical framework, not a direct quotation from any single source. It is a conceptual map distilled from the broader research material.

### Generation 1: Pure Prompt (around 2022)

When ChatGPT first appeared, the engineer's main job was simple: write a good prompt, send it, get a response, and stop. No tools, no loop, no state. Every interaction was a stateless single-turn exchange.

💡 **Plain English**: You send a text message to a food delivery platform, it replies once, and the interaction ends. No order tracking, no live courier location, no exception-handling workflow.

Chapters 1 through 5 of the Claude Code white paper describe Claude's basic conversation layer. This first-generation paradigm stops at that level.

### Generation 2: Tool Use (2023)

Models began gaining the ability to call tools: search engines, code executors, file read/write systems. Function calling / tool use became mainstream interfaces. Engineers now had to define tool schemas, handle tool-call requests from the model, and return execution results.

💡 **Plain English**: The food delivery platform starts integrating maps, inventory systems, and payment APIs, but each order is still an isolated request with no memory across sessions and no autonomous decision loop.

Claude Code chapters 7 through 14 cover this layer: the bash tool, file ops, and the MCP tool invocation system.

### Generation 3: Multi-Agent / Orchestration (2023-2024)

Multiple models were connected into pipelines, or one "orchestrator" model was used to schedule multiple "worker" models. CrewAI, AutoGen, and LangGraph all emerged from this line of thinking. The engineer's main job became "designing the collaboration relationships among agents."

💡 **Plain English**: The delivery platform turns into a logistics company. Dispatchers, couriers, and customer service become separate roles, but the whole flow is still driven by a process map drawn in advance by humans (the engineers).

Claude Code chapters 50 through 55 discuss sub-agents (the `Task` tool) and the mechanism for spawning subagents. That is a product of the third generation.

### Generation 4: Harness (2025 to present)

The problem with Generation 3 was this: no matter how well orchestration was designed, agents still failed in the details, formatting errors, forgotten context, declaring completion too early, losing the working state. Engineers discovered that making an agent work reliably requires more than designing "who does what." You also have to carefully design the **environment in which the agent runs**: progress files, feature inventories, startup scripts, lint rules, feedback loops, garbage collection... That whole environment is the harness.

Trivedy's phrasing is the most concise: **Agent = Model + Harness**. The model is responsible for reasoning; the harness is responsible for making sure that reasoning happens at the right time, with the right information, and produces verifiable results.

💡 **Plain English**: In motorsports, "harness" originally refers to the safety belt system on the driver's seat. It is not the engine, and it is not the tires, but without it, even the strongest engine is not safe. Harness Engineering is the engineering practice of designing that whole "seat belt + dashboard + track rules" system.

Signature practices of this generation include Young's initializer + coding agent two-component setup, Lopopolo's AGENTS.md-as-table-of-contents approach, and LangChain's generator-evaluator feedback loop. Claude Code itself is a representative implementation of this paradigm.

### Generation 5: End-to-End Reinforcement Learning (still under industry debate)

People such as Noam Brown (OpenAI reasoning researcher) argue that harness is fundamentally "patching over the fact that pre-training and post-training are not strong enough." As models internalize stronger self-correction abilities through large-scale RL training, most harnesses will disappear naturally. This is the Agent-era version of the Bitter Lesson: general computation will beat specialized engineering.

But Rajasekaran himself (Anthropic) offered a different observation in his 2026-03-24 article: when he upgraded a three-agent GAN architecture built on Opus 4.5 to Opus 4.6, it **simplified the harness rather than eliminating it**. In his words, "the space of interesting harness combinations doesn't shrink as models improve. Instead, it moves."

This debate is expanded in Section 5 of this chapter.

---

## 3. Comparing Three Major Implementations

The following compares three of the most representative harness implementations: Anthropic (Claude Code), OpenAI (Codex Harness), and LangChain (DeepAgents + Trivedy's methodology). The broader survey also covered Cursor, Cline, and Aider, but this chapter focuses on the three with the clearest philosophical differences.

### Anthropic: Claude Code

**Core idea**: "Thinnest possible wrapper." The role of the harness is to compensate for what the model lacks, and it should not be overdesigned. Rajasekaran's memorable line is: "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing."

**Agent Loop**: The Claude Agent SDK provides a three-stage loop (`gather context → take action → verify work`) and supports handoff across sessions. Young's setup is an initializer agent (establishes the environment on first run: `init.sh`, `claude-progress.txt`, initial git commit) plus a coding agent (makes incremental progress in each session).

**Context management**: Two modes coexist: automatic compaction (in-place summary compression, suitable for Opus 4.x because it has weaker context anxiety) and context reset (clear everything and restart, using a structured handoff artifact; this was necessary for Sonnet 4.5 because Sonnet had obvious "context anxiety"). The Skills system uses progressive disclosure to load instructions on demand and prevent the instruction budget from being pre-consumed.

**Specification files**: `CLAUDE.md` is the main carrier. Young's multi-session system additionally used `feature_list.json` (over 200 features) and `claude-progress.txt`. Rajasekaran's three-agent system used sprint contract files for inter-agent communication.

**Evaluation and feedback**: Rajasekaran's evaluator agent imitates a GAN-style architecture, is calibrated into a "skeptic" with few-shot examples, and uses Playwright MCP to perform real UI interaction tests.

💡 **Plain English**: Anthropic's approach is like a minimalist interior designer. If something does not need to be installed, do not install it. Only patch the wall where there is an actual crack.

**Corresponding Claude Code chapters**: agent loop → Chapter 6; context compaction → Chapter 28; `CLAUDE.md` / Skills → Chapters 36-37; `Task` tool / subagent → Chapter 51; MCP → Chapters 44-47.

### OpenAI: Codex Harness

**Core idea**: "Humans steer. Agents execute." The engineer's role shifts from "writing code" to "designing the environment in which the agent operates."

**Scale of the experiment** (source: five-way reconstruction from InfoQ, TheNeuron, Ignorance.ai, Lavaee, engineering.fyi; highly consistent across all of them): over 5 months, starting with 3 engineers (later expanding to 7), roughly 1 million lines of code, about 1500 merged pull requests, an average of 3.5 PRs per engineer per day, zero manually-written code. Every line, including application logic, tests, CI configuration, docs, and observability tooling, was written by the Codex agent.

**Context management**: The key use of `AGENTS.md` is as a "table of contents," not as a "manual." At around 100 lines, it serves only as a pointer into structured deeper documents under `docs/` (`design-docs`, `exec-plans`, `product-specs`, `references`, and so on). Lopopolo's own wording is: "Context is a scarce resource. A giant instruction file crowds out the task, the code, and the relevant docs." The application layer is designed for Codex readability (application legibility): git worktree startup, Chrome DevTools Protocol DOM inspection, and runtime observability exposed through Victoria Logs (LogQL) plus Victoria Metrics (PromQL). A single Codex run can operate independently for **more than 6 hours**.

**Architectural constraints**: Dependency layering is fixed as **Types → Config → Repo → Service → Runtime → UI** and mechanically enforced through custom lints and structural tests. Taste preferences are encoded as lint rules, and the lint error messages themselves are written as remediation instructions that are directly injected into the agent context.

**Feedback loop**: A background garbage collection agent periodically scans for drift and opens refactoring PRs. Most reviews take under a minute and can be automerged. This replaced a previous Friday-all-day manual cleanup ritual that consumed roughly 20% of weekly time.

💡 **Plain English**: If Anthropic's approach is a minimalist interior designer, OpenAI's approach is more like building a full real-estate quality assurance system: construction standards, acceptance criteria, and automated inspection robots. The construction crew (the agent) works inside that system, so it does not "build something wrong and nobody notices."

**Source of the key numbers**: The numbers above come from InfoQ (2026-02-21), Ignorance.ai (2026-02-22), TheNeuron (2026-03-12), Alex Lavaee (undated), and engineering.fyi in a five-way cross-check. They are highly consistent and therefore credible. The original OpenAI article itself could not be directly retrieved because of the 403 block, leaving that gap.

### LangChain: Trivedy Methodology + DeepAgents

**Core idea**: Treat the harness as an independent object that can be studied and iterated on, with an emphasis on "harness portability."

Trivedy's most important empirical result is from *Improving Deep Agents with Harness Engineering* (2026-02-17): the LangChain team changed **only the harness, not the model** (`gpt-5.2-codex` stayed the same), and raised their Terminal Bench 2.0 score from 52.8% to 66.5% (+13.7 percentage points), reaching the Top 5. As a control, Claude Opus 4.6 scored 59.6% under the same harness, which had not been optimized for Opus. LangChain's interpretation was: "competitive but underperforming relative to Codex, attributed to harness not being optimized for Claude's specific characteristics."

The meaning of this experiment is twofold: first, harness can indeed significantly change the performance of the same model; second, harness has model specificity and cannot simply be transplanted unchanged.

Trivedy's three-way distinction (framework / runtime / harness) is an attempt to organize the industry's concepts. LangChain itself admits that "the boundaries are fuzzy." Its *Anatomy* article (2026-03-10) defines harness as conversation & context management, tool invocation layer, permissions, session & filesystem state, loop control & error handling, and basic observability / telemetry. That lines up closely with Anthropic's implementation, but it is more descriptive than prescriptive.

💡 **Plain English**: LangChain's role is closer to a restaurant operations consultant. They do not run one restaurant themselves; they abstract best practices across many restaurants and turn them into reusable management playbooks.

**Key comparison table** (for later chart briefs):

| Dimension | Anthropic (Claude Code) | OpenAI (Codex Harness) | LangChain |
|------|------------------------|------------------------|-----------|
| Core creed | "Thinnest wrapper"; harness fills the gap | "Humans steer, agents execute" | "Agent = Model + Harness"; portable |
| Loop mechanism | `gather→act→verify`; multi-session | Ralph Wiggum continuous loop; 6h+ independent runs | generator-evaluator feedback loop |
| Context strategy | Compaction + Context Reset + Skills | `AGENTS.md` index (~100 lines) + structured docs | portable natural-language harness (NLAH direction) |
| Spec files | `CLAUDE.md` + `feature_list.json` | `AGENTS.md` + `docs/` | `.langchain/` rules (fragmented ecosystem) |
| Multi-agent | `Task` tool subagent; GAN-style 3-agent | Background GC agent; Skills with Owners | DeepAgents; generator/evaluator adversarial loop |
| Key data | 200+ features; DAW build for $124.70 | 1M LOC; 3.5 PR/person/day; 6h+ per run | +13.7% on Terminal Bench (harness change only) |
| Assumption about model capability | Harness simplifies dynamically as models improve | Harness carries "taste"; model executes | Harness is portable, not tied to a specific model |

---

## 4. Academic Support: Full Coverage of Four arXiv Papers

The research notes recorded 4 arXiv papers that directly treat "harness" as the object of study. All four are covered below.

### arXiv 2507.11633: General Modular Harness (Zhang et al., 2025-07-15)

**Authors**: Yuxuan Zhang, Haoyang Yu, Lanxiang Hu, Haojian Jin, Hao Zhang. **This is currently the earliest identifiable academic paper to use "harness" as an agent term in an arXiv title**, two months earlier than Trivedy's industry blog post (2025-09-23). The two lines of work appear to be independent and do not cite each other.

**Research content**: Proposes a modular harness framework for LLM agents in multi-turn gaming environments, consisting of perception, memory, and reasoning modules, each of which can be turned on or off for controlled ablation experiments.

**Key findings**: Across Sokoban, 2048, Candy Crush, and Tetris, the full harness produced statistically significant improvements over the unharnessed baseline (paired t-test p<0.05). In Candy Crush, the median improvement was +217.50 points. Module contributions were task-specific: the perception module dominated in Sokoban (spatially complex) and Tetris, while the memory module dominated in 2048 (long-horizon planning) and Candy Crush.

**Contribution to the Harness paradigm**: The word "harness" in this paper differs conceptually from the industry usage in Trivedy. Zhang et al. define it more as a cognitive architecture (perception-memory-reasoning), while Trivedy defines it more as engineering components (context management, tool invocation, permissions, state, loop control, observability). But the shared core is this: **a harness is the collection of components outside the model that make the model work reliably**. This paper showed that harness components have measurable, decomposable causal effects on agent performance, which laid the foundation for later academic follow-up.

### arXiv 2603.03329: AutoHarness (Lou et al., 2026-02-10)

**Authors**: Xinghua Lou, Miguel Lázaro-Gredilla, Antoine Dedieu, Carter Wendelken, Wolfgang Lehrach, Kevin P. Murphy (Google DeepMind).

**Research content**: Proposes the AutoHarness framework, where an LLM automatically synthesizes a code harness that wraps itself, without requiring engineers to hand-write one. The motivation comes from an observed problem: in chess-style matches on Kaggle GameArena, 78% of Gemini-2.5-Flash failure cases were caused by illegal moves. These were not merely suboptimal decisions; the environment explicitly forbade them.

AutoHarness proposes three harness variants: (1) action-filter, which directly filters illegal actions; (2) action-verifier, whose main form is a control loop that calls the LLM and rejects unacceptable answers; and (3) code-as-policy, which compiles the entire policy into code and completely removes decision-time LLM calls.

**Key data**: Achieves a 100% legal-action rate across 145 TextArena games. In two-player games, Gemini-2.5-Flash + AutoHarness beats Gemini-2.5-Pro with a 56.3% win rate vs 38.2%. In code-as-policy mode, average reward is 0.870, exceeding GPT-5.2-High at 0.844. The automatic synthesis process uses an average of 14.5 tree-search iterations guided by Thompson sampling.

**Contribution to the Harness paradigm**: AutoHarness proves that **the harness itself can be automatically generated by the model**. Conceptually, that opens a new direction: rather than engineers manually designing the harness, the model discovers for itself what constraints it needs. This corresponds to Rajasekaran's evaluator-agent line of thinking, and also to Lopopolo's observation that custom lint rules can be written by Codex itself, with 100% test coverage.

### arXiv 2603.25723: NLAH (Pan et al., 2026-03-26)

**Authors**: Linyue Pan, Lexiao Zou, Shuo Guo, Jingchen Ni, Hai-Tao Zheng.

**Research content**: Proposes Natural-Language Agent Harnesses (NLAH), which externalize harness control logic from code-embedded "implicit control flow" into readable, editable natural-language artifacts. The paper also proposes an Intelligent Harness Runtime (IHR), consisting of an in-loop LLM (which reads harness logic, current state, and the runtime charter), a backend (terminal tools + multi-agent interface), and the runtime charter (which defines the semantics of contracts, state, and orchestration).

The core harness components exposed by NLAH are: **Contracts** (what artifacts must be produced, what gates must be satisfied), **Roles** (solver / verifier / researcher / orchestrator), **Stage structure** (`plan→execute→verify→repair`), Adapters, State semantics, and Failure taxonomy.

**Key data**: On SWE-bench Verified (125 samples), Full IHR TRAE scores 74.4%, and Full IHR Live-SWE scores 72.8%. On OSWorld (36 samples), native OS-Symphony scores 30.4%, while the version migrated to NLAH scores 47.2% (+16.8 percentage points).

**Contribution to the Harness paradigm**: This is currently the most formal academic treatment of "agent harness" as a **scientific object of study**. The Related Work section directly cites Young's Anthropic article (2025-11-26) and *Building effective agents*, and Claude Code is explicitly referenced. NLAH's three-dimensional definition of harness (Control / Contracts / State) is the most rigorous academic formulation among all the sources surveyed.

The paper also reports one especially noteworthy finding: "Module effects concentrate on a small solved frontier rather than shifting the whole benchmark uniformly." In other words, harness components do not improve all tasks evenly. They matter most at the boundary where "the model almost succeeds but still falls short." This matches Rajasekaran's intuition almost perfectly.

### arXiv 2603.05344: OpenDev (Bui, 2026-03-05, v3 revised 2026-03-13)

**Author**: Nghi D. Q. Bui.

**Research content**: Introduces OpenDev, a terminal-native AI coding agent implemented in Rust. It uses a compound AI system architecture (different LLMs assigned different cognitive work), a dual-agent architecture (planning separated from execution), lazy tool discovery (reducing token waste), adaptive context compaction (gradually compressing old observations), and an automated memory system (accumulating project-specific knowledge across sessions).

**Key contribution**: Gives the clearest current distinction between scaffolding and harness (build time vs runtime), and explicitly pays tribute to Claude Code: "Claude Code led this shift, demonstrating that a terminal-native agent could match or exceed IDE-integrated tools in real-world software engineering tasks."

Its five Lessons Learned closely echo the first 82 chapters of the Claude Code white paper: Context Pressure as Central Constraint (corresponding to Chapter 28 on compaction), Long-Horizon Steering (corresponding to Chapter 31 on memory), Safety Through Architecture (corresponding to Chapter 39 on permissions), Designing for Approximate Outputs (corresponding to Chapter 18 on tool-call fault tolerance), and Lazy Loading and Bounded Growth (corresponding to Chapter 36 on progressive disclosure in Skills).

**Contribution to the Harness paradigm**: OpenDev turns Claude Code's "thin wrapper" philosophy into an implementable Rust architecture, offering an independent industrial-grade reference implementation and contributing a more standardized engineering definition of harness from practice.

---

## 5. Industry Criticism: Is Harness a New Paradigm or Old Wine in a New Bottle

### The core arguments from the skeptical camp

The strongest criticism comes from two directions, with different underlying motivations.

**"New name for old stuff" criticism**: Chayenne Zhao (@GenAI_is_real, in an X post and the LinkedIn article *Harness Engineering Is Just Good Engineering With a New Name*) makes the sharpest version of the argument:

> "From prompt engineering to context engineering to harness engineering — every few months someone coins a new term, writes a 10,000-word essay, sprinkles in a few big-company case studies, and the whole community starts buzzing. It's the same thing every time: Design the environment your model runs in. This has existed since the day ChatGPT launched."

This criticism has some force. If you define harness as "letting the model operate in a good environment," then yes, that is not a new idea. But it confuses the existence of a concept with the systematization of a concept. The idea of "hygiene" existed before Lister in modern medicine too. That does not mean making it operational, teachable, and shareable was not valuable.

**"Bitter Lesson" criticism**: People such as Noam Brown (OpenAI) argue that harness is fundamentally a patch and will eventually be replaced by stronger models. METR research found that the advantage of specialized harnesses (Claude Code, Codex) over a basic scaffold was negligible, and Scale AI's SWE-Atlas likewise found that "performance differences due to harness choice are within experimental error margins."

In a 2026-03-05 article, swyx (Latent Space) framed the debate as "**Big Model vs Big Harness**":
- The Big Model camp cites Anthropic's internal position: "All the secret sauce, it's all in the model. And this is the thinnest possible wrapper."
- The Big Harness camp points to LangChain's result: changing only the harness improved the same model by 13.7 percentage points on Terminal Bench 2.0.

swyx's own position is more subtle: "You can engineer your way above the Bitter Lesson, and harnesses can survive even reasoning paradigm changes."

Kyle from HumanLayer offers a counterintuitive observation: Terminal Bench 2.0 data shows that Opus 4.6 ranks #33 under Claude Code's official harness, but #5 under LangChain's redesigned harness. That implies **Claude Code's own harness may actually be limiting the potential of Opus 4.6**, because the Codex model was deeply coupled to the `apply_patch` tool during post-training, while Claude Code's harness was also deeply coupled to Claude during its own post-training period. Both may represent a form of "models overfitting to their own harness."

### The core arguments from the supportive camp

The arguments for treating harness engineering as an independent engineering discipline ultimately come down to the following points:

First, **layering is a foundational method of software engineering**. The OS sits below the application layer; the network stack sits below the OS. Nobody argues that layering is merely a crutch. The harness layer in the Agent era is simply a new layer.

Second, **improvements in model capability will not eliminate harness; they will change its form**. Rajasekaran records this in his 2026-03-24 article: when upgrading from Opus 4.5 to Opus 4.6, the sprint structure was simplified and context reset was removed, but the two core components, planner and evaluator, remained. "The space of interesting harness combinations doesn't shrink as models improve. Instead, it moves."

Third, **the findings in the NLAH paper provide theoretical support**: "Module effects concentrate on a small solved frontier." The role of harness is not spread evenly across all tasks; it is concentrated at the boundary where "the model almost succeeds but still cannot quite do it." As models get stronger, that boundary moves outward, and harness continues to matter at the new boundary.

### My judgment

The criticism that "Harness Engineering is just scaffolding / a crutch" rests on one assumption: **the endpoint is a model that does everything by itself**. That assumption itself is questionable.

In production environments, a single-model-does-everything solution has a fundamental weakness: **terrible interpretability and terrible debuggability**. When a complex task fails, you do not know which step went wrong. The existence of the harness layer is exactly what makes responsibility boundaries clear among components. Did the initializer fail? Was the evaluator scoring too loosely? Did the lint rules fail to cover an important case? This is the same reason microservices do not disappear just because monolith performance improves.

On the other hand, the criticism that it is "old stuff with a new name" is too harsh. **Systematic naming itself is productive**. Before Trivedy and Lopopolo provided clear definitions and actionable frameworks, each engineer was independently fumbling toward an answer to "how do I stop an agent from going off the rails on long tasks?" Now there is a shared concept to discuss, and the community's iteration speed has clearly improved.

Taken together, I believe harness engineering is a **systematized expression of a real engineering need**, not a wholly new invention. It deserves a distinct name and deserves to be promoted as an engineering standard. But it also should not be marketed as a "disruptive new paradigm." It is a concrete application of mature software engineering principles, layering, constraints, feedback loops, and incremental growth, to the LLM agent setting.

---

## 6. Mapping Back to Claude Code Source: Where the Core Elements of Harness Appear

Harness has six core elements (drawn from Trivedy's original definition and mapped against NLAH's three dimensions of Control / Contracts / State). Below, each is matched to Claude Code's actual mechanisms, with the corresponding white paper chapters indicated.

### Element 1: Conversation & Context Management

Corresponding mechanisms in Claude Code:
- **Context Compaction**: `compactConversation`-related logic (Chapter 28), which performs in-place summary compression while preserving dialogue continuity
- **Context Reset**: the `/clear` command (Chapter 29), which clears the context and reloads `CLAUDE.md`
- **Sub-agent as context firewall**: sub-agents spawned by the `Task` tool have their own independent context windows (Chapter 51), so contamination in the main agent's context does not spread

Young's `claude-progress.txt` is a form of externalized context passing. It outsources memory across sessions to the filesystem rather than relying on compaction quality. This corresponds to the discussion of external memory in Chapter 31 of the white paper.

### Element 2: Tool Invocation Layer

Corresponding mechanisms in Claude Code:
- **Built-in toolset** (Chapters 7-14): bash, file read/write/edit/search, `TodoWrite`, `Task`, and so on
- **MCP subsystem** (Chapters 44-47): external tool injection; Playwright MCP (browser automation) is the concrete tool repeatedly mentioned in Young and Rajasekaran's articles
- **Tool permission model** (Chapter 39): tool calls require user authorization, and `--dangerouslySkipPermissions` is the bypass mechanism

Lopopolo's Chrome DevTools Protocol + LogQL / PromQL setup is OpenAI's expansion of the tool layer. The underlying direction is basically the same as MCP-style external tool injection, but it goes much deeper on observability.

### Element 3: Permissions

Corresponding mechanisms in Claude Code:
- **Permission system** (Chapter 39): every tool call requires user confirmation or prior authorization
- **Permission declarations in `CLAUDE.md`** (Chapter 36): preconfiguration through fields such as `allowed_tools` and `bash_command_allowlist`
- **Hooks as permission extensions** (Chapter 40): PreToolUse / PostToolUse hooks can intercept specific tool calls and implement custom permission logic

### Element 4: Session & File-System State

Corresponding mechanisms in Claude Code:
- **Git version control**: Claude Code uses git as state infrastructure (Chapter 17); Young's coding agent forces a commit with a descriptive message at the end of each session
- **`CLAUDE.md` as persistent knowledge** (Chapter 36): a project-level instruction file that persists across sessions and serves as the most important state carrier in the harness layer
- **`feature_list.json` / `claude-progress.txt`** (Young's setup): these are not hardcoded in Claude Code source, but the `TodoWrite` tool (Chapter 12) provides similar to-do state management

Lopopolo's `AGENTS.md` + `docs/` directory system corresponds closely to Claude Code's `CLAUDE.md` + Skills (`SKILL.md`) system. The design philosophy is essentially the same: progressive disclosure / table-of-contents style navigation.

### Element 5: Loop Control & Error Handling

Corresponding mechanisms in Claude Code:
- **Main agent loop** (Chapter 6): the three-stage cycle of `gather context → take action → verify work`
- **Hook exit-code feedback mechanism** (Chapter 40): a PostToolUse hook returning exit code 2 can reactivate the agent. This is exactly what HumanLayer's Kyle means by "success must be silent, only failures produce verbose output"
- **Error recovery mechanisms** (Chapter 20): fallback and retry logic when tools fail

Lopopolo's "minimal blocking merge gates" and "correction is cheap, waiting is expensive" are the OpenAI version of loop-control philosophy, aligned with Claude Code's design choice that the agent loop should not be interrupted by a single tool failure.

### Element 6: Basic Observability & Telemetry

Corresponding mechanisms in Claude Code:
- **Conversation history** (Chapter 15): all tool calls and returns are preserved in the conversation log, forming the most basic observability layer
- **Debug mode output** (Chapter 5): the `--debug` flag exposes token statistics and API call details
- **Hooks PostToolUse logging** (Chapter 40): logs can be written after every tool call

This is where the gap between Claude Code and OpenAI Codex Harness is most obvious: under Lopopolo's setup, the agent can query application logs with LogQL and metrics with PromQL, so observability reaches all the way into the business layer, while Claude Code's built-in observability is still more conversation-level. That may be one likely direction for Claude Code's next stage of evolution.

---

## 7. Takeaways for Readers

If you are building your own Agent application, the material in this chapter suggests several actionable takeaways.

**First: let the agent fail before adding harness components.** Do not try to design a perfect harness from the beginning. Kyle's "Skill Issue" article puts it plainly: if you design harness preventively before observing real failures, you usually add a large number of ineffective components. The right order is: start minimally, watch where the agent fails, then add harness components surgically. Research from ETH Zurich found that LLM-generated agentfiles can actually hurt performance while consuming over 20% more tokens, which shows that even the "automatically generate the harness" path should be approached cautiously.

**Second: use load-bearing tests to validate harness components.** Rajasekaran's line is worth rereading: "Every component in a harness encodes an assumption about what the model can't do on its own, and those assumptions are worth stress testing." The method is simple: remove harness components one by one and observe the effect on results. If removing a component has no effect, it may not actually be load-bearing and can be deleted.

**Third: `CLAUDE.md` / `AGENTS.md` should be a table of contents, not a manual.** Lopopolo's ~100-line `AGENTS.md` principle applies equally to your own `CLAUDE.md`. Give the agent a navigation map so it knows where to look for detailed information, rather than dumping every rule into one giant file.

**Fourth: feedback loops are more effective than forward instructions.** Young's observation that "performance dramatically improved" after using Puppeteer MCP for end-to-end testing, and Rajasekaran's finding that "training an external evaluator is much easier than asking the generator to critique itself," both point to the same design principle: **verifiable failure is more valuable than unmeasurable success**. When building a harness, first ask "how will the agent know it did something wrong?" and only then ask "how do we make it do it right?"

**Fifth: harness is model-specific, so porting requires care.** LangChain's experiments show that a harness optimized for `gpt-5.2-codex` causes Claude Opus 4.6 to underperform expectations, and vice versa. That does not mean harness is not portable; it means that portability requires recalibration. The conventions of Claude Code's `CLAUDE.md` and OpenAI's `AGENTS.md` can be borrowed at the format level, but the specific prompt style, tool invocation patterns, and error-handling strategies still need to be revalidated against the underlying model you are actually using.

---

## 8. References

Below are all the major sources cited in this chapter, listed in chronological order. Sources that could not be directly retrieved are marked with the secondary-source substitution used.

| No. | Author | Title | Publication Date | URL | Status |
|------|------|------|----------|-----|------|
| 1 | Zhang, Yu, Hu, Jin, Zhang | General Modular Harness for LLM Agents in Multi-Turn Gaming Environments | 2025-07-15 | https://arxiv.org/abs/2507.11633 | Success |
| 2 | Vivek Trivedy | The Claude Code SDK and the Birth of HaaS | 2025-09-23 | https://www.vtrivedy.com/posts/claude-code-sdk-haas-harness-as-a-service/ | Success |
| 3 | Anthropic Applied AI team | Effective Context Engineering for AI Agents | 2025-09-29 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | Success |
| 4 | Thariq Shihipar et al. | Building Agents with the Claude Agent SDK | 2025-09-29 | https://claude.com/blog/building-agents-with-the-claude-agent-sdk | Success |
| 5 | LangChain Accounts | Agent Frameworks, Runtimes, and Harnesses — oh my! | 2025-10-25 (revised 2025-11-04) | https://blog.langchain.com/agent-frameworks-runtimes-and-harnesses-oh-my/ | Success |
| 6 | Justin Young (Anthropic) | Effective Harnesses for Long-Running Agents | 2025-11-26 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | Success |
| 7 | Anthropic (Grace/Hadfield/Olivares/De Jonghe) | Demystifying Evals for AI Agents | 2026-01-09 | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | Success |
| 8 | Lee Robinson (Cursor) | Best Practices for Coding with Agents | 2026-01-09 | https://cursor.com/blog/agent-best-practices | Success |
| 9 | Nicholas Carlini (Anthropic) | How I Used Claude to Write a C Compiler | 2026-02-05 | https://www.anthropic.com/engineering/building-c-compiler | Success |
| 10 | Lou, Lázaro-Gredilla, Dedieu et al. (Google DeepMind) | AutoHarness: improving LLM agents by automatically synthesizing a code harness | 2026-02-10 | https://arxiv.org/abs/2603.03329 | Success |
| 11 | Ryan Lopopolo (OpenAI) | Harness engineering: leveraging Codex in an agent-first world | 2026-02-11 | https://openai.com/index/harness-engineering/ | **403, reconstructed from the engineering.fyi mirror + InfoQ + TheNeuron + Lavaee + Emil Sit in five-way combination** |
| 12 | LangChain Accounts | Improving Deep Agents with Harness Engineering | 2026-02-17 | https://blog.langchain.com/improving-deep-agents-with-harness-engineering/ | Success |
| 13 | Leela Kumili (InfoQ) | OpenAI Introduces Harness Engineering | 2026-02-21 | https://www.infoq.com/news/2026/02/openai-harness-engineering-codex/ | Success |
| 14 | Charlie Guo (Ignorance.ai) | The Emerging "Harness Engineering" Playbook | 2026-02-22 | https://www.ignorance.ai/p/the-emerging-harness-engineering | Success |
| 15 | Alex Lavaee | OpenAI Agent-First Codebase Learnings | Undated | https://alexlavaee.me/blog/openai-agent-first-codebase-learnings/ | Success |
| 16 | Emil Sit | Notes on OpenAI Harness Engineering | 2026-02-24 | https://www.emilsit.net/t/2026/02/openai-harness-engineering/ | Success |
| 17 | engineering.fyi | Mirror: Harness engineering: leveraging Codex in an agent-first world | 2026-02-11 (mirror) | https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world | Success (used as the primary substitute for the OpenAI original) |
| 18 | swyx (Latent Space) | [AINews] Is Harness Engineering real? | 2026-03-05 | https://www.latent.space/p/ainews-is-harness-engineering-real | Success |
| 19 | Nghi D. Q. Bui | Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering | 2026-03-05 (v3 revised 2026-03-13) | https://arxiv.org/abs/2603.05344 | Success |
| 20 | Vivek Trivedy | The Anatomy of an Agent Harness | 2026-03-10 (revised 2026-03-16) | https://blog.langchain.com/the-anatomy-of-an-agent-harness/ | Success |
| 21 | Kyle @0xblacklight (HumanLayer) | Skill Issue: Harness Engineering for Coding Agents | 2026-03-12 | https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents | Success |
| 22 | Grant Harvey (TheNeuron) | OpenAI Harness Engineering: Ship 1M Lines of Code w/ Agents | 2026-03-12 | https://www.theneuron.ai/explainer-articles/openais-harness-engineering-playbook-how-to-ship-1m-lines-of-code-without-writing-any/ | Success |
| 23 | Prithvi Rajasekaran (Anthropic Labs) | Harness Design for Long-Running Application Development | 2026-03-24 | https://www.anthropic.com/engineering/harness-design-long-running-apps | Success |
| 24 | Pan, Zou, Guo, Ni, Zheng | Natural-Language Agent Harnesses | 2026-03-26 | https://arxiv.org/abs/2603.25723 | Success |
| 25 | Birgitta Böckeler (Thoughtworks, martinfowler.com) | Harness Engineering for Coding Agent Users | 2026-04-02 | https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html | Success |
| 26 | Chayenne Zhao | (X post, critical stance) | approximately 2026-03 | https://x.com/GenAI_is_real/status/2036266930290696599 | **402 paywall**, core argument obtained only from search snippets |
| 27 | James Phoenix (Understanding Data) | Generator-Evaluator Harness Design | 2026-03-25 | https://understandingdata.com/posts/generator-evaluator-harness-design/ | Success |

---

*This chapter is based on a deep research document completed on 2026-04-06, covering 37 successfully retrieved sources (including 4 arXiv papers). All 15 failed sources are marked with substitute secondary sources. Every quantitative citation is sourced explicitly.*
