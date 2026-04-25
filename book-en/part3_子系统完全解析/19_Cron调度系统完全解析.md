# Complete Analysis of the Cron Scheduling System

Claude Code is more than a "conversational" tool—it can act like an on-call engineer who never sleeps, executing tasks on a schedule you define. The Cron scheduling system (2,172 lines) allows users to set timed tasks through natural language (e.g., "check deployment status every 30 minutes"). The system continues to run in the background even after you close the current conversation window. This is the key infrastructure that enables Claude Code to evolve from "passive responder" to "active patrol."

> **Source Code Location**: `src/utils/cronScheduler.ts` (566 lines), `src/utils/cronTasks.ts` (1,028 lines), `src/utils/cron.ts` (308 lines), `src/utils/cronTasksLock.ts` (195 lines), `src/utils/cronJitterConfig.ts` (75 lines)

> 💡 **Plain English**: Cron scheduling is like the alarm clock app on your phone—you set "wake me up at 7 AM every day" or "remind me to drink water every 30 minutes," and the phone works in the background, ringing at the right time. The difference is that when this "alarm" goes off, it doesn't make a sound; instead, it makes the AI execute a task (check code, run tests, update progress, etc.).

### Industry Context

Scheduled/background tasks are a relatively new capability in AI coding tools:

- **GitHub Copilot**: No native scheduled tasks; relies on GitHub Actions' cron trigger
- **Cursor**: No scheduling functionality; purely passive response
- **Aider**: Can be invoked externally via cron with `aider --message`, but not a built-in capability
- **CodeX (OpenAI)**: Has continuous execution in agent mode, but no user-defined scheduled scheduling

Claude Code's Cron system is one of the few **built-in schedulers within an AI coding tool**, supporting production-grade features such as file persistence, multi-session safety, and automatic expiration.

---

## Overview

This chapter unfolds in the following order: Section 1 dissects the core architecture (scheduler + task storage + lock mechanism); Section 2 dives into the cron expression parser; Section 3 explains file persistence and multi-session safety; Section 4 analyzes the Jitter mechanism; Section 5 parses task lifecycle management; Section 6 discusses design trade-offs.

---

> **[Figure placeholder 3.19-A]**: Cron scheduler architecture — CronScheduler ↔ CronTasks file storage ↔ Lock multi-session coordination

> **[Figure placeholder 3.19-B]**: Task lifecycle — Create → Persist → Schedule → Trigger → Execute → Expire/Delete

---

## 1. Core Architecture

### 1.1 Three-Layer Components

```
User: "/loop 30m check deployment status"
  │
  ▼
┌────────────────────────────────────────────┐
│ /loop Skill (Parsing Layer)                │
│  · Natural language → interval + prompt    │
│  · interval → cron expression              │
│  · Call CronCreate tool                    │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ CronCreate / CronDelete / CronList (Tool   │
│ Layer)                                     │
│  · Create/delete/list tasks                │
│  · Generate task ID                        │
│  · Set recurring / one-shot flags          │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ cronScheduler.ts (Scheduler Layer)         │
│  · Periodically check for tasks to trigger │
│  · Multi-session lock coordination         │
│  · Jitter to prevent thundering herd       │
│  · Execute prompt after trigger            │
└─────────────────┬──────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────┐
│ cronTasks.ts (Persistence Layer)           │
│  · .claude/scheduled_tasks.json file store │
│  · Chokidar file change watcher            │
│  · Atomic read/write protection            │
└────────────────────────────────────────────┘
```

### 1.2 Code Volume Distribution

| File | Lines | Responsibility |
|------|-------|----------------|
| `cronTasks.ts` | 1,028 | Task file I/O, parsing, serialization, file watching |
| `cronScheduler.ts` | 566 | Scheduling core, periodic checks, lock acquisition, trigger execution |
| `cron.ts` | 308 | Cron expression parser, next trigger time calculation |
| `cronTasksLock.ts` | 195 | Multi-session file lock, dead process detection |
| `cronJitterConfig.ts` | 75 | Jitter configuration (GrowthBook remote control) |
| **Total** | **2,172** | |

---

## 2. Cron Expression Parser (cron.ts)

### 2.1 Standard Cron Format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, both 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

### 2.2 Core Functions

```typescript
// Two core functions exported by cron.ts

// Parse a cron expression into a structured object
parseCronExpression(expr: string): CronExpression

// Calculate the next trigger time based on a cron expression
computeNextCronRun(expr: string, after?: Date): Date | null
```

### 2.3 /loop Natural Language Conversion

`/loop` is the user-facing entry point to the Cron system—it converts natural language time intervals into standard cron expressions:

| User Input | Parsed Interval | Cron Expression | Notes |
|-----------|-----------------|-----------------|-------|
| `5m /check-tests` | 5m | `*/5 * * * *` | Every 5 minutes |
| `2h check deploy` | 2h | `0 */2 * * *` | Every 2 hours |
| `1d backup` | 1d | `0 0 */1 * *` | Every midnight |
| `30s ping` | 30s → 1m | `*/1 * * * *` | Sub-minute rounded up to 1 minute |
| `check deploy every 20m` | 20m | `*/20 * * * *` | Trailing "every" pattern |
| `90m report` | 90m → 2h | `0 */2 * * *` | Approximate when not evenly divisible |

> 💡 **Plain English**: `/loop` is like a translator—you say "check every half hour," and it translates that into `*/30 * * * *` that the machine can understand. If you say something the machine can't express precisely (like "every 90 minutes"—cron's smallest unit is minutes, but 90 minutes isn't divisible by 60), the translator says, "How about every 2 hours instead?"

---

## 3. File Persistence and Multi-Session Safety

### 3.1 Persistence Format

Tasks are stored in `.claude/scheduled_tasks.json`:

```json
{
  "tasks": [
    {
      "id": "cron_abc123",
      "cron": "*/30 * * * *",
      "prompt": "check deployment status",
      "recurring": true,
      "createdAt": "2026-04-05T10:00:00Z",
      "lastRun": "2026-04-05T10:30:00Z",
      "expiresAt": "2026-04-12T10:00:00Z",
      "sessionId": "sess_xyz789"
    }
  ]
}
```

### 3.2 Chokidar File Watching

When multiple Claude Code instances share the same working directory, each instance needs to be aware of changes to the task file:

```typescript
// cronTasks.ts — file change watcher
// Uses the chokidar library to watch scheduled_tasks.json

watchTeamMemory() {
  // File changed → wait 300ms stabilization period → reload task list
  // 300ms threshold prevents repeated rapid writes from causing duplicate loads
}
```

### 3.3 Multi-Session Lock (cronTasksLock.ts)

Multiple Claude Code instances may be running simultaneously, but the same scheduled task should not be triggered twice:

```typescript
// cronTasksLock.ts — file lock implementation

// Acquire lock (returns true/false)
tryAcquireSchedulerLock(): boolean {
  // 1. Check if lock file exists
  // 2. If it exists, check if the holding process is still alive
  // 3. If the holder is dead (lease expired), take over the lock
  // 4. Write own PID + timestamp
}

// Release lock
releaseSchedulerLock(): void {
  // Delete lock file (only if the lock belongs to us)
}
```

> 💡 **Plain English**: It's like a shared office printer—only one person can use it at a time. Zhang San hits print and locks the printer; Li Si also wants to print, sees it's locked, and waits. But if Zhang San walks away halfway through (process crash), the system detects "Zhang San hasn't responded for 5 minutes" and automatically unlocks it so Li Si can use it.

### 3.4 Dead Process Detection

```typescript
// Lock file content:
{
  "pid": 12345,
  "acquiredAt": "2026-04-05T10:00:00Z"
}

// Determine if the holder is still alive:
// 1. Send signal 0 to the PID (doesn't kill the process, only checks existence)
// 2. If the process doesn't exist → lock has expired
// 3. If acquiredAt exceeds the lease limit → lock has expired
// Either condition being met allows takeover
```

---

## 4. Jitter Mechanism

### 4.1 Thundering Herd

When multiple `*/5 * * * *` tasks run on the same machine, they all trigger at exactly `:00`, `:05`, `:10`, causing API request spikes.

### 4.2 Random Offset

```typescript
// cronJitterConfig.ts — remotely configured via GrowthBook

// Each task's actual trigger time = scheduled time + random(0, jitter_max)
// jitter_max is configured through a GrowthBook feature flag
// Default values can be remotely adjusted based on API load
```

> 💡 **Plain English**: It's like school dismissal—if all students rush out the gate at the same time, the entrance gets jammed. The school's solution is "first graders leave first, second graders 5 minutes later, third graders 10 minutes later." Jitter works similarly—it adds a random delay to each scheduled task so their trigger times are staggered, preventing the API from being bombarded all at once.

---

## 5. Task Lifecycle

### 5.1 Creation

```
User input → /loop parsing → CronCreate tool call →
  Write to scheduled_tasks.json → Execute immediately (doesn't wait for first cron trigger)
```

### 5.2 Scheduling and Triggering

```typescript
// cronScheduler.ts — main scheduler loop

createCronScheduler(options) {
  return {
    start() {
      // 1. Acquire multi-session lock
      // 2. Load task list
      // 3. Check every minute: which tasks have nextRun <= now?
      // 4. Trigger due tasks (execute their prompt)
      // 5. Update lastRun time
      // 6. Check for expired tasks (automatic cleanup)
    },
    stop() {
      // Release lock + stop timer
    },
    getNextFireTime() {
      // Return the nearest next trigger time (for UI display)
    }
  }
}
```

### 5.3 Automatic Expiration

```typescript
// Automatic expiration for recurring tasks
// Default TTL: 7 days
// Calculated from createdAt
// Automatically removed from scheduled_tasks.json after expiration

if (task.recurring && task.expiresAt < now) {
  removeTask(task.id)  // Silent cleanup, no user interruption
}
```

This design prevents users from forgetting to cancel a scheduled task, which would otherwise continue incurring API costs.

### 5.4 Missed Task Detection

```typescript
// On startup: were there any tasks "missed" during downtime?
// Scenario: user set "check once per hour," but the computer was off for 3 hours

// One-shot task: if scheduledAt < now, prompt user "This task expired; execute it?"
// Recurring task: skip directly to the next trigger point, no catch-up for missed rounds
```

### 5.5 Daemon Mode

```typescript
// Daemon mode: only execute tasks marked as permanent
// For background-running Claude daemon

const scheduler = createCronScheduler({
  dir: workingDir,
  taskFilter: (t) => t.permanent  // Filter out session-level tasks
})
```

---

## 6. Design Trade-offs

### 6.1 File Storage vs Database

JSON files were chosen over SQLite or other databases:

| Aspect | JSON File | Database |
|--------|-----------|----------|
| Deployment complexity | Zero dependencies | Requires additional runtime |
| Human readability | ✅ Can be viewed/edited directly | ❌ Requires tooling |
| Concurrency safety | Needs file locks | Built-in transactions |
| Performance | Sufficient for small task counts | Better for large volumes |
| Portability | Cross-platform | Needs platform-specific drivers |

Claude Code chose JSON files because the expected task volume is very small (usually single digits), and the file lock mechanism is sufficient to guarantee multi-session safety.

### 6.2 7-Day Automatic Expiration

The 7-day TTL is a pragmatic balance:

- **Too short** (e.g., 1 day): Users setting weekly tasks would need frequent renewals
- **Too long** (e.g., 30 days): Forgotten tasks would continue consuming API quota
- **No expiration**: Most dangerous—a forgotten `*/5 * * * *` task consumes 288 API calls per day

### 6.3 One-Minute Minimum Granularity

Cron's smallest unit is 1 minute—even if a user asks for "every 10 seconds," it gets rounded up to 1 minute. This is because:

- Every task trigger implies a full AI inference call
- A 10-second interval = 8,640 calls per day, which is unrealistic for both API cost and rate limits
- Most real-world scenarios (code checks, deployment monitoring) don't need sub-minute response times

---

## 7. Critique and Reflection

### 7.1 Missed Compensation Strategy Is Too Simplistic

The current implementation only has two choices after downtime: execute immediately (one-shot) or skip (recurring). For a task like "check deployment status every hour," if the machine was down for 3 hours, the ideal behavior would be "catch up by executing the latest missed run once," rather than "execute all 3 missed runs" or "skip entirely."

### 7.2 Task Isolation

All tasks share the same `.claude/scheduled_tasks.json` with no project-level or user-level namespace isolation. In scenarios where multiple projects share a working directory (e.g., a monorepo), scheduled tasks from different projects may interfere with each other.

### 7.3 Insufficient Observability

There is no execution history—users cannot view "the results of each scheduled check over the past week." This limits the usefulness of the Cron system in operations and maintenance scenarios.

> 🔑 **Deep Insight**: Although the Cron scheduling system is only 2,172 lines, it represents a critical step in the evolution of AI coding tools from "conversational" to "resident." When AI can patrol on a schedule, actively monitor, and execute according to plan, it is no longer a chatbot that "answers when asked"—it becomes a true member of the software engineering team, with its own work schedule, on-call hours, and automated workflows.
