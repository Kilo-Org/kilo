import { test, expect } from "bun:test"
import { Replay } from "../../src/warm/replay"
import type { Audit } from "../../src/warm/audit"

function makeEntries(): Audit.Entry[] {
  const now = Date.now()
  return [
    {
      type: "dispatch_decision",
      id: "d1",
      taskID: "task_001",
      sessionID: "ses_001",
      candidates: [{ agentID: "agent_a", score: 72, reason: "warmness=72" }],
      selected: { agentID: "agent_a", reason: "warmest" },
      timestamp: now,
    },
    {
      type: "state_transition",
      id: "t1",
      entityType: "task",
      entityID: "task_001",
      from: "pending",
      to: "claimed",
      trigger: "dispatched",
      timestamp: now + 1,
    },
    {
      type: "state_transition",
      id: "t2",
      entityType: "agent",
      entityID: "agent_a",
      from: "warm",
      to: "executing",
      trigger: "dispatched",
      timestamp: now + 2,
    },
    {
      type: "invariant_check",
      id: "i1",
      taskID: "task_001",
      phase: "tool_pre",
      check: "blast_radius",
      passed: true,
      timestamp: now + 3,
    },
    {
      type: "invariant_check",
      id: "i2",
      taskID: "task_001",
      phase: "postcondition",
      check: "files_in_scope",
      passed: false,
      error: "package.json out of scope",
      timestamp: now + 4,
    },
    {
      type: "rollback",
      id: "r1",
      taskID: "task_001",
      snapshotFrom: "def456",
      snapshotTo: "abc123",
      filesRestored: ["src/a.ts"],
      timestamp: now + 5,
    },
    {
      type: "state_transition",
      id: "t3",
      entityType: "task",
      entityID: "task_001",
      from: "claimed",
      to: "executing",
      trigger: "started",
      timestamp: now + 6,
    },
    {
      type: "mcp_health",
      id: "m1",
      server: "server_x",
      status: "degraded",
      toolsDrifted: ["old_tool"],
      timestamp: now + 7,
    },
  ]
}

// buildTrace is async and reads from disk, so we test the verifiers directly
// using a manually constructed trace

function makeTrace(entries: Audit.Entry[]): Replay.ReplayTrace {
  return {
    sessionID: "ses_test",
    steps: entries.map((entry, index) => ({ index, entry, type: entry.type })),
    dispatches: entries.filter((e) => e.type === "dispatch_decision").length,
    transitions: entries.filter((e) => e.type === "state_transition").length,
    invariantChecks: entries.filter((e) => e.type === "invariant_check").length,
    invariantFailures: entries.filter((e) => e.type === "invariant_check" && !e.passed).length,
    rollbacks: entries.filter((e) => e.type === "rollback").length,
    mcpEvents: entries.filter((e) => e.type === "mcp_health").length,
  }
}

test("trace counts are correct", () => {
  const trace = makeTrace(makeEntries())
  expect(trace.dispatches).toBe(1)
  expect(trace.transitions).toBe(3)
  expect(trace.invariantChecks).toBe(2)
  expect(trace.invariantFailures).toBe(1)
  expect(trace.rollbacks).toBe(1)
  expect(trace.mcpEvents).toBe(1)
})

test("verifyDispatchDeterminism - passes with valid dispatches", () => {
  const trace = makeTrace(makeEntries())
  const result = Replay.verifyDispatchDeterminism(trace)
  expect(result.passed).toBe(true)
})

test("verifyDispatchDeterminism - fails with missing agentID", () => {
  const entries = makeEntries()
  ;(entries[0] as any).selected.agentID = ""
  ;(entries[0] as any).selected.reason = "warmest" // not denied but empty
  const trace = makeTrace(entries)
  const result = Replay.verifyDispatchDeterminism(trace)
  expect(result.passed).toBe(false)
  expect(result.errors[0]).toContain("no agentID")
})

test("verifyLifecycleIntegrity - passes with correct chain", () => {
  const entries: Audit.Entry[] = [
    { type: "state_transition", id: "t1", entityType: "task", entityID: "task_x", from: "pending", to: "claimed", trigger: "dispatch", timestamp: 1 },
    { type: "state_transition", id: "t2", entityType: "task", entityID: "task_x", from: "claimed", to: "executing", trigger: "start", timestamp: 2 },
    { type: "state_transition", id: "t3", entityType: "task", entityID: "task_x", from: "executing", to: "completed", trigger: "done", timestamp: 3 },
  ]
  const trace = makeTrace(entries)
  const result = Replay.verifyLifecycleIntegrity(trace)
  expect(result.passed).toBe(true)
})

test("verifyLifecycleIntegrity - fails on broken chain", () => {
  const entries: Audit.Entry[] = [
    { type: "state_transition", id: "t1", entityType: "task", entityID: "task_y", from: "pending", to: "claimed", trigger: "dispatch", timestamp: 1 },
    { type: "state_transition", id: "t2", entityType: "task", entityID: "task_y", from: "executing", to: "completed", trigger: "done", timestamp: 2 },
  ]
  const trace = makeTrace(entries)
  const result = Replay.verifyLifecycleIntegrity(trace)
  expect(result.passed).toBe(false)
  expect(result.errors[0]).toContain('expected from="claimed"')
})

test("verifyInvariantCoverage - passes when dispatched tasks have transitions", () => {
  const entries: Audit.Entry[] = [
    { type: "dispatch_decision", id: "d1", taskID: "task_z", sessionID: "ses_001", candidates: [], selected: { agentID: "a", reason: "warmest" }, timestamp: 1 },
    { type: "state_transition", id: "t1", entityType: "task", entityID: "task_z", from: "pending", to: "claimed", trigger: "dispatch", timestamp: 2 },
  ]
  const trace = makeTrace(entries)
  const result = Replay.verifyInvariantCoverage(trace)
  expect(result.passed).toBe(true)
})

test("verifyInvariantCoverage - fails when dispatched task has no transitions", () => {
  const entries: Audit.Entry[] = [
    { type: "dispatch_decision", id: "d1", taskID: "task_orphan", sessionID: "ses_001", candidates: [], selected: { agentID: "a", reason: "warmest" }, timestamp: 1 },
  ]
  const trace = makeTrace(entries)
  const result = Replay.verifyInvariantCoverage(trace)
  expect(result.passed).toBe(false)
  expect(result.errors[0]).toContain("task_orphan")
})

test("summary - produces readable output", () => {
  const trace = makeTrace(makeEntries())
  const text = Replay.summary(trace)
  expect(text).toContain("ses_test")
  expect(text).toContain("Dispatches: 1")
  expect(text).toContain("Rollbacks: 1")
})
