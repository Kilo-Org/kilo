# Warm Agents Orchestration — Architecture Proposal

**Author:** Architect Agent
**Date:** 2026-02-18
**Status:** Draft — Internal Review
**Target Codebase:** `packages/opencode/src/`
**Branch Base:** `dev`

---

## 1. Executive Summary

1. **Warm Agents replaces the implicit loop-as-orchestrator pattern** in `SessionPrompt.loop()` with a deterministic dispatch system that validates intent before action and controls scope before mutation.
2. **The core abstraction is a WarmAgent**: a rehydratable execution context that carries scored warmness (loaded files, tool history, project familiarity) and can be matched to incoming tasks via capability routing.
3. **All agent and task state is externalized** to a durable store (extending the existing `Storage` layer), enabling process-restart recovery, CI/CD replay, and multi-agent handoff without conversational context loss.
4. **A typed lifecycle model** governs agents (`cold → warming → warm → executing → cooling → cold`) and tasks (`pending → claimed → executing → postchecked → completed | failed | rolled_back`), replacing the current implicit busy/idle/retry status.
5. **Deterministic routing rules** evaluate in a fixed priority order (pinned → warmest-qualified → cold-spawn), with every decision logged to an append-only audit trail.
6. **Safety interlocks** enforce blast-radius declarations, precondition gates, and postcondition checks before any mutation reaches the filesystem — extending the existing snapshot system with structured rollback.
7. **MCP lifecycle awareness** adds health checks, tool schema drift detection, and runtime routing fallback so warm agents degrade gracefully when MCP servers change or die.
8. **The migration is additive**: a new `warm/` directory under `packages/opencode/src/` introduces all subsystems as seams that the existing `SessionPrompt.loop()` can opt into incrementally.
9. **Three implementation phases**: prototype (single-agent warmness + task lifecycle), integration (multi-agent dispatch + safety harness), hardening (replay, drift handling, CI/CD mode).
10. **The quality bar is explicit provenance**: for any execution, a senior developer can answer what the agent was trying to do, what it was allowed to change, and what state survives process death — by reading the audit log and durable state alone.

---

## 2. Architecture Blueprint

### 2.1 Components

```
┌──────────────────────────────────────────────────────────────────┐
│                        Warm Agents System                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Scheduler   │  │  Capability  │  │   Invariant Middleware │ │
│  │   (Dispatch)  │←→│  Registry    │  │   (Pre/Post Checks)   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘ │
│         │                 │                       │              │
│         ▼                 ▼                       ▼              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  State Store  │  │   Warmness   │  │   Replay / Rollback   │ │
│  │  (Durable)    │  │   Scorer     │  │   Engine              │ │
│  └──────┬───────┘  └──────────────┘  └───────────┬────────────┘ │
│         │                                         │              │
│         ▼                                         ▼              │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │              Audit Log (append-only)                         ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐
│ SessionPrompt  │  │   MCP Client   │  │   Snapshot System      │
│ .loop() (prev) │  │   (existing)   │  │   (existing)           │
└────────────────┘  └────────────────┘  └────────────────────────┘
```

**Subsystems:**

| Subsystem | Responsibility | New/Extends |
|-----------|---------------|-------------|
| **Scheduler** | Receives task requests, evaluates routing rules, dispatches to warm or cold agents | New |
| **State Store** | Persists agent state, task state, warmness snapshots, and audit entries | Extends `Storage` |
| **Capability Registry** | Maps agent capabilities to tool sets, MCP servers, and file-scope familiarity | Extends `Agent.state` |
| **Invariant Middleware** | Validates preconditions before tool execution, postconditions after step completion | New (wraps existing `resolveTools`) |
| **Warmness Scorer** | Computes warmness score from loaded context, recency, tool history, file familiarity | New |
| **Replay/Rollback Engine** | Replays task sequences from audit log; executes rollback via snapshot system | Extends `Snapshot` |
| **Audit Log** | Append-only record of all dispatch decisions, state transitions, and mutations | New |

### 2.2 Data Flows

**Normal dispatch flow:**
```
User Input / CI Trigger
    │
    ▼
┌─ Scheduler ──────────────────────────────────────────┐
│  1. Parse intent → TaskRequest                        │
│  2. Query CapabilityRegistry for qualified agents     │
│  3. Score each candidate via WarmnessSorer            │
│  4. Apply routing rules (pinned > warmest > cold)     │
│  5. Write TaskState(pending→claimed) to StateStore    │
│  6. Write AuditEntry(dispatch_decision)               │
│  7. Dispatch to selected agent                        │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ Agent Execution ────────────────────────────────────┐
│  1. Rehydrate warm context from StateStore            │
│  2. InvariantMiddleware.checkPreconditions(task)      │
│  3. SessionPrompt.loop() — existing execution         │
│     ├─ Each tool call → InvariantMiddleware.pre()     │
│     └─ Each tool result → InvariantMiddleware.post()  │
│  4. Update TaskState(executing→postchecked)           │
│  5. InvariantMiddleware.checkPostconditions(task)     │
│  6. Update TaskState(postchecked→completed|failed)    │
│  7. Update AgentState warmness snapshot               │
│  8. Write AuditEntry(execution_complete)              │
└──────────────────────────────────────────────────────┘
```

**Recovery flow (process restart):**
```
Process Start
    │
    ▼
StateStore.scanIncomplete()
    │ returns tasks in {claimed, executing} state
    ▼
For each incomplete task:
    │
    ├─ task.state == "claimed" (not started)
    │   → Re-dispatch via Scheduler (agent may have died)
    │
    └─ task.state == "executing" (in-flight)
        → Load last audit checkpoint
        → Rollback to last known-good snapshot
        → Re-dispatch with rollback context
```

### 2.3 Failure Domains

| Domain | Blast Radius | Recovery Strategy |
|--------|-------------|-------------------|
| **LLM stream failure** | Single turn | Existing retry logic in `SessionProcessor` (unchanged) |
| **Tool execution failure** | Single tool call | Existing error→LLM feedback loop (unchanged) |
| **MCP server crash** | All tools on that server | Capability Registry marks server unhealthy; Scheduler routes around it |
| **Agent process death** | All in-flight tasks for that agent | StateStore recovery scan; snapshot rollback; re-dispatch |
| **State Store corruption** | All state | JSON files + shadow git provide dual recovery path |
| **Invariant violation** | Single task | Task marked `failed`; rollback to pre-task snapshot; audit entry |

---

## 3. State & Contract Schema

### 3.1 Agent State Machine

```
                    ┌──────────┐
          spawn     │          │   rehydrate()
     ┌──────────────│   COLD   │◄──────────────────────┐
     │              │          │                        │
     │              └────┬─────┘                        │
     │                   │ loadContext()                 │
     │                   ▼                              │
     │              ┌──────────┐                        │
     │              │ WARMING  │                        │
     │              │          │                        │
     │              └────┬─────┘                        │
     │                   │ contextReady()               │
     │                   ▼                              │
     │              ┌──────────┐    idle timeout        │
     │              │   WARM   │────────────────────────┘
     │              │          │◄───────────┐
     │              └────┬─────┘            │
     │                   │ dispatch(task)   │ taskComplete()
     │                   ▼                  │
     │              ┌──────────┐            │
     │              │EXECUTING │────────────┘
     │              │          │
     │              └────┬─────┘
     │                   │ cooldown() [explicit or timeout]
     │                   ▼
     │              ┌──────────┐
     └──────────────│ COOLING  │
        evict()     │          │
                    └──────────┘
```

```typescript
// packages/opencode/src/warm/agent-state.ts

import { z } from "zod"

export const AgentLifecycle = z.enum([
  "cold",       // No loaded context, minimal memory footprint
  "warming",    // Loading context from StateStore (files, history, tools)
  "warm",       // Context loaded, ready for dispatch
  "executing",  // Actively processing a task
  "cooling",    // Saving warmness snapshot before eviction
])

export const WarmAgentState = z.object({
  id: z.string(),                              // "warm_agent_{ulid}"
  agentName: z.string(),                       // references Agent.Info.name
  sessionID: z.string(),                       // bound session
  lifecycle: AgentLifecycle,
  warmness: z.number().min(0).max(100),        // computed score
  capabilities: z.array(z.string()),           // tool keys this agent can use
  mcpServers: z.array(z.string()),             // connected MCP server names
  context: z.object({
    loadedFiles: z.array(z.string()),          // files read in warm context
    toolHistory: z.array(z.string()),          // recent tool calls (last N)
    projectScope: z.array(z.string()),         // glob patterns this agent "knows"
    lastActiveAt: z.number(),                  // epoch ms
    rehydrationKey: z.string().optional(),     // pointer to warmness snapshot
  }),
  constraints: z.object({
    maxSteps: z.number().default(50),
    allowedPaths: z.array(z.string()),         // filesystem scope (globs)
    deniedPaths: z.array(z.string()),          // explicit exclusions
    blastRadius: z.enum(["read-only", "single-file", "directory", "project", "unrestricted"]),
  }),
  time: z.object({
    created: z.number(),
    warmedAt: z.number().optional(),
    lastDispatchedAt: z.number().optional(),
    cooldownAt: z.number().optional(),
  }),
})

export type WarmAgentState = z.infer<typeof WarmAgentState>
```

### 3.2 Task State Machine

```
                    ┌──────────┐
                    │ PENDING  │
                    │          │
                    └────┬─────┘
                         │ claim(agentID)
                         ▼
                    ┌──────────┐
              ┌─────│ CLAIMED  │
              │     │          │
              │     └────┬─────┘
              │          │ startExecution()
              │          ▼
              │     ┌──────────┐
    timeout/  │     │EXECUTING │──────────────┐
    crash     │     │          │              │ postcondition
              │     └────┬─────┘              │ check triggered
              │          │                    ▼
              │          │          ┌─────────────────┐
              │          │          │  POSTCHECKED     │
              │          │          │                  │
              │          │          └──┬────────────┬──┘
              │          │             │            │
              │          │    pass     │            │  fail
              │          │             ▼            ▼
              │          │      ┌──────────┐ ┌──────────┐
              │          │      │COMPLETED │ │  FAILED  │
              │          │      └──────────┘ └────┬─────┘
              │          │                        │ rollback()
              │          │                        ▼
              │          │                 ┌──────────────┐
              └──────────┴────────────────►│ ROLLED_BACK  │
                    re-dispatch            └──────────────┘
```

```typescript
// packages/opencode/src/warm/task-state.ts

import { z } from "zod"

export const TaskLifecycle = z.enum([
  "pending",       // Submitted, not yet claimed
  "claimed",       // Agent selected, not yet executing
  "executing",     // In-flight execution
  "postchecked",   // Execution done, postconditions being verified
  "completed",     // All postconditions passed
  "failed",        // Postcondition or execution failure
  "rolled_back",   // Rollback executed after failure
])

export const BlastRadiusDeclaration = z.object({
  paths: z.array(z.string()),                  // globs of files that MAY be touched
  operations: z.array(z.enum([
    "read", "write", "delete", "execute", "network",
  ])),
  mcpTools: z.array(z.string()),               // MCP tool keys that may be called
  reversible: z.boolean(),                     // can this task be rolled back?
})

export const TaskState = z.object({
  id: z.string(),                              // "task_{ulid}"
  sessionID: z.string(),
  parentTaskID: z.string().optional(),         // for subtask hierarchy
  lifecycle: TaskLifecycle,
  intent: z.object({
    description: z.string(),                   // what the agent is trying to do
    agentName: z.string().optional(),          // pinned agent (if specified)
    capabilities: z.array(z.string()),         // required tool capabilities
    priority: z.number().default(0),           // higher = more urgent
  }),
  blastRadius: BlastRadiusDeclaration,
  assignment: z.object({
    agentID: z.string().optional(),            // warm agent that claimed this
    claimedAt: z.number().optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
  }),
  preconditions: z.array(z.object({
    check: z.string(),                         // "file_exists", "mcp_healthy", "no_pending_tasks", etc.
    args: z.record(z.unknown()),
    passed: z.boolean().optional(),
  })),
  postconditions: z.array(z.object({
    check: z.string(),                         // "files_within_blast_radius", "tests_pass", etc.
    args: z.record(z.unknown()),
    passed: z.boolean().optional(),
    error: z.string().optional(),
  })),
  snapshots: z.object({
    preExecution: z.string().optional(),        // git tree hash before execution
    postExecution: z.string().optional(),       // git tree hash after execution
    rollbackTarget: z.string().optional(),      // hash to restore on rollback
  }),
  result: z.object({
    status: z.enum(["success", "failure", "rollback"]).optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
    filesChanged: z.array(z.string()).optional(),
  }).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

export type TaskState = z.infer<typeof TaskState>
```

### 3.3 Session Continuity Schema

The existing `Session.Info` is extended with a warm-agent binding:

```typescript
// Extension to Session.Info (additive, does not modify existing fields)

export const SessionWarmContext = z.object({
  warmAgentID: z.string().optional(),          // currently bound warm agent
  activeTaskID: z.string().optional(),         // currently executing task
  warmnessSummary: z.object({                  // snapshot for quick lookup
    score: z.number(),
    loadedFiles: z.number(),
    toolCalls: z.number(),
    lastActiveAt: z.number(),
  }).optional(),
  dispatchHistory: z.array(z.object({          // last N dispatch decisions
    taskID: z.string(),
    agentID: z.string(),
    reason: z.string(),                        // "warmest", "pinned", "cold_spawn"
    timestamp: z.number(),
  })).default([]),
})
```

---

## 4. Deterministic Orchestration Policy

### 4.1 Rule Evaluation Order

When a task is submitted, the Scheduler evaluates dispatch in this **fixed priority order**:

```
1. DENY CHECK
   └─ Does the task's blast radius exceed session-level constraints?
   └─ Are any required MCP servers unhealthy?
   └─ Is the task's intent on the session deny-list?
   → If any DENY: task → failed, audit entry, STOP

2. PINNED AGENT CHECK
   └─ Does the task specify intent.agentName?
   └─ Is that agent available (warm or spawnable)?
   → If PINNED and available: dispatch to that agent, SKIP scoring

3. WARM CANDIDATE SCORING
   └─ Query CapabilityRegistry for agents with matching capabilities
   └─ For each candidate, compute warmness score (§5)
   └─ Rank by score descending
   → Select highest-scoring agent above WARM_THRESHOLD (default: 30)

4. COLD SPAWN FALLBACK
   └─ If no warm candidate meets threshold:
       spawn new cold agent with required capabilities
   → Cold agent enters warming → warm → executing lifecycle

5. DISPATCH
   └─ Write TaskState(pending → claimed)
   └─ Write AuditEntry with full decision trace
   └─ Invoke agent execution
```

### 4.2 Override/Deny Semantics

Overrides follow the same **last-wins** pattern as `PermissionNext`:

```typescript
// packages/opencode/src/warm/policy.ts

export const DispatchRule = z.object({
  match: z.object({
    intent: z.string().optional(),             // wildcard pattern on intent description
    capabilities: z.array(z.string()).optional(),
    blastRadius: BlastRadiusDeclaration.partial().optional(),
  }),
  action: z.enum(["allow", "deny", "require_approval", "pin_agent"]),
  agentName: z.string().optional(),            // for pin_agent
  reason: z.string(),
})

export const DispatchPolicy = z.object({
  rules: z.array(DispatchRule),
  // Evaluated in order. Last matching rule wins (consistent with PermissionNext).
  // Default rule (implicit): { match: {}, action: "allow", reason: "default" }
})
```

**Session-level overrides** (set at session creation, e.g., by `--auto`):

| Override | Effect |
|----------|--------|
| `auto_approve_dispatch: true` | Skip `require_approval` rules |
| `max_blast_radius: "directory"` | DENY any task declaring wider scope |
| `deny_capabilities: ["bash:rm", ...]` | DENY tasks requiring specific tools |
| `pin_agent: "code"` | Force all tasks to a specific agent |

### 4.3 Audit Log Model

```typescript
// packages/opencode/src/warm/audit.ts

export const AuditEntry = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dispatch_decision"),
    id: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    candidates: z.array(z.object({
      agentID: z.string(),
      score: z.number(),
      reason: z.string(),
    })),
    selected: z.object({
      agentID: z.string(),
      reason: z.enum(["pinned", "warmest", "cold_spawn", "denied"]),
    }),
    policy: z.object({
      rulesEvaluated: z.number(),
      matchingRule: DispatchRule.optional(),
    }),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("state_transition"),
    id: z.string(),
    entityType: z.enum(["agent", "task"]),
    entityID: z.string(),
    from: z.string(),
    to: z.string(),
    trigger: z.string(),                       // what caused the transition
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("invariant_check"),
    id: z.string(),
    taskID: z.string(),
    phase: z.enum(["precondition", "postcondition", "tool_pre", "tool_post"]),
    check: z.string(),
    passed: z.boolean(),
    error: z.string().optional(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("rollback"),
    id: z.string(),
    taskID: z.string(),
    snapshotFrom: z.string(),
    snapshotTo: z.string(),
    filesRestored: z.array(z.string()),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("mcp_health"),
    id: z.string(),
    server: z.string(),
    status: z.enum(["healthy", "unhealthy", "degraded", "reconnecting"]),
    toolsDrifted: z.array(z.string()).optional(),
    timestamp: z.number(),
  }),
])

export type AuditEntry = z.infer<typeof AuditEntry>
```

The audit log is **append-only**, stored as JSONL at `{storage_root}/warm/audit/{sessionID}.jsonl`. Each line is a single `AuditEntry`. This format supports:
- `tail -f` for live monitoring
- Line-count for replay positioning
- Grep for filtering by type

---

## 5. Warmness Model

### 5.1 How Warm Context is Scored

Warmness is a composite score (0–100) computed from four weighted dimensions:

```typescript
// packages/opencode/src/warm/scorer.ts

export interface WarmnessDimensions {
  recency: number      // 0-100: how recently the agent was active
  familiarity: number  // 0-100: overlap between agent's loaded files and task's likely scope
  toolMatch: number    // 0-100: what % of required tools the agent has used recently
  continuity: number   // 0-100: is this a continuation of the agent's current work?
}

export const WEIGHTS = {
  recency: 0.20,
  familiarity: 0.35,
  toolMatch: 0.20,
  continuity: 0.25,
} as const

export function computeWarmness(d: WarmnessDimensions): number {
  return Math.round(
    d.recency * WEIGHTS.recency +
    d.familiarity * WEIGHTS.familiarity +
    d.toolMatch * WEIGHTS.toolMatch +
    d.continuity * WEIGHTS.continuity
  )
}
```

**Dimension calculations:**

| Dimension | Calculation | Example |
|-----------|------------|---------|
| **Recency** | `max(0, 100 - (minutesSinceLastActive / STALENESS_MINUTES) * 100)` | Active 5 min ago with 30-min staleness → 83 |
| **Familiarity** | `(intersection(agent.loadedFiles, task.likelyFiles) / task.likelyFiles.length) * 100` | Agent loaded 8/10 files task needs → 80 |
| **Tool Match** | `(intersection(agent.toolHistory, task.requiredCapabilities) / task.requiredCapabilities.length) * 100` | Agent used 3/4 required tools recently → 75 |
| **Continuity** | `100` if task.parentTaskID matches agent's last task, `50` if same session, `0` otherwise | Subtask of current work → 100 |

### 5.2 Expiration/Staleness Rules

```typescript
export const STALENESS_CONFIG = {
  WARM_THRESHOLD: 30,           // minimum score to be considered "warm enough"
  STALENESS_MINUTES: 30,        // recency decays to 0 after this many minutes
  MAX_WARM_AGENTS: 5,           // max concurrent warm agents per session
  COOLDOWN_AFTER_IDLE_MS: 300_000,  // 5 minutes idle → start cooling
  EVICT_AFTER_COOL_MS: 600_000,    // 10 minutes cooling → evict to cold
  CONTEXT_SIZE_LIMIT: 50,       // max loaded files in warm context
}
```

**Eviction policy** (when `MAX_WARM_AGENTS` is reached):
1. Score all warm agents
2. Evict the lowest-scoring agent (transition to `cooling`)
3. Save warmness snapshot to StateStore (so it can rehydrate later)
4. If all agents score above threshold, evict the oldest by `lastActiveAt`

### 5.3 Rehydration Strategy

When a cold agent is selected for dispatch (no warm candidate meets threshold, or a pinned agent is cold):

```
1. Load WarmAgentState from StateStore (if exists)
2. Check rehydrationKey → load warmness snapshot
3. Reconstruct context:
   a. Re-read loadedFiles list (verify files still exist, skip deleted)
   b. Rebuild tool history from audit log
   c. Load last N messages from session storage (existing MessageV2 system)
4. Compute fresh warmness score
5. Transition: cold → warming → warm
6. Total rehydration budget: max 5 seconds wall-clock
   (if exceeded, dispatch as partially-warm with reduced score)
```

The rehydration key is a pointer to a snapshot stored in `{storage_root}/warm/snapshots/{agentID}.json` containing the full `WarmAgentState.context` object. This is written during the `cooling` phase.

---

## 6. Safety Harness Design for `--auto`

### 6.1 Snapshot Strategy

Extends the existing `Snapshot` system in `packages/opencode/src/snapshot/`:

```
Task Lifecycle Snapshots:
  ┌─────────────┐
  │  pre-task    │ ← Snapshot.track() at task claim time
  │  snapshot    │   (same shadow-git mechanism as today)
  └──────┬──────┘
         │
  ┌──────▼──────┐
  │  per-step   │ ← Existing step-start/step-finish snapshots (unchanged)
  │  snapshots  │
  └──────┬──────┘
         │
  ┌──────▼──────┐
  │  post-task   │ ← Snapshot.track() after postcondition check
  │  snapshot    │
  └─────────────┘
```

The `pre-task snapshot` is new — it captures filesystem state before the warm agent begins executing, providing a clean rollback target that is independent of individual step snapshots.

### 6.2 Blast Radius Declaration

Every task must declare its blast radius **before execution begins**:

```typescript
// Enforced by InvariantMiddleware.checkPreconditions()

const blastRadius = {
  paths: ["packages/opencode/src/warm/**"],    // files that MAY be touched
  operations: ["read", "write"],               // no delete, no execute
  mcpTools: [],                                // no MCP tools needed
  reversible: true,                            // can be rolled back
}
```

**Enforcement during execution:**

The `InvariantMiddleware` wraps `resolveTools()` (the existing tool assembly point at [session/prompt.ts:754](packages/opencode/src/session/prompt.ts)) and intercepts every tool call:

```typescript
// packages/opencode/src/warm/invariant.ts

export async function toolPreCheck(
  toolName: string,
  args: unknown,
  task: TaskState,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Check if tool is in allowed operations
  const op = classifyToolOperation(toolName) // "read" | "write" | "delete" | "execute" | "network"
  if (!task.blastRadius.operations.includes(op)) {
    return { allowed: false, reason: `Operation "${op}" not declared in blast radius` }
  }

  // 2. Check if affected path is within declared scope
  const targetPath = extractTargetPath(toolName, args)
  if (targetPath && !matchesAnyGlob(targetPath, task.blastRadius.paths)) {
    return { allowed: false, reason: `Path "${targetPath}" outside declared blast radius` }
  }

  // 3. Check if MCP tool is declared
  if (isMCPTool(toolName) && !task.blastRadius.mcpTools.includes(toolName)) {
    return { allowed: false, reason: `MCP tool "${toolName}" not declared in blast radius` }
  }

  return { allowed: true }
}
```

### 6.3 Rollback Protocol

```
Rollback Trigger:
  postcondition failure ──OR── explicit rollback request ──OR── process crash recovery

Rollback Steps:
  1. Read task.snapshots.preExecution (git tree hash)
  2. For each file in task.result.filesChanged:
     a. Snapshot.revert(file, preExecution hash)     ← existing mechanism
  3. Update TaskState: lifecycle → "rolled_back"
  4. Write AuditEntry(type: "rollback", filesRestored, snapshotFrom, snapshotTo)
  5. Bus.publish(TaskRolledBack, { taskID, reason })

Non-reversible Tasks:
  If task.blastRadius.reversible === false:
    - Rollback is SKIPPED
    - Task is marked "failed" with error describing why rollback was not possible
    - Audit entry includes "rollback_skipped" flag
    - Structured failure report is emitted (§6.4)
```

### 6.4 Structured Failure Report Schema

```typescript
// packages/opencode/src/warm/failure-report.ts

export const FailureReport = z.object({
  taskID: z.string(),
  sessionID: z.string(),
  agentID: z.string(),
  timestamp: z.number(),

  // What was the agent trying to do?
  intent: z.string(),

  // What was it allowed to change?
  blastRadius: BlastRadiusDeclaration,

  // What actually happened?
  execution: z.object({
    stepsCompleted: z.number(),
    stepsTotal: z.number(),
    filesActuallyChanged: z.array(z.string()),
    toolCallsExecuted: z.number(),
    lastToolCall: z.object({
      tool: z.string(),
      input: z.unknown(),
      output: z.string().optional(),
      error: z.string().optional(),
    }).optional(),
  }),

  // What failed?
  failure: z.object({
    phase: z.enum(["precondition", "execution", "postcondition", "rollback"]),
    check: z.string().optional(),
    error: z.string(),
    recoverable: z.boolean(),
  }),

  // What was done about it?
  recovery: z.object({
    action: z.enum(["rolled_back", "rollback_skipped", "retry_queued", "abandoned"]),
    snapshotRestored: z.string().optional(),
    filesRestored: z.array(z.string()).optional(),
  }),

  // What state survives?
  durableState: z.object({
    auditLogPath: z.string(),
    snapshotHash: z.string().optional(),
    taskStatePath: z.string(),
  }),
})

export type FailureReport = z.infer<typeof FailureReport>
```

---

## 7. MCP Lifecycle Awareness Plan

### 7.1 Health Checks

```typescript
// packages/opencode/src/warm/mcp-health.ts

export const MCPHealthStatus = z.enum(["healthy", "unhealthy", "degraded", "reconnecting"])

export interface MCPHealthState {
  server: string
  status: MCPHealthStatus
  lastCheckedAt: number
  lastHealthyAt: number
  consecutiveFailures: number
  toolCount: number                  // tools at last healthy check
  latencyMs: number                  // average response time
}
```

**Health check mechanism:**

The existing MCP client in `mcp/index.ts` already handles `ToolListChangedNotification`. The Warm Agents system adds a periodic health probe:

```
Scheduler Timer (every 60s):
  For each connected MCP server:
    1. Call client.listTools() with 5s timeout
    2. If success:
       - Compare tool count/names to last known state
       - If changed → emit "mcp_health" audit entry with toolsDrifted
       - Update MCPHealthState: status = "healthy" or "degraded" (if tools changed)
    3. If timeout/error:
       - Increment consecutiveFailures
       - If failures >= 3 → status = "unhealthy"
       - Write audit entry
       - Notify Scheduler to re-evaluate routing for affected agents
```

### 7.2 Tool Schema Drift Handling

When `listTools()` returns a different tool set than expected:

```
Drift Detection:
  1. Compare current tools to CapabilityRegistry's recorded tools for this server
  2. Classify drift:
     a. ADDED tools: register in CapabilityRegistry, log audit entry, no action needed
     b. REMOVED tools:
        - Check if any warm agent depends on removed tool
        - If yes → mark affected agents as "degraded" (reduce warmness by 20)
        - If a task in-flight requires the removed tool → emit warning to LLM
     c. CHANGED schema (same name, different parameters):
        - Mark tool as "schema_drifted" in CapabilityRegistry
        - Existing calls using old schema may fail → LLM will receive error naturally
        - Log audit entry with before/after schema diff

Resolution:
  - Agents adapt automatically via existing tool-error → LLM feedback loop
  - Scheduler avoids routing tasks to agents with degraded capabilities
  - After N successful calls with new schema → clear drift flag
```

### 7.3 Runtime Routing Fallback

When an MCP server is unhealthy during task dispatch:

```
Fallback Priority:
  1. Route to warm agent that does NOT depend on unhealthy server
  2. If task requires unhealthy server's tools:
     a. Check if another MCP server provides equivalent tools (name match)
     b. If yes → route via alternate server
     c. If no → queue task as "pending" with retry after health recovery
     d. If queued > MAX_QUEUE_WAIT (5 min) → fail task with structured report

Bus Integration:
  - Bus.publish(MCPServerUnhealthy, { server, tools, since })
  - Bus.publish(MCPServerRecovered, { server, tools })
  - Scheduler subscribes and re-evaluates pending tasks on recovery
```

---

## 8. Implementation Plan

### Phase 1: Prototype (2-3 weeks)

**Goal:** Single-agent warmness tracking + task lifecycle in isolation.

| Step | Work | Files |
|------|------|-------|
| 1a | Create `packages/opencode/src/warm/` directory | New directory |
| 1b | Implement `WarmAgentState` + `TaskState` schemas | `warm/agent-state.ts`, `warm/task-state.ts` |
| 1c | Implement `StateStore` adapter (extends `Storage`) | `warm/state-store.ts` |
| 1d | Implement `WarmnessSorer` with four dimensions | `warm/scorer.ts` |
| 1e | Implement `AuditLog` (JSONL append-only writer) | `warm/audit.ts` |
| 1f | Add lifecycle state tracking to `SessionPrompt.loop()` | `session/prompt.ts` (additive seam) |
| 1g | Write unit tests for scorer, state machines, audit | `tests/warm/*.test.ts` |

**Seam strategy:** In Phase 1, `SessionPrompt.loop()` gets an optional `WarmContext` parameter. If provided, it records state transitions and warmness updates. If not provided (default), behavior is identical to today.

**Risk:** Warmness scoring heuristics may need tuning.
**Mitigation:** All weights are configurable constants, not hardcoded. Phase 1 includes logging to collect scoring data for calibration.

### Phase 2: Integration (3-4 weeks)

**Goal:** Multi-agent dispatch, invariant middleware, safety harness.

| Step | Work | Files |
|------|------|-------|
| 2a | Implement `Scheduler` (dispatch loop + routing rules) | `warm/scheduler.ts` |
| 2b | Implement `CapabilityRegistry` (extends `Agent.state`) | `warm/capability-registry.ts` |
| 2c | Implement `InvariantMiddleware` (pre/post tool checks) | `warm/invariant.ts` |
| 2d | Implement `DispatchPolicy` rule evaluation | `warm/policy.ts` |
| 2e | Extend `Snapshot` with pre-task/post-task captures | `snapshot/index.ts` (minimal diff) |
| 2f | Implement rollback protocol | `warm/rollback.ts` |
| 2g | Implement `FailureReport` generation | `warm/failure-report.ts` |
| 2h | Wire Scheduler into `SessionPrompt.loop()` | `session/prompt.ts` (seam activation) |
| 2i | Wire InvariantMiddleware into `resolveTools()` | `session/prompt.ts` (wraps existing) |
| 2j | Add `--warm` CLI flag to opt-in | `cli/cmd/run.ts` |
| 2k | Integration tests: dispatch, rollback, failure reports | `tests/warm/*.test.ts` |

**Seam strategy:** Phase 2 activates the Scheduler behind a `--warm` CLI flag. Without the flag, the existing `SessionPrompt.loop()` runs unchanged. With the flag, the Scheduler wraps the loop and manages dispatch.

**Risk:** InvariantMiddleware adds latency to every tool call.
**Mitigation:** Invariant checks are synchronous schema matches (glob matching, set lookup) — sub-millisecond. No network calls in the hot path.

### Phase 3: Hardening (2-3 weeks)

**Goal:** MCP health, replay, `--auto` safety, production readiness.

| Step | Work | Files |
|------|------|-------|
| 3a | Implement MCP health check timer | `warm/mcp-health.ts` |
| 3b | Implement tool schema drift detection | `warm/mcp-health.ts` |
| 3c | Implement runtime routing fallback | `warm/scheduler.ts` (extend) |
| 3d | Implement replay engine (audit log → re-execution) | `warm/replay.ts` |
| 3e | Implement `--auto` safety integration | `cli/cmd/run.ts` (extend) |
| 3f | Add structured failure reports to `--auto` output | `warm/failure-report.ts` |
| 3g | Process restart recovery scan | `warm/state-store.ts` (extend) |
| 3h | End-to-end tests: crash recovery, MCP drift, replay | `tests/warm/*.test.ts` |
| 3i | Documentation and config reference | `docs/warm-agents.md` |

**Risk:** Replay fidelity — non-deterministic tool results (LLM, network) make exact replay impossible.
**Mitigation:** Replay engine validates *structural* equivalence (same tools called in same order) rather than output equality. Useful for CI/CD audit, not exact reproduction.

### Files Likely Touched (Summary)

| Category | Files | Change Type |
|----------|-------|-------------|
| **New** | `packages/opencode/src/warm/*.ts` (8-10 files) | All new code |
| **New** | `packages/opencode/tests/warm/*.test.ts` (4-6 files) | All new tests |
| **Seam** | `packages/opencode/src/session/prompt.ts` | Additive optional parameter + conditional branch |
| **Seam** | `packages/opencode/src/snapshot/index.ts` | Add `trackTask()` / `revertTask()` methods |
| **Seam** | `packages/opencode/src/cli/cmd/run.ts` | Add `--warm` flag, extend `--auto` behavior |
| **Seam** | `packages/opencode/src/bus/bus-event.ts` | Add new event types |
| **Untouched** | All other existing files | No changes |

---

## 9. 60-Second Demo Script

### Setup

```bash
# Terminal 1: Start Kilo with warm agents enabled
cd my-project
kilo run --warm "Add error handling to the API routes"
```

### Expected Observable Behavior

```
$ kilo run --warm "Add error handling to the API routes"

[warm] Scheduler: creating task task_01JMXYZ...
  intent: "Add error handling to the API routes"
  blast_radius: paths=["src/routes/**"], ops=[read,write], reversible=true

[warm] Scheduler: no warm agents available, spawning cold agent
  agent: code → lifecycle: cold → warming
  rehydrating: 0 files, 0 tool history entries
  lifecycle: warming → warm (score: 15)

[warm] Scheduler: dispatching task_01JMXYZ to warm_agent_01JMABC
  reason: cold_spawn (no warm candidates)
  preconditions: [file_exists("src/routes/")] → PASSED

[warm] InvariantMiddleware: tool_pre_check
  tool: read, path: src/routes/users.ts → ALLOWED (within blast radius)

... (normal LLM execution, tool calls visible as today) ...

[warm] InvariantMiddleware: tool_pre_check
  tool: write, path: src/routes/users.ts → ALLOWED (within blast radius)

[warm] InvariantMiddleware: tool_pre_check
  tool: write, path: package.json → DENIED (outside blast radius)
  → error returned to LLM: "Cannot write to package.json — not in declared scope"

... (LLM adjusts, continues within scope) ...

[warm] Task task_01JMXYZ: executing → postchecked
  postconditions: [files_within_blast_radius] → PASSED
  postconditions: [no_new_lint_errors] → PASSED

[warm] Task task_01JMXYZ: postchecked → completed
  files changed: src/routes/users.ts, src/routes/posts.ts
  snapshot: abc123 → def456

[warm] Agent warm_agent_01JMABC: executing → warm (score: 72)
  loaded_files: 5, tool_history: 12, idle timeout: 5m

# Follow-up task reuses warm context:
$ kilo run --warm "Now add tests for those error handlers"

[warm] Scheduler: creating task task_01JMXZZ...
[warm] Scheduler: scoring candidates...
  warm_agent_01JMABC: score=72 (familiarity=80, recency=95, toolMatch=60, continuity=50)
[warm] Scheduler: dispatching to warm_agent_01JMABC
  reason: warmest (score 72 > threshold 30)
  rehydration: SKIPPED (already warm)

... (agent already knows the files, starts faster) ...
```

### `--auto` Safety Demo

```bash
# CI/CD mode: auto-approve but with safety harness
$ kilo run --warm --auto "Refactor auth module"

[warm] Task task_01JM...: blast_radius declared
  paths: ["src/auth/**"], ops: [read,write], reversible: true

... (auto-approved execution) ...

[warm] InvariantMiddleware: POSTCONDITION FAILED
  check: "files_within_blast_radius"
  violation: agent wrote to "src/config/auth.json" (not in declared paths)

[warm] Rollback initiated for task_01JM...
  restoring: src/auth/login.ts, src/auth/register.ts, src/config/auth.json
  snapshot: def456 → abc123 (pre-task state)

[warm] Failure report written to .kilo/warm/failures/task_01JM....json
  {
    "intent": "Refactor auth module",
    "failure": {
      "phase": "postcondition",
      "check": "files_within_blast_radius",
      "error": "src/config/auth.json not in declared paths [src/auth/**]",
      "recoverable": true
    },
    "recovery": {
      "action": "rolled_back",
      "filesRestored": ["src/auth/login.ts", "src/auth/register.ts", "src/config/auth.json"]
    }
  }

Exit code: 1 (postcondition failure)
```

---

## 10. Acceptance Criteria

### Determinism Checks

| # | Criterion | Verification |
|---|-----------|-------------|
| D1 | Given the same task, same warm agent pool, and same MCP state, the Scheduler always selects the same agent | Unit test: fixed inputs → deterministic output |
| D2 | Dispatch rule evaluation produces identical results when rules are replayed from audit log | Unit test: serialize rules + inputs → replay → compare |
| D3 | Warmness scores are reproducible from persisted state (no reliance on in-memory-only data) | Unit test: load WarmAgentState from disk → compute score → matches stored score |
| D4 | Task lifecycle transitions follow the state machine exactly — no skipped states | Integration test: assert transition sequence from audit log entries |
| D5 | Audit log entries contain sufficient information to reconstruct every dispatch decision | Review test: parse audit → rebuild decision tree → verify matches |

### Recovery Checks

| # | Criterion | Verification |
|---|-----------|-------------|
| R1 | After process kill during task execution, restart finds incomplete task and initiates recovery | Integration test: kill process → restart → verify recovery scan fires |
| R2 | Rollback restores all files to pre-task snapshot state | Integration test: execute task → force postcondition failure → verify file contents match pre-task state |
| R3 | Warm agent context survives process restart via rehydration | Integration test: warm agent → kill process → restart → verify agent rehydrates with correct loaded files and tool history |
| R4 | MCP server crash does not leave tasks in permanent "executing" state | Integration test: disconnect MCP mid-task → verify task transitions to failed → verify re-dispatch on MCP recovery |
| R5 | Concurrent tasks on the same session do not corrupt shared state | Concurrency test: parallel task submissions → verify no state interleaving in audit log |

### Safety Checks

| # | Criterion | Verification |
|---|-----------|-------------|
| S1 | A tool call outside declared blast radius is blocked before execution | Unit test: declare `paths: ["src/a/**"]` → attempt write to `src/b/x.ts` → verify DENIED |
| S2 | A postcondition failure triggers automatic rollback in `--auto` mode | Integration test: `--auto` task → postcondition fails → verify rollback → verify exit code 1 |
| S3 | Structured failure report contains all three Quality Bar answers | Schema validation: every FailureReport has non-empty `intent`, `blastRadius`, and `durableState` |
| S4 | `--auto` mode cannot bypass blast radius declarations (even with auto-approve) | Integration test: `--auto` → task declares `read-only` → agent attempts write → verify DENIED regardless of auto-approve |
| S5 | No warm agent state is lost if the process dies between state transitions | Crash test: inject kill signal at each lifecycle transition → restart → verify state store has last committed state |

### Quality Bar Verification

For **any** task execution, the following must be answerable from the audit log and state store alone (no conversational context needed):

| Question | Source |
|----------|--------|
| **What was the agent trying to do?** | `TaskState.intent.description` + `AuditEntry(dispatch_decision).selected` |
| **What was it allowed to change?** | `TaskState.blastRadius` (paths, operations, mcpTools) |
| **What state survives process death?** | `TaskState` (persisted), `WarmAgentState` (persisted), `AuditLog` (JSONL on disk), `Snapshot` hashes (shadow git) |

---

## Appendix A: File Structure

```
packages/opencode/src/warm/
├── index.ts                 # Public API: createWarmContext(), WarmScheduler
├── agent-state.ts           # WarmAgentState schema + lifecycle transitions
├── task-state.ts            # TaskState schema + lifecycle transitions
├── state-store.ts           # Durable persistence adapter (extends Storage)
├── scheduler.ts             # Dispatch loop, routing rules, candidate scoring
├── scorer.ts                # Warmness scoring (4 dimensions + weights)
├── capability-registry.ts   # Agent capability mapping + MCP tool index
├── invariant.ts             # Pre/post condition checks, tool blast-radius enforcement
├── policy.ts                # DispatchPolicy schema + rule evaluation
├── rollback.ts              # Rollback protocol (extends Snapshot)
├── failure-report.ts        # FailureReport schema + generator
├── mcp-health.ts            # MCP server health checks + drift detection
├── replay.ts                # Audit log replay engine
├── audit.ts                 # AuditEntry schema + JSONL writer
└── bus-events.ts            # Warm-specific Bus event types
```

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Warm Agent** | An agent instance with loaded context (files, tool history, project scope) that can be dispatched without cold-start overhead |
| **Warmness Score** | 0–100 composite metric measuring how prepared an agent is for a given task |
| **Blast Radius** | Explicit declaration of what files, operations, and tools a task is allowed to touch |
| **Invariant Middleware** | Enforcement layer that validates preconditions before and postconditions after task execution |
| **Rehydration** | Process of loading a cold agent's context from a persisted warmness snapshot |
| **Cooling** | Transitional state where a warm agent saves its context snapshot before eviction |
| **Dispatch Policy** | Ordered rule set that determines which agent handles a task |
| **Audit Log** | Append-only JSONL record of all dispatch decisions, state transitions, and invariant checks |
