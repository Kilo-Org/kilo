import { Log } from "../util/log"
import type { AgentState } from "./agent-state"
import type { TaskState } from "./task-state"

export namespace WarmScorer {
  const log = Log.create({ service: "warm.scorer" })

  export const WEIGHTS = {
    recency: 0.2,
    familiarity: 0.35,
    toolMatch: 0.2,
    continuity: 0.25,
  } as const

  export const DEFAULTS = {
    WARM_THRESHOLD: 30,
    STALENESS_MINUTES: 30,
    MAX_WARM_AGENTS: 5,
    COOLDOWN_AFTER_IDLE_MS: 300_000,
    EVICT_AFTER_COOL_MS: 600_000,
    CONTEXT_SIZE_LIMIT: 50,
  } as const

  export interface Dimensions {
    recency: number
    familiarity: number
    toolMatch: number
    continuity: number
  }

  export function computeScore(dimensions: Dimensions): number {
    const raw =
      dimensions.recency * WEIGHTS.recency +
      dimensions.familiarity * WEIGHTS.familiarity +
      dimensions.toolMatch * WEIGHTS.toolMatch +
      dimensions.continuity * WEIGHTS.continuity
    return Math.round(Math.max(0, Math.min(100, raw)))
  }

  export function recency(lastActiveAt: number, now?: number): number {
    const elapsed = (now ?? Date.now()) - lastActiveAt
    const minutes = elapsed / 60_000
    return Math.max(0, Math.round(100 - (minutes / DEFAULTS.STALENESS_MINUTES) * 100))
  }

  export function familiarity(agentFiles: string[], taskFiles: string[]): number {
    if (taskFiles.length === 0) return 0
    const taskSet = new Set(taskFiles)
    const overlap = agentFiles.filter((f) => taskSet.has(f)).length
    return Math.round((overlap / taskFiles.length) * 100)
  }

  export function toolMatch(agentTools: string[], requiredCapabilities: string[]): number {
    if (requiredCapabilities.length === 0) return 100
    const agentSet = new Set(agentTools)
    const overlap = requiredCapabilities.filter((c) => agentSet.has(c)).length
    return Math.round((overlap / requiredCapabilities.length) * 100)
  }

  export function continuity(
    agent: { lastTaskID?: string; sessionID: string },
    task: { parentTaskID?: string; sessionID: string },
  ): number {
    if (task.parentTaskID && task.parentTaskID === agent.lastTaskID) return 100
    if (task.sessionID === agent.sessionID) return 50
    return 0
  }

  export function scoreAgent(agent: AgentState.Info, task: TaskState.Info, now?: number): { score: number; dimensions: Dimensions } {
    const dims: Dimensions = {
      recency: recency(agent.context.lastActiveAt, now),
      familiarity: familiarity(agent.context.loadedFiles, task.blastRadius.paths),
      toolMatch: toolMatch(agent.context.toolHistory, task.intent.capabilities),
      continuity: continuity(
        { sessionID: agent.sessionID },
        { parentTaskID: task.parentTaskID, sessionID: task.sessionID },
      ),
    }
    const score = computeScore(dims)
    log.info("scored", { agentID: agent.id, score, ...dims })
    return { score, dimensions: dims }
  }

  export function rankAgents(
    agents: AgentState.Info[],
    task: TaskState.Info,
    now?: number,
  ): Array<{ agent: AgentState.Info; score: number; dimensions: Dimensions }> {
    return agents
      .filter((a) => a.lifecycle === "warm")
      .map((agent) => {
        const { score, dimensions } = scoreAgent(agent, task, now)
        return { agent, score, dimensions }
      })
      .sort((a, b) => b.score - a.score)
  }
}
