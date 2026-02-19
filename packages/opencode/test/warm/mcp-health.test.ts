import { test, expect, beforeEach } from "bun:test"
import { MCPHealth } from "../../src/warm/mcp-health"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { AgentState } from "../../src/warm/agent-state"

beforeEach(() => {
  MCPHealth.clear()
  CapabilityRegistry.clear()
})

// --- register / get ---

test("register creates healthy server", () => {
  MCPHealth.register("server_a", ["tool1", "tool2"])
  const state = MCPHealth.get("server_a")
  expect(state).toBeDefined()
  expect(state!.status).toBe("healthy")
  expect(state!.knownTools).toEqual(["tool1", "tool2"])
  expect(state!.consecutiveFailures).toBe(0)
})

test("all returns all registered servers", () => {
  MCPHealth.register("s1", ["t1"])
  MCPHealth.register("s2", ["t2"])
  expect(MCPHealth.all().length).toBe(2)
})

// --- recordSuccess ---

test("recordSuccess with no drift keeps healthy", () => {
  MCPHealth.register("server_b", ["tool1", "tool2"])
  const { drift } = MCPHealth.recordSuccess("server_b", ["tool1", "tool2"], 50)
  expect(drift).toBeUndefined()
  expect(MCPHealth.get("server_b")!.status).toBe("healthy")
  expect(MCPHealth.get("server_b")!.latencyMs).toBe(50)
})

test("recordSuccess with drift returns report and sets degraded", () => {
  MCPHealth.register("server_c", ["tool1", "tool2"])
  const { drift } = MCPHealth.recordSuccess("server_c", ["tool1", "tool3"], 30)
  expect(drift).toBeDefined()
  expect(drift!.added).toEqual(["tool3"])
  expect(drift!.removed).toEqual(["tool2"])
  expect(MCPHealth.get("server_c")!.status).toBe("degraded")
})

test("recordSuccess on unknown server registers it", () => {
  const { drift } = MCPHealth.recordSuccess("server_new", ["toolA"], 10)
  expect(drift).toBeUndefined()
  expect(MCPHealth.get("server_new")).toBeDefined()
  expect(MCPHealth.get("server_new")!.status).toBe("healthy")
})

test("recordSuccess resets failure counter", () => {
  MCPHealth.register("server_d", ["tool1"])
  MCPHealth.recordFailure("server_d")
  MCPHealth.recordFailure("server_d")
  expect(MCPHealth.get("server_d")!.consecutiveFailures).toBe(2)
  MCPHealth.recordSuccess("server_d", ["tool1"], 20)
  expect(MCPHealth.get("server_d")!.consecutiveFailures).toBe(0)
})

// --- recordFailure ---

test("recordFailure increments counter", () => {
  MCPHealth.register("server_e", ["tool1"])
  MCPHealth.recordFailure("server_e")
  expect(MCPHealth.get("server_e")!.consecutiveFailures).toBe(1)
  expect(MCPHealth.get("server_e")!.status).toBe("reconnecting")
})

test("recordFailure marks unhealthy after threshold", () => {
  MCPHealth.register("server_f", ["tool1"])
  MCPHealth.recordFailure("server_f")
  MCPHealth.recordFailure("server_f")
  const result = MCPHealth.recordFailure("server_f")
  expect(result.unhealthy).toBe(true)
  expect(MCPHealth.get("server_f")!.status).toBe("unhealthy")
})

test("recordFailure returns affected agents from capability registry", () => {
  const agent = {
    ...AgentState.create({ id: "agent_mcp_1", agentName: "code", sessionID: "ses_001", mcpServers: ["server_g"] }),
    lifecycle: "warm" as const,
    context: { loadedFiles: [], toolHistory: [], projectScope: [], lastActiveAt: Date.now() },
  }
  CapabilityRegistry.register(agent)
  MCPHealth.register("server_g", ["tool1"])

  MCPHealth.recordFailure("server_g")
  MCPHealth.recordFailure("server_g")
  const result = MCPHealth.recordFailure("server_g")
  expect(result.affected).toContain("agent_mcp_1")
})

// --- markRecovered ---

test("markRecovered restores healthy status", () => {
  MCPHealth.register("server_h", ["tool1"])
  MCPHealth.recordFailure("server_h")
  MCPHealth.recordFailure("server_h")
  MCPHealth.recordFailure("server_h")
  expect(MCPHealth.get("server_h")!.status).toBe("unhealthy")

  MCPHealth.markRecovered("server_h", ["tool1", "tool2"])
  expect(MCPHealth.get("server_h")!.status).toBe("healthy")
  expect(MCPHealth.get("server_h")!.consecutiveFailures).toBe(0)
  expect(MCPHealth.get("server_h")!.knownTools).toEqual(["tool1", "tool2"])
})

// --- isHealthy / unhealthyServers ---

test("isHealthy returns true for healthy and degraded", () => {
  MCPHealth.register("healthy_s", ["t1"])
  expect(MCPHealth.isHealthy("healthy_s")).toBe(true)

  MCPHealth.recordSuccess("healthy_s", ["t1", "t2"], 10) // drift → degraded
  expect(MCPHealth.isHealthy("healthy_s")).toBe(true)
})

test("isHealthy returns false for unhealthy", () => {
  MCPHealth.register("bad_s", ["t1"])
  MCPHealth.recordFailure("bad_s")
  MCPHealth.recordFailure("bad_s")
  MCPHealth.recordFailure("bad_s")
  expect(MCPHealth.isHealthy("bad_s")).toBe(false)
})

test("unhealthyServers lists only unhealthy", () => {
  MCPHealth.register("ok", ["t1"])
  MCPHealth.register("bad", ["t2"])
  MCPHealth.recordFailure("bad")
  MCPHealth.recordFailure("bad")
  MCPHealth.recordFailure("bad")

  const unhealthy = MCPHealth.unhealthyServers()
  expect(unhealthy).toEqual(["bad"])
})
