# How Does Computer Use Let AI Control Your Screen?

Claude Code is a terminal program—no windows, no mouse, no graphical interface. Yet the Computer Use feature lets it take screenshots of your desktop, move the mouse, click buttons, and type on the keyboard. Behind this lies a complex system spanning four architectural layers, two native languages (Rust + Swift), and a manually pumped macOS main thread. This chapter disassembles the entire technical chain—from the MCP protocol down to hardware events—that lets AI "see" and "touch" graphical interfaces.

> 💡 **Plain English**: It's like remotely piloting a drone—the AI sends commands, and your screen executes them.

> 🌍 **Industry Context**: AI control of graphical interfaces (GUI Agent) was a hot direction in 2024–2025. **CodeX (OpenAI)** focuses on terminal operations and parallel agent workflows, without GUI control. **Kimi Code**'s multimodal capabilities are noteworthy—it supports direct ingestion of UI interaction videos or screen recordings, with its underlying vision large model converting dynamic footage into high-fidelity frontend interaction code, achieving "what you see is what you get" visual programming. This represents another route to GUI understanding. **Cursor** and **Windsurf**, as IDE-embedded tools, manipulate the editor interface through VS Code APIs but cannot control desktop applications outside the editor. **Anthropic's Computer Use API** (released October 2024) was the first commercial solution to let an LLM perform general desktop control via screenshots + coordinates; the Computer Use module in Claude Code is the engineering implementation of this API in a CLI environment. In the open-source community, **Open Interpreter**'s OS mode and **UFO** (Microsoft Research) are also exploring similar GUI automation, but most rely on OCR + Accessibility Tree rather than a pure vision approach of screenshots + coordinates. The real technical difficulty isn't "calling an API"—it's the engineering details of cross-language invocation (Rust/Swift), event-loop compatibility, and multi-monitor coordinate alignment. That's what this chapter breaks down.

---

## The Problem

Claude Code is a terminal tool—it has no window, no mouse, no graphical interface. But the Computer Use feature lets it screenshot your desktop, move the mouse, click buttons, and type on the keyboard. How does a purely textual terminal program "see" and "control" your graphical interface? How long is the technical chain in between?

---

> **[Chart placeholder 2.20-A]**: Architecture diagram — Computer Use's four-layer architecture (MCP Server → Wrapper → Executor → Native Modules), annotating each layer's responsibilities and data flow

> **[Chart placeholder 2.20-B]**: Sequence diagram — The complete call chain of a "screenshot → analyze → click" operation

## You Might Think...

"It's probably just calling a screenshot API and then simulating keyboard and mouse events?" You might think this is simple—after all, macOS has Accessibility API, CGEvent, and the `screencapture` command.

---

## Here's How It Actually Works

Computer Use is one of the most complex subsystems in Claude Code 2.1.88—fifteen source files, 2,161 lines of code, spanning four architectural layers. It depends on two native Napi modules (Rust's `@ant/computer-use-input` and Swift's `@ant/computer-use-swift`), and must solve the macOS permission model, conflicts between the Node.js event loop and the macOS main thread, the identity dilemma of a terminal app "having no window," multi-monitor coordinate conversion, and a system-wide Escape-key safety mechanism that must intercept everything.

### Section 1: The Four Layers—from MCP Protocol to Hardware Events

The entire system is divided into four layers, each solving a different problem:

**Layer 1: MCP Server (`mcpServer.ts`, 106 lines)**

Computer Use exposes its capabilities as an MCP Server. Why not make it a built-in tool? Because the API backend detects tool names starting with `mcp__computer-use__*` and injects specific Computer Use instructions into the system prompt (the comment at `setup.ts:19-20` explains this). Using different tool names won't trigger this backend behavior.

`createComputerUseMcpServerForCli` (`mcpServer.ts:60-78`) builds this in-process MCP Server. It has an interesting detail: it attempts to enumerate installed apps with a 1-second timeout (`tryGetInstalledAppNames`, `mcpServer.ts:25-44`), injecting the app list into the tool description—so when the model reads the tool description, it knows which applications are installed on the user's machine. If Spotlight is too slow or crashes, it gracefully degrades: the description omits the app list, and the model discovers apps at use time.

**Layer 2: Wrapper (`wrapper.tsx`, large file)**

The Wrapper is the bridge between `ToolUseContext` (Claude Code's tool context) and the Computer Use package. It maintains a process-level cached `binding`—created via `bindSessionContext`, containing a `dispatch` function and an internal screenshot cache.

The key part is permission management: the `onPermissionRequest` callback pops up a React-rendered approval dialog (`ComputerUseApproval` component), letting the user authorize which applications the AI may control. There's also a cross-session file lock (`computerUseLock.ts`) ensuring only one Claude Code session on a machine performs Computer Use at a time—preventing two AIs from fighting over the mouse simultaneously.

**Layer 3: Executor (`executor.ts`, 658 lines)**

This is the core implementation layer. The `createCliExecutor` factory function (`executor.ts:259`) returns a `ComputerExecutor` object containing all primitive operations: screenshot, mouse movement, clicking, keyboard input, dragging, and application management. Every operation must handle macOS-specific complexity.

**Layer 4: Native Modules (`inputLoader.ts` + `swiftLoader.ts`)**

Loaders for the two native modules. The Swift module loads immediately when the factory is created (screenshots are essential), while the Input module is **lazily loaded** on the first mouse or keyboard operation (`executor.ts:271-272` comment)—if you're only doing screenshot analysis without manipulation, the Rust module never loads.

### Section 2: The Achilles' Heel of Node.js—drainRunLoop

This is the strangest technical challenge in all of Computer Use.

macOS Swift `@MainActor` methods and Rust's `key()/keys()` functions both dispatch work to `DispatchQueue.main` (the macOS main thread's work queue). In Electron, `CFRunLoop` runs continuously, the main queue drains naturally, and everything works fine—this is why Cowork (Anthropic's desktop app) needs no such hack.

But Claude Code runs on Node.js/Bun. The libuv event loop **does not** drive macOS's `CFRunLoop`. The result: all work dispatched to the main queue never executes, Promises remain pending forever, and the program deadlocks.

> 📚 **Course Connection**: This is a classic **event-loop model conflict** (operating systems course). macOS's `CFRunLoop` and Node.js's `libuv` are two independent event-dispatch mechanisms, analogous to two different schedulers each managing their own ready queue. The 1ms polling of `drainRunLoop` is essentially **busy waiting/polling**—usually considered inefficient in OS courses, but under the constraint of not being able to modify the underlying runtime, it's the only viable cross-event-loop bridging mechanism. The retain/release reference-counting pattern corresponds to **reference-counted memory management** (similar to Objective-C ARC).

The solution (`drainRunLoop.ts`, 79 lines): a reference-counted `setInterval` that calls `_drainMainRunLoop()` (i.e., `RunLoop.main.run()`) every 1 millisecond to manually pump the main queue.

```
pump start → setInterval(drainTick, 1ms) → cu._drainMainRunLoop() → main queue drains → Promise resolves
```

This pump uses a **reference-counting pattern**:

- `retain()` increments the counter, starting the `setInterval` on the first call
- `release()` decrements the counter, stopping it when it reaches zero
- Multiple concurrent `drainRunLoop()` calls share the same pump

There's also a 30-second timeout guard (`drainRunLoop.ts:42`)—if a native call doesn't return within 30 seconds, the Promise race times out. The abandoned native Promise is silently swallowed by `.catch(() => {})`, so it won't become an `unhandledRejection`.

`retainPump` / `releasePump` are also exported to the Escape hotkey system—the CGEventTap's `CFRunLoopSource` also needs the pump to keep running (`escHotkey.ts:34`).

### Section 3: Screenshots—the Trick of "Seeing" the Desktop

Screenshots are implemented via Swift's `SCContentFilter` API (`@ant/computer-use-swift`), but Claude Code faces a unique problem as a terminal app: **it can't screenshot itself**.

The solution is "allowlist inversion" (`executor.ts:279-286`). Swift 0.2.1's `captureExcluding` actually takes an **allowlist**, not an exclusion list (the comment notes this is a misleadingly named API, referencing `apps#30355`). So the `withoutTerminal()` helper filters the terminal app **out of the allowlist**:

```typescript
const withoutTerminal = (allowed: readonly string[]): string[] =>
  terminalBundleId === null
    ? [...allowed]
    : allowed.filter(id => id !== terminalBundleId)
```

The terminal's Bundle ID is detected two ways (`common.ts:43-47`):
1. The `__CFBundleIdentifier` environment variable—automatically set by macOS when a subprocess launches from a .app
2. A fallback mapping table—matching against the `TERM_PROGRAM` environment variable (covers iTerm, Terminal.app, Ghostty, and 6 other terminals)

Screenshots also have precise size control (`executor.ts:63-68`): get the logical resolution and scale factor, convert to physical pixels, then calculate the target size expected by the API via `targetImageSize`. This is to trigger an "early return" in the API's image transcoder (`executor.ts:398-399` comment)—no server-side scaling, keeping the coordinate system consistent. JPEG quality is fixed at 0.75 (`executor.ts:57`), balancing clarity and transfer size.

### Section 4: Keyboard and Mouse Control—a 0.05-Second Precision Dance

Every mouse and keyboard operation is packed with timing details.

**Mouse movement** (`moveAndSettle`, `executor.ts:113-120`): instantly move to the target position, then **wait 50 milliseconds**. Why? Because there's a propagation delay from the HID (Human Interface Device) event to AppKit's `NSEvent`. If you click immediately, `NSEvent.mouseLocation` may not have updated to the new position. This 50ms is a battle-tested threshold.

**Clicking** (`executor.ts:538-556`): first `moveAndSettle`, then `mouseButton('click', count)`. Double- and triple-clicks rely on AppKit's own timing and position clustering—consecutive clicks at the same position, close enough in time, and AppKit automatically increments `clickCount`. Modifier keys (Ctrl, Shift, etc.) are wrapped by the `withModifiers` function (`executor.ts:150-165`) in a "press-execute-release" pattern, with a `finally` block ensuring modifiers are released even if the operation throws—otherwise your Ctrl key would get "stuck."

**Dragging** (`executor.ts:579-594`): move to the start point → press the mouse button → wait 50ms → **animated movement** to the end point → release the mouse button. The animated movement uses ease-out-cubic easing, 60fps, 2000px/sec speed, max 0.5 seconds (`animatedMove`, `executor.ts:217-255`). Why animate dragging? Because the target application may listen to intermediate `.leftMouseDragged` events to implement scrollbar dragging or window resizing—instant movement generates no intermediate events.

**Keyboard input** (`executor.ts:455-473`): supports xdotool-style key combinations (e.g., `"ctrl+shift+a"` → split by `+`). There's an 8ms interval between each keypress—matching the USB 125Hz polling rate. For text input, there are two modes: character-by-character typing or **clipboard paste**.

**Clipboard paste** (`typeViaClipboard`, `executor.ts:180-206`) is a carefully choreographed 6-step protocol:

1. Read and save the user's current clipboard content
2. Write the text to be input into the clipboard
3. **Read-back verification**—if what you read back after writing doesn't match, **refuse to paste** (otherwise you'd paste garbage)
4. Simulate Cmd+V
5. Wait 100ms—giving the target application time to complete the paste
6. Restore the original clipboard content (in a `finally` block, ensuring restoration even on exception)

> 📚 **Course Connection**: This 6-step protocol is essentially a **transaction**—it has atomicity (either the paste completes or it doesn't) and durability (the clipboard state is eventually restored). This corresponds to a simplified version of ACID properties from database courses. The `finally` block acts as a rollback mechanism, ensuring a consistent state even if intermediate steps fail. The read-back verification resembles **read-your-writes consistency** in distributed systems.

There are three defensive designs here: read-back verification prevents silent write failures, the 100ms delay prevents restoring so fast that the paste gets the restored content, and `finally` prevents permanent clipboard tampering.

### Section 5: The Escape Key—a System-Wide Emergency Brake

When an AI is controlling your computer, you need a reliable "stop" button. Claude Code chose the Escape key, but the implementation is extremely aggressive: **a system-wide CGEventTap**.

`escHotkey.ts` (54 lines) registers a CGEventTap through the Swift module—macOS's lowest-level event interception mechanism. Once registered:

- The Escape key is **consumed system-wide**—no application receives it
- This is a defense against prompt injection—if a malicious instruction makes the AI press Escape to dismiss a confirmation dialog, the CGEventTap swallows it

But the AI itself sometimes needs to press Escape (e.g., to exit fullscreen in some app). The solution is `notifyExpectedEscape()` (`escHotkey.ts:51-54`)—the executor notifies the Swift module before synthesizing an Escape keypress, and Swift lets the next Escape event through within 100ms. This 100ms decay window (described in the comment at `executor.ts:467-468`) ensures: if the synthesized CGEvent fails to reach the tap callback for some reason, interception automatically restores after 100ms—the hole doesn't stay open permanently.

The CGEventTap's `CFRunLoopSource` needs `CFRunLoop` to run in order to work—so it uses `retainPump()` to keep the drainRunLoop pump running for the duration of its registration.

### Section 6: Host Adapter—the Glue Layer

`hostAdapter.ts` (69 lines) is the singleton that glues everything together. `getComputerUseHostAdapter()` returns a process-lifetime `ComputerUseHostAdapter` object containing:

- **executor**: created via `createCliExecutor`, passed two dynamic getters—`getMouseAnimationEnabled` and `getHideBeforeActionEnabled`. These read GrowthBook sub-gates, so Anthropic can remotely toggle behaviors (e.g., temporarily disable mouse animation for debugging)
- **logger**: the `DebugLogger` class forwards all logs to `logForDebugging`, with five levels: silly/debug/info/warn/error
- **ensureOsPermissions**: checks two macOS TCC permissions—Accessibility and Screen Recording. Returns `{ granted: true }` or a detailed report of which is missing
- **cropRawPatch**: a JPEG crop callback for pixel verification—returning `null` means skip verification. Why? Because Cowork uses Electron's `nativeImage` (synchronous), but the CLI only has `image-processor-napi` (asynchronous), while the caller needs synchronous `patch1.equals(patch2)` comparison. Returning null is a deliberate degradation path (`PixelCompareResult.skipped`)

This adapter also hardcodes `getAutoUnhideEnabled: () => true`—after each operation round, previously hidden application windows are automatically restored. There's no user preference to disable this—having your AI permanently hide windows is unacceptable.

### Section 7: Feature Gating—Who Can Use This "Remote Control Center"

Not everyone can use Computer Use. `gates.ts` (72 lines) implements multi-layer gating:

1. **Subscription tier**: only Max and Pro subscribers (`hasRequiredSubscription()`). Anthropic internal employees (`USER_TYPE === 'ant'`) bypass this restriction
2. **Remote configuration**: controlled by the GrowthBook feature flag `tengu_malort_pedway`. Even if you're a Max user, you can't use it if Anthropic hasn't enabled the feature
3. **Internal anti-accident**: if the `MONOREPO_ROOT_DIR` environment variable is detected (indicating an Anthropic monorepo dev environment), it's disabled unless `ALLOW_ANT_COMPUTER_USE_MCP=1` is explicitly set—preventing developers from accidentally letting AI control their dev machine
4. **macOS only**: the first line of `createCliExecutor` checks `process.platform !== 'darwin'`; non-macOS throws immediately
5. **OS permissions**: requires both Accessibility and Screen Recording macOS permissions (`hostAdapter.ts:48-53`)

The coordinate mode (pixels vs. normalized) is frozen after first read (`gates.ts:68-72`)—preventing GrowthBook from switching mid-session, which would cause the model to speak in pixel coordinates while the executor converts as normalized coordinates.

### Section 8: prepareForAction—the "Clearing the Field" Step

Before a mouse or keyboard operation, the system can perform a "clearing" step (`executor.ts:302-339`). `prepareForAction` does three things:

1. Calls Swift's `prepareDisplay`—hiding application windows not on the allowlist, and activating the target application
2. Passes `surrogateHost` (the terminal's Bundle ID)—exempting the terminal from being hidden on the Swift side, while also skipping it during z-order activation
3. Wraps the entire operation in `drainRunLoop`—because `prepareDisplay`'s internal `.hide()` calls trigger window manager events that are queued on the CFRunLoop

The comment (`executor.ts:310-318`) explains a key Electron vs. CLI difference: Cowork's Electron continuously drains CFRunLoop, so window-hide events process immediately. But CLI's drainRunLoop stops pumping after the operation ends, causing multiple `.hide()` events to pile up and process all at once on the next pump start—resulting in window flickering. So the pump must keep running during the clearing phase.

If clearing fails (e.g., the target app is unresponsive), **it doesn't throw**—it logs and continues. Safety is provided by the subsequent frontmost gate—if the target application isn't in the foreground, the operation is blocked.

After the operation ends, `unhideComputerUseApps` (`executor.ts:652-658`) restores all hidden windows at turn end. This function is exported at module level rather than as an executor method—it's called by `cleanup.ts` outside the executor lifecycle, fire-and-forget.

### Section 9: City Metaphor—the Remote Control Center

If Claude Code is a city, Computer Use is the **city's remote control center**.

This control center sits underground—the terminal is a windowless command room. But it's equipped with a full suite of high-tech gear:

- **Surveillance cameras** (screenshots): they can see everything on the city surface, but are carefully mounted so they never capture the command room itself
- **Robotic arms** (mouse/keyboard control): every motion has precise timing control, waiting 50ms after movement to confirm positioning, and simulating human-like acceleration/deceleration curves during drags
- **Broadcast system** (clipboard paste): it backs up whatever is currently playing, broadcasts the message, then restores—citizens don't even know the broadcast was temporarily commandeered
- **Emergency button** (global Escape interception): pressing Escape anywhere in the entire city triggers an emergency stop. This button cannot be bypassed by anyone—even a "fake Escape" from the control center itself is flagged and only briefly allowed through
- **Heartbeat pump** (drainRunLoop): the command room and surface systems speak different "languages" (Node.js vs. macOS main thread), so a translation pump must work every millisecond to keep communication flowing

The most critical safety design: the control center has a lock. Only one operator can sit at the console at a time (`computerUseLock`). If a new operator finds the lock occupied, they must wait for the previous one to leave.

---

## The Trade-Offs Behind This Design

**Why not just use AppleScript?** AppleScript can do a lot of automation, but it's shell-interpreted string code with injection risks. And AppleScript's capabilities are limited—it can't precisely control mouse coordinates or do sub-pixel screenshot cropping. Native modules are complex, but provide complete control and type safety.

**Why MCP instead of a built-in tool?** Purely because of API backend convention—it recognizes tool names starting with `mcp__computer-use__*` to identify Computer Use capabilities and inject the corresponding system prompts. Built-in tools use a different naming pattern and can't trigger this mechanism.

**Why the 1ms drainRunLoop?** This is the "glue tax" of running macOS native code in a Node.js environment. Electron apps get this for free (CFRunLoop is part of Chromium's event loop), but terminal apps must pump manually. The 1ms interval means at most 1ms of latency—imperceptible to users, but enough to keep native calls flowing smoothly.

**Why pre-calculate target screenshot size?** If the API server does the scaling, the scaled coordinates won't match the local coordinate system—the model says "click (300, 200)" but the actual screen position is wrong. Local pre-scaling ensures local coordinates = model-seen coordinates = click coordinates, eliminating a whole class of coordinate-misalignment bugs.

**Why freeze the coordinate mode?** `gates.ts:68-72` freezes the coordinate mode after first read (`frozenCoordinateMode`). If GrowthBook switched from "pixels" to "normalized" mid-session, the model would still speak in pixel coordinates while the executor starts converting as normalized—all click positions would be wrong. Freezing is the simplest consistency guarantee.

**Why return null to skip pixel verification?** The `cropRawPatch` callback in `hostAdapter.ts:65` returns `null`. Pixel verification needs synchronous JPEG crop comparison (`patch1.equals(patch2)`), but the CLI only has asynchronous `image-processor-napi`. Forcing it synchronous would block the event loop. Skipping verification is a safe degradation—the sub-gate is off by default, and the click still executes, just without the extra "confirm the target pixels haven't changed" check.

---

## Code Landmarks

- `src/utils/computerUse/executor.ts`, line 259: `createCliExecutor()` factory function
- `src/utils/computerUse/executor.ts`, lines 113-120: `moveAndSettle()` mouse movement + 50ms wait
- `src/utils/computerUse/executor.ts`, lines 180-206: `typeViaClipboard()` 6-step clipboard protocol
- `src/utils/computerUse/executor.ts`, lines 302-339: `prepareForAction()` pre-operation clearing
- `src/utils/computerUse/drainRunLoop.ts`: 1ms-interval manual CFRunLoop pump
- `src/utils/computerUse/escHotkey.ts`: system-wide Escape key CGEventTap interception
- `src/utils/computerUse/hostAdapter.ts`: CLI environment host adapter singleton
- `src/utils/computerUse/gates.ts`: multi-layer gating (subscription tier + GrowthBook + macOS only)
- `src/tools/ComputerUseTool/mcpServer.ts`, lines 60-78: MCP Server construction
- `src/tools/ComputerUseTool/wrapper.tsx`: ToolUseContext bridge layer

---

## Limitations and Critique

- **macOS only**: the entire system is deeply tied to macOS CGEvent, SCContentFilter, and Accessibility API; completely unavailable on Linux/Windows
- **drainRunLoop is an architectural compromise**: pumping the macOS main thread with 1ms polling is a hack that continuously consumes CPU cycles; if Bun/Node.js ever natively supports CFRunLoop integration, this design should be replaced
- **pixel verification is skipped**: in the CLI environment `cropRawPatch` returns null, meaning it can't confirm whether the click target's pixels match those at screenshot time—in dynamic UIs, the wrong location may be clicked

---

## If You Remember Only One Thing

Computer Use is not simply "screenshot + simulate click." It's a complete system of four architectural layers, two native languages, manual pumping of the macOS main thread, system-wide Escape key interception, animated drag trajectory simulation, a 6-step clipboard protection protocol, and a cross-session file lock to prevent conflicts. It proves that **letting AI "see" and "touch" a graphical interface is far harder than letting it read and write code files**.
