import { test, expect } from "bun:test"
import { DispatchPolicy } from "../../src/warm/policy"
import { TaskState } from "../../src/warm/task-state"

function makeTask(overrides?: {
  description?: string
  capabilities?: string[]
  blastRadius?: Partial<TaskState.BlastRadius>
}): TaskState.Info {
  return TaskState.create({
    id: "task_pol_001",
    sessionID: "ses_001",
    intent: {
      description: overrides?.description ?? "test task",
      capabilities: overrides?.capabilities ?? [],
    },
    blastRadius: overrides?.blastRadius,
  })
}

test("defaultConfig - returns valid config", () => {
  const cfg = DispatchPolicy.defaultConfig()
  expect(cfg.rules).toEqual([])
  expect(cfg.autoApproveDispatch).toBe(false)
  expect(cfg.maxBlastRadius).toBe("unrestricted")
})

test("evaluate - allows by default with no rules", () => {
  const task = makeTask()
  const result = DispatchPolicy.evaluate(task, DispatchPolicy.defaultConfig())
  expect(result.action).toBe("allow")
})

test("evaluate - denies when blast radius exceeds max", () => {
  const task = makeTask({ blastRadius: { paths: ["**"], operations: ["read", "write", "delete"] } })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    maxBlastRadius: "read-only",
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("deny")
})

test("evaluate - denies when capability is on deny list", () => {
  const task = makeTask({ capabilities: ["bash", "delete"] })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    denyCapabilities: ["delete"],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("deny")
  if (result.action === "deny") {
    expect(result.reason).toContain("delete")
  }
})

test("evaluate - pins agent when configured", () => {
  const task = makeTask()
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    pinAgent: "code",
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("pin_agent")
  if (result.action === "pin_agent") {
    expect(result.agentName).toBe("code")
  }
})

test("evaluate - last-wins rule evaluation", () => {
  const task = makeTask({ description: "deploy production" })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    rules: [
      { match: { intent: "deploy" }, action: "deny", reason: "dangerous" },
      { match: { intent: "deploy" }, action: "allow", reason: "overridden" },
    ],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("allow")
})

test("evaluate - require_approval bypassed with autoApproveDispatch", () => {
  const task = makeTask({ description: "delete all files" })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    autoApproveDispatch: true,
    rules: [{ match: { intent: "delete" }, action: "require_approval", reason: "destructive" }],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("allow")
})

test("evaluate - require_approval blocks without autoApprove", () => {
  const task = makeTask({ description: "delete all files" })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    rules: [{ match: { intent: "delete" }, action: "require_approval", reason: "destructive" }],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("require_approval")
})

test("evaluate - capability match in rules", () => {
  const task = makeTask({ capabilities: ["bash", "write"] })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    rules: [{ match: { capabilities: ["bash"] }, action: "deny", reason: "no bash" }],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("deny")
})

test("evaluate - unmatched rule is skipped", () => {
  const task = makeTask({ description: "read files" })
  const config = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    rules: [{ match: { intent: "deploy" }, action: "deny", reason: "no deploy" }],
  })
  const result = DispatchPolicy.evaluate(task, config)
  expect(result.action).toBe("allow")
})
