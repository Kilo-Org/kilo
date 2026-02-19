import z from "zod"
import { Log } from "../util/log"

export namespace AgentState {
  const log = Log.create({ service: "warm.agent-state" })

  export const Lifecycle = z.enum([
    "cold",
    "warming",
    "warm",
    "executing",
    "cooling",
  ])
  export type Lifecycle = z.infer<typeof Lifecycle>

  export const Context = z.object({
    loadedFiles: z.array(z.string()),
    toolHistory: z.array(z.string()),
    projectScope: z.array(z.string()),
    lastActiveAt: z.number(),
    rehydrationKey: z.string().optional(),
  })
  export type Context = z.infer<typeof Context>

  export const Constraints = z.object({
    maxSteps: z.number().default(50),
    allowedPaths: z.array(z.string()),
    deniedPaths: z.array(z.string()),
    blastRadius: z.enum(["read-only", "single-file", "directory", "project", "unrestricted"]),
  })
  export type Constraints = z.infer<typeof Constraints>

  export const Info = z.object({
    id: z.string(),
    agentName: z.string(),
    sessionID: z.string(),
    lifecycle: Lifecycle,
    warmness: z.number().min(0).max(100),
    capabilities: z.array(z.string()),
    mcpServers: z.array(z.string()),
    context: Context,
    constraints: Constraints,
    time: z.object({
      created: z.number(),
      warmedAt: z.number().optional(),
      lastDispatchedAt: z.number().optional(),
      cooldownAt: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  const VALID_TRANSITIONS: Record<Lifecycle, Lifecycle[]> = {
    cold: ["warming"],
    warming: ["warm", "cold"],
    warm: ["executing", "cooling"],
    executing: ["warm", "cooling"],
    cooling: ["cold"],
  }

  export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
    return VALID_TRANSITIONS[from].includes(to)
  }

  export function transition(agent: Info, to: Lifecycle): Info {
    if (!canTransition(agent.lifecycle, to)) {
      log.warn("invalid transition", { from: agent.lifecycle, to, agentID: agent.id })
      throw new Error(`Invalid agent lifecycle transition: ${agent.lifecycle} → ${to}`)
    }

    const now = Date.now()
    const time = { ...agent.time }

    switch (to) {
      case "warm":
        time.warmedAt = now
        break
      case "executing":
        time.lastDispatchedAt = now
        break
      case "cooling":
        time.cooldownAt = now
        break
    }

    log.info("transition", { agentID: agent.id, from: agent.lifecycle, to })
    return {
      ...agent,
      lifecycle: to,
      context: {
        ...agent.context,
        lastActiveAt: now,
      },
      time,
    }
  }

  export function create(input: {
    id: string
    agentName: string
    sessionID: string
    capabilities?: string[]
    mcpServers?: string[]
    constraints?: Partial<z.input<typeof Constraints>>
  }): Info {
    const now = Date.now()
    return Info.parse({
      id: input.id,
      agentName: input.agentName,
      sessionID: input.sessionID,
      lifecycle: "cold",
      warmness: 0,
      capabilities: input.capabilities ?? [],
      mcpServers: input.mcpServers ?? [],
      context: {
        loadedFiles: [],
        toolHistory: [],
        projectScope: [],
        lastActiveAt: now,
      },
      constraints: {
        maxSteps: 50,
        allowedPaths: ["**"],
        deniedPaths: [],
        blastRadius: "unrestricted",
        ...input.constraints,
      },
      time: {
        created: now,
      },
    })
  }
}
