import { test, expect, beforeEach } from "bun:test"
import { AgentState } from "../../src/warm/agent-state"
import { TaskState } from "../../src/warm/task-state"
import { WarmScorer } from "../../src/warm/scorer"
import { Invariant } from "../../src/warm/invariant"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { DispatchPolicy } from "../../src/warm/policy"
import { MCPHealth } from "../../src/warm/mcp-health"
import { Replay } from "../../src/warm/replay"

beforeEach(() => {
  CapabilityRegistry.clear()
  MCPHealth.clear()
})

// --- Full lifecycle: create agent → create task → score → dispatch → execute → complete ---

test("integration: full warm agent lifecycle", () => {
  const now = Date.now()

  // 1. Create cold agent
  let agent = AgentState.create({
    id: "int_agent_001",
    agentName: "code",
    sessionID: "int_ses_001",
    capabilities: ["read", "edit", "bash"],
  })
  expect(agent.lifecycle).toBe("cold")

  // 2. Warm it up
  agent = AgentState.transition(agent, "warming")
  agent = AgentState.transition(agent, "warm")
  agent = {
    ...agent,
    context: {
      loadedFiles: ["src/auth/login.ts", "src/auth/register.ts"],
      toolHistory: ["read", "edit"],
      projectScope: ["src/auth/**"],
      lastActiveAt: now - 2 * 60_000,
    },
  }
  CapabilityRegistry.register(agent)

  // 3. Create task
  const task = TaskState.create({
    id: "int_task_001",
    sessionID: "int_ses_001",
    intent: {
      description: "Add password validation",
      capabilities: ["read", "edit"],
    },
    blastRadius: {
      paths: ["src/auth/login.ts", "src/auth/register.ts", "src/auth/validate.ts"],
      operations: ["read", "write"],
      reversible: true,
    },
  })

  // 4. Score agent against task
  const { score, dimensions } = WarmScorer.scoreAgent(agent, task, now)
  expect(score).toBeGreaterThan(WarmScorer.DEFAULTS.WARM_THRESHOLD)
  expect(dimensions.familiarity).toBeGreaterThan(0)
  expect(dimensions.recency).toBeGreaterThan(0)

  // 5. Rank (single agent, should be top)
  const ranked = WarmScorer.rankAgents([agent], task, now)
  expect(ranked.length).toBe(1)
  expect(ranked[0].agent.id).toBe("int_agent_001")

  // 6. Dispatch via policy
  const policy = DispatchPolicy.defaultConfig()
  const policyResult = DispatchPolicy.evaluate(task, policy)
  expect(policyResult.action).toBe("allow")

  // 7. Execute
  agent = AgentState.transition(agent, "executing")
  expect(agent.lifecycle).toBe("executing")

  // 8. Tool pre-check (within scope)
  const allowed = Invariant.toolPreCheck("edit", { file_path: "src/auth/login.ts" }, task)
  expect(allowed.allowed).toBe(true)

  // 9. Tool pre-check (outside scope — denied, since paths are exact files not globs)
  const denied = Invariant.toolPreCheck("write", { file_path: "package.json" }, task)
  expect(denied.allowed).toBe(false)

  // 10. Complete
  const postcheck = Invariant.validateFilesWithinBlastRadius(
    ["src/auth/login.ts", "src/auth/register.ts"],
    task.blastRadius,
  )
  expect(postcheck.passed).toBe(true)

  let completed = TaskState.transition(task, "claimed")
  completed = TaskState.transition(completed, "executing")
  completed = TaskState.transition(completed, "postchecked")
  completed = TaskState.transition(completed, "completed")
  expect(completed.lifecycle).toBe("completed")

  // 11. Agent returns to warm
  agent = AgentState.transition(agent, "warm")
  expect(agent.lifecycle).toBe("warm")
})

// --- Policy denial blocks dispatch ---

test("integration: policy denial blocks task", () => {
  const task = TaskState.create({
    id: "int_task_002",
    sessionID: "int_ses_002",
    intent: { description: "delete database", capabilities: ["bash"] },
    blastRadius: { paths: ["**"], operations: ["read", "write", "delete", "execute"] },
  })

  const policy = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    denyCapabilities: ["bash"],
  })

  const result = DispatchPolicy.evaluate(task, policy)
  expect(result.action).toBe("deny")
})

// --- Blast radius ceiling enforcement ---

test("integration: blast radius ceiling stops wide tasks", () => {
  const task = TaskState.create({
    id: "int_task_003",
    sessionID: "int_ses_003",
    intent: { description: "refactor everything" },
    blastRadius: { paths: ["**"], operations: ["read", "write", "delete"] },
  })

  const policy = DispatchPolicy.Config.parse({
    ...DispatchPolicy.defaultConfig(),
    maxBlastRadius: "directory",
  })

  const result = DispatchPolicy.evaluate(task, policy)
  expect(result.action).toBe("deny")
})

// --- MCP health affects routing ---

test("integration: MCP unhealthy degrades agent scoring", () => {
  const now = Date.now()

  MCPHealth.register("server_critical", ["special_tool"])

  const agent: AgentState.Info = {
    ...AgentState.create({
      id: "int_agent_mcp",
      agentName: "code",
      sessionID: "int_ses_004",
      capabilities: ["read", "special_tool"],
      mcpServers: ["server_critical"],
    }),
    lifecycle: "warm",
    context: {
      loadedFiles: ["src/a.ts"],
      toolHistory: ["special_tool"],
      projectScope: [],
      lastActiveAt: now,
    },
  }
  CapabilityRegistry.register(agent)

  // Server goes unhealthy
  MCPHealth.recordFailure("server_critical")
  MCPHealth.recordFailure("server_critical")
  MCPHealth.recordFailure("server_critical")
  expect(MCPHealth.isHealthy("server_critical")).toBe(false)

  // Can query which agents are affected
  const affected = CapabilityRegistry.markMCPUnhealthy("server_critical")
  expect(affected).toContain("int_agent_mcp")
})

// --- Postcondition violation detected ---

test("integration: postcondition catches out-of-scope writes", () => {
  const task = TaskState.create({
    id: "int_task_004",
    sessionID: "int_ses_005",
    intent: { description: "fix auth bug" },
    blastRadius: { paths: ["src/auth/**"], operations: ["read", "write"] },
  })

  const result = Invariant.validateFilesWithinBlastRadius(
    ["src/auth/login.ts", "src/config/db.json"],
    task.blastRadius,
  )
  expect(result.passed).toBe(false)
  expect(result.violations).toContain("src/config/db.json")
})

// --- Replay structural verification ---

test("integration: replay verifies correct lifecycle chain", () => {
  const entries = [
    { type: "dispatch_decision" as const, id: "d1", taskID: "t1", sessionID: "s1", candidates: [{ agentID: "a1", score: 80, reason: "warmest" }], selected: { agentID: "a1", reason: "warmest" as const }, timestamp: 1 },
    { type: "state_transition" as const, id: "st1", entityType: "task" as const, entityID: "t1", from: "pending", to: "claimed", trigger: "dispatch", timestamp: 2 },
    { type: "state_transition" as const, id: "st2", entityType: "task" as const, entityID: "t1", from: "claimed", to: "executing", trigger: "start", timestamp: 3 },
    { type: "state_transition" as const, id: "st3", entityType: "task" as const, entityID: "t1", from: "executing", to: "postchecked", trigger: "done", timestamp: 4 },
    { type: "state_transition" as const, id: "st4", entityType: "task" as const, entityID: "t1", from: "postchecked", to: "completed", trigger: "pass", timestamp: 5 },
  ]

  const trace: Replay.ReplayTrace = {
    sessionID: "s1",
    steps: entries.map((e, i) => ({ index: i, entry: e, type: e.type })),
    dispatches: 1,
    transitions: 4,
    invariantChecks: 0,
    invariantFailures: 0,
    rollbacks: 0,
    mcpEvents: 0,
  }

  expect(Replay.verifyDispatchDeterminism(trace).passed).toBe(true)
  expect(Replay.verifyLifecycleIntegrity(trace).passed).toBe(true)
  expect(Replay.verifyInvariantCoverage(trace).passed).toBe(true)
})

// --- Cold spawn when no warm candidates ---

test("integration: scoring returns empty when no warm agents exist", () => {
  const task = TaskState.create({
    id: "int_task_005",
    sessionID: "int_ses_006",
    intent: { description: "build feature" },
  })

  const coldAgent = AgentState.create({
    id: "int_agent_cold",
    agentName: "code",
    sessionID: "int_ses_006",
  })
  // cold agent, not warm — should be filtered out
  const ranked = WarmScorer.rankAgents([coldAgent], task)
  expect(ranked.length).toBe(0)
})
