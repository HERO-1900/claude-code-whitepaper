# Prologue: Opening the Hood of a "Chat Assistant"

---

Imagine opening the calculator on your phone, pressing `1 + 1 =`, and seeing `2` on the screen.

Simple, right? But if you crack open the calculator app's source code, you'll find floating-point precision handling, localized number formats, accessibility voice output, an undo history stack, a unit test framework, and much more. It is far more complex than "doing addition."

Claude Code is the same way.

When you type `claude` in a terminal, what you see is a friendly conversational interface. You say something, it says something back, and sometimes it helps you edit some code. "Isn't it just ChatGPT in a terminal?"

No. Not even close.

> 🌍 **Industry Context**: By 2026, AI coding assistants had completed a fundamental shift from "helping you autocomplete a line of code" to "taking action and finishing the whole task themselves." How crowded is this field? Just look at a few names and you can feel it immediately: GitHub Copilot, Cursor, Kimi Code, OpenAI CodeX, Devin, Google Antigravity... every company is building its own AI coding assistant, and the level of competition is comparable to the smartphone wars.
>
> In this crowded landscape of rising contenders, Claude Code chose a very different path: not an IDE plugin (an IDE is a programmer's dedicated code editor, roughly analogous to Photoshop for designers), not a web app, but a full AI agent runtime built inside the **terminal** itself, that black window with white text. That choice makes it the only AI coding assistant that can run on a purely remote server, be operated entirely from the keyboard, and integrate seamlessly with any editor. The cost is that it must solve, by itself, a whole class of problems that are normally "free" inside an IDE: UI rendering, file management, process isolation, and more. This book dissects every technical detail behind that ambitious engineering decision.
>
> <details><summary>📋 <b>The Full 2026 Competitive Landscape of AI Coding Assistants (Click to Expand)</b></summary>
>
> | Product | Company | Distinctive Feature |
> |------|------|------|
> | GitHub Copilot Agent Mode | Microsoft/GitHub | Fully generally available (GA), with multiple specialized AI agents built in |
> | Cursor Background Agents | Anysphere | Runs code refactors in parallel inside cloud VMs |
> | Kimi Code | Moonshot AI | Built on a trillion-parameter model, with up to 100 concurrent sub-agents |
> | OpenAI CodeX | OpenAI | Rewrites the lower layer in Rust and introduces parallel Agent workflows |
> | OpenCode | Open-source community | 110K+ GitHub stars, supports 75+ model providers |
> | Devin | Cognition | Shifted from "fully autonomous" toward a human-machine collaborative control model |
> | Z Code (GLM) | Zhipu AI | 744 billion parameters, focused on domestic chips and private deployment |
> | Google Antigravity | Google | Mission Control architecture, redefining engineering collaboration |
>
> </details>
>
> The industry's understanding of systems like this has evolved through three stages: **Prompt Engineering** (2023-24) → **Context Engineering** (2025) → **Harness Engineering** (2026). LangChain founder Harrison Chase summarizes this as a three-layer architecture of Model + Runtime + Harness. All Agents (Claude Code, OpenClaw, Manus) share this same underlying three-layer structure, but differences in harness design determine differences in product behavior. The Claude Code dissected in this book is a complete case study in harness design.

### Ecosystem Explosion Driven by the Public Source Release

The public source release did more than trigger technical discussion. It also sparked a concentrated burst of open-source ecosystem activity. Within one week of the release, 6 of the top 10 projects on the GitHub Agent Skills trending list were CC-related, together collecting 9,000+ stars:

| Project | Stars | Positioning |
|---|---|---|
| byterover-cli | 3,638 | Agent memory layer |
| open-agent-sdk-typescript | 1,822 | SDK replacement |
| taches-cc-resources | 1,731 | Configuration collection |
| claude-reviews-claude | 988 | Self-review tool |
| how-claude-code-works | 808 | Mechanism analysis |
| claude-code-from-scratch | 472 | From-scratch tutorial |

Together with projects like claw-code (121K+ stars, 50K within 2 hours) and open-agent-sdk, the public release gave rise to an open-source ecosystem centered on the CC architecture. Community derivative projects were not limited to coding tools. **ccunpacked.dev** built an English-language visual guide that turns the 11-step Agent Loop into an interactive animation, becoming the preferred entry point for non-Chinese communities trying to understand the CC architecture. **harness-books** (1.1k stars), coming from a Chinese perspective, tries to establish a systematic framework for harness engineering and complements this book. Taken together, these projects show something remarkable: a single unplanned source release accidentally provided the entire industry with a reference implementation of AI Agent architecture.

> 🌍 Community View | @idoubicc — "Claude Code caught fire in its own backyard, so I had CC move the tables and chairs outside and build a new house. Everyone can stay for free."

> 🌍 Community View | @IceBearMiner — "The more time I spend vibe coding, the more I feel the importance of software engineering"
>
> 💡 **Plain English**: Vibe coding means letting AI generate code directly from a rough sense of the "vibe," without deeply understanding the details yourself. What this developer is saying is: the more you let AI write code, the more you realize that **human engineering judgment** is what really determines product quality. AI can write code, but architecture, security boundaries, and performance tradeoffs still need human oversight.

What you have opened is an engineering system with **1,884 TypeScript files**[^1]. It has its own process scheduler, security sandbox, file version management, multi-instance coordinator, telemetry pipeline, and plugin ecosystem. If you insist on describing it in a single phrase, the most accurate one is:

[^1]: **About the exact meaning of the number "1,884"**: this is the total count of TypeScript source files under `src/` with `.ts` + `.tsx` extensions (reproducible with `find src/ -name '*.ts' -o -name '*.tsx' | wc -l`). If you count all files under `src/` instead, including `.json`, `.proto`, `.css`, and other file types, the total is 1,902. This book consistently uses **1,884 (TypeScript-source count)**, because the object of analysis in this book is the TS source code itself. Non-source files are outside the scope of analysis. The difference between the two numbers (18 files) consists of configuration and resource files, which do not affect one's understanding of the system architecture.

**An operating system designed for AI agents.**

> **[Figure Placeholder 0.1-A]**: Full CC source-code statistics dashboard — an exhaustive panoramic view in numbers: 476,875 effective lines of code, 1,884 TS files, 40 AI tools, and 101 slash commands.

Except what it manages is not hardware processes, but the lifecycle of AI agents. Of course, "operating system" is an analogy to aid understanding, not a precise technical definition. Claude Code runs on top of Node.js and is still, fundamentally, a user-space application. But the **responsibilities** it takes on, resource scheduling, security isolation, lifecycle management, extensibility, really are highly isomorphic to those of an operating system. The value of this analogy is not literal exactness. It is that it gives you a mental model you already know for understanding a system that is entirely new.

> **[Figure Placeholder 0.1-B]**: Claude Code hero architecture diagram — a global overview of the 9-node main path (CLI → Permissions → Prompt → `queryLoop` → API → Tools → Output) and 6 supporting subsystems (Permissions / Config / MCP / Hooks / Sandbox / Context).

---

## What This Book Is Trying to Do

This book is based on a source-level architectural analysis of the **source code of Claude Code version 2.1.88** (source-analysis cutoff date: **April 2026**; changes in later versions of Claude Code are outside the scope of this book). We do not guess. We do not hand-wave. Every conclusion is annotated with source file paths and line numbers.

> **⚠️ Research Boundary Statement**
>
> This source code entered public circulation on March 31, 2026, via the Claude Code 2.1.88 `cli.js.map` shared through the community. It is a **source snapshot detached from its git lineage**: there is no `.git` directory, no version history, and no complete build-artifact chain. It is not the complete repository voluntarily open-sourced by Anthropic, but rather 1,884 TypeScript source files recovered from `cli.js.map`.
>
> That means two things:
>
> 1. **Behavior-level analysis is already complete.** The core behavior chains, how the system starts, how the query main loop runs, how tools are selected and executed, how multi-Agent coordination works, how cross-environment recovery happens, are all present in full within the current snapshot. Every architectural conclusion in this book is based on verifiable source-code evidence.
>
> 2. **A small number of source modules are missing from the current snapshot.** Specifically: the execution host directory of `SendUserFileTool`, the rendering component for `UserCrossSessionMessage`, the full implementation of `peerSessions.js`, the defining host of `fireCompanionObserver` (`src/buddy/observer.ts`), the caller of `setReplBridgeActive`, and the closed-source sandbox package `@anthropic-ai/sandbox-runtime`. These gaps do not affect understanding of the system's behavior, but this book will not make unverified claims about their specific implementations. Wherever the analysis hits a break, the main text will mark it explicitly.
>
> 💡 **Plain English**: Think of archaeologists studying excavated pottery shards. We can reconstruct the shape, craftsmanship, and purpose of the vessel, but we cannot claim to have reconstructed every single step the potter took. This source snapshot lets us see Claude Code's full architectural blueprint clearly. It is just that a few "shards" are still buried underground.

You will see, in this book:

- How the system goes through dozens of steps after you press Enter before your question ever reaches the AI
- Why a seemingly simple reply may actually have **7 AI instances** working at the same time behind the scenes
- How an "edit file" operation passes through three layers of gates: permission checks, sandbox isolation, and file snapshots
- How tokens are budgeted with the same care as money, and how cache hit rates influence every decision the way exchange rates do
- How enterprise administrators can remotely control Claude Code on every developer machine through a nine-layer configuration system

> **[Figure Placeholder 0.2-A]**: Complete data-journey diagram — from "Help me refactor this function" to the final output, a full evolution of data shape across 10 stages (`string → object → JSON → SSE → ReactNode`) in one interaction.

**This is not a user guide.** You will not learn how to use Claude Code here. The official documentation already does that well.

**This is an engineering dissection.** We want to understand *why* it was designed this way, *what tradeoffs* those designs embody, and *what you can learn* from them and apply to your own projects.

> **[Figure Placeholder 0.2-B]**: Claude Code technology-stack panorama — an 8-layer stack, from the L2 language layer (TypeScript) to the L8 sandbox layer (Seatbelt/Namespace), showing every brick this system depends on.

---

## Why Use the "Operating System" Lens to Understand Claude Code

This is not just for rhetorical effect. Claude Code's architecture really **does** resemble an operating system.

When your computer boots, the operating system does three things: it manages hardware resources, schedules applications, and enforces security policies. Claude Code does almost the same thing, except that "hardware resources" become token budgets and API quotas, "applications" become AI agent instances, and "security policies" become permission rules and sandbox restrictions.

> 📚 **Course Connection**: The analytical framework in this book draws heavily on core concepts from **Operating Systems** courses. If you are studying, or about to study, OS, Claude Code makes an excellent case study in a "modern operating system": it projects textbook abstractions like process scheduling, memory management, security models, and file systems into the entirely new domain of AI applications. At the same time, the engineering analysis methods used in this book correspond to **Software Engineering** practices such as source-level architecture analysis.

This analogy helps you build intuition. The table below is the book's translation key. Whenever you encounter a Claude Code concept in later chapters, you can use it to find the matching concept in the world of operating systems:

| Operating System Concept | Claude Code Counterpart | Why the Analogy Holds |
|---|---|---|
| **Kernel** | QueryEngine + `queryLoop` (the core loop: receive requests, call tools, return results) | Every request passes through it for scheduling: calling APIs, dispatching tools, managing context, just as a kernel manages CPU time slices and memory allocation |

> 💡 **Plain English**: QueryEngine is like a **parcel-sorting conveyor line**: intake (receive user input) → sort (decide which tools are needed) → load (call the API) → deliver (execute tools) → confirm receipt (return the result) → wait for the next package (continue the loop).
| **System call (Syscall)** | Tool invocation | The AI cannot read or write files directly. It has to issue "system calls" through the tool system, just as a user-space program must use syscalls to access hardware |

> 💡 **Plain English**: Tools are like **employee skill certifications**: a file-reading certificate, a code-writing certificate, a search certificate. Each skill has to be authorized (permission checked) before it can be used. Claude is not omnipotent. It has to be "licensed for the job."

> **[Figure Placeholder 0.3-A]**: Complete directory of 40 built-in tools — grouped into 6 categories (File / Search / Execute / Agent / Web / Other), annotated with each tool's permission requirements, input schema, and best-fit scenarios.

| **Process scheduler (Scheduler)** | Agent/Task system | Seven task types and a Coordinator orchestration pattern manage the priority and resources of multiple concurrent AI instances, just as an OS schedules processes |

> 💡 **Plain English**: The Agent system is like a **delivery dispatch center sending out riders**. The main Claude is the dispatch center. Each Agent is a rider, independently handling a different order (subtask), then reporting back with the result.
| **Filesystem** | File History + JSONL (`JSON Lines`, a log format with one record per line) sessions | Snapshots, version numbers, and rewind rollback add a kind of "time travel" ability beyond a normal OS filesystem |
| **Security model** | Permission system + sandbox + enterprise policies | A ten-step permission state machine, seatbelt/bwrap process isolation, and bypass-immune rules create defense in depth across multiple layers |

> 💡 **Plain English**: The permission system is like a **gated community access system**. Residents (approved operations) are let through automatically. Visitors (unknown operations) must register and be approved. Delivery workers (commands inside the sandbox) scan a code to enter. Suspicious people (dangerous operations) are rejected outright.

> **[Figure Placeholder 0.3-B]**: Security model panorama — a full cross-reference of four layers of defense in depth (Permissions / Sandbox / Command Preflight / Enterprise Policy) against three threat vectors (Prompt Injection / File Overreach / Command Escape).

> **[Figure Placeholder 0.3-C]**: Permission model comparison table — a matrix of six permission modes (`plan / default / acceptEdits / autoAccept / bypass / dontAsk`) across tool categories (Read / Edit / Bash / Agent), showing which are "automatic / confirm / forbid."

| **Device drivers (Drivers)** | MCP servers | External capabilities are integrated through a standardized protocol (`JSON-RPC`), just as drivers let an OS control hardware from different vendors |

> 💡 **Plain English**: MCP is like a **USB-C adapter for a MacBook**. A MacBook only has Type-C ports, so if you want to connect a mouse, keyboard, or projector, you need an adapter. MCP is Claude's universal adapter, letting it connect to all kinds of external tools and services.

> **[Figure Placeholder 0.3-D]**: MCP transport comparison matrix — 8 MCP transport modes compared across 5 dimensions (latency / throughput / security / complexity / reliability), with recommended scenarios for each.

| **Shell** | REPL terminal UI (Ink/React, a framework that uses React-style web techniques to drive terminal interfaces) | The interaction layer between the user and the "kernel" — a React component tree rendered inside the terminal |
| **`/etc/` config** | Settings system (5 layers + 4 sublayers) | Nine layers of merged configuration, from enterprise policy to user preference, just like system-wide config in `/etc/` overriding user config in `~/.config` |

> 💡 **Plain English**: The configuration system is like **layers of clothing**. Underwear = default config → shirt = project config → coat = user config → body armor = enterprise policy. Outer layers override inner ones, but body armor (enterprise policy) has the highest priority and nobody gets to take it off.

> **[Figure Placeholder 0.3-E]**: Complete configuration map — the three-layer configuration tree of `~/.claude/` (global) → `.claude/` (project) → workspace `CLAUDE.md`, including precedence chains and the purpose of each file.

| **Inter-process communication (IPC)** | Scratchpad (a shared whiteboard: temporary files used to pass information between Agents) + Task Notification | Agents do not share memory. They communicate via files (Scratchpad) and XML message formats |
| **Boot** | `main.tsx` → `init.ts` → `launchRepl` | A three-stage startup process: performance I/O prefetch, system initialization, and UI rendering — just like BIOS → Bootloader → Kernel |

> 📚 **Course Connection**: The comparison table above covers almost the full outline of a standard **Operating Systems** course. Recommended mapping: kernel and system calls → chapters 2-3 of the textbook; process scheduling → chapters 5-6; file systems → chapters 11-12; security model → chapters 14-15 (using Silberschatz's *Operating System Concepts* as reference).

> 💡 **Plain English**: The startup sequence is like a **morning wake-up routine**. Alarm goes off = CLI starts → wash up = load config → get dressed = initialize modules → head out the door = ready for input. None of these steps can be skipped, but while you're brushing your teeth you can also warm up breakfast at the same time (parallel optimization).
| **Kernel modules (Modules)** | Hooks system | Custom logic can be injected at 27 key points while the system is running, just like loadable kernel modules in Linux |

> 💡 **Plain English**: Hooks are like **SMS alerts from a package locker**. A package arrives and you get notified automatically, that is an event hook. You can set "notify me when it arrives" or "just leave it at the door," that is custom Hook behavior. The system automatically triggers the action you preconfigured at critical moments.

> **[Figure Placeholder 0.3-F]**: Complete Hook event directory — 27 events × 4 lifecycle stages (Session / Query / Tool / Agent), listing all attachment points and annotating the parameters and typical uses of each event.

| **Package manager (`apt`/`npm`)** | Plugin system + Skills | Third-party extensions are installed, validated, and sandboxed for execution, doing the same job an OS package manager does |

> **[Figure Placeholder 0.3-G]**: Extension ecosystem map — five extension mechanisms, `CLAUDE.md` / Custom Commands / Skills / Hooks / MCP, spread across the two dimensions of "scope × complexity," with their points of intersection marked (`MCP+Hooks`, `CLAUDE.md+Skills`, and so on).

> **[Figure Placeholder 0.3-H]**: Module dependency network graph — a dependency graph colored by clusters (Tools / Commands / API / MCP / Config / Utils), with hub nodes such as `Tool.ts` (`in-degree 43`) and circular dependencies marked.

> In later chapters, whenever a major concept first appears, we will mark its operating-system counterpart with `🔑 OS Analogy:`. You do not need to memorize this table. It will reappear naturally whenever you need it.

---

## Reading Paths

> **[Figure Placeholder 0.4-A]**: Knowledge graph of this book — 88 chapters colored into 5 clusters (Architecture / Engine / Tools / Security / Advanced), presented as a network graph showing chapter cross-references and skip-reading paths, helping you find the shortest route through the book.

> 📚 **A Small Note on Chapter Numbering**: In the filesystem, this book's directories are named like `part0_序章`, `part1_认识这个系统`, `part2_*`, `part3_*`, and so on (`part0` is the prologue, and `part1` through `part5` are the five main body directories). But the **Part 1 / Part 2 / ...** mentioned below in the "reading paths" section are counted from the start of the **main body after the prologue**. So the "Part 3: Curiosity-Driven Deep Q&A" discussed below is actually located under the directory `part2_好奇心驱动的深度问答/` in the filesystem (adjacent to `part2_代码架构完全解构/`, as neighboring directories for "code architecture" and "Q&A"). This slightly offset naming is the result of historical evolution. It does not affect reading. Just remember: "the prologue is `part0`, subsequent directories are counted from `part1`; but the book's narrative `Part 1-6` refers to logical groupings of the main body."

The book is divided into six parts. You can read it in order, or jump around based on your interests:

### Part 1: Getting to Know the System
*Build your mental model from zero.* Understand the overall architecture in five minutes and learn every concept you need to read the rest of the book. Suitable for all readers.

### Part 2: A Full Architectural Dissection of the Codebase
*Systematically take apart the entire codebase.* From the startup sequence to the terminal UI, this part dissects every subsystem layer by layer: its design, entities, components, and logic. This is the foundation of the book. If you want to truly understand how this system is put together, you cannot skip this part.

### Part 3: Curiosity-Driven Deep Q&A
*27 questions you are probably curious about.* "What is that trick with those three lines before the import?" "What is Claude secretly doing while you type?" Each question goes deep into one concrete engineering detail and uncovers a design clever enough to make you slap the table. Ideal for browsing at random.

### Part 4: Complete Subsystem Analysis
*A technical reference manual.* 30+ core subsystems are analyzed in line-by-line depth (permissions, MCP, Hooks, plugins, sandbox, telemetry, memory, Bash AST, Cron, team sync, Prompt Cache observability, Peer/Session discovery layer, `assistant=viewer`, Brief/Viewer channels, and more), making this the right place to look when you need precise details.

### Part 5: Engineering Philosophy
*Design principles distilled from the code.* "Hide work inside waiting time," "Treat tokens as first-class citizens," "Use AI like Lego bricks" — six principles you can take away and apply in your own projects (including eight key prompt-design insights).

> **[Figure Placeholder 0.4-B]**: Performance optimization panorama — before/after comparisons of five major acceleration strategies, including Prompt Cache, streaming execution, and speculative execution. Part 5, "Engineering Philosophy," will unpack the engineering tradeoffs behind each of these numbers one by one.

### Part 6: Critique and Beyond
*An honest analysis of cost.* What is the cost of this system's complexity? How would we redesign it from scratch? How can these ideas be applied to your own projects?

### Three Reading Routes: Find the Entry Point That Fits You

**If you are a CS student** (or only recently started learning programming): start with the prologue → Part 1, "Getting to Know the System," to build a global impression. Do not stress when you run into unfamiliar terms. Just skip them for the moment. The Q&A chapters in Part 3 are better suited to exploratory browsing, because each question stands on its own. Pay particular attention to the operating-system analogy table above. It will help you connect classroom concepts to a real system.

**If you are a senior engineer** (already using Claude Code or similar tools): jump straight to the subsystem you care about. Part 4 is a technical reference manual organized by module, and each chapter begins with source locations and indexes of key data structures. Part 5 distills design principles you can directly apply to your own projects. Part 2 is the right section when you need to understand the global data flow.

**If you are an AI tools founder or product manager** (trying to understand Agent architecture decisions): Part 6, "Critique and Beyond," is your core section. It analyzes the cost of this system's complexity and the alternative designs. The industry context and competitive landscape in the prologue provide the market coordinate system. The design-philosophy chapters in Part 5 can serve as architectural references for your own product.

---

## About Metaphors

This book uses a lot of metaphors and analogies. Not to "make things simpler," but because many of the concepts involved in Claude Code, speculative execution, prompt-cache boundaries, permission state machines, token budgets, are abstract by nature. **A good metaphor does not reduce precision. It gives you another entry point.**

We follow one principle:

> **Metaphor first, precision second.** First use something you already understand, operating systems, airport security, city finance, to build intuition. Then confirm whether that intuition is actually correct using source code and line numbers. If the metaphor diverges from reality, we will explicitly point out where the analogy stops holding.

You will see several recurring families of metaphor throughout the book:

- **Operating systems** (global framework): kernel, system calls, file systems, process scheduling...
- **Airport security** (security model): security lanes, PreCheck, boarding passes, customs...
- **City finance** (token economics): budgets, taxes, infrastructure reuse...
- **Sandwich assembly line** (prompt construction): ingredient order, fixed recipe parts, personalized toppings...
- **Game save files** (file history): autosave, save points, load-and-rollback...

Each metaphor is fully unpacked the first time it appears. Later references use only the shorthand.

> **[Figure Placeholder 0.5-A]**: Claude Code quick-reference concept sheet — 25 core concepts grouped into 5 sets (Loops & Execution / Tools & Agents / Security & Permissions / Context & Tokens / Extensions & Configuration), so you can come back here anytime while reading later chapters.

---

## A Statement

This book's analysis is based on the community-released source code of Claude Code version 2.1.88. We have sincere respect for Anthropic's engineering team. This is a well-designed system, and many of its decisions become genuinely impressive under close analysis. Our criticism is equally sincere: pointing out design tradeoffs and potential issues is not an act of belittlement, but the proper stance of engineering analysis.

Code evolves, and versions change. By the time you read this, the line numbers and specific implementations in the book may already have shifted. But design philosophy and architectural decisions live much longer than any particular code listing. That is the real value this book is trying to convey.

Let us begin.

---

## Quick Navigation: Source Entry Points

The core source entry points analyzed in this book:

```
src/main.tsx          — boot entry (4,684-line giant file)
src/services/api/claude.ts — query loop core (query function)
src/tools/            — 40 built-in tool directories
src/utils/permissions/ — permission system (~1,500 lines)
src/memdir/           — memory system
```

---

*→ Turn to Part 1, Chapter 1: [This Is Not a Chatbot](../part1_认识这个系统/01_这不是聊天机器人.md)*
