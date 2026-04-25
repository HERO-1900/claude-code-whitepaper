# What Is the Fundamental Difference Between Skills and Slash Commands?

In Claude Code, "commands" and "Skills" may look similar—both are Markdown files triggered via `/`—but their design philosophies are fundamentally different. Commands are tools invoked manually by the user, whereas Skills are capabilities the AI can autonomously decide to use. This distinction determines their differences in trigger mechanism, loading logic, and token efficiency. This chapter offers an in-depth comparison of the two systems, revealing the evolutionary logic from Commands to Skills.

> 💡 **Plain English**: Think of Skills as a restaurant menu—the chef (AI) can autonomously choose the right dishes to match the diner's needs. Slash commands, on the other hand, are like a service bell—they only ring when the diner (user) presses it themselves; the waiter won't press it unbidden.

---

### 🌍 Industry Context

The distinction between "user-triggered" and "AI-autonomously-triggered" capabilities is a core design problem for AI Agent frameworks. **LangChain**'s Tool system has been AI-autonomous from the start—the Agent decides which Tool to use based on task descriptions (similar to `whenToUse`), with no concept of manual user invocation. **Cursor**'s Rules files (`.cursorrules`) are similar to Claude Code's Skills—they are project-level instruction files that the AI reads and follows automatically, but users cannot manually trigger a Rule via a command. **Aider**'s `/` commands (e.g., `/run`, `/test`) are all user-triggered, with no AI-autonomous capability layer. **CodeX (OpenAI)** defines Agent behavior through system-prompt instructions and an open-source skills library (Figma/Linear native integrations); its Skills Library design is conceptually the closest to Claude Code's Skills, though CodeX's skills lean more toward "predefined domain integrations" than "AI autonomous scheduling."

Claude Code's distinctive feature is that it **retains both modes simultaneously**, and allows the same Skill to toggle between them via the `user-invocable` field. The evolution from Commands to Skills reflects the industry's broader cognitive shift from "AI as a tool" to "AI as an autonomous Agent." However, this "AI-autonomous trigger" design also introduces predictability challenges—a problem shared by all Agent frameworks.

---

## The Question

Claude Code has "commands" (you type `/commit` manually) and "Skills" (in the `.claude/skills/` directory). The file formats look similar—both are Markdown. What exactly is the difference?

---

## The Fundamental Difference: Who Triggers It

**Commands** are triggered by the user. You type `/build`, and the system executes the prompt inside `build.md`.

**Skills** can be triggered autonomously by the AI. That is the key distinction.

---

## The `whenToUse` Field

Skills have a frontmatter field that commands lack:

```markdown
---
description: Run the full test suite
whenToUse: Use when the user asks to run tests, verify code correctness, or before committing code
allowed-tools: Bash
---

Run `npm test` and report the results...
```

The `whenToUse` field is injected into the system prompt, telling the AI under what circumstances it should invoke this Skill.

This means a user might not type any command at all—they might simply say, "Help me fix this bug and commit it"—and the AI will autonomously recognize that "tests need to be run" and invoke the corresponding Skill.

---

## Six Loading Sources

Skills come from six different sources, with varying priority:

| Source | Directory/Mechanism | Description |
|------|----------|------|
| `bundled` | Built into the CLI binary | Built-in skills shipped with Claude Code |
| `managed` | Enterprise policy directory | Enterprise-mandated Skills |
| `userSettings` | `~/.claude/skills/` | User-global Skills |
| `projectSettings` | `.claude/skills/` | Project-level Skills |
| `plugin` | Plugin's `skills/` directory | Skills provided by plugins |
| `mcp` | MCP servers | Registered via `mcpSkillBuilders.ts` |

There is also `commands_DEPRECATED`—the old `.claude/commands/` directory, now deprecated but still supported.

---

## Four Additional Frontmatter Fields

Skills support more frontmatter configurations than commands:

**`user-invocable`** (default true)
```markdown
---
user-invocable: false
---
```
When set to false, this Skill will not appear in the `/` command list; only the AI can invoke it.

**`context: fork`**
```markdown
---
context: fork
---
```
Executes in an isolated context (does not affect the state of the main conversation).

**`hooks`**
```markdown
---
hooks:
  PostToolUse:
    - hooks:
        - type: command
          command: echo "Tool call complete"
---
```

Skills can define hooks inside their own frontmatter! These hooks only take effect during the execution of this Skill.

**`paths`**
```markdown
---
paths:
  - "src/**/*.ts"
---
```
Same semantics as the `paths` field in CLAUDE.md—this Skill is only loaded into the system prompt when the working directory matches these paths.

---

## BundledSkill: Skills Compiled into the Binary

There is a special class of Skills—`BundledSkillDefinition`—that are not files but registered directly within the system:

```typescript
registerBundledSkill({
  name: 'run-tests',
  description: 'Run the test suite',
  whenToUse: 'When code correctness needs to be verified',
  allowedTools: ['Bash'],
  getPromptForCommand: async (args, context) => {
    // Dynamically generate the prompt
    return [{ type: 'text', text: '...' }]
  },
})
```

Bundled Skills can carry files (the `files` field), which are extracted to disk on first invocation so the AI can read them on demand. This is equivalent to Markdown files in the skills folder—the only difference is their source.

---

## Token Efficiency Considerations

The Skills system has an optimization: **it only estimates the token count of the frontmatter**, without loading the full content:

```typescript
export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}
```

The full content of a Skill (the actual prompt) is only loaded when the AI decides to invoke it. This is consistent with the "lazy loading" principle—only the minimum information needed for the AI to make a decision is placed into context.

> 📚 **Course Connection**: This strategy of "loading only metadata, and fetching full content on demand" is analogous to the **demand paging** principle in **operating systems**—page table entries always exist, but physical page frames are only loaded from disk on first access. In **database systems**, this also resembles the separation of index and data—the internal nodes of a B+ tree store only keys (like frontmatter), while leaf nodes store the full data (like the Skill's prompt body).

---

## The Evolution from Commands to Skills

The `.claude/commands/` directory is now labeled `commands_DEPRECATED`. The new recommended approach is `.claude/skills/`.

This evolution reflects a cognitive shift: **moving AI capabilities from "tools the user invokes" to "capabilities the AI can autonomously decide to use."** Commands are a user-interface concept; Skills are an AI-cognition concept. This imperative-to-declarative evolution is happening across the entire AI Agent field—LangChain evolved from early Sequential Chains (imperative pipelines) to Agents (autonomous decision-making), and Semantic Kernel evolved from Plugins to Planners, all moving in the same direction.

---

## Limitations and Critique

- **Uncertainty of AI-triggered invocation**: Skills rely on the AI to autonomously judge when to invoke them based on the `whenToUse` description, but the model may trigger a Skill inappropriately, or fail to trigger one when it should.
- **Legacy commands directory not fully migrated**: `commands_DEPRECATED` is still supported. The coexistence of both systems increases cognitive and maintenance overhead.
- **Unclear boundaries of frontmatter capabilities**: Advanced frontmatter fields for Skills such as `hooks`, `paths`, and `context: fork` lack documentation, making them hard for users to discover and use correctly.

---

## Code Locations

- `src/skills/` — Top-level Skills system directory
- `src/tools/SkillTool/` — Skill tool invocation implementation
- `src/skills/loadSkillsDir.ts`, lines 67–73: `LoadedFrom` type definition (6 sources)
- `src/skills/loadSkillsDir.ts`, lines 185–250: `parseSkillFrontmatterFields()` (Skills frontmatter parsing)
- `src/skills/bundledSkills.ts`, lines 15–41: `BundledSkillDefinition` type
- `src/skills/bundledSkills.ts`, line 53: `registerBundledSkill()` function
- `src/skills/loadSkillsDir.ts`, lines 100–105: `estimateSkillFrontmatterTokens()` (lazy loading optimization)
