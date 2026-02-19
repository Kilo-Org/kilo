import { test, expect } from "bun:test"
import { WarmScorer } from "../../src/warm/scorer"
import { AgentState } from "../../src/warm/agent-state"
import { TaskState } from "../../src/warm/task-state"

test("computeScore - all zeros returns 0", () => {
  expect(WarmScorer.computeScore({ recency: 0, familiarity: 0, toolMatch: 0, continuity: 0 })).toBe(0)
})

test("computeScore - all 100s returns 100", () => {
  expect(WarmScorer.computeScore({ recency: 100, familiarity: 100, toolMatch: 100, continuity: 100 })).toBe(100)
})

test("computeScore - weighted correctly", () => {
  const score = WarmScorer.computeScore({ recency: 50, familiarity: 50, toolMatch: 50, continuity: 50 })
  expect(score).toBe(50)
})

test("computeScore - familiarity dominates", () => {
  const high = WarmScorer.computeScore({ recency: 0, familiarity: 100, toolMatch: 0, continuity: 0 })
  const low = WarmScorer.computeScore({ recency: 100, familiarity: 0, toolMatch: 0, continuity: 0 })
  expect(high).toBeGreaterThan(low)
})

test("computeScore - clamps to 0-100", () => {
  expect(WarmScorer.computeScore({ recency: -50, familiarity: -50, toolMatch: -50, continuity: -50 })).toBe(0)
})

test("recency - just active returns ~100", () => {
  const now = Date.now()
  expect(WarmScorer.recency(now, now)).toBe(100)
})

test("recency - half staleness returns ~50", () => {
  const now = Date.now()
  const halfStale = now - (WarmScorer.DEFAULTS.STALENESS_MINUTES / 2) * 60_000
  const score = WarmScorer.recency(halfStale, now)
  expect(score).toBeGreaterThanOrEqual(48)
  expect(score).toBeLessThanOrEqual(52)
})

test("recency - fully stale returns 0", () => {
  const now = Date.now()
  const stale = now - WarmScorer.DEFAULTS.STALENESS_MINUTES * 60_000
  expect(WarmScorer.recency(stale, now)).toBe(0)
})

test("recency - beyond staleness still returns 0", () => {
  const now = Date.now()
  const veryStale = now - WarmScorer.DEFAULTS.STALENESS_MINUTES * 2 * 60_000
  expect(WarmScorer.recency(veryStale, now)).toBe(0)
})

test("familiarity - full overlap returns 100", () => {
  expect(WarmScorer.familiarity(["a.ts", "b.ts"], ["a.ts", "b.ts"])).toBe(100)
})

test("familiarity - no overlap returns 0", () => {
  expect(WarmScorer.familiarity(["a.ts"], ["b.ts"])).toBe(0)
})

test("familiarity - partial overlap", () => {
  expect(WarmScorer.familiarity(["a.ts", "b.ts", "c.ts"], ["a.ts", "b.ts", "d.ts", "e.ts"])).toBe(50)
})

test("familiarity - empty task files returns 0", () => {
  expect(WarmScorer.familiarity(["a.ts"], [])).toBe(0)
})

test("toolMatch - all required tools available returns 100", () => {
  expect(WarmScorer.toolMatch(["read", "edit", "bash"], ["read", "edit"])).toBe(100)
})

test("toolMatch - no required tools returns 100", () => {
  expect(WarmScorer.toolMatch(["read"], [])).toBe(100)
})

test("toolMatch - none available returns 0", () => {
  expect(WarmScorer.toolMatch([], ["read", "edit"])).toBe(0)
})

test("toolMatch - partial match", () => {
  expect(WarmScorer.toolMatch(["read"], ["read", "edit"])).toBe(50)
})

test("continuity - same parent task returns 100", () => {
  expect(
    WarmScorer.continuity(
      { lastTaskID: "task_001", sessionID: "ses_001" },
      { parentTaskID: "task_001", sessionID: "ses_002" },
    ),
  ).toBe(100)
})

test("continuity - same session returns 50", () => {
  expect(
    WarmScorer.continuity(
      { lastTaskID: "task_001", sessionID: "ses_001" },
      { parentTaskID: "task_099", sessionID: "ses_001" },
    ),
  ).toBe(50)
})

test("continuity - different session returns 0", () => {
  expect(
    WarmScorer.continuity(
      { lastTaskID: "task_001", sessionID: "ses_001" },
      { parentTaskID: "task_099", sessionID: "ses_002" },
    ),
  ).toBe(0)
})

test("scoreAgent - integrates all dimensions", () => {
  const now = Date.now()
  const agent = AgentState.create({
    id: "warm_agent_score_001",
    agentName: "code",
    sessionID: "ses_001",
  })
  const warmAgent: AgentState.Info = {
    ...agent,
    lifecycle: "warm",
    context: {
      loadedFiles: ["src/a.ts", "src/b.ts"],
      toolHistory: ["read", "edit"],
      projectScope: ["src/**"],
      lastActiveAt: now - 5 * 60_000,
    },
  }

  const task = TaskState.create({
    id: "task_score_001",
    sessionID: "ses_001",
    intent: { description: "test", capabilities: ["read", "edit", "bash"] },
    blastRadius: { paths: ["src/a.ts", "src/b.ts", "src/c.ts"] },
  })

  const { score, dimensions } = WarmScorer.scoreAgent(warmAgent, task, now)
  expect(score).toBeGreaterThan(0)
  expect(dimensions.recency).toBeGreaterThan(0)
  expect(dimensions.familiarity).toBeGreaterThan(0)
  expect(dimensions.toolMatch).toBeGreaterThan(0)
  expect(dimensions.continuity).toBe(50) // same session
})

test("rankAgents - returns sorted by score descending", () => {
  const now = Date.now()

  const makeAgent = (id: string, lastActive: number, files: string[]): AgentState.Info => ({
    ...AgentState.create({ id, agentName: "code", sessionID: "ses_001" }),
    lifecycle: "warm",
    context: {
      loadedFiles: files,
      toolHistory: ["read"],
      projectScope: [],
      lastActiveAt: lastActive,
    },
  })

  const agents = [
    makeAgent("agent_cold", now - 60 * 60_000, []),
    makeAgent("agent_hot", now - 1 * 60_000, ["a.ts", "b.ts"]),
    makeAgent("agent_mid", now - 10 * 60_000, ["a.ts"]),
  ]

  const task = TaskState.create({
    id: "task_rank_001",
    sessionID: "ses_001",
    intent: { description: "test", capabilities: ["read"] },
    blastRadius: { paths: ["a.ts", "b.ts"] },
  })

  const ranked = WarmScorer.rankAgents(agents, task, now)
  expect(ranked.length).toBe(3)
  expect(ranked[0].agent.id).toBe("agent_hot")
  expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score)
})

test("rankAgents - excludes non-warm agents", () => {
  const now = Date.now()
  const coldAgent = AgentState.create({ id: "agent_cold", agentName: "code", sessionID: "ses_001" })
  const warmAgent: AgentState.Info = {
    ...AgentState.create({ id: "agent_warm", agentName: "code", sessionID: "ses_001" }),
    lifecycle: "warm",
    context: { loadedFiles: [], toolHistory: [], projectScope: [], lastActiveAt: now },
  }

  const task = TaskState.create({
    id: "task_rank_002",
    sessionID: "ses_001",
    intent: { description: "test" },
  })

  const ranked = WarmScorer.rankAgents([coldAgent, warmAgent], task, now)
  expect(ranked.length).toBe(1)
  expect(ranked[0].agent.id).toBe("agent_warm")
})
