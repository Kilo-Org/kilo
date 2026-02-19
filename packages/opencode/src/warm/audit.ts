import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"

export namespace Audit {
  const log = Log.create({ service: "warm.audit" })

  export const DispatchDecision = z.object({
    type: z.literal("dispatch_decision"),
    id: z.string(),
    taskID: z.string(),
    sessionID: z.string(),
    candidates: z.array(
      z.object({
        agentID: z.string(),
        score: z.number(),
        reason: z.string(),
      }),
    ),
    selected: z.object({
      agentID: z.string(),
      reason: z.enum(["pinned", "warmest", "cold_spawn", "denied"]),
    }),
    timestamp: z.number(),
  })

  export const StateTransition = z.object({
    type: z.literal("state_transition"),
    id: z.string(),
    entityType: z.enum(["agent", "task"]),
    entityID: z.string(),
    from: z.string(),
    to: z.string(),
    trigger: z.string(),
    timestamp: z.number(),
  })

  export const InvariantCheck = z.object({
    type: z.literal("invariant_check"),
    id: z.string(),
    taskID: z.string(),
    phase: z.enum(["precondition", "postcondition", "tool_pre", "tool_post"]),
    check: z.string(),
    passed: z.boolean(),
    error: z.string().optional(),
    timestamp: z.number(),
  })

  export const Rollback = z.object({
    type: z.literal("rollback"),
    id: z.string(),
    taskID: z.string(),
    snapshotFrom: z.string(),
    snapshotTo: z.string(),
    filesRestored: z.array(z.string()),
    timestamp: z.number(),
  })

  export const MCPHealth = z.object({
    type: z.literal("mcp_health"),
    id: z.string(),
    server: z.string(),
    status: z.enum(["healthy", "unhealthy", "degraded", "reconnecting"]),
    toolsDrifted: z.array(z.string()).optional(),
    timestamp: z.number(),
  })

  export const Entry = z.discriminatedUnion("type", [
    DispatchDecision,
    StateTransition,
    InvariantCheck,
    Rollback,
    MCPHealth,
  ])
  export type Entry = z.infer<typeof Entry>

  function auditDir(): string {
    return path.join(Global.Path.data, "warm", "audit")
  }

  function auditPath(sessionID: string): string {
    return path.join(auditDir(), `${sessionID}.jsonl`)
  }

  export async function append(sessionID: string, entry: Entry): Promise<void> {
    const validated = Entry.parse(entry)
    const filePath = auditPath(sessionID)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const line = JSON.stringify(validated) + "\n"
    await fs.appendFile(filePath, line, "utf-8")
    log.info("appended", { type: entry.type, sessionID })
  }

  export async function read(sessionID: string): Promise<Entry[]> {
    const filePath = auditPath(sessionID)
    try {
      const content = await fs.readFile(filePath, "utf-8")
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => Entry.parse(JSON.parse(line)))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
      throw e
    }
  }

  export async function readByType<T extends Entry["type"]>(
    sessionID: string,
    type: T,
  ): Promise<Extract<Entry, { type: T }>[]> {
    const entries = await read(sessionID)
    return entries.filter((e): e is Extract<Entry, { type: T }> => e.type === type)
  }

  export async function tail(sessionID: string, count: number): Promise<Entry[]> {
    const entries = await read(sessionID)
    return entries.slice(-count)
  }
}
