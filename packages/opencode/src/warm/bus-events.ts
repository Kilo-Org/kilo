import z from "zod"
import { BusEvent } from "../bus/bus-event"

export namespace WarmEvent {
  export const AgentTransition = BusEvent.define(
    "warm.agent.transition",
    z.object({
      agentID: z.string(),
      from: z.string(),
      to: z.string(),
      warmness: z.number(),
    }),
  )

  export const TaskTransition = BusEvent.define(
    "warm.task.transition",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
      from: z.string(),
      to: z.string(),
    }),
  )

  export const DispatchDecision = BusEvent.define(
    "warm.dispatch.decision",
    z.object({
      taskID: z.string(),
      agentID: z.string(),
      reason: z.enum(["pinned", "warmest", "cold_spawn", "denied"]),
      score: z.number(),
    }),
  )

  export const InvariantViolation = BusEvent.define(
    "warm.invariant.violation",
    z.object({
      taskID: z.string(),
      toolName: z.string(),
      reason: z.string(),
    }),
  )

  export const TaskRolledBack = BusEvent.define(
    "warm.task.rolled_back",
    z.object({
      taskID: z.string(),
      sessionID: z.string(),
      reason: z.string(),
      filesRestored: z.array(z.string()),
    }),
  )

  export const MCPServerStatus = BusEvent.define(
    "warm.mcp.status",
    z.object({
      server: z.string(),
      status: z.enum(["healthy", "unhealthy", "degraded", "reconnecting"]),
    }),
  )
}
