import { test, expect } from "bun:test"
import { Invariant } from "../../src/warm/invariant"
import { TaskState } from "../../src/warm/task-state"

function makeTask(overrides: Partial<TaskState.BlastRadius> = {}): TaskState.Info {
  return TaskState.create({
    id: "task_inv_001",
    sessionID: "ses_001",
    intent: { description: "test" },
    blastRadius: {
      paths: ["src/routes/**"],
      operations: ["read", "write"],
      mcpTools: [],
      reversible: true,
      ...overrides,
    },
  })
}

// --- classifyToolOperation ---

test("classifyToolOperation - read tools", () => {
  expect(Invariant.classifyToolOperation("read")).toBe("read")
  expect(Invariant.classifyToolOperation("grep")).toBe("read")
  expect(Invariant.classifyToolOperation("glob")).toBe("read")
  expect(Invariant.classifyToolOperation("list")).toBe("read")
})

test("classifyToolOperation - write tools", () => {
  expect(Invariant.classifyToolOperation("write")).toBe("write")
  expect(Invariant.classifyToolOperation("edit")).toBe("write")
  expect(Invariant.classifyToolOperation("multiedit")).toBe("write")
  expect(Invariant.classifyToolOperation("apply_patch")).toBe("write")
})

test("classifyToolOperation - execute tools", () => {
  expect(Invariant.classifyToolOperation("bash")).toBe("execute")
})

test("classifyToolOperation - network tools", () => {
  expect(Invariant.classifyToolOperation("webfetch")).toBe("network")
  expect(Invariant.classifyToolOperation("websearch")).toBe("network")
})

test("classifyToolOperation - unknown defaults to execute", () => {
  expect(Invariant.classifyToolOperation("some_unknown_tool")).toBe("execute")
})

// --- toolPreCheck ---

test("toolPreCheck - allows read within blast radius", () => {
  const task = makeTask()
  const result = Invariant.toolPreCheck("read", { file_path: "src/routes/users.ts" }, task)
  expect(result.allowed).toBe(true)
})

test("toolPreCheck - denies undeclared operation", () => {
  const task = makeTask({ operations: ["read"] })
  const result = Invariant.toolPreCheck("write", { file_path: "src/routes/users.ts" }, task)
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain("write")
  expect(result.reason).toContain("not declared")
})

test("toolPreCheck - denies path outside blast radius", () => {
  const task = makeTask({ paths: ["src/routes/**"] })
  const result = Invariant.toolPreCheck("write", { file_path: "package.json" }, task)
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain("package.json")
  expect(result.reason).toContain("outside")
})

test("toolPreCheck - allows when path within blast radius", () => {
  const task = makeTask({ paths: ["src/routes/**"] })
  const result = Invariant.toolPreCheck("write", { file_path: "src/routes/api.ts" }, task)
  expect(result.allowed).toBe(true)
})

test("toolPreCheck - allows wildcard path", () => {
  const task = makeTask({ paths: ["**"] })
  const result = Invariant.toolPreCheck("write", { file_path: "any/path/file.ts" }, task)
  expect(result.allowed).toBe(true)
})

// --- matchesGlob ---

test("matchesGlob - ** matches everything", () => {
  expect(Invariant.matchesGlob("anything", ["**"])).toBe(true)
})

test("matchesGlob - **/* matches everything", () => {
  expect(Invariant.matchesGlob("anything", ["**/*"])).toBe(true)
})

test("matchesGlob - exact match", () => {
  expect(Invariant.matchesGlob("src/a.ts", ["src/a.ts"])).toBe(true)
})

test("matchesGlob - prefix match with /**", () => {
  expect(Invariant.matchesGlob("src/routes/a.ts", ["src/routes/**"])).toBe(true)
})

test("matchesGlob - no match", () => {
  expect(Invariant.matchesGlob("lib/other.ts", ["src/routes/**"])).toBe(false)
})

// --- checkPreconditions ---

test("checkPreconditions - all passed", () => {
  const task = TaskState.create({
    id: "task_pre_001",
    sessionID: "ses_001",
    intent: { description: "test" },
    preconditions: [
      { check: "file_exists", args: { path: "src/a.ts" }, passed: true },
      { check: "mcp_healthy", args: { server: "test" }, passed: true },
    ],
  })
  const result = Invariant.checkPreconditions(task)
  expect(result.passed).toBe(true)
  expect(result.failures).toEqual([])
})

test("checkPreconditions - one failed", () => {
  const task = TaskState.create({
    id: "task_pre_002",
    sessionID: "ses_001",
    intent: { description: "test" },
    preconditions: [
      { check: "file_exists", args: { path: "src/a.ts" }, passed: true },
      { check: "mcp_healthy", args: { server: "test" }, passed: false, error: "server down" },
    ],
  })
  const result = Invariant.checkPreconditions(task)
  expect(result.passed).toBe(false)
  expect(result.failures.length).toBe(1)
  expect(result.failures[0]).toContain("mcp_healthy")
})

// --- checkPostconditions ---

test("checkPostconditions - all passed", () => {
  const task = TaskState.create({
    id: "task_post_001",
    sessionID: "ses_001",
    intent: { description: "test" },
    postconditions: [{ check: "files_in_scope", args: {}, passed: true }],
  })
  expect(Invariant.checkPostconditions(task).passed).toBe(true)
})

test("checkPostconditions - failure detected", () => {
  const task = TaskState.create({
    id: "task_post_002",
    sessionID: "ses_001",
    intent: { description: "test" },
    postconditions: [{ check: "files_in_scope", args: {}, passed: false, error: "out of scope write" }],
  })
  const result = Invariant.checkPostconditions(task)
  expect(result.passed).toBe(false)
  expect(result.failures[0]).toContain("files_in_scope")
})

// --- validateFilesWithinBlastRadius ---

test("validateFilesWithinBlastRadius - all within scope", () => {
  const br: TaskState.BlastRadius = { paths: ["src/**"], operations: ["write"], mcpTools: [], reversible: true }
  const result = Invariant.validateFilesWithinBlastRadius(["src/a.ts", "src/b.ts"], br)
  expect(result.passed).toBe(true)
  expect(result.violations).toEqual([])
})

test("validateFilesWithinBlastRadius - violations detected", () => {
  const br: TaskState.BlastRadius = { paths: ["src/routes/**"], operations: ["write"], mcpTools: [], reversible: true }
  const result = Invariant.validateFilesWithinBlastRadius(["src/routes/a.ts", "package.json", "src/config/b.ts"], br)
  expect(result.passed).toBe(false)
  expect(result.violations).toContain("package.json")
  expect(result.violations).toContain("src/config/b.ts")
})

// --- toAuditEntry ---

test("toAuditEntry - generates valid audit entry", () => {
  const entry = Invariant.toAuditEntry("inv_001", "task_001", "tool_pre", "blast_radius", true)
  expect(entry.type).toBe("invariant_check")
  expect(entry.passed).toBe(true)
  expect(entry.timestamp).toBeGreaterThan(0)
})
