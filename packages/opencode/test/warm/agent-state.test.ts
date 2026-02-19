import { test, expect } from "bun:test"
import { AgentState } from "../../src/warm/agent-state"

test("create - returns cold agent with defaults", () => {
  const agent = AgentState.create({
    id: "warm_agent_001",
    agentName: "code",
    sessionID: "ses_001",
  })
  expect(agent.lifecycle).toBe("cold")
  expect(agent.warmness).toBe(0)
  expect(agent.capabilities).toEqual([])
  expect(agent.context.loadedFiles).toEqual([])
  expect(agent.constraints.blastRadius).toBe("unrestricted")
  expect(agent.constraints.maxSteps).toBe(50)
})

test("create - accepts custom constraints", () => {
  const agent = AgentState.create({
    id: "warm_agent_002",
    agentName: "explore",
    sessionID: "ses_001",
    capabilities: ["read", "grep"],
    constraints: {
      blastRadius: "read-only",
      allowedPaths: ["src/**"],
      deniedPaths: ["src/secret/**"],
    },
  })
  expect(agent.constraints.blastRadius).toBe("read-only")
  expect(agent.constraints.allowedPaths).toEqual(["src/**"])
  expect(agent.constraints.deniedPaths).toEqual(["src/secret/**"])
  expect(agent.capabilities).toEqual(["read", "grep"])
})

test("canTransition - valid transitions return true", () => {
  expect(AgentState.canTransition("cold", "warming")).toBe(true)
  expect(AgentState.canTransition("warming", "warm")).toBe(true)
  expect(AgentState.canTransition("warm", "executing")).toBe(true)
  expect(AgentState.canTransition("executing", "warm")).toBe(true)
  expect(AgentState.canTransition("executing", "cooling")).toBe(true)
  expect(AgentState.canTransition("warm", "cooling")).toBe(true)
  expect(AgentState.canTransition("cooling", "cold")).toBe(true)
  expect(AgentState.canTransition("warming", "cold")).toBe(true)
})

test("canTransition - invalid transitions return false", () => {
  expect(AgentState.canTransition("cold", "executing")).toBe(false)
  expect(AgentState.canTransition("cold", "warm")).toBe(false)
  expect(AgentState.canTransition("warm", "cold")).toBe(false)
  expect(AgentState.canTransition("executing", "cold")).toBe(false)
  expect(AgentState.canTransition("cooling", "warm")).toBe(false)
})

test("transition - cold to warming succeeds", () => {
  const agent = AgentState.create({
    id: "warm_agent_003",
    agentName: "code",
    sessionID: "ses_001",
  })
  const warmed = AgentState.transition(agent, "warming")
  expect(warmed.lifecycle).toBe("warming")
})

test("transition - warming to warm sets warmedAt", () => {
  const agent = AgentState.create({
    id: "warm_agent_004",
    agentName: "code",
    sessionID: "ses_001",
  })
  const warming = AgentState.transition(agent, "warming")
  const warm = AgentState.transition(warming, "warm")
  expect(warm.lifecycle).toBe("warm")
  expect(warm.time.warmedAt).toBeDefined()
})

test("transition - warm to executing sets lastDispatchedAt", () => {
  const agent = AgentState.create({
    id: "warm_agent_005",
    agentName: "code",
    sessionID: "ses_001",
  })
  const warm = AgentState.transition(AgentState.transition(agent, "warming"), "warm")
  const executing = AgentState.transition(warm, "executing")
  expect(executing.lifecycle).toBe("executing")
  expect(executing.time.lastDispatchedAt).toBeDefined()
})

test("transition - invalid transition throws", () => {
  const agent = AgentState.create({
    id: "warm_agent_006",
    agentName: "code",
    sessionID: "ses_001",
  })
  expect(() => AgentState.transition(agent, "executing")).toThrow("Invalid agent lifecycle transition")
})

test("transition - executing to warm preserves context", () => {
  let agent = AgentState.create({
    id: "warm_agent_007",
    agentName: "code",
    sessionID: "ses_001",
  })
  agent = { ...agent, context: { ...agent.context, loadedFiles: ["a.ts", "b.ts"], toolHistory: ["read", "edit"] } }
  agent = AgentState.transition(agent, "warming")
  agent = AgentState.transition(agent, "warm")
  agent = AgentState.transition(agent, "executing")
  const back = AgentState.transition(agent, "warm")
  expect(back.lifecycle).toBe("warm")
  expect(back.context.loadedFiles).toEqual(["a.ts", "b.ts"])
  expect(back.context.toolHistory).toEqual(["read", "edit"])
})

test("Info schema validates correctly", () => {
  const agent = AgentState.create({
    id: "warm_agent_008",
    agentName: "code",
    sessionID: "ses_001",
  })
  const result = AgentState.Info.safeParse(agent)
  expect(result.success).toBe(true)
})

test("Info schema rejects invalid warmness", () => {
  const result = AgentState.Info.safeParse({
    id: "warm_agent_009",
    agentName: "code",
    sessionID: "ses_001",
    lifecycle: "cold",
    warmness: 150,
    capabilities: [],
    mcpServers: [],
    context: { loadedFiles: [], toolHistory: [], projectScope: [], lastActiveAt: 0 },
    constraints: { maxSteps: 50, allowedPaths: [], deniedPaths: [], blastRadius: "unrestricted" },
    time: { created: 0 },
  })
  expect(result.success).toBe(false)
})
