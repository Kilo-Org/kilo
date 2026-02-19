import z from "zod"
import { Log } from "../util/log"

export namespace TaskState {
  const log = Log.create({ service: "warm.task-state" })

  export const Lifecycle = z.enum([
    "pending",
    "claimed",
    "executing",
    "postchecked",
    "completed",
    "failed",
    "rolled_back",
  ])
  export type Lifecycle = z.infer<typeof Lifecycle>

  export const BlastRadius = z.object({
    paths: z.array(z.string()),
    operations: z.array(z.enum(["read", "write", "delete", "execute", "network"])),
    mcpTools: z.array(z.string()),
    reversible: z.boolean(),
  })
  export type BlastRadius = z.infer<typeof BlastRadius>

  export const Condition = z.object({
    check: z.string(),
    args: z.record(z.string(), z.unknown()),
    passed: z.boolean().optional(),
    error: z.string().optional(),
  })
  export type Condition = z.infer<typeof Condition>

  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    parentTaskID: z.string().optional(),
    lifecycle: Lifecycle,
    intent: z.object({
      description: z.string(),
      agentName: z.string().optional(),
      capabilities: z.array(z.string()),
      priority: z.number().default(0),
    }),
    blastRadius: BlastRadius,
    assignment: z.object({
      agentID: z.string().optional(),
      claimedAt: z.number().optional(),
      startedAt: z.number().optional(),
      completedAt: z.number().optional(),
    }),
    preconditions: z.array(Condition),
    postconditions: z.array(Condition),
    snapshots: z.object({
      preExecution: z.string().optional(),
      postExecution: z.string().optional(),
      rollbackTarget: z.string().optional(),
    }),
    result: z
      .object({
        status: z.enum(["success", "failure", "rollback"]).optional(),
        summary: z.string().optional(),
        error: z.string().optional(),
        filesChanged: z.array(z.string()).optional(),
      })
      .optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  const VALID_TRANSITIONS: Record<Lifecycle, Lifecycle[]> = {
    pending: ["claimed"],
    claimed: ["executing", "rolled_back"],
    executing: ["postchecked", "failed", "rolled_back"],
    postchecked: ["completed", "failed"],
    completed: [],
    failed: ["rolled_back"],
    rolled_back: [],
  }

  export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
    return VALID_TRANSITIONS[from].includes(to)
  }

  export function transition(task: Info, to: Lifecycle): Info {
    if (!canTransition(task.lifecycle, to)) {
      log.warn("invalid transition", { from: task.lifecycle, to, taskID: task.id })
      throw new Error(`Invalid task lifecycle transition: ${task.lifecycle} → ${to}`)
    }

    const now = Date.now()
    const assignment = { ...task.assignment }

    switch (to) {
      case "claimed":
        assignment.claimedAt = now
        break
      case "executing":
        assignment.startedAt = now
        break
      case "completed":
      case "failed":
      case "rolled_back":
        assignment.completedAt = now
        break
    }

    log.info("transition", { taskID: task.id, from: task.lifecycle, to })
    return {
      ...task,
      lifecycle: to,
      assignment,
      time: {
        ...task.time,
        updated: now,
      },
    }
  }

  export function create(input: {
    id: string
    sessionID: string
    parentTaskID?: string
    intent: {
      description: string
      agentName?: string
      capabilities?: string[]
      priority?: number
    }
    blastRadius?: Partial<z.input<typeof BlastRadius>>
    preconditions?: z.input<typeof Condition>[]
    postconditions?: z.input<typeof Condition>[]
  }): Info {
    const now = Date.now()
    return Info.parse({
      id: input.id,
      sessionID: input.sessionID,
      parentTaskID: input.parentTaskID,
      lifecycle: "pending",
      intent: {
        description: input.intent.description,
        agentName: input.intent.agentName,
        capabilities: input.intent.capabilities ?? [],
        priority: input.intent.priority ?? 0,
      },
      blastRadius: {
        paths: ["**"],
        operations: ["read", "write"],
        mcpTools: [],
        reversible: true,
        ...input.blastRadius,
      },
      assignment: {},
      preconditions: input.preconditions ?? [],
      postconditions: input.postconditions ?? [],
      snapshots: {},
      time: {
        created: now,
        updated: now,
      },
    })
  }
}
