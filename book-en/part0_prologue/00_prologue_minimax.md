# Preface: When You Open the Hood of a "Chat Assistant"

---

Imagine opening the calculator app on your phone, pressing `1 + 1 =`, and seeing `2` on the screen.

Simple, right? But if you dig into the calculator app's source code, you'll find floating-point precision handling, localized number formatting, accessibility voice announcements, an undo history stack, unit test frameworks—far more complex than "doing addition."

Claude Code works the same way.

When you type `claude` in your terminal, what you see is a friendly conversational interface. You say something, it replies, occasionally helping you edit code. "Isn't that just a ChatGPT in the terminal?"

No. Not even close.

> 🌍 **Industry Background**: In 2026, AI programming assistants have completed a fundamental shift from "helping you complete a line of code" to "getting an entire task done on their own." How heated is this space? Just listing a few names gives you a sense: GitHub Copilot, Cursor, Kimi Code, OpenAI CodeX, Devin, Google Antigravity... Every company is building their own AI programming assistant, with competition as fierce as the smartphone wars.
>
> In this landscape of competing powers, Claude Code chose a unique path—not building an IDE plugin (an IDE is a specialized editor for programmers, like Photoshop for designers), not building a web application, but constructing a complete AI agent runtime **in the terminal** (that black-and-white command-line window). This choice makes it the only AI programming assistant that can work on a pure remote server, operate entirely via keyboard, and seamlessly integrate with any editor. The trade-off: it has to solve UI rendering, file management, and process isolation—problems that come "free" in an IDE environment. This book dissects every technical detail behind this ambitious engineering choice.
>
> <details><summary>📋 <b>2026 AI Programming Assistant Competitive Landscape (Click to Expand)</b></summary>
>
> | Product | Company | Highlights |
> |------|------|------|
> | GitHub Copilot Agent Mode | Microsoft/GitHub | Generally Available (GA), built-in multiple specialized AI agents |
> | Cursor Background Agents | Anysphere | Parallel code refactoring in cloud VMs |
> | Kimi Code | Moonshot AI | Trillion-parameter model, up to 100 concurrent sub-agents |
> | OpenAI CodeX | OpenAI | Rust rewrite, parallel agent workflows |
> | OpenCode | Open Source Community | 110K+ GitHub Stars, 75+ model providers |
> | Devin | Cognition | Shifted from "fully autonomous" to human-in-the-loop control |
> | Z Code (GLM) | Zhipu AI | 744 billion parameters, domestic chips and private deployment focus |
> | Google Antigravity | Google | Mission Control architecture, redefining engineering collaboration |
>
> </details>
>
> The industry's understanding of these systems has gone through three stages of evolution: **Prompt Engineering** (2023-24) → **Context Engineering** (2025) → **Harness Engineering** (2026). LangChain founder Harrison Chase summarized this as a three-layer architecture: Model + Runtime + Harness—all agents (Claude Code, OpenClaw, Manus) use the same three-layer structure underneath, and the harness layer's design differences determine the differences in product behavior. This book dissects Claude Code, which is a complete case study in harness design.

### The Source-Release-Sparked Ecosystem Explosion

The public source release didn't just spark technical discussion—it ignited an open-source ecosystem explosion. Within a week of the release, 6 of the top 10 GitHub Agent Skills trending projects were CC-related, collectively earning 9,000+ stars:

| Project | Stars | Focus |
> |---|---|---|
> | byterover-cli | 3,638 | Agent memory layer |
> | open-agent-sdk-typescript | 1,822 | SDK alternative |
> | taches-cc-resources | 1,731 | Configuration collection |
> | claude-reviews-claude | 988 | Self-review tool |
> | how-claude-code-works | 808 | Mechanism analysis |
> | claude-code-from-scratch | 472 | From-scratch tutorial |

Combined with projects like claw-code (121K+ stars, 50K in 2 hours) and open-agent-sdk, the public release spawned an entire open-source ecosystem around CC's architecture. Community derivatives aren't limited to code tools—**ccunpacked.dev** built an English visual guide site, turning the 11-step Agent Loop flow into an interactive animation, becoming the go-to resource for non-Chinese-speaking communities to understand CC's architecture; **harness-books** (1.1k stars) took a Chinese perspective, attempting to build a systematic harness engineering framework book that complements this one. Together, these projects show: one community source release, unexpectedly giving the entire industry an "AI Agent Architecture Reference Implementation."

> 🌍 Community Perspective | @idoubicc — "Claude Code's backyard caught fire, so I got CC to build new houses with the furniture, free for everyone."

> 🌍 Community Perspective | @IceBearMiner — "The more time you spend vibe coding, the more you realize the importance of software engineering"
>
> 💡 **Plain English**: Vibe coding means letting AI generate code based on "vibes" without diving into the details yourself. This developer's realization: the more you let AI write code, the more you realize **human engineering design ability** is what determines final product quality—AI can write code, but architecture design, security boundaries, and performance tradeoffs—"software engineering" work—still needs human oversight.

What you're opening is an engineering system with **1,884 TypeScript files**[^1]. It has its own process scheduler, security sandbox, file version management, multi-instance coordinator, telemetry pipeline, plugin ecosystem—if you absolutely must use one word to describe it, the most accurate would be:

[^1]: **On the "1,884" figure**: This is the total count of TypeScript source files (`.ts` + `.tsx` suffix) in the `src/` directory (reproducible with `find src/ -name '*.ts' -o -name '*.tsx' | wc -l`). If you count all files in `src/` (including `.json` / `.proto` / `.css` and other types), the total is 1,902. This book consistently uses **1,884 (TypeScript source perspective)**—because this book analyzes TS source code itself, and non-source files fall outside the scope of analysis. The difference of 18 files are configuration and resource files, which don't affect understanding the system's architecture.

**An operating system designed for AI agents.**

> **[Chart Placeholder 0.1-A]**: CC Source Code Full Statistics Dashboard—exhaustive panorama of 476,875 lines of effective code, 1,884 TS files, 40 AI tools, 101 slash commands.

Only it doesn't manage hardware processes—it manages AI agent lifecycles. Admittedly, "operating system" is an analogy for understanding, not a precise technical definition—Claude Code runs on Node.js and is still a user-space application. But the **responsibilities** it bears (resource scheduling, security isolation, lifecycle management, extension mechanisms) are genuinely homologous to an operating system. The value of this analogy isn't literal accuracy—it's providing a familiar mental framework for understanding a brand new system.

> **[Chart Placeholder 0.1-B]**: Claude Code Hero Architecture Diagram—global overview of the 9-node main chain (CLI→Permissions→Prompt→`queryLoop`→API→Tools→Output) and 6 supporting subsystems (Permissions/Config/MCP/Hooks/Sandbox/Context).

---

## What This Book Aims to Do

This book conducts a source-level architectural analysis of Claude Code **version 2.1.88's source code** (source analysis cutoff date: **April 2026**; changes in subsequent Claude Code versions fall outside this book's scope). We don't guess, we don't speculate—all conclusions cite source file paths and line numbers.

> **⚠️ Research Boundary Declaration**
>
> This source code entered public circulation via the Claude Code 2.1.88 `cli.js.map` on March 31, 2026, a **source snapshot detached from the git lineage**—no `.git` directory, no version history, no complete build artifact chain. It is not Anthropic's voluntarily open-sourced complete repository, but 1,884 TypeScript source files recovered from `cli.js.map`.
>
> This means two things:
>
> 1. **Behavioral-level analysis is complete.** How the system starts up, how the query main loop runs, how tools are selected and executed, how multi-agent collaboration works, how cross-environment recovery happens—these core behavioral chains are fully present in the current snapshot, and all architectural conclusions in this book are based on verifiable source evidence.
>
> 2. **A small number of source modules are missing from the current snapshot.** Specifically: `SendUserFileTool` execution host directory, `UserCrossSessionMessage` rendering component, `peerSessions.js` complete implementation, `fireCompanionObserver` defining host (`src/buddy/observer.ts`), callers of `setReplBridgeActive`, the `@anthropic-ai/sandbox-runtime` closed-source sandbox package. These absences don't affect understanding of system behavior, but this book won't make unsourced speculation on their specific implementations—where analysis gaps occur, the main text will explicitly note them.
>
> 💡 **Plain English**: Think of archaeologists studying unearthed pottery shards—we can restore the object's shape, craftsmanship, and purpose, but we can't claim to have reconstructed every step of the potter's craft. This source code lets us see Claude Code's complete architectural blueprint, just with a few "shards" still buried underground.

In this book, you'll find:

- How the system goes through dozens of steps between pressing Enter and getting your question in front of an AI
- Why a seemingly simple response might involve **7 AI instances** working simultaneously
- How a single "edit file" operation crosses three checkpoints: permission check, sandbox isolation, file snapshot
- How Tokens are scrutinized like currency, and cache hit rates affect every decision like exchange rates
- How enterprise administrators remotely control Claude Code on every developer's machine through a nine-layer configuration system

> **[Chart Placeholder 0.2-A]**: Complete Data Flow Journey—from "refactor this function for me" to final output, showing one interaction crossing 10 stages (string → object → JSON → SSE → ReactNode) of complete data shape evolution.

**This is not a usage guide.** You won't learn how to use Claude Code here—the official documentation does that well already.

**This is an engineering dissection.** We're figuring out *why* it was designed this way, *what tradeoffs* those designs made, and *what engineering wisdom* you can extract for your own projects.

> **[Chart Placeholder 0.2-B]**: Claude Code Tech Stack Panorama—8-layer tech stack from L2 language layer (TypeScript) to L8 sandbox layer (Seatbelt/Namespace), showing every brick this system depends on.

---

## Why Use "Operating System" to Understand Claude Code

This isn't rhetorical flourish—Claude Code's architecture **really** works like an operating system.

When your computer boots up, the OS does three things: manage hardware resources, schedule applications, enforce security policies. Claude Code does almost the same, except "hardware resources" become token budgets and API quotas, "applications" become AI agent instances, and "security policies" become permission rules and sandbox restrictions.

> 📚 **Course Connection**: This book's analytical framework heavily draws on core concepts from **Operating Systems** courses. If you're taking or about to take this course, Claude Code is an excellent "modern operating system" case study—it projects textbook abstractions (process scheduling, memory management, security models, file systems) onto the entirely new domain of AI applications. Meanwhile, the engineering analysis methods in this book correspond to source-level architecture analysis practices from **Software Engineering** courses.

This analogy builds intuition. The table below is the book's "translation glossary"—whenever you encounter a Claude Code concept in later chapters, you can find its operating system counterpart here:

| Operating System Concept | Claude Code Equivalent | Why the Analogy Holds |
|---|---|---|
> | **Kernel** | QueryEngine + `queryLoop` (core loop—receives requests, invokes tools, returns results) | All requests pass through it for scheduling—calling APIs, dispatching tools, managing context, just like a kernel manages CPU time slices and memory allocation |

> 💡 **Plain English**: QueryEngine is like a **courier sorting pipeline**—receiving (user input) → sorting (determining which tools are needed) → loading (calling APIs) → delivering (executing tools) → signing (returning results) → waiting for next order (continuing the loop).
| **System Call (Syscall)** | Tool invocation | AI can't directly read/write files—it must issue "system calls" through the tool system, just like user-space programs must use syscalls to access hardware |

> 💡 **Plain English**: Tools are like **employees' skill certificates**—read file certificate, write code certificate, search certificate. Each skill needs to pass assessment (permission check) before use. Claude isn't all-powerful; it needs to be "certified" for each task.

> **[Chart Placeholder 0.3-A]**: Complete Built-in Tools Directory—40 tools grouped into 6 categories (File / Search / Execute / Agent / Web / Other), with permission requirements, input schemas, and use case annotations for each.

| **Process Scheduler** | Agent/Task system | 7 task types, Coordinator orchestration pattern—managing priority and resources for multiple concurrent AI instances, just like OS scheduling processes |

> 💡 **Plain English**: The Agent system is like **a food delivery dispatch center sending out riders**—the main Claude is the dispatch center, each Agent is a rider independently delivering different orders (sub-tasks), reporting results when complete.
| **Filesystem** | File History + JSONL (JSON Lines—log format with one record per line) sessions | Snapshots, version numbers, rewind rollback—filesystem with "time travel" capabilities beyond what OS filesystems offer |
| **Security Model** | Permission system + Sandbox + Enterprise policies | Ten-step permission state machine, seatbelt/bwrap process isolation, bypass-immune rules—multi-layer defense depth |

> 💡 **Plain English**: The permission system is like **a residential compound's gate access**—owners (approved operations) = auto-allow, visitors (unknown operations) = registration required, delivery (sandboxed commands) = scan to enter, suspicious individuals (dangerous operations) = immediate rejection.

> **[Chart Placeholder 0.3-B]**: Security Model Panorama—4-layer defense-in-depth (Permission / Sandbox / Command Pre-check / Enterprise Policy) × 3 threat vectors (Prompt Injection / File Privilege Escalation / Command Escape) complete comparison.

> **[Chart Placeholder 0.3-C]**: Permission Model Comparison—6 permission modes (plan / default / acceptEdits / autoAccept / bypass / dontAsk) "auto/confirm/deny" matrix across tool types (Read / Edit / Bash / Agent).

| **Device Drivers** | MCP servers | Standardized protocol (JSON-RPC) for connecting external capabilities, just like drivers let OS interact with different manufacturers' hardware |

> 💡 **Plain English**: MCP is like **MacBook's USB adapter**—MacBook only has Type-C ports; to connect a mouse, keyboard, or projector, you need adapters. MCP is Claude's universal adapter, letting it connect to various external tools and services.

> **[Chart Placeholder 0.3-D]**: MCP Transport Method Comparison Matrix—comparing 8 MCP transport methods across 5 dimensions: latency / throughput / security / complexity / reliability, with recommended use cases for each.

| **Shell** | REPL terminal interface (Ink/React—a framework using web tech React to drive terminal UIs) | The interaction layer between user and "kernel"—React component tree rendered in the terminal |
| **/etc/ Configuration** | Settings system (5 layers + 4 sub-layers) | Nine-layer configuration merging from enterprise policies to user preferences, like /etc/ system config overriding user ~/.config |

> 💡 **Plain English**: The configuration system is like **layers of clothing**—underwear = default config → shirt = project config → coat = user config → bulletproof vest = enterprise policy. Outer layers override inner ones, but the bulletproof vest (enterprise policy) has highest priority and can't be removed.

> **[Chart Placeholder 0.3-E]**: Complete Configuration File Map—`~/.claude/` (global) → `.claude/` (project) → workspace `CLAUDE.md` three-layer config tree, priority chain, and purpose of each file.

| **Inter-Process Communication (IPC)** | Scratchpad (shared whiteboard—temporary files for passing info between Agents) + Task Notification | Agents don't share memory—communicate via files (Scratchpad) and XML message format |
| **Boot Sequence** | main.tsx → init.ts → launchRepl | Three-stage startup: performance I/O prefetch, system initialization, UI rendering—just like BIOS → Bootloader → Kernel |

> 📚 **Course Connection**: The comparison table above nearly covers the complete **Operating Systems** course outline. Suggested paired study: Kernel and System Calls → Textbook Chapters 2-3; Process Scheduling → Chapters 5-6; Filesystems → Chapters 11-12; Security Models → Chapters 14-15 (referencing Silberschatz's "Operating System Concepts").

> 💡 **Plain English**: The startup sequence is like **your morning routine**—alarm rings = CLI starts → washing up = loading config → getting dressed = initializing modules → leaving house = ready and waiting for input. Each step can't be skipped, but you can heat breakfast while brushing teeth (parallel optimization).
| **Kernel Modules** | Hooks system | Injecting custom logic at 27 key runtime events, just like Linux's loadable kernel modules |

> 💡 **Plain English**: Hooks are like **parcel locker notifications**—package arrived, automatically notifies you = event hook. You can set "notify me when it arrives" or "just leave it at the door" = custom Hook behavior. The system automatically triggers your preset actions at key moments.

> **[Chart Placeholder 0.3-F]**: Complete Hook Events Directory—27 events × 4 lifecycle phases (Session / Query / Tool / Agent) complete list of mount points, with parameters and typical uses for each event.

| **Package Manager (apt/npm)** | Plugin system + Skills | Installing, validating, sandboxed execution of third-party extensions—doing the same job as OS package managers |

> **[Chart Placeholder 0.3-G]**: Extension Ecosystem Map—5 extension mechanisms (CLAUDE.md / Custom Commands / Skills / Hooks / MCP) plotted on "scope × complexity" 2D plane, with intersection points annotated (MCP+Hooks, CLAUDE.md+Skills, etc.).

> **[Chart Placeholder 0.3-H]**: Module Dependency Network Graph—modules color-coded by cluster (Tools / Commands / API / MCP / Config / Utils), annotating hub nodes like Tool.ts (in-degree 43) and circular dependencies.

> In subsequent chapters, we'll mark each major concept's first appearance with `🔑 OS Analogy:` to indicate its operating system counterpart. You don't need to memorize this table—it will naturally appear when you need it.

---

## Reading Roadmap

> **[Chart Placeholder 0.4-A]**: Book Knowledge Graph—88 chapters color-coded by 5 clusters (Architecture / Engine / Tools / Security / Advanced), presented as a network graph showing cross-references and skip paths, helping you find the shortest path through the book.

> 📚 **A Note on Chapter Numbering**: The directories in the file system use naming like `part0_序章` / `part1_认识这个系统` / `part2_*` / `part3_*` (part0 is the preface, part1-part5 are the 5 body directories). But "Part 1 / Part 2 / ..." in the reading roadmap below starts counting from "the body after the preface"—so "Part 3 好奇心驱动的深度问答" in the body actually sits in the directory `part2_好奇心驱动的深度问答/` (alongside `part2_代码架构完全解构/` as two adjacent directories for "Code Architecture" and "Q&A"). This slightly offset naming is the result of historical evolution and doesn't affect reading—just remember "the preface is part0, subsequent directories count from part1; and the Part 1-6 in the book's narrative are the logical groupings of the body."

The book is divided into six parts—you can read straight through or skip around based on interest:

### Part 1: Getting to Know This System
*Building cognition from scratch.* Understand the overall architecture in five minutes, master all concepts needed for reading subsequent content. Suitable for all readers.

### Part 2: Complete Deconstruction of Code Architecture
*Systematically dismantling the entire codebase.* From startup sequence to terminal UI, layer-by-layer dissection of every subsystem's design, entities, components, and logic. This is the book's "foundation"—if you truly want to understand how this system is built, don't skip this part.

### Part 3: Curiosity-Driven Deep Q&A
*27 questions you might wonder about.* "What's the trick with those three lines of code before the imports?" "What is Claude secretly doing while you type?" Each question dives deep into a specific engineering detail, discovering designs that make you want to applaud. Suitable for random browsing.

### Part 4: Complete Subsystem Analysis
*Technical reference manual.* In-depth line-by-line analysis of 30+ core subsystems (Permissions, MCP, Hooks, Plugins, Sandbox, Telemetry, Memory, Bash AST, Cron, Team Sync, Prompt Cache Observability, Peer/Session Discovery, assistant=viewer, Brief/Viewer channels, etc.), suitable for looking up precise details.

### Part 5: Engineering Philosophy
*Design principles distilled from code.* "Hide work inside waiting time," "Token is a first-class citizen," "Treat AI as LEGO blocks"—six engineering philosophies you can take away and apply to your own projects (including Prompt's Eight Design Wisdom).

> **[Chart Placeholder 0.4-B]**: Performance Optimization Panorama—Before/After comparison of five major acceleration strategies (Prompt Cache, Streaming Execution, Speculative Execution, etc.), with Part 5 "Engineering Philosophy" chapters one by one dissecting the engineering tradeoffs behind these numbers.

### Part 6: Critique and Beyond
*Honest trade-off analysis.* What is the complexity cost of this system? How would we design it from scratch? How can you apply these ideas to your own projects?

### Three Reading Paths: Find Your Entry Point

**If you're a CS student** (or recently started learning programming): Start from the Preface → Part 1 "Getting to Know This System" to build a global picture. Don't anxiety about unfamiliar terms—just skip them as you read—the Q&A-style chapters in Part 3 are better for random exploration, each question stands on its own. Focus on the operating system analogy table (right above)—it will help you connect textbook concepts with real systems.

**If you're a senior engineer** (already using Claude Code or similar tools): Jump directly to the subsystem you care about—Part 4 is a module-organized technical reference manual, with source file locations and key data structure indexes at each chapter's start. The engineering philosophy chapters in Part 5 distill principles you can directly apply to your projects. Part 2's architecture deconstruction suits scenarios where you need to understand global data flow.

**If you're an AI tool entrepreneur or product manager** (wanting to understand Agent architecture decisions): Part 6 "Critique and Beyond" is your core chapter—it analyzes this system's complexity costs and alternatives. The industry background and competitive landscape in the Preface provide the market coordinate system. Part 5's design philosophy chapters can serve as architectural reference for your own products.

---

## On Metaphors

This book uses metaphors and analogies extensively. This isn't to "dumb things down"—many concepts in Claude Code (speculative execution, prompt cache boundaries, permission state machines, Token budgets) are inherently abstract. **A good metaphor isn't about reducing precision—it's about providing another entry point.**

We follow one principle:

> **Metaphor first, precision follows.** First build intuition with something you already understand (operating systems, airport security, city finances), then verify whether that intuition matches reality using source code and line numbers. Where metaphor and reality diverge, we'll explicitly note where the analogy breaks down.

You'll see several recurring metaphor families in the book:

- **Operating System** (global framework): kernel, system calls, filesystem, process scheduling...
- **Airport Security** (security model): security lanes, PreCheck, boarding passes, customs...
- **City Finances** (Token economics): budgets, taxes, infrastructure reuse...
- **Sandwich Assembly Line** (prompt construction): ingredient order, fixed recipe portions, personalized toppings...
- **Game Save Files** (file history): auto-save, save points, load and rollback...

Each metaphor is fully developed on its first appearance; subsequent references use shorthand.

> **[Chart Placeholder 0.5-A]**: Claude Code Concept Quick Reference—25 core concepts divided into 5 groups (Loop & Execution / Tools & Agent / Security & Permissions / Context & Token / Extensions & Config), handy for cross-referencing while reading subsequent chapters.

---

## A Declaration

This book's analysis is based on the community-released source code of Claude Code version 2.1.88. We hold genuine admiration for Anthropic's engineering team—this is a meticulously designed system, and many decisions inspire genuine admiration upon deeper analysis. Our criticism is equally genuine: pointing out design tradeoffs and potential issues is not disparagement—it's the proper attitude for engineering analysis.

Code evolves, versions update. Line numbers and specific implementations in this book may have changed by the time you read it. But design philosophy and architectural decisions have much longer lifespans than specific code—this is the core value this book tries to convey.

Let's begin.

---

## Quick Navigation: Source Code Entry Points

Core source code entry points analyzed in this book:

```
src/main.tsx          — Startup entry (4,684-line giant file)
src/services/api/claude.ts — Query loop core (query function)
src/tools/            — 40 built-in tools directory
src/utils/permissions/ — Permission system (~1,500 lines)
src/memdir/           — Memory system
```

---

*→ Proceed to Part 1, Chapter 1: [This Is Not a Chatbot](../part1_认识这个系统/01_这不是聊天机器人.md)*
