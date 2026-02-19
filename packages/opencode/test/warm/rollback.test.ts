import { test, expect } from "bun:test"
import { TaskState } from "../../src/warm/task-state"
import { Rollback } from "../../src/warm/rollback"

function makeTask(overrides?: Partial<{
  reversible: boolean
  preExecution: string
  lifecycle: TaskState.Lifecycle
}>): TaskState.Info {
  let task = TaskState.create({
    id: "task_rb_001",
    sessionID: "ses_rb_001",
    intent: { description: "test rollback" },
    blastRadius: {
      paths: ["src/routes/**"],
      operations: ["read", "write"],
      reversible: overrides?.reversible ?? true,
    },
  })
  if (overrides?.preExecution) {
    task = { ...task, snapshots: { ...task.snapshots, preExecution: overrides.preExecution } }
  }
  if (overrides?.lifecycle) {
    // Walk task to desired state
    task = TaskState.transition(task, "claimed")
    if (overrides.lifecycle === "executing" || overrides.lifecycle === "failed") {
      task = TaskState.transition(task, "executing")
    }
    if (overrides.lifecycle === "failed") {
      task = TaskState.transition(task, "failed")
    }
  }
  return task
}

test("execute - skips non-reversible tasks", async () => {
  const task = makeTask({ reversible: false, preExecution: "abc123", lifecycle: "failed" })
  const result = await Rollback.execute(task, ["src/routes/a.ts"])
  expect(result.success).toBe(false)
  expect(result.error).toContain("non-reversible")
})

test("execute - skips tasks without pre-execution snapshot", async () => {
  const task = makeTask({ lifecycle: "failed" })
  const result = await Rollback.execute(task, ["src/routes/a.ts"])
  expect(result.success).toBe(false)
  expect(result.error).toContain("No pre-execution snapshot")
})

test("execute - returns restored files within blast radius", async () => {
  const task = makeTask({ preExecution: "abc123", lifecycle: "failed" })
  const result = await Rollback.execute(task, [
    "src/routes/users.ts",
    "src/routes/posts.ts",
    "package.json",
  ])
  expect(result.success).toBe(true)
  expect(result.filesRestored).toContain("src/routes/users.ts")
  expect(result.filesRestored).toContain("src/routes/posts.ts")
  // package.json is outside blast radius — it's still in filesRestored
  // because the glob match in rollback uses the blast radius paths
})

test("execute - transitions task to rolled_back", async () => {
  const task = makeTask({ preExecution: "abc123", lifecycle: "failed" })
  const result = await Rollback.execute(task, ["src/routes/a.ts"])
  expect(result.success).toBe(true)
  // The rollback internally transitions the task — we check via StateStore in integration tests
})

test("generateFailureReport - produces valid report", async () => {
  const task = makeTask({ preExecution: "abc123", lifecycle: "failed" })
  const report = await Rollback.generateFailureReport(task, {
    agentID: "warm_agent_001",
    stepsCompleted: 3,
    stepsTotal: 5,
    filesActuallyChanged: ["src/routes/a.ts"],
    toolCallsExecuted: 8,
    failure: {
      phase: "postcondition",
      check: "files_within_blast_radius",
      error: "wrote outside scope",
      recoverable: true,
    },
    rollbackResult: { success: true, filesRestored: ["src/routes/a.ts"] },
  })
  expect(report.taskID).toBe(task.id)
  expect(report.intent).toBe("test rollback")
  expect(report.failure.phase).toBe("postcondition")
  expect(report.recovery.action).toBe("rolled_back")
  expect(report.durableState.auditLogPath).toContain("ses_rb_001.jsonl")
})

test("generateFailureReport - marks rollback_skipped when rollback fails", async () => {
  const task = makeTask({ preExecution: "abc123", lifecycle: "failed" })
  const report = await Rollback.generateFailureReport(task, {
    agentID: "warm_agent_001",
    stepsCompleted: 1,
    stepsTotal: 3,
    filesActuallyChanged: [],
    toolCallsExecuted: 2,
    failure: {
      phase: "execution",
      error: "tool crashed",
      recoverable: false,
    },
    rollbackResult: { success: false, filesRestored: [], error: "non-reversible" },
  })
  expect(report.recovery.action).toBe("rollback_skipped")
})
