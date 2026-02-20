import { test, expect, beforeEach, afterEach } from "bun:test"
import { GovernanceIntegration } from "../../src/governance/integration"

let origDisable: string | undefined

beforeEach(() => {
  origDisable = process.env.KILO_DISABLE_GOVERNANCE
  delete process.env.KILO_DISABLE_GOVERNANCE
})

afterEach(() => {
  if (origDisable !== undefined) {
    process.env.KILO_DISABLE_GOVERNANCE = origDisable
  } else {
    delete process.env.KILO_DISABLE_GOVERNANCE
  }
})

// ---- Feature toggle ----

test("isEnabled returns true by default", () => {
  expect(GovernanceIntegration.isEnabled()).toBe(true)
})

test("isEnabled returns false when KILO_DISABLE_GOVERNANCE=1", () => {
  process.env.KILO_DISABLE_GOVERNANCE = "1"
  expect(GovernanceIntegration.isEnabled()).toBe(false)
})

test("allows everything when governance disabled", () => {
  process.env.KILO_DISABLE_GOVERNANCE = "1"
  const r = GovernanceIntegration.checkBash("rm -rf /", [["rm", "-rf", "/"]])
  expect(r.allowed).toBe(true)
})

test("allows write to .env when governance disabled", () => {
  process.env.KILO_DISABLE_GOVERNANCE = "1"
  const r = GovernanceIntegration.checkWritePath("/projects/.env", "/projects")
  expect(r.allowed).toBe(true)
})

// ---- Bash checks ----

test("blocks destructive bash when enabled", () => {
  const r = GovernanceIntegration.checkBash("rm -rf /", [["rm", "-rf", "/"]])
  expect(r.allowed).toBe(false)
  expect(r.output).toContain("[governance]")
})

test("allows safe bash when enabled", () => {
  const r = GovernanceIntegration.checkBash("echo hello", [["echo", "hello"]])
  expect(r.allowed).toBe(true)
  expect(r.output).toBeUndefined()
})

test("returns warnings for medium severity", () => {
  const r = GovernanceIntegration.checkBash("rm -rf dist", [["rm", "-rf", "dist"]])
  expect(r.allowed).toBe(true)
  expect(r.warnings).toContain("governance_warning")
})

// ---- Write path checks ----

test("blocks write to /etc/passwd", () => {
  const r = GovernanceIntegration.checkWritePath("/etc/passwd", "/projects/myapp")
  expect(r.allowed).toBe(false)
  expect(r.output).toContain("[governance]")
})

test("blocks write to .env", () => {
  const r = GovernanceIntegration.checkWritePath("/projects/myapp/.env", "/projects/myapp")
  expect(r.allowed).toBe(false)
})

test("allows write to project file", () => {
  const r = GovernanceIntegration.checkWritePath("/projects/myapp/src/index.ts", "/projects/myapp")
  expect(r.allowed).toBe(true)
})

// ---- Output quality ----

test("rejection output includes severity and reason", () => {
  const r = GovernanceIntegration.checkBash("git reset --hard", [["git", "reset", "--hard"]])
  expect(r.allowed).toBe(false)
  expect(r.output).toContain("HIGH")
  expect(r.output).toContain("git reset --hard")
  expect(r.output).toContain("Suggest:")
})

test("rejection output mentions override mechanism", () => {
  const r = GovernanceIntegration.checkBash("rm -rf /", [["rm", "-rf", "/"]])
  expect(r.output).toContain("KILO_DISABLE_GOVERNANCE")
})
