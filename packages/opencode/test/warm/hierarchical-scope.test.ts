import { test, expect, beforeEach } from "bun:test"
import { Invariant } from "../../src/warm/invariant"
import { WarmSession } from "../../src/warm/warm-session"
import { WarmIntegration } from "../../src/warm/integration"
import { TaskState } from "../../src/warm/task-state"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { MCPHealth } from "../../src/warm/mcp-health"

beforeEach(() => {
  delete (globalThis as any).__warmContext
  CapabilityRegistry.clear()
  MCPHealth.clear()
})

// --- Scope Inference ---

test("inferScopeFromMessage extracts file paths", () => {
  const paths = Invariant.inferScopeFromMessage(
    "Fix the login bug in src/auth/login.js",
    ["src/**"],
  )
  expect(paths).toContain("src/auth/**")
})

test("inferScopeFromMessage extracts directory references", () => {
  const paths = Invariant.inferScopeFromMessage(
    "update the src/auth module",
    ["src/**"],
  )
  expect(paths.some((p) => p.includes("src/auth"))).toBe(true)
})

test("inferScopeFromMessage handles multiple paths", () => {
  const paths = Invariant.inferScopeFromMessage(
    "read src/auth/login.js and edit src/auth/utils.js",
    ["src/**"],
  )
  expect(paths).toContain("src/auth/**")
})

test("inferScopeFromMessage returns parent paths when nothing inferred", () => {
  const parentPaths = ["src/**"]
  const paths = Invariant.inferScopeFromMessage("do something", parentPaths)
  expect(paths).toEqual(parentPaths)
})

test("inferScopeFromMessage rejects paths outside parent scope", () => {
  const paths = Invariant.inferScopeFromMessage(
    "read /etc/passwd and fix src/auth/login.js",
    ["src/**"],
  )
  // /etc/passwd should be filtered out, only src/auth stays
  expect(paths.every((p) => p.startsWith("src/"))).toBe(true)
})

test("inferScopeFromMessage handles nested paths", () => {
  const paths = Invariant.inferScopeFromMessage(
    "fix src/components/auth/LoginForm.tsx",
    ["src/**"],
  )
  expect(paths).toContain("src/components/auth/**")
})

// --- Validate Child Scope ---

test("validateChildScope allows subset of parent paths", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/**"],
    operations: ["read", "write"],
    mcpTools: [],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    paths: ["src/auth/**"],
    operations: ["read", "write"],
  })
  expect(result.allowed).toBe(true)
  expect(result.effectiveScope?.paths).toEqual(["src/auth/**"])
})

test("validateChildScope rejects paths outside parent", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/auth/**"],
    operations: ["read", "write"],
    mcpTools: [],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    paths: ["config/**"],
  })
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain("escapes parent")
})

test("validateChildScope rejects operations not in parent", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/**"],
    operations: ["read"],
    mcpTools: [],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    paths: ["src/auth/**"],
    operations: ["read", "write"],
  })
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain("operation")
})

test("validateChildScope allows same scope as parent", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/**"],
    operations: ["read", "write"],
    mcpTools: [],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    paths: ["src/**"],
    operations: ["read", "write"],
  })
  expect(result.allowed).toBe(true)
})

test("validateChildScope inherits parent operations when not specified", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/**"],
    operations: ["read", "write", "execute"],
    mcpTools: [],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    paths: ["src/auth/**"],
  })
  expect(result.allowed).toBe(true)
  expect(result.effectiveScope?.operations).toEqual(["read", "write", "execute"])
})

test("validateChildScope rejects child MCP tools not in parent", () => {
  const parent: TaskState.BlastRadius = {
    paths: ["src/**"],
    operations: ["read"],
    mcpTools: ["mcp_tool_a"],
    reversible: true,
  }
  const result = Invariant.validateChildScope(parent, {
    mcpTools: ["mcp_tool_b"],
  })
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain("MCP tool")
})

// --- createSubTask ---

test("createSubTask creates child with narrowed scope", async () => {
  const ctx = WarmSession.createContext("ses_sub_001")
  await WarmSession.registerAgent(ctx, {
    id: "agent_sub_001",
    agentName: "code",
    capabilities: ["read", "write"],
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "main task",
    workingDirectory: "src",
  })

  const parentTask = ctx.activeTask!
  expect(parentTask.blastRadius.paths).toEqual(["src/**"])

  const { task, narrowed } = await WarmSession.createSubTask(ctx, {
    message: "fix the login bug in src/auth/login.js",
    parentTask,
  })

  expect(task.parentTaskID).toBe(parentTask.id)
  expect(task.blastRadius.paths).toContain("src/auth/**")
  expect(narrowed).toBe(true)
  expect(task.lifecycle).toBe("executing")
})

test("createSubTask falls back to parent scope when no paths inferred", async () => {
  const ctx = WarmSession.createContext("ses_sub_002")
  await WarmSession.registerAgent(ctx, {
    id: "agent_sub_002",
    agentName: "code",
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "main task",
    workingDirectory: "src",
  })

  const parentTask = ctx.activeTask!

  const { task, narrowed } = await WarmSession.createSubTask(ctx, {
    message: "do something generic",
    parentTask,
  })

  expect(task.blastRadius.paths).toEqual(parentTask.blastRadius.paths)
  expect(narrowed).toBe(false)
})

test("createSubTask rejects scope that exceeds parent and falls back", async () => {
  const ctx = WarmSession.createContext("ses_sub_003")
  await WarmSession.registerAgent(ctx, {
    id: "agent_sub_003",
    agentName: "code",
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "main task",
    workingDirectory: "src/auth",
  })

  const parentTask = ctx.activeTask!
  expect(parentTask.blastRadius.paths).toEqual(["src/auth/**"])

  const { task, narrowed } = await WarmSession.createSubTask(ctx, {
    message: "edit database migrations",
    parentTask,
    blastRadius: {
      paths: ["db/**"], // outside parent scope!
    },
  })

  // Should fall back to parent scope
  expect(task.blastRadius.paths).toEqual(["src/auth/**"])
  expect(narrowed).toBe(false)
})

test("createSubTask with explicit valid narrower scope", async () => {
  const ctx = WarmSession.createContext("ses_sub_004")
  await WarmSession.registerAgent(ctx, {
    id: "agent_sub_004",
    agentName: "code",
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "main task",
    workingDirectory: "src",
  })

  const parentTask = ctx.activeTask!

  const { task, narrowed } = await WarmSession.createSubTask(ctx, {
    message: "fix auth",
    parentTask,
    blastRadius: {
      paths: ["src/auth/**"],
      operations: ["read"],
    },
  })

  expect(task.blastRadius.paths).toEqual(["src/auth/**"])
  expect(task.blastRadius.operations).toEqual(["read"])
  expect(narrowed).toBe(true)
})

// --- Integration: sub-task tool enforcement ---

test("sub-task enforces narrower scope on tool calls", async () => {
  const ctx = WarmSession.createContext("ses_sub_005")
  WarmIntegration.setContext(ctx)
  await WarmSession.registerAgent(ctx, {
    id: "agent_sub_005",
    agentName: "code",
    capabilities: ["read", "write"],
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "main task",
    workingDirectory: "src",
  })

  const parentTask = ctx.activeTask!

  // Create sub-task scoped to src/auth
  const { task } = await WarmSession.createSubTask(ctx, {
    message: "fix src/auth/login.js",
    parentTask,
  })
  ctx.activeTask = task // simulate what integration bridge does

  // Tool within sub-task scope → allowed
  const allowed = await WarmIntegration.checkTool("read", { file_path: "src/auth/login.js" }, "ses_sub_005")
  expect(allowed.allowed).toBe(true)

  // Tool outside sub-task scope but within parent scope → blocked
  const blocked = await WarmIntegration.checkTool("write", { file_path: "src/ui/dashboard.js" }, "ses_sub_005")
  expect(blocked.allowed).toBe(false)
  expect(blocked.reason).toContain("outside declared blast radius")
})

// --- Full hierarchical flow ---

test("full flow: parent task → sub-task → enforce → restore", async () => {
  const ctx = WarmSession.createContext("ses_full_hier")
  WarmIntegration.setContext(ctx)
  await WarmSession.registerAgent(ctx, {
    id: "agent_full_hier",
    agentName: "code",
    capabilities: ["read", "write"],
  })
  await WarmSession.createDefaultTask(ctx, {
    message: "refactor the app",
    workingDirectory: "/projects/myapp",
  })

  const parentTask = ctx.activeTask!
  expect(parentTask.blastRadius.paths).toEqual(["/projects/myapp/**"])

  // Orchestrator spawns sub-agent scoped to auth
  const subResult = await WarmIntegration.createSubTask(
    "ses_full_hier",
    "fix the login bug in src/auth/login.js",
  )
  expect(subResult).toBeDefined()
  expect(subResult!.narrowed).toBe(true)
  // Inferred "src/auth" anchored within parent root "/projects/myapp"
  expect(subResult!.scope).toContain("/projects/myapp/src/auth/**")

  // Active task is now the sub-task
  expect(ctx.activeTask!.id).toBe(subResult!.taskID)
  expect(ctx.activeTask!.parentTaskID).toBe(parentTask.id)

  // Sub-agent tool call within scope → allowed
  const ok = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/src/auth/login.js" }, "ses_full_hier")
  expect(ok.allowed).toBe(true)

  // Sub-agent tool call outside sub-task scope → blocked
  const denied = await WarmIntegration.checkTool("write", { file_path: "/projects/myapp/config/settings.json" }, "ses_full_hier")
  expect(denied.allowed).toBe(false)

  // Complete sub-task, restore parent
  await WarmIntegration.completeSubTask("ses_full_hier", parentTask)
  expect(ctx.activeTask!.id).toBe(parentTask.id)

  // Parent task scope is wider again
  const parentOk = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/config/settings.json" }, "ses_full_hier")
  expect(parentOk.allowed).toBe(true)
})
