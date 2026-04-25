How Does User Input Become an AI Request Step by Step?

From the moment you press Enter to when the AI starts replying, much more happens than "sending text to the API." User input passes through image scaling, attachment extraction, three-way dispatch (bash / slash command / text), safety filtering, Hook interception, and many other stages—any of which can alter the pipeline's direction or halt processing entirely. This chapter traces the full pipeline from "your fingertip" to "API request," revealing its 17 input parameters and 6 early-exit points.

> 💡 **Plain English**: It's like a post office sorting letters—you drop one in the mailbox (input), it gets sorted (parsed), labeled (message construction), and loaded onto the truck (packaged into the API request).

> 🌍 **Industry Context**: Input preprocessing pipelines are a challenge every AI coding tool must face, but complexity varies greatly. **GitHub Copilot** has relatively simple input—it extracts context from the editor cursor position, stitches it into a prompt, and follows a mostly single-track pipeline. **Cursor** handles input more elaborately, supporting @-mention files, @web search, image paste, and other multimodal inputs with some multi-route dispatch logic. **Aider** accepts terminal text input and supports slash commands like `/add` and `/run`, but its pipeline remains fairly linear. **CodeX (OpenAI)** supports a "prompt-plus-stdin" pipe-injection mode that can blend local compiler error logs with natural-language instructions. Claude Code's pipeline complexity—17 parameters and 6 early exits—is on the high end among peers, mainly because it must simultaneously support four entry points: terminal, VS Code extension, mobile bridge, and SDK. A unified pipeline across multiple entry points inevitably brings a higher density of conditional branches. This complexity is the cost of broad functionality, not deliberate over-engineering.

---

## The Question

You type a line into Claude Code's input box and press Enter. A few seconds later, the AI starts responding. What actually happens in between? Did you think it was as simple as "send the text to the API"? What if your input is an image? A slash command? A bash command? What if you @mention a sub-agent? What if a magic keyword triggers a remote session? How many branches and traps lie along the pipeline from "your fingertip" to "API request"?

---

> **[Chart placeholder 2.22-A]**: Flowchart — the complete decision tree of `processUserInput` (from input string / content-block array → multi-route dispatch → final message array)

> **[Chart placeholder 2.22-B]**: Pipeline diagram — the processing flow for a normal text input (image handling → attachment extraction → keyword detection → Hook execution → message construction)

## You Might Think…

"Isn't it just `fetch('/api/messages', { body: { content: userInput } })`?" You might assume user-input handling is just wrapping text into an API request format. Or maybe you know about slash commands but figure they're nothing more than a simple `if (input.startsWith('/'))` branch.

---

## Here's What Actually Happens

The `processUserInput/` directory contains 4 files and 1,765 lines of code implementing a **multi-route dispatch pipeline**: image scaling, clipboard content handling, IDE selector extraction, attachment loading, slash-command parsing, bash command execution, sub-agent @mention detection, ultraplan magic keywords, bridge-safe command filtering, Hook interception, permission-mode injection, and `isMeta` ghost messages—any of which can reroute or terminate the pipeline. This is not a straight assembly line; it is a **decision maze** packed with conditional branches and early exits.

### Section 1: The Entry Point — Two Input Shapes

The `processUserInput` function (`processUserInput.ts:85-270`) is the pipeline's entry point. The input it receives is not a simple string—the parameter signature has 17 fields, and `input` can take one of two shapes:

```typescript
input: string | Array<ContentBlockParam>
```

**String shape**: text typed directly into the terminal. The most common case.

**Content-block array shape**: rich content input from the VS Code extension, mobile bridge, or inputs containing images. Each block can be `text`, `image`, or another content type.

The first thing the entry function does is **not** parse the input—it gives **immediate feedback** (`processUserInput.ts:145-147`):

```typescript
if (mode === 'prompt' && inputString !== null && !isMeta) {
  setUserInputOnProcessing?.(inputString)
}
```

Before any processing begins, the user's input is shown in the UI so the user knows "I got it." `isMeta` messages (system-generated invisible prompts) skip this step because they should not appear in the user interface.

### Section 2: Image Handling — Right at the Front of the Pipeline

If the input contains images (whether inside content blocks or pasted from the clipboard), image handling is one of the first steps executed (`processUserInput.ts:317-345`):

```typescript
for (const block of input) {
  if (block.type === 'image') {
    const resized = await maybeResizeAndDownsampleImageBlock(block)
    // collect size metadata
    processedBlocks.push(resized.block)
  }
}
```

Images are **resized and downsampled** to fit API size limits. Dimensions metadata is also collected for each image—this metadata is later attached as an `isMeta: true` ghost message (`addImageMetadataMessage`, `processUserInput.ts:592-605`) so the model knows the original size and source path of the image, but the user never sees this message.

For clipboard-pasted images there is an extra step: `storeImages` saves the images to disk (`processUserInput.ts:360-362`) so Claude can reference the image path later (for example, to process it with CLI tools or upload it to a PR).

The entire image-handling stage runs in parallel (`Promise.all`, `processUserInput.ts:366-388`), scaling multiple images at once instead of waiting serially.

There is also a subtle compatibility fix: the iOS mobile app may send `mediaType` rather than the API-expected `media_type` (a comment references `mobile-apps#5825`). The `normalizedInput` variable ensures that processed image blocks—not the raw input—are passed down the pipeline.

### Section 3: Three Main Routes — Bash, Slash Command, and Plain Text

After images and attachments are handled, the pipeline enters a **three-way dispatch**. The decision logic looks simple, but each path hides deep water:

**Route 1: Bash commands** (`mode === 'bash'`)

When the user types in bash mode (toggled via Ctrl+B), the input is handed directly to `processBashCommand`. That function (`processBashCommand.tsx`) follows this flow:

1. Detect whether PowerShell should be used—`isPowerShellToolEnabled() && resolveDefaultShell() === 'powershell'`
2. Wrap the input in `<bash-input>` XML tags
3. Call `BashTool.call()` or `PowerShellTool.call()` (the PowerShell tool is **lazily loaded**; `require()` is only triggered when actually used, avoiding ~300 KB of load overhead)
4. The command executes with `dangerouslyDisableSandbox: true`—user-initiated bash commands are not sandbox-restricted
5. Handle progress callbacks—display stdout/stderr in real time
6. Format the result as a message array containing `<local-command-stdout>` and possibly `<bash-stderr>` tags

**Route 2: Slash commands** (`inputString.startsWith('/')`)

Slash commands are routed to `processSlashCommand` (the largest file, several thousand lines). There is a complex pre-filter stage here:

**Bridge-safe commands** (`processUserInput.ts:429-453`): input from remote control sets `skipSlashCommands = true` by default—remote messages should not trigger local commands. But if the command passes the `isBridgeSafeCommand()` check, execution is re-allowed. Unsafe commands (those requiring local UI or terminal) return a friendly "isn't available over Remote Control" message. Unrecognized `/xxx` input (for example, typing "/shrug" from a phone) is silently demoted to plain text.

**Ultraplan keywords** (`processUserInput.ts:467-493`): if the input is not a slash command but contains an ultraplan keyword (detected using `preExpansionInput`, i.e. the raw input before expansion, to prevent accidental triggering by pasted content), it is automatically rewritten as `/ultraplan <rewritten input>`. Several gates must be open:
- `feature('ULTRAPLAN')` compile-time feature flag
- Interactive mode (not headless)
- No active ultraplan session
- Input does not start with `/` (to avoid colliding with real slash commands)

**Route 3: Plain text prompts**

Most inputs take this path. `processTextPrompt` (`processTextPrompt.ts`, 100 lines) is comparatively concise:

1. Generate a new `promptId` (UUID) and store it in global state via `setPromptId`
2. Start an interaction tracking span (`startInteractionSpan`)—used for performance tracing
3. Emit an OpenTelemetry event—the `user_prompt` event contains prompt length and, if telemetry is allowed, the prompt content
4. Detect keywords: `matchesNegativeKeyword` (the user is expressing negation) and `matchesKeepGoingKeyword` (the user is urging continuation)
5. If images were pasted: merge text and images into a multi-content-block UserMessage
6. Otherwise: create a plain-text UserMessage

One noteworthy detail: for the OTel event's prompt text, when the input comes from VS Code / SDK (array shape), the **last** text block is taken (`input.findLast`), not the first. That's because `createUserContent` places the user's actual input at the end, with IDE selection and attachment context before it. An earlier version used `input.find` (the first text block), which caused VS Code sessions to never emit `user_prompt` events (`anthropics/claude-code#33301`).

> 📚 **Course Connection**: The OpenTelemetry (OTel) span and event concepts come from **distributed systems coursework** on distributed-tracing theory. The span created by `startInteractionSpan` represents a segment of the request's execution path through the system, and `promptId` (UUID) acts as the trace ID in distributed tracing, allowing logs across components to be correlated for analysis.

### Section 4: The Attachment System — The Invisible Companion of Input

Before the three-way dispatch, the pipeline extracts **attachments** (`processUserInput.ts:499-514`):

```typescript
const attachmentMessages = shouldExtractAttachments
  ? await toArray(getAttachmentMessages(inputString, context, ideSelection, [], messages, querySource))
  : []
```

`getAttachmentMessages` is an async generator—it scans the input text for @mentions, IDE selections, and other attachment markers, creating an `AttachmentMessage` for each attachment.

When are attachments **not** extracted? Three cases:
- `skipAttachments` is explicitly set
- The input is not a string
- Slash commands (they have their own attachment-extraction logic)

Among attachment messages there is a special type: `agent_mention` (`processUserInput.ts:557-574`). When a user @mentions a sub-agent (e.g. `@agent-commit`) in the input, the system records the behavior for analytics—distinguishing between "only typed @agent with no further instruction" and "@agent followed by a command" patterns.

### Section 5: Hook Interception — The Final Checkpoint

After the three routes finish and messages are constructed, if `shouldQuery === true` (i.e. the input needs to go to the AI), it must pass one last gate: **UserPromptSubmit hooks** (`processUserInput.ts:182-264`).

These hooks are custom scripts configured by the user in `settings.json`. They can do three things:

> 📚 **Course Connection**: The Hook mechanism is essentially the **Middleware Pattern**, widely discussed in software engineering and web-framework courses. Express.js middleware chains, Django middleware, and multi-pass processing in compiler courses all adopt similar architectures. The three hook behaviors—block, stop-but-keep, and append-context—correspond to the reject, absorb, and enrich semantics of middleware. This "pipeline + interception point" design also appears in operating-system courses as **system-call interception** (e.g. Linux seccomp, ptrace).

1. **Block** (`blockingError`): completely prevents the request from being sent. The original user input is replaced by a system warning message and `shouldQuery` is set to false. Use case: enterprise security policies preventing certain content from reaching the AI.

2. **Stop but keep** (`preventContinuation`): the request is not sent, but the original prompt is preserved in context. Use case: the hook handled the request itself (for example, performing a local query and returning the answer directly).

3. **Append context** (`additionalContexts`): does not block the request, but adds extra information to the message array. Use case: automatically attaching project standards or coding guidelines.

Hook output has truncation protection—`MAX_HOOK_OUTPUT_LENGTH = 10000` characters (`processUserInput.ts:274`). Overly long output is truncated with an "output truncated" marker appended. This prevents a misbehaving hook script from exhausting the context window with massive output.

Hooks are async generators (`for await ... of executeUserPromptSubmitHooks`), supporting streaming processing—intermediate `progress` results are skipped, and only the final result is handled.

### Section 6: Message Construction — A UserMessage Is More Than Text

The pipeline's final output is a `ProcessUserInputBaseResult`:

```typescript
type ProcessUserInputBaseResult = {
  messages: (UserMessage | AssistantMessage | AttachmentMessage | SystemMessage | ProgressMessage)[]
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  resultText?: string
  nextInput?: string
  submitNextInput?: boolean
}
```

Notice this is not "just one message"—it is a **message array** plus a set of control flags:

- `messages`: may contain multiple messages—user message + attachment messages + hook-appended context messages + ghost image-metadata messages
- `shouldQuery`: `false` means the pipeline ends here and no AI call is needed (for example, a locally executed slash command)
- `allowedTools`: some commands restrict the AI to specific tools only
- `model` / `effort`: some commands force a particular model or thinking depth
- `resultText`: output text for non-interactive mode (the `-p` pipe mode)
- `nextInput` / `submitNextInput`: command chaining—for example, after `/discover` selects a feature, the next command is auto-filled and submitted

The `UserMessage` itself is also nontrivial—it can carry a `uuid` (for deduplication), `imagePasteIds` (linking pasted images), `permissionMode` (current permission mode), and `isMeta` (ghost-message flag).

### Section 7: City Analogy — The Civic Service Hall

If Claude Code were a city, `processUserInput` would be its **civic service hall**—translating citizens' requests into government-processable documents.

A citizen walks into the hall, possibly carrying various items:
- A sentence (plain-text input)
- A stack of photos (image attachments)—photos are first resized and copied to standard size at the front desk, while originals are filed in the archives
- A letter of recommendation (@mention sub-agent)—recorded in the logbook but does not alter the processing flow
- A special token (slash-command prefix `/`)—immediately routed to a dedicated window

The hall has three main windows:
1. **Execution window** (bash mode): the citizen's request is "do this for me"; the window executes it directly and returns the result
2. **Skills window** (slash commands): the citizen carries a specialized service code (`/commit`, `/review`, etc.) and is routed to the corresponding professional desk
3. **Consultation window** (plain prompt): the most common case; the citizen's request is translated into an official document (UserMessage) and sent to the AI processing center

No matter which window is used, every citizen must pass through the **security checkpoint** (UserPromptSubmit hooks) before leaving the hall. The security officer can intercept the request ("this is not allowed"), attach extra materials ("this request requires this supplementary document"), or let it through.

The hall also has an invisible filter: requests from out of town (remote bridge) are barred from local-exclusive services by default (`skipSlashCommands`), but a set of "general services" (`bridgeSafeCommand`) remains open to them.

The nicest detail is at the entrance: as soon as the citizen steps inside, the front desk displays their name on the queue screen (`setUserInputOnProcessing`), even while their request is still being processed—making the wait a little less anxious.

---

## The Trade-offs Behind This Design

**Why must the input type support `string | Array<ContentBlockParam>`?** Because Claude Code is not just a terminal CLI—it is also a VS Code extension, a mobile bridge, and an SDK backend. Terminal input is naturally a string, but VS Code may send an array of content blocks containing IDE selections, and the mobile app may send an array containing images. A unified entry point prevents each platform from growing its own handling logic.

**Why detect ultraplan keywords on `preExpansionInput`?** Because expanded content after `[Pasted text #N]` might coincidentally contain an ultraplan keyword. The user had no intention of triggering a remote session, but the pasted text contained the word—a classic "user intent vs. content signal" conflict, solved by detecting the raw input before expansion.

**Why truncate Hook output to 10,000 characters?** Hook scripts can be uncontrolled—a buggy hook might output several megabytes of logs. Without truncation, those logs would be sent as context messages to the API, consuming the token budget and degrading the AI's response quality. 10,000 characters is enough to convey meaningful extra information while capping worst-case impact.

**Why do bash commands use `dangerouslyDisableSandbox: true`?** Commands typed in bash mode are **actively initiated by the user**—no different from typing in a regular terminal. The sandbox exists to restrict AI-initiated commands, not user actions. If a user types `rm -rf /` in bash mode and presses Enter, that is the user's will, not the AI's behavior.

**Why is `processSlashCommand` so large (thousands of lines)?** Because the slash-command system carries too many variants: built-in commands, plugin commands, Skills, forkable commands, async background commands, MCP waiting logic, permission checks… Each variant has its own execution path and error handling. This is a classic "simple interface, complex internals" module.

---

## Code Locations

- `src/utils/processUserInput/processUserInput.ts`, lines 85-270: pipeline entry point (18 parameters)
- `src/utils/processUserInput/processUserInput.ts`, lines 429-453: bridge-safe command filtering
- `src/utils/processUserInput/processUserInput.ts`, lines 467-493: ultraplan keyword detection
- `src/utils/processUserInput/processTextPrompt.ts`: plain-text handling (UUID, OTel, keyword detection)
- `src/utils/processUserInput/processBashCommand.tsx`: bash-mode command processing
- `src/components/TextInput.tsx` — input component (image paste, mode switching)

---

## Limitations and Critique

- **High pipeline complexity**: 18 input parameters and 6 early exits make debugging and testing exceptionally difficult, creating a steep learning curve for new developers trying to understand the full flow
- **Risk of accidental ultraplan keyword triggers**: although `preExpansionInput` mitigates the pasted-text problem, a user unintentionally writing the keyword during normal conversation can still trigger unexpected behavior
- **Monolithic bloat of `processSlashCommand`**: a single file spanning thousands of lines makes the slash-command system hard to test and maintain independently, representing clear technical debt

---

## If You Remember Only One Thing

User input is not "a string sent to the API"—it is a **multi-stage processing pipeline** that passes through image scaling, attachment extraction, three-way dispatch (bash / slash command / text), safety filtering (bridge commands, magic keywords), and Hook interception. This pipeline has 18 input parameters, 5 output message types, and at least 6 early exits. It proves a design truth: **in AI products, the complexity of "understanding what the user said" is often no less than the AI's own reasoning process**.
