#!/usr/bin/env bun
/**
 * Warm Agents — Standalone Audit Demo
 *
 * Exercises the full warm API without an LLM:
 *   1. Agent registration + lifecycle transitions
 *   2. Task creation with blast-radius enforcement
 *   3. Tool pre-checks (allowed / blocked)
 *   4. Hierarchical sub-tasks with scope narrowing
 *   5. Sub-task tool enforcement
 *   6. Task completion + postcondition checks
 *   7. Full audit log generation & readback
 *
 * Run:  bun test/warm/demo-audit.ts
 * Logs: $XDG_DATA_HOME/kilo/warm/audit/demo_audit_*.jsonl
 */

import { WarmSession } from "../../src/warm/warm-session"
import { WarmIntegration } from "../../src/warm/integration"
import { Invariant } from "../../src/warm/invariant"
import { Audit } from "../../src/warm/audit"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { MCPHealth } from "../../src/warm/mcp-health"

// ---- Helpers ----

const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"
const WARN = "\x1b[33m⚠\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

function section(title: string) {
  console.log(`\n${BOLD}━━━ ${title} ━━━${RESET}`)
}

function result(label: string, allowed: boolean, detail?: string) {
  const icon = allowed ? PASS : FAIL
  const suffix = detail ? ` ${DIM}(${detail})${RESET}` : ""
  console.log(`  ${icon} ${label}${suffix}`)
}

// ---- Clean State ----

delete (globalThis as any).__warmContext
CapabilityRegistry.clear()
MCPHealth.clear()

const SESSION_ID = `demo_audit_${Date.now()}`

section("Warm Agents — Audit Demo")
console.log(`  Session: ${SESSION_ID}`)
console.log(`  Time:    ${new Date().toISOString()}`)

// ━━━ Phase 1: Agent Registration ━━━

section("Phase 1: Agent Registration")

const ctx = WarmSession.createContext(SESSION_ID)
WarmIntegration.setContext(ctx)

const agent = await WarmSession.registerAgent(ctx, {
  id: `agent_demo_001`,
  agentName: "code",
  capabilities: ["read", "write", "edit", "bash", "glob", "grep"],
})

result("Agent registered", true, `id=${agent.id}, lifecycle=${agent.lifecycle}, warmness=${agent.warmness}`)

// ━━━ Phase 2: Parent Task — scoped to project root ━━━

section("Phase 2: Parent Task Creation")

const parentTask = await WarmSession.createDefaultTask(ctx, {
  message: "Refactor the authentication module",
  workingDirectory: "/projects/myapp",
})

result("Parent task created", true, `id=${parentTask.id}`)
result("Blast radius", true, `paths=${parentTask.blastRadius.paths.join(", ")}`)
result("Operations", true, `ops=${parentTask.blastRadius.operations.join(", ")}`)
result("Lifecycle", parentTask.lifecycle === "executing", `state=${parentTask.lifecycle}`)

// ━━━ Phase 3: Tool Pre-Checks on Parent Task ━━━

section("Phase 3: Tool Pre-Checks (Parent Scope)")

// 3a. Read within scope — should PASS
const check1 = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/src/auth/login.ts" }, SESSION_ID)
result("read /projects/myapp/src/auth/login.ts", check1.allowed, "within scope")

// 3b. Write within scope — should PASS
const check2 = await WarmIntegration.checkTool("write", { file_path: "/projects/myapp/src/auth/utils.ts" }, SESSION_ID)
result("write /projects/myapp/src/auth/utils.ts", check2.allowed, "within scope")

// 3c. Read outside scope — should FAIL
const check3 = await WarmIntegration.checkTool("read", { file_path: "/etc/passwd" }, SESSION_ID)
result("read /etc/passwd", !check3.allowed, check3.reason ?? "blocked")

// 3d. Write outside scope — should FAIL
const check4 = await WarmIntegration.checkTool("write", { file_path: "/tmp/malicious.sh" }, SESSION_ID)
result("write /tmp/malicious.sh", !check4.allowed, check4.reason ?? "blocked")

// 3e. Execute operation — should FAIL (only read, write allowed)
const check5 = await WarmIntegration.checkTool("bash", { command: "rm -rf /" }, SESSION_ID)
result("bash rm -rf /", !check5.allowed, check5.reason ?? "blocked")

// 3f. Network operation — should FAIL
const check6 = await WarmIntegration.checkTool("webfetch", { url: "https://evil.com" }, SESSION_ID)
result("webfetch https://evil.com", !check6.allowed, check6.reason ?? "blocked")

// ━━━ Phase 4: Hierarchical Sub-Task ━━━

section("Phase 4: Hierarchical Sub-Task (Scope Narrowing)")

// Create sub-task via integration bridge — message mentions src/auth/login.ts
const subResult = await WarmIntegration.createSubTask(
  SESSION_ID,
  "Fix the password validation bug in src/auth/login.ts",
)

if (subResult) {
  result("Sub-task created", true, `id=${subResult.taskID}`)
  result("Parent tracked", true, `parentID=${subResult.parentTaskID}`)
  result("Scope narrowed", subResult.narrowed, `scope=${subResult.scope.join(", ")}`)
  result("Active task swapped", ctx.activeTask?.id === subResult.taskID, `active=${ctx.activeTask?.id}`)

  // ━━━ Phase 5: Tool Pre-Checks on Sub-Task (Narrower Scope) ━━━

  section("Phase 5: Tool Pre-Checks (Sub-Task Scope)")

  // 5a. Read within sub-task scope — should PASS
  const sub1 = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/src/auth/login.ts" }, SESSION_ID)
  result("read /projects/myapp/src/auth/login.ts", sub1.allowed, "within sub-scope")

  // 5b. Write within parent scope but OUTSIDE sub-task scope — should FAIL
  const sub2 = await WarmIntegration.checkTool("write", { file_path: "/projects/myapp/src/ui/dashboard.ts" }, SESSION_ID)
  result("write /projects/myapp/src/ui/dashboard.ts", !sub2.allowed, sub2.reason ?? "blocked by sub-scope")

  // 5c. Read config — outside sub-task scope — should FAIL
  const sub3 = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/config/settings.json" }, SESSION_ID)
  result("read /projects/myapp/config/settings.json", !sub3.allowed, sub3.reason ?? "blocked by sub-scope")

  // ━━━ Phase 6: Complete Sub-Task, Restore Parent ━━━

  section("Phase 6: Sub-Task Completion → Parent Restore")

  await WarmIntegration.completeSubTask(SESSION_ID, subResult.previousTask!)
  result("Parent task restored", ctx.activeTask?.id === parentTask.id, `active=${ctx.activeTask?.id}`)

  // Parent scope is back — wider access restored
  const restored1 = await WarmIntegration.checkTool("read", { file_path: "/projects/myapp/config/settings.json" }, SESSION_ID)
  result("read config (parent scope restored)", restored1.allowed, "parent scope active again")

  const restored2 = await WarmIntegration.checkTool("write", { file_path: "/projects/myapp/src/ui/dashboard.ts" }, SESSION_ID)
  result("write ui/dashboard (parent scope restored)", restored2.allowed, "parent scope active again")
} else {
  result("Sub-task creation", false, "returned undefined")
}

// ━━━ Phase 7: Scope Validation Edge Cases ━━━

section("Phase 7: Scope Validation Edge Cases")

// 7a. Validate child scope — valid narrowing
const valid = Invariant.validateChildScope(
  { paths: ["/projects/myapp/**"], operations: ["read", "write"], mcpTools: [], reversible: true },
  { paths: ["/projects/myapp/src/auth/**"], operations: ["read"] },
)
result("Valid narrowing (auth read-only)", valid.allowed)

// 7b. Validate child scope — path escape
const escape = Invariant.validateChildScope(
  { paths: ["/projects/myapp/**"], operations: ["read", "write"], mcpTools: [], reversible: true },
  { paths: ["/etc/shadow/**"], operations: ["read"] },
)
result("Path escape rejected", !escape.allowed, escape.reason ?? "")

// 7c. Validate child scope — operation escalation
const escalation = Invariant.validateChildScope(
  { paths: ["/projects/myapp/**"], operations: ["read"], mcpTools: [], reversible: true },
  { paths: ["/projects/myapp/**"], operations: ["read", "execute"] },
)
result("Operation escalation rejected", !escalation.allowed, escalation.reason ?? "")

// 7d. Validate child scope — MCP tool not in parent
const mcpEscape = Invariant.validateChildScope(
  { paths: ["**"], operations: ["read"], mcpTools: ["mcp_safe_tool"], reversible: true },
  { mcpTools: ["mcp_dangerous_tool"] },
)
result("MCP tool escape rejected", !mcpEscape.allowed, mcpEscape.reason ?? "")

// 7e. Scope inference from message
const inferred = Invariant.inferScopeFromMessage(
  "Fix the login bug in src/auth/login.ts and update src/auth/utils.ts",
  ["/projects/myapp/**"],
)
result("Scope inference from message", inferred.length > 0, `inferred=${inferred.join(", ")}`)

// ━━━ Phase 8: Complete Parent Task ━━━

section("Phase 8: Parent Task Completion")

const completion = await WarmSession.completeTask(ctx, [
  "/projects/myapp/src/auth/login.ts",
  "/projects/myapp/src/auth/utils.ts",
])
result("Postcondition check (files within scope)", completion.passed)
result("Agent returned to warm", ctx.activeAgent?.lifecycle === "warm", `lifecycle=${ctx.activeAgent?.lifecycle}`)

// ━━━ Phase 9: Postcondition Violation ━━━

section("Phase 9: Postcondition Violation (files outside blast radius)")

// Create a new task to test violation
const violationCtx = WarmSession.createContext(`${SESSION_ID}_violation`)
await WarmSession.registerAgent(violationCtx, {
  id: "agent_violation_001",
  agentName: "code",
  capabilities: ["read", "write"],
})
await WarmSession.createDefaultTask(violationCtx, {
  message: "Only touch auth",
  workingDirectory: "/projects/myapp/src/auth",
})

const violationResult = await WarmSession.completeTask(violationCtx, [
  "/projects/myapp/src/auth/login.ts", // OK
  "/projects/myapp/src/db/schema.sql",  // VIOLATION
])
result("Postcondition violation detected", !violationResult.passed, violationResult.failures.join("; "))

// ━━━ Phase 10: Read Audit Log ━━━

section("Phase 10: Audit Log Readback")

const entries = await Audit.read(SESSION_ID)
console.log(`  Total entries: ${entries.length}`)

const byType: Record<string, number> = {}
for (const e of entries) {
  byType[e.type] = (byType[e.type] || 0) + 1
}

for (const [type, count] of Object.entries(byType)) {
  console.log(`    ${type}: ${count}`)
}

// Show a few sample entries
section("Sample Audit Entries")

const transitions = entries.filter((e) => e.type === "state_transition").slice(0, 4)
for (const t of transitions) {
  if (t.type === "state_transition") {
    console.log(`  ${DIM}[transition]${RESET} ${t.entityType}:${t.entityID} ${t.from} → ${t.to} (${t.trigger})`)
  }
}

const checks = entries.filter((e) => e.type === "invariant_check").slice(0, 6)
for (const c of checks) {
  if (c.type === "invariant_check") {
    const icon = c.passed ? PASS : FAIL
    console.log(`  ${icon} [${c.phase}] ${c.check}${c.error ? ` — ${c.error}` : ""}`)
  }
}

// ━━━ Summary ━━━

section("Summary")

const totalChecks = entries.filter((e) => e.type === "invariant_check").length
const passedChecks = entries.filter((e) => e.type === "invariant_check" && e.passed).length
const blockedChecks = totalChecks - passedChecks

console.log(`  Session:    ${SESSION_ID}`)
console.log(`  Audit entries: ${entries.length}`)
console.log(`  Transitions: ${entries.filter((e) => e.type === "state_transition").length}`)
console.log(`  Invariant checks: ${totalChecks} (${PASS} ${passedChecks} passed, ${FAIL} ${blockedChecks} blocked)`)
console.log(`  Agent final state: ${ctx.activeAgent?.lifecycle}`)
console.log(`  Task final state: ${ctx.activeTask?.lifecycle}`)
console.log()
console.log(`  ${BOLD}Audit log path:${RESET}`)
console.log(`  ${DIM}$XDG_DATA_HOME/kilo/warm/audit/${SESSION_ID}.jsonl${RESET}`)
console.log()
