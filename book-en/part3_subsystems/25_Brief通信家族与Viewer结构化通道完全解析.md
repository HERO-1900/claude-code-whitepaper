# The Brief Communication Family and Viewer Structured Channels Fully Explained

When you upload a file on the claude.ai web interface, or remotely observe the results of a tool executed by a local Claude Code instance, how does the data flow from one end to the other? Behind the scenes are two easily overlooked yet architecturally significant subsystems: the **Brief communication family** (file/message delivery) and the **Viewer structured channel** (tool result rendering).

> 🎯 **Why are these necessary components of an Agent workbench?** A single-machine, single-window "AI chat box" doesn't need these mechanisms—the user, AI, and tools all live in the same process, so shared memory is sufficient. But the **Agent workbench** requires tasks to be passed across devices, processes, and sessions—a user on the web must be able to see tool execution results from a local CLI, and the local CLI must be able to receive files uploaded from the web. This "cross-end data channel" must satisfy three constraints simultaneously: (1) data structure integrity (the viewer must be able to render it); (2) no pollution of model context (model context is expensive); and (3) semantic backward compatibility (legacy clients must not be broken). The Brief/Viewer channel is Claude Code's complete answer to these three constraints, and also a **design layer that products like ChatGPT Desktop, Cursor, and Cline have not yet reached**.

> **Source locations**: `src/tools/BriefTool/` (Brief + SendUserFile shared infrastructure), `src/utils/messages/mappers.ts` (tool_use_result mapping), `src/remote/sdkMessageAdapter.ts` (remote result backfill), `src/ink/components/messages/UserToolSuccessMessage.tsx` (result rendering), `src/bridge/inboundAttachments.ts` (file persistence)

> **🔑 OS analogy:** The Brief family is like Linux's `write()` and `sendfile()` system calls—both are responsible for "sending data out," but `write()` sends text (Brief) and `sendfile()` sends files (SendUserFile). They share the same underlying VFS interface but have different behavioral semantics.

> 💡 **Plain English**: The Brief family is like two services from a courier company—"regular text delivery" (Brief: send a message, replacing the previous reply) and "file parcel delivery" (SendUserFile: send a file, preserving the original reply context). Both services use the same delivery slip system (`attachments.ts`), but the acceptance rules differ.

---

## 1. The Dual-Member Structure of the Brief Communication Family

### Two Members, One Base

`BriefTool` (alias `SendUserMessage`) and `SendUserFileTool` belong to the same family, sharing the `BriefTool/attachments.ts` infrastructure.

Source evidence (comment at `attachments.ts:2`):
> "Shared attachment validation + resolution for SendUserMessage and SendUserFile"

In `tools.ts`, both are registered side by side. In `Messages.tsx`, both are grouped into the same `briefToolNames` array (see the definition around line 513). In `conversationRecovery.ts:364-368`, there are actually **three names listed as terminal tool results**: `BRIEF_TOOL_NAME` + `LEGACY_BRIEF_TOOL_NAME` + `SEND_USER_FILE_TOOL_NAME`—where `LEGACY_BRIEF_TOOL_NAME` is an old alias for the Brief tool, retained for SDK protocol backward compatibility, and treated the same as the new name.

### Key Asymmetry: dropText

**This is the core to understanding the relationship between the two members.** But first the reader must ask: why care about the difference between Brief and SendUserFile? The answer: if you send a message or file from the claude.ai web interface to a remote Claude Code instance, how does the data actually travel between web and terminal? That's what the Brief family solves—it determines **whether the conversation record you see on the web will be overwritten by Claude's next reply**. Brief overwrites (retracts and resends); SendUserFile does not overwrite (appends an attachment). This difference seems minor, but it actually determines whether the UI state the user sees after each operation matches expectations.

Now let's look at the source evidence. **You only need to read a small snippet of code—and rest assured, you don't need to learn programming, just understand what the variable names *mean***:

`Messages.tsx:513` defines two key arrays (an "array" can be understood as a list containing several names):
```typescript
const briefToolNames = [BRIEF_TOOL_NAME, SEND_USER_FILE_TOOL_NAME]
const dropTextToolNames = [BRIEF_TOOL_NAME]  // only Brief, not SendUserFile
```

> 💡 **What do the two arrays mean?**
> - `briefToolNames` = "Brief communication family member list"—determines which tools are classified as Brief family members during rendering. Both Brief and SendUserFile are here
> - `dropTextToolNames` = "discard the current turn's assistant text reply after invocation"—determines which tools, after being triggered, cause Claude's previous utterance to be "voided." Only Brief is here

- **Brief**: sends replacement text. In its turn, the assistant's previous reply text is **dropped** (`dropText`), because Brief's message itself is the new reply—keeping the old text would cause duplication
- **SendUserFile**: delivers the file itself. It **preserves** assistant context—because "sending a file" and "what was said before" are two separate things, and dropping context would break coherence in subsequent conversation

Original comment (`Messages.tsx:511`): "SendUserFile delivers a file without replacement text".

> 💡 **Plain English**: Brief is like "retract and resend" (WeChat's retract + re-edit), while SendUserFile is like "append attachment" (an email's "append attachment" button—the original body remains).

### Missing SendUserFileTool Host Directory

Having covered the **behavioral difference** between Brief and SendUserFile (the dropText asymmetry), there's another **implementation-level curiosity** worth mentioning about SendUserFile: it is referenced everywhere in the source, yet its definition file cannot be found.

There is **no** `SendUserFileTool/` directory under `source/src/tools/` (confirmed by directory traversal in this book's workspace), but `tools.ts:42-43` references it via `require('./tools/SendUserFileTool/SendUserFileTool.js')`. Meanwhile, `ToolSearchTool/prompt.ts`, `Messages.tsx`, and `conversationRecovery.ts` all reference it. This is a checkout-level source gap (see the research boundary declaration in the prologue)—the system's "skeleton" (registration, scheduling, rendering, recovery) is already prepared for it, but the "muscle" (execution implementation) is not in the current snapshot.

### Brief vs. SendUserFile Availability Asymmetry (Security Trade-off)

One security design worth noting: **Brief is an unconditional capability, while SendUserFile is a KAIROS-gated capability**—in `tools.ts:42-44`, SendUserFileTool is hard-gated behind `feature('KAIROS')`. This means:

- **Regular CLI users do not have** SendUserFile capability by default—even if the bridge is connected
- This tool is only loaded in assistant mode (when KAIROS is enabled)
- The reason is straightforward: SendUserFile involves **file persistence** (`~/.claude/uploads/{sessionId}/`), which is a **write path**—write operations have a larger attack surface than read operations, and should only be enabled in controlled scenarios

This is an **intentional attack surface reduction**: Brief only transfers text and has no file-writing capability, so it's enabled unconditionally; SendUserFile writes files to the local disk, so it's only enabled in the controlled assistant scenario. Don't treat Brief and SendUserFile as "symmetric dual members"—their availability conditions are completely asymmetric.

---

## 2. The file_uuid Attachment Closed Loop

How does a file uploaded from the web end eventually reach the local Claude Code `Read` tool chain?

### End-to-End Pipeline

> 💡 **How to read the flowchart below**: Imagine it as a **logistics routing map for a postal sorting center**—the Web Composer is the sender dropping a package into a mailbox, bridge/inboundAttachments.ts is the sorting window at the receiving post office, file_uuid is the logistics tracking number stuck on the package, ~/.claude/uploads/ is the local warehouse, and the final Read tool chain is the recipient opening the package. The arrows below show the route the package takes.

```
Web Composer uploads file
  → message carries file_uuid field (attachments[].file_uuid in BriefTool.ts)
  → bridge/inboundAttachments.ts receives the message
  → downloads file via OAuth: GET /api/oauth/files/{uuid}/content
  → writes to local disk: ~/.claude/uploads/{sessionId}/
  → converted to @"path" and handed to Claude's Read tool chain
```

### No Model Context Pollution

The comment at `utils/messages/mappers.ts:140-142` explicitly states:
> "Rides the protobuf catchall so web viewers can read things like BriefTool's file_uuid without it polluting model context"

This means `file_uuid` travels via a **structured side-channel**—it is carried by the protobuf catchall so the web viewer can read it (for displaying file previews), but it does not enter the model's context window (avoiding wasted tokens and interference with model reasoning).

> 💡 **First, let's explain three terms**:
> - **protobuf** (Protocol Buffers): a compact data transmission format designed by Google; all messages between Claude Code and the remote server are packed with it
> - **catchall** (fallback field): a "miscellaneous box" reserved in the protobuf schema—any data not in the formal field list gets stuffed in here and sent along with the message. It's like the **"remarks" section on an envelope**: the post office will deliver it, but the recipient doesn't look at it by default
> - **side-channel**: a **parallel transmission path** alongside the main channel, used to send "metadata" (information for system tools) rather than the main text (content for the model)

> 💡 **Plain English**: `file_uuid` is like the **barcode** on a courier package—the logistics system (viewer) needs to scan it to track the package and display a preview image, but the recipient (model) doesn't need to look at the barcode, only what's inside the package. The barcode travels with the package (side-channel), but goes through a different "attention channel."

### Security Trade-off Discussion

> ⚠️ **This section is for readers with an information security background.** It discusses the attack surface analysis brought by the file_uuid closed loop. General readers may skip this—it does not affect understanding of the channel's functionality itself.

The file_uuid attachment closed loop essentially places a write path that "pushes data from claude.ai to the local filesystem" into the bridge consumption chain. In the context of Chapter 12's discussion of the Anthropic relay server as a "single point of trust anchor," the security implications of this path must be made explicit:

- **Authorization boundary of uuid**: The file_uuid issued by the server must undergo per-user authorization validation on the server side—if the uuid can be enumerated or predicted, an attacker who obtains a uuid can make any local Claude instance download files. This is a **server-side trust anchor**, not something local defense can solve
- **Path traversal defense**: In the write path `~/.claude/uploads/{sessionId}/`, `sessionId` is a locally generated random value that does not accept path components from the remote end—this prevents path traversal attacks where the web side constructs a malicious sessionId to write files to locations like `~/.claude/uploads/../ssh/`
- **Size/type validation**: The download path in bridge `inboundAttachments.ts` should have size limits, MIME type whitelists, and download timeouts—these are conventional defense points. This book cannot directly verify from the source whether each of these is fully implemented, so this is an **audit-pending item**
- **Trust chain inference**: If Anthropic's relay server is compromised, the file_uuid closed loop means the remote side can make local Claude arbitrarily download files to `~/.claude/uploads/`. This attack surface shares the same fundamental premise as the "Bridge single point of trust anchor" discussed in Chapter 12 §Critical Analysis—the relay server is the trust origin of the entire bridge data chain

---

## 3. tool_use_result: End-to-End Structured Side Channel

§2 covered the **Web → Local** inbound channel (how user-uploaded files reach the local tool chain). But Claude Code is bidirectional—local tool execution results also need to be sent back to the web viewer for the user to see. This is the **Local → Web** outbound channel, which is what this section covers: the `tool_use_result` side channel.

How do tool execution results pass from local Claude Code to the remote web viewer?

### Three-Stage Pipeline

```
① Construction
   queryHelpers.ts constructs the toolUseResult field
   ↓
② Transmission
   utils/messages/mappers.ts maps toolUseResult to tool_use_result
   → transmitted via protobuf catchall (does not enter model context)
   ↓
③ Rendering
   remote/sdkMessageAdapter.ts, when convertToolResults:true,
   backfills remote tool_result into locally renderable messages
   → UserToolSuccessMessage.tsx validates via outputSchema.safeParse()
   → if validation passes, calls tool.renderToolResultMessage() to render
```

### outputSchema.safeParse Validation

At `UserToolSuccessMessage.tsx:60`, before rendering a tool result, `tool.outputSchema?.safeParse(message.toolUseResult)` is used for validation. This means the viewer consumption chain **preserves the tool's native output contract**—not just any JSON can be rendered; it must conform to the tool's defined output schema.

> 💡 **Plain English**: tool_use_result is like a **dedicated courier channel**—regular mail (text messages) goes through the normal post office, while special packages (tool results) go through dedicated logistics (structured side channel), and upon receipt the package contents are verified against the expected format (safeParse).

---

## 4. convertToolResults: Remote Rendering Mode Switch

`convertToolResults` is not the default behavior—it is an **explicit switch**, only turned on in specific remote rendering modes.

> 💡 **What does "remote rendering mode" mean?** The current REPL process is not the task executor, but rather an **observer/renderer of a task on another device**—such as `claude assistant`, `/remote-control`, SSH sessions, or direct-connect mode. The common characteristic of these scenarios is that tool results come from remote execution, not locally generated. Only remote results need to be "translated" into locally renderable message formats (locally generated results are already in the context and don't need conversion).

### Four Explicit Trigger Points

| Trigger Location | Scenario |
|---------|---------|
| `useAssistantHistory` | assistant mode loading historical messages |
| `useRemoteSession` (viewerOnly) | viewer mode receiving live increments |
| `useDirectConnect` | directly connected remote session |
| `useSSHSession` | SSH tunneled session |

`remote/sdkMessageAdapter.ts:155` defines `convertToolResults?: boolean`, and line 185 checks `if (opts?.convertToolResults && isToolResult)`.

**Why isn't it on by default?** A local agent's own tool results don't need conversion—they're already in the local context. Only remotely produced results need to be "translated" into locally renderable message formats. Enabling convertToolResults adds CPU overhead (requires parsing every tool result), so it's only explicitly enabled in the four remote scenarios that actually need it.

---

## 5. Structured Limitations on Cross-Session Messages

Bridge cross-session messages **only support plain text**—structured messages are permanently rejected.

### Source Evidence

`SendMessageTool.ts:635-641`:
```typescript
if (typeof input.message !== 'string') {
  // structured messages cannot be sent cross-session — only plain text
  return { success: false, message: '...' }
}
```

**Key detail**: This check occurs **before** the connection state check. That is, even if the bridge is properly connected, structured messages will still be rejected—this is not a "temporarily unsupported" capability limitation, but a **product-level permanent semantic**.

The source comment explains the reason: to avoid users reconnecting (connection restored) and mistakenly thinking structured messages would also be restored—if the connection were checked first and structured messages rejected later, users would think "it didn't work when disconnected, so it should work after reconnecting," but in reality it never will.

> 💡 **Plain English**: It's like passing notes between offices—you can only pass text notes (plain text), not complex spreadsheets or PowerPoints (structured messages). This isn't because the note-passing window is too small (temporary limitation), but by design only notes are supported (permanent semantic).

---

## 6. Industry Comparison: Other Solutions for Cross-End Data Channels

Claude Code's Brief/Viewer channel is a complete answer to the "cross-end data channel" problem, but it's not the only solution. Here's how other AI products approach it:

| Product | Cross-End Data Solution | Key Difference |
|------|------------|---------|
| **ChatGPT Desktop** | User uploads files in the desktop app, and files enter the conversation turn directly as attachments | No semantic separation like Brief/SendUserFile—files and messages are mixed in the same turn, making it impossible to "append a file without overwriting the body" |
| **Cursor Chat** | Upload locally through the Cursor IDE, attachments embedded in the Composer message body | File-message integration, also lacks the dropText asymmetry design |
| **Cline** (formerly Claude Dev) | VS Code extension-based, files accessed directly through the IDE's filesystem API | No cross-end channel needed—the local IDE process reads and writes local files directly |
| **GitHub Copilot Workspace** | User submits tasks via web interface, files passed through the Git repository | Asynchronous batch processing mode, no need for "real-time cross-end communication" |

**Claude Code's uniqueness**: It is the only product that **simultaneously satisfies** (1) cross-end asynchronous data channel, (2) message overwrite/append semantic separation (dropText asymmetry), and (3) side-channel metadata channel (file_uuid does not pollute model context) **all three constraints**. The simultaneous satisfaction of these three constraints stems from its Agent workbench positioning—single-machine, single-window products don't need these mechanisms at all, while cloud batch processing products don't need real-time bidirectional interaction. Claude Code occupies the unique position of "local execution + remote observability + bidirectional interaction," and the Brief/Viewer channel is the inevitable result of this positioning.

---

## 7. Relationship with the Bridge Chapter

This chapter and the Bridge Remote Architecture Fully Explained (Part 3 Ch12) are **complementary**:

- **The Bridge chapter** covers "how the pipe is built"—handshake, transport protocol, JWT authentication, disconnection and reconnection
- **This chapter** covers "what format of cargo flows through the pipe"—Brief message delivery, file_uuid attachment closed loop, tool result rendering channel

After understanding the Bridge pipe architecture, this chapter explains the actual data formats and rendering chains flowing through the pipe.

---

## Critical Analysis

### Strengths

1. **Brief/SendUserFile sharing a base but keeping semantics separate** is an elegant design—`attachments.ts` doesn't need to be duplicated, yet the dropText behavior is precisely distinguished through a single line of configuration
2. **The side-channel design of file_uuid** avoids polluting the model context—file metadata is only visible to the viewer, without wasting tokens
3. **The outputSchema.safeParse validation** ensures the viewer won't render incorrectly formatted results—type safety is maintained from source to consumer
4. **The permanent rejection of structured messages** clarifies design intent through validateInput ordering—leaving no ambiguous "maybe it'll be supported later" space

### The Four-Sided Convergence of SendUserFile

Despite the missing execution host for SendUserFileTool in the current snapshot, its **position** in the system is fully established through four independent consumption surfaces:

1. **ToolSearch surface**: `ToolSearchTool/prompt.ts` controls its immediate availability via `isReplBridgeActive()`—no ToolSearch relay needed
2. **Recovery surface**: `conversationRecovery.ts` lists it alongside Brief as a terminal tool result—recognized and properly handled during session recovery
3. **Transcript surface**: `Messages.tsx`'s `briefToolNames` array includes it—treated as a Brief family member during conversation history rendering
4. **Viewer/Attachment surface**: `file_uuid` passes through the protobuf side-channel, allowing the web viewer to render file previews

Four-sided convergence means: even if the execution host is missing, the system **has already reserved a complete ecological niche for it**. Once the host returns, it can plug in seamlessly—no consumer-side code changes needed.

### Costs

1. **The missing SendUserFileTool directory** is the most significant tool-level gap in the current source snapshot—the system knows it exists, knows how to register it, knows how to recover it, but the execution host is not present
2. **The explicit switch design of convertToolResults** increases configuration complexity for remote scenarios—if a scenario that needs it is missed, tool results become unrenderable empty data
3. **The plain text only limitation** means cross-session communication can only transfer text—if structured data (e.g., code block with metadata) needs to be passed in the future, a secondary encoding at the text level will be required

---

### This Chapter's Place in the Book

This chapter is the **finale** of the "cross-end communication infrastructure" narrative chain: Ch23 (Peer/Session discovery layer) → Ch12 Bridge architecture → Ch24 (assistant=viewer) → this chapter. Ch23 answers "how do local multiple instances discover each other," Ch12 answers "how do local and remote establish a pipe," Ch24 answers "how to attach to a remote session," and this chapter answers "what data formats flow through the pipe." These four chapters together form the complete picture of Claude Code's cross-end communication. The following chapters (Ch26 and beyond) return to local core systems—the subsystem analysis will turn to more vertical topics like memory, permissions, and tools.

---

> **Cross-references**:
> - Bridge architecture → Part3 Ch12
> - assistant = viewer → Part3 Ch24
> - Send contract vs. state surface → Part3 Ch12 §15
> - Peer address routing → Part3 Ch12 §14 / Ch23 §7
