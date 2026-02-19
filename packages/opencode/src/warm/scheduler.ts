import { Log } from "../util/log"
import { AgentState } from "./agent-state"
import { TaskState } from "./task-state"
import { WarmScorer } from "./scorer"
import { DispatchPolicy } from "./policy"
import { StateStore } from "./state-store"
import { Audit } from "./audit"
import { CapabilityRegistry } from "./capability-registry"
import { Bus } from "../bus"
import { WarmEvent } from "./bus-events"

export namespace Scheduler {
  const log = Log.create({ service: "warm.scheduler" })

  export interface DispatchResult {
    action: "dispatched" | "denied" | "queued"
    agentID?: string
    reason: string
    score?: number
  }

  export async function dispatch(
    task: TaskState.Info,
    policy: DispatchPolicy.Config,
    sessionAgents?: AgentState.Info[],
  ): Promise<DispatchResult> {
    // 1. Policy evaluation
    const policyResult = DispatchPolicy.evaluate(task, policy)

    if (policyResult.action === "deny") {
      await writeDispatchAudit(task, [], { agentID: "", reason: "denied" })
      await Bus.publish(WarmEvent.DispatchDecision, {
        taskID: task.id,
        agentID: "",
        reason: "denied",
        score: 0,
      })
      return { action: "denied", reason: policyResult.reason }
    }

    // 2. Load available agents
    const agents = sessionAgents ?? (await StateStore.listAgents(task.sessionID))

    // 3. Handle pinned agent
    if (policyResult.action === "pin_agent") {
      const pinned = agents.find((a) => a.agentName === policyResult.agentName)
      if (pinned) {
        await writeDispatchAudit(
          task,
          [{ agentID: pinned.id, score: 100, reason: "pinned" }],
          { agentID: pinned.id, reason: "pinned" },
        )
        await Bus.publish(WarmEvent.DispatchDecision, {
          taskID: task.id,
          agentID: pinned.id,
          reason: "pinned",
          score: 100,
        })
        return { action: "dispatched", agentID: pinned.id, reason: "pinned", score: 100 }
      }
      // Pinned agent not found — fall through to scoring
    }

    // 4. Score warm candidates
    const ranked = WarmScorer.rankAgents(agents, task)
    const candidates = ranked.map((r) => ({
      agentID: r.agent.id,
      score: r.score,
      reason: `warmness=${r.score}`,
    }))

    // 5. Select warmest above threshold
    const best = ranked.find((r) => r.score >= WarmScorer.DEFAULTS.WARM_THRESHOLD)
    if (best) {
      await writeDispatchAudit(task, candidates, { agentID: best.agent.id, reason: "warmest" })
      await Bus.publish(WarmEvent.DispatchDecision, {
        taskID: task.id,
        agentID: best.agent.id,
        reason: "warmest",
        score: best.score,
      })
      return { action: "dispatched", agentID: best.agent.id, reason: "warmest", score: best.score }
    }

    // 6. Cold spawn fallback
    const coldSpawnID = `warm_agent_cold_${Date.now()}`
    await writeDispatchAudit(task, candidates, { agentID: coldSpawnID, reason: "cold_spawn" })
    await Bus.publish(WarmEvent.DispatchDecision, {
      taskID: task.id,
      agentID: coldSpawnID,
      reason: "cold_spawn",
      score: 0,
    })
    return { action: "dispatched", agentID: coldSpawnID, reason: "cold_spawn", score: 0 }
  }

  export async function recoverIncomplete(): Promise<TaskState.Info[]> {
    const incomplete = await StateStore.scanIncomplete()
    log.info("recovery scan", { found: incomplete.length })
    return incomplete
  }

  async function writeDispatchAudit(
    task: TaskState.Info,
    candidates: Array<{ agentID: string; score: number; reason: string }>,
    selected: { agentID: string; reason: "pinned" | "warmest" | "cold_spawn" | "denied" },
  ): Promise<void> {
    await Audit.append(task.sessionID, {
      type: "dispatch_decision",
      id: `audit_dispatch_${Date.now()}`,
      taskID: task.id,
      sessionID: task.sessionID,
      candidates,
      selected,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))
  }
}
