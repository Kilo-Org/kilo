import z from "zod"
import { TaskState } from "./task-state"
import { Log } from "../util/log"

export namespace FailureReport {
  const log = Log.create({ service: "warm.failure-report" })

  export const Info = z.object({
    taskID: z.string(),
    sessionID: z.string(),
    agentID: z.string(),
    timestamp: z.number(),

    intent: z.string(),
    blastRadius: TaskState.BlastRadius,

    execution: z.object({
      stepsCompleted: z.number(),
      stepsTotal: z.number(),
      filesActuallyChanged: z.array(z.string()),
      toolCallsExecuted: z.number(),
      lastToolCall: z
        .object({
          tool: z.string(),
          input: z.unknown(),
          output: z.string().optional(),
          error: z.string().optional(),
        })
        .optional(),
    }),

    failure: z.object({
      phase: z.enum(["precondition", "execution", "postcondition", "rollback"]),
      check: z.string().optional(),
      error: z.string(),
      recoverable: z.boolean(),
    }),

    recovery: z.object({
      action: z.enum(["rolled_back", "rollback_skipped", "retry_queued", "abandoned"]),
      snapshotRestored: z.string().optional(),
      filesRestored: z.array(z.string()).optional(),
    }),

    durableState: z.object({
      auditLogPath: z.string(),
      snapshotHash: z.string().optional(),
      taskStatePath: z.string(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export function fromTask(
    task: TaskState.Info,
    input: {
      agentID: string
      stepsCompleted: number
      stepsTotal: number
      filesActuallyChanged: string[]
      toolCallsExecuted: number
      lastToolCall?: { tool: string; input: unknown; output?: string; error?: string }
      failure: {
        phase: "precondition" | "execution" | "postcondition" | "rollback"
        check?: string
        error: string
        recoverable: boolean
      }
      recovery: {
        action: "rolled_back" | "rollback_skipped" | "retry_queued" | "abandoned"
        snapshotRestored?: string
        filesRestored?: string[]
      }
      auditLogPath: string
      taskStatePath: string
    },
  ): Info {
    const report: Info = {
      taskID: task.id,
      sessionID: task.sessionID,
      agentID: input.agentID,
      timestamp: Date.now(),
      intent: task.intent.description,
      blastRadius: task.blastRadius,
      execution: {
        stepsCompleted: input.stepsCompleted,
        stepsTotal: input.stepsTotal,
        filesActuallyChanged: input.filesActuallyChanged,
        toolCallsExecuted: input.toolCallsExecuted,
        lastToolCall: input.lastToolCall,
      },
      failure: input.failure,
      recovery: input.recovery,
      durableState: {
        auditLogPath: input.auditLogPath,
        snapshotHash: task.snapshots.preExecution,
        taskStatePath: input.taskStatePath,
      },
    }
    log.info("generated", { taskID: task.id, phase: input.failure.phase })
    return Info.parse(report)
  }
}
