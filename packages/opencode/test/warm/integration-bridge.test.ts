import { test, expect, beforeEach } from "bun:test"
import { WarmIntegration } from "../../src/warm/integration"
import { WarmSession } from "../../src/warm/warm-session"
import { TaskState } from "../../src/warm/task-state"
import { AgentState } from "../../src/warm/agent-state"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { MCPHealth } from "../../src/warm/mcp-health"

beforeEach(() => {
  // Clear globalThis warm context
  delete (globalThis as any).__warmContext
  CapabilityRegistry.clear()
  MCPHealth.clear()
})

// --- Context Access ---

test("getContext returns undefined when no context set", () => {
  expect(WarmIntegration.getContext()).toBeUndefined()
})

test("isEnabled returns false when no context", () => {
  expect(WarmIntegration.isEnabled()).toBe(false)
})

test("setContext / getContext roundtrip", () => {
  const ctx = WarmSession.createContext("ses_test_001")
  WarmIntegration.setContext(ctx)

  const retrieved = WarmIntegration.getContext()
  expect(retrieved).toBeDefined()
  expect(retrieved!.sessionID).toBe("ses_test_001")
  expect(retrieved!.enabled).toBe(true)
})

test("isEnabled returns true after setContext", () => {
  WarmIntegration.setContext(WarmSession.createContext("ses_test_002"))
  expect(WarmIntegration.isEnabled()).toBe(true)
})

// --- Tool Pre-Check ---

test("checkTool returns allowed when no context", async () => {
  const result = await WarmIntegration.checkTool("read", { file_path: "src/a.ts" }, "ses_001")
  expect(result.allowed).toBe(true)
  expect(result.logged).toBe(false)
})

test("checkTool returns allowed when no active task", async () => {
  const ctx = WarmSession.createContext("ses_003")
  WarmIntegration.setContext(ctx)

  const result = await WarmIntegration.checkTool("read", { file_path: "src/a.ts" }, "ses_003")
  expect(result.allowed).toBe(true)
  expect(result.logged).toBe(false)
})

test("checkTool allows tool within blast radius", async () => {
  const ctx = WarmSession.createContext("ses_004")
  ctx.activeTask = TaskState.create({
    id: "task_004",
    sessionID: "ses_004",
    intent: { description: "test" },
    blastRadius: {
      paths: ["src/auth/**"],
      operations: ["read", "write"],
    },
  })
  WarmIntegration.setContext(ctx)

  const result = await WarmIntegration.checkTool("read", { file_path: "src/auth/login.ts" }, "ses_004")
  expect(result.allowed).toBe(true)
  expect(result.logged).toBe(true)
})

test("checkTool blocks tool outside blast radius", async () => {
  const ctx = WarmSession.createContext("ses_005")
  ctx.activeTask = TaskState.create({
    id: "task_005",
    sessionID: "ses_005",
    intent: { description: "test" },
    blastRadius: {
      paths: ["src/auth/**"],
      operations: ["read", "write"],
    },
  })
  WarmIntegration.setContext(ctx)

  const result = await WarmIntegration.checkTool("write", { file_path: "package.json" }, "ses_005")
  expect(result.allowed).toBe(false)
  expect(result.reason).toBeDefined()
  expect(result.logged).toBe(true)
})

// --- Status Formatting ---

test("formatStatus returns undefined when no context", () => {
  expect(WarmIntegration.formatStatus()).toBeUndefined()
})

test("formatStatus includes agent and task when present", () => {
  const ctx = WarmSession.createContext("ses_006")
  ctx.activeAgent = {
    ...AgentState.create({ id: "agent_001", agentName: "code", sessionID: "ses_006" }),
    lifecycle: "warm",
    context: { loadedFiles: [], toolHistory: [], projectScope: [], lastActiveAt: Date.now() },
  }
  ctx.activeTask = TaskState.create({
    id: "task_006",
    sessionID: "ses_006",
    intent: { description: "test" },
  })
  WarmIntegration.setContext(ctx)

  const status = WarmIntegration.formatStatus()
  expect(status).toContain("[warm]")
  expect(status).toContain("agent=agent_001")
  expect(status).toContain("task=task_006")
})

test("formatToolCheck shows check mark for allowed", () => {
  const result = WarmIntegration.formatToolCheck("read", { allowed: true, logged: true })
  expect(result).toContain("\u2713")
  expect(result).toContain("read")
})

test("formatToolCheck shows X for blocked", () => {
  const result = WarmIntegration.formatToolCheck("write", { allowed: false, reason: "out of scope", logged: true })
  expect(result).toContain("\u2717")
  expect(result).toContain("BLOCKED")
  expect(result).toContain("out of scope")
})

test("formatTaskSummary returns undefined when no context", () => {
  expect(WarmIntegration.formatTaskSummary()).toBeUndefined()
})

test("formatTaskSummary includes task details", () => {
  const ctx = WarmSession.createContext("ses_007")
  ctx.activeTask = TaskState.create({
    id: "task_007",
    sessionID: "ses_007",
    intent: { description: "add validation" },
    blastRadius: {
      paths: ["src/auth/**"],
      operations: ["read", "write"],
      reversible: true,
    },
  })
  WarmIntegration.setContext(ctx)

  const summary = WarmIntegration.formatTaskSummary()
  expect(summary).toContain("add validation")
  expect(summary).toContain("src/auth/**")
  expect(summary).toContain("read, write")
  expect(summary).toContain("Reversible: true")
})

// --- createDefaultTask ---

test("createDefaultTask creates task with working directory scope", async () => {
  const ctx = WarmSession.createContext("ses_008")
  WarmIntegration.setContext(ctx)

  const task = await WarmSession.createDefaultTask(ctx, {
    message: "fix the login bug",
    workingDirectory: "/projects/myapp",
  })

  expect(task.id).toContain("warm_task_")
  expect(task.intent.description).toBe("fix the login bug")
  expect(task.blastRadius.paths).toEqual(["/projects/myapp/**"])
  expect(task.blastRadius.operations).toContain("read")
  expect(task.blastRadius.operations).toContain("write")
  expect(task.blastRadius.reversible).toBe(true)
  expect(task.lifecycle).toBe("executing")
  expect(ctx.activeTask).toBeDefined()
  expect(ctx.activeTask!.id).toBe(task.id)
})

test("createDefaultTask truncates long messages", async () => {
  const ctx = WarmSession.createContext("ses_009")

  const longMessage = "a".repeat(500)
  const task = await WarmSession.createDefaultTask(ctx, {
    message: longMessage,
    workingDirectory: "/projects/myapp",
  })

  expect(task.intent.description.length).toBeLessThanOrEqual(200)
})

// --- Full integration flow via bridge ---

test("full bridge flow: create context → register agent → create task → check tool", async () => {
  const ctx = WarmSession.createContext("ses_full_001")
  WarmIntegration.setContext(ctx)

  // Register agent
  const agent = await WarmSession.registerAgent(ctx, {
    id: "agent_full_001",
    agentName: "code",
    capabilities: ["read", "edit", "bash"],
  })
  expect(agent.lifecycle).toBe("warm")

  // Create task
  const task = await WarmSession.createDefaultTask(ctx, {
    message: "refactor auth module",
    workingDirectory: "src/auth",
  })
  expect(task.lifecycle).toBe("executing")

  // Check tool within scope
  const allowed = await WarmIntegration.checkTool("read", { file_path: "src/auth/login.ts" }, "ses_full_001")
  expect(allowed.allowed).toBe(true)

  // Check tool outside scope
  const blocked = await WarmIntegration.checkTool("write", { file_path: "package.json" }, "ses_full_001")
  expect(blocked.allowed).toBe(false)

  // Status should show active agent and task
  const status = WarmIntegration.formatStatus()
  expect(status).toContain("agent_full_001")
  expect(status).toContain(task.id)
})
