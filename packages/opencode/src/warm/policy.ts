import z from "zod"
import { Log } from "../util/log"
import { TaskState } from "./task-state"

export namespace DispatchPolicy {
  const log = Log.create({ service: "warm.policy" })

  export const Rule = z.object({
    match: z.object({
      intent: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      blastRadius: z.enum(["read-only", "single-file", "directory", "project", "unrestricted"]).optional(),
    }),
    action: z.enum(["allow", "deny", "require_approval", "pin_agent"]),
    agentName: z.string().optional(),
    reason: z.string(),
  })
  export type Rule = z.infer<typeof Rule>

  export const Config = z.object({
    rules: z.array(Rule),
    autoApproveDispatch: z.boolean().default(false),
    maxBlastRadius: z
      .enum(["read-only", "single-file", "directory", "project", "unrestricted"])
      .default("unrestricted"),
    denyCapabilities: z.array(z.string()).default([]),
    pinAgent: z.string().optional(),
  })
  export type Config = z.infer<typeof Config>

  const BLAST_RADIUS_ORDER = ["read-only", "single-file", "directory", "project", "unrestricted"] as const
  type BlastLevel = (typeof BLAST_RADIUS_ORDER)[number]

  function blastLevel(level: BlastLevel): number {
    return BLAST_RADIUS_ORDER.indexOf(level)
  }

  export type EvalResult =
    | { action: "allow" }
    | { action: "deny"; reason: string }
    | { action: "require_approval"; reason: string }
    | { action: "pin_agent"; agentName: string; reason: string }

  export function evaluate(task: TaskState.Info, config: Config): EvalResult {
    // 1. Check max blast radius constraint
    const taskBlast = inferBlastLevel(task)
    if (blastLevel(taskBlast) > blastLevel(config.maxBlastRadius)) {
      const reason = `Task blast radius "${taskBlast}" exceeds max "${config.maxBlastRadius}"`
      log.warn("denied by blast radius", { taskID: task.id, taskBlast, max: config.maxBlastRadius })
      return { action: "deny", reason }
    }

    // 2. Check denied capabilities
    for (const cap of task.intent.capabilities) {
      if (config.denyCapabilities.includes(cap)) {
        const reason = `Capability "${cap}" is on the deny list`
        log.warn("denied by capability", { taskID: task.id, capability: cap })
        return { action: "deny", reason }
      }
    }

    // 3. Check pinned agent
    if (config.pinAgent) {
      return { action: "pin_agent", agentName: config.pinAgent, reason: "global pin" }
    }

    // 4. Evaluate rules (last-wins, consistent with PermissionNext)
    let result: EvalResult = { action: "allow" }
    for (const rule of config.rules) {
      if (!matchesRule(rule, task)) continue
      switch (rule.action) {
        case "allow":
          result = { action: "allow" }
          break
        case "deny":
          result = { action: "deny", reason: rule.reason }
          break
        case "require_approval":
          if (config.autoApproveDispatch) {
            result = { action: "allow" }
          } else {
            result = { action: "require_approval", reason: rule.reason }
          }
          break
        case "pin_agent":
          result = { action: "pin_agent", agentName: rule.agentName!, reason: rule.reason }
          break
      }
    }

    return result
  }

  function matchesRule(rule: Rule, task: TaskState.Info): boolean {
    if (rule.match.intent) {
      if (!task.intent.description.toLowerCase().includes(rule.match.intent.toLowerCase())) {
        return false
      }
    }
    if (rule.match.capabilities) {
      const has = new Set(task.intent.capabilities)
      if (!rule.match.capabilities.every((c) => has.has(c))) return false
    }
    if (rule.match.blastRadius) {
      if (inferBlastLevel(task) !== rule.match.blastRadius) return false
    }
    return true
  }

  function inferBlastLevel(task: TaskState.Info): BlastLevel {
    const ops = task.blastRadius.operations
    if (ops.length === 1 && ops[0] === "read") return "read-only"
    const paths = task.blastRadius.paths
    if (paths.length === 1 && !paths[0].includes("*")) return "single-file"
    if (paths.every((p) => p.startsWith("**"))) return "unrestricted"
    return "directory"
  }

  export function defaultConfig(): Config {
    return Config.parse({
      rules: [],
      autoApproveDispatch: false,
      maxBlastRadius: "unrestricted",
      denyCapabilities: [],
    })
  }
}
