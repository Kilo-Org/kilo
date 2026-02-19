import { test, expect, beforeEach } from "bun:test"
import { CapabilityRegistry } from "../../src/warm/capability-registry"
import { AgentState } from "../../src/warm/agent-state"

beforeEach(() => {
  CapabilityRegistry.clear()
})

function makeAgent(id: string, tools: string[], mcpServers: string[] = []): AgentState.Info {
  return {
    ...AgentState.create({ id, agentName: "code", sessionID: "ses_001", capabilities: tools, mcpServers }),
    lifecycle: "warm",
    context: { loadedFiles: [], toolHistory: [], projectScope: ["src/**"], lastActiveAt: Date.now() },
  }
}

test("register and get", () => {
  const agent = makeAgent("agent_001", ["read", "edit", "bash"])
  CapabilityRegistry.register(agent)
  const entry = CapabilityRegistry.get("agent_001")
  expect(entry).toBeDefined()
  expect(entry!.tools.has("read")).toBe(true)
  expect(entry!.tools.has("edit")).toBe(true)
  expect(entry!.agentName).toBe("code")
})

test("unregister removes entry", () => {
  const agent = makeAgent("agent_002", ["read"])
  CapabilityRegistry.register(agent)
  CapabilityRegistry.unregister("agent_002")
  expect(CapabilityRegistry.get("agent_002")).toBeUndefined()
})

test("findQualified - matches by capabilities", () => {
  CapabilityRegistry.register(makeAgent("agent_a", ["read", "edit"]))
  CapabilityRegistry.register(makeAgent("agent_b", ["read"]))
  CapabilityRegistry.register(makeAgent("agent_c", ["bash"]))

  const results = CapabilityRegistry.findQualified({ capabilities: ["read", "edit"] })
  expect(results.length).toBe(1)
  expect(results[0].agentID).toBe("agent_a")
})

test("findQualified - no requirements returns all", () => {
  CapabilityRegistry.register(makeAgent("agent_d", ["read"]))
  CapabilityRegistry.register(makeAgent("agent_e", ["bash"]))
  const results = CapabilityRegistry.findQualified({})
  expect(results.length).toBe(2)
})

test("findQualified - filters by MCP servers", () => {
  CapabilityRegistry.register(makeAgent("agent_f", ["read"], ["server_a"]))
  CapabilityRegistry.register(makeAgent("agent_g", ["read"], ["server_b"]))

  const results = CapabilityRegistry.findQualified({ mcpServers: ["server_a"] })
  expect(results.length).toBe(1)
  expect(results[0].agentID).toBe("agent_f")
})

test("updateTools - replaces tool set", () => {
  CapabilityRegistry.register(makeAgent("agent_h", ["read"]))
  CapabilityRegistry.updateTools("agent_h", ["read", "write", "bash"])
  const entry = CapabilityRegistry.get("agent_h")
  expect(entry!.tools.has("write")).toBe(true)
  expect(entry!.tools.has("bash")).toBe(true)
})

test("markMCPUnhealthy - returns affected agents", () => {
  CapabilityRegistry.register(makeAgent("agent_i", ["read"], ["server_x"]))
  CapabilityRegistry.register(makeAgent("agent_j", ["read"], ["server_y"]))
  CapabilityRegistry.register(makeAgent("agent_k", ["read"], ["server_x"]))

  const affected = CapabilityRegistry.markMCPUnhealthy("server_x")
  expect(affected.length).toBe(2)
  expect(affected).toContain("agent_i")
  expect(affected).toContain("agent_k")
})

test("all - returns all registered", () => {
  CapabilityRegistry.register(makeAgent("agent_l", ["read"]))
  CapabilityRegistry.register(makeAgent("agent_m", ["bash"]))
  expect(CapabilityRegistry.all().length).toBe(2)
})

test("clear - empties registry", () => {
  CapabilityRegistry.register(makeAgent("agent_n", ["read"]))
  CapabilityRegistry.clear()
  expect(CapabilityRegistry.all().length).toBe(0)
})
