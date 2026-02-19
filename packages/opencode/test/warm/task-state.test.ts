import { test, expect } from "bun:test"
import { TaskState } from "../../src/warm/task-state"

test("create - returns pending task with defaults", () => {
  const task = TaskState.create({
    id: "task_001",
    sessionID: "ses_001",
    intent: { description: "Add error handling" },
  })
  expect(task.lifecycle).toBe("pending")
  expect(task.intent.description).toBe("Add error handling")
  expect(task.intent.capabilities).toEqual([])
  expect(task.intent.priority).toBe(0)
  expect(task.blastRadius.reversible).toBe(true)
  expect(task.assignment.agentID).toBeUndefined()
  expect(task.snapshots.preExecution).toBeUndefined()
})

test("create - accepts custom blast radius", () => {
  const task = TaskState.create({
    id: "task_002",
    sessionID: "ses_001",
    intent: { description: "Delete old files", capabilities: ["bash"] },
    blastRadius: {
      paths: ["src/old/**"],
      operations: ["read", "delete"],
      reversible: false,
    },
  })
  expect(task.blastRadius.paths).toEqual(["src/old/**"])
  expect(task.blastRadius.operations).toEqual(["read", "delete"])
  expect(task.blastRadius.reversible).toBe(false)
})

test("canTransition - valid transitions return true", () => {
  expect(TaskState.canTransition("pending", "claimed")).toBe(true)
  expect(TaskState.canTransition("claimed", "executing")).toBe(true)
  expect(TaskState.canTransition("executing", "postchecked")).toBe(true)
  expect(TaskState.canTransition("postchecked", "completed")).toBe(true)
  expect(TaskState.canTransition("postchecked", "failed")).toBe(true)
  expect(TaskState.canTransition("failed", "rolled_back")).toBe(true)
  expect(TaskState.canTransition("executing", "failed")).toBe(true)
  expect(TaskState.canTransition("executing", "rolled_back")).toBe(true)
  expect(TaskState.canTransition("claimed", "rolled_back")).toBe(true)
})

test("canTransition - invalid transitions return false", () => {
  expect(TaskState.canTransition("pending", "executing")).toBe(false)
  expect(TaskState.canTransition("completed", "failed")).toBe(false)
  expect(TaskState.canTransition("rolled_back", "pending")).toBe(false)
  expect(TaskState.canTransition("failed", "completed")).toBe(false)
})

test("transition - pending to claimed sets claimedAt", () => {
  const task = TaskState.create({
    id: "task_003",
    sessionID: "ses_001",
    intent: { description: "test" },
  })
  const claimed = TaskState.transition(task, "claimed")
  expect(claimed.lifecycle).toBe("claimed")
  expect(claimed.assignment.claimedAt).toBeDefined()
})

test("transition - claimed to executing sets startedAt", () => {
  const task = TaskState.create({
    id: "task_004",
    sessionID: "ses_001",
    intent: { description: "test" },
  })
  const claimed = TaskState.transition(task, "claimed")
  const executing = TaskState.transition(claimed, "executing")
  expect(executing.lifecycle).toBe("executing")
  expect(executing.assignment.startedAt).toBeDefined()
})

test("transition - to completed sets completedAt", () => {
  let task = TaskState.create({
    id: "task_005",
    sessionID: "ses_001",
    intent: { description: "test" },
  })
  task = TaskState.transition(task, "claimed")
  task = TaskState.transition(task, "executing")
  task = TaskState.transition(task, "postchecked")
  task = TaskState.transition(task, "completed")
  expect(task.lifecycle).toBe("completed")
  expect(task.assignment.completedAt).toBeDefined()
})

test("transition - invalid transition throws", () => {
  const task = TaskState.create({
    id: "task_006",
    sessionID: "ses_001",
    intent: { description: "test" },
  })
  expect(() => TaskState.transition(task, "executing")).toThrow("Invalid task lifecycle transition")
})

test("full happy path lifecycle", () => {
  let task = TaskState.create({
    id: "task_007",
    sessionID: "ses_001",
    intent: { description: "Add tests" },
  })
  expect(task.lifecycle).toBe("pending")
  task = TaskState.transition(task, "claimed")
  expect(task.lifecycle).toBe("claimed")
  task = TaskState.transition(task, "executing")
  expect(task.lifecycle).toBe("executing")
  task = TaskState.transition(task, "postchecked")
  expect(task.lifecycle).toBe("postchecked")
  task = TaskState.transition(task, "completed")
  expect(task.lifecycle).toBe("completed")
})

test("failure and rollback path", () => {
  let task = TaskState.create({
    id: "task_008",
    sessionID: "ses_001",
    intent: { description: "Risky change" },
  })
  task = TaskState.transition(task, "claimed")
  task = TaskState.transition(task, "executing")
  task = TaskState.transition(task, "failed")
  expect(task.lifecycle).toBe("failed")
  task = TaskState.transition(task, "rolled_back")
  expect(task.lifecycle).toBe("rolled_back")
})
