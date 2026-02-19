import z from "zod"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Audit } from "./audit"
import { WarmEvent } from "./bus-events"
import { CapabilityRegistry } from "./capability-registry"

export namespace MCPHealth {
  const log = Log.create({ service: "warm.mcp-health" })

  export const Status = z.enum(["healthy", "unhealthy", "degraded", "reconnecting"])
  export type Status = z.infer<typeof Status>

  export const ServerState = z.object({
    server: z.string(),
    status: Status,
    lastCheckedAt: z.number(),
    lastHealthyAt: z.number(),
    consecutiveFailures: z.number(),
    knownTools: z.array(z.string()),
    latencyMs: z.number(),
  })
  export type ServerState = z.infer<typeof ServerState>

  export const DriftReport = z.object({
    server: z.string(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    timestamp: z.number(),
  })
  export type DriftReport = z.infer<typeof DriftReport>

  const FAILURE_THRESHOLD = 3

  const servers = new Map<string, ServerState>()

  export function register(server: string, tools: string[]): void {
    const now = Date.now()
    servers.set(server, {
      server,
      status: "healthy",
      lastCheckedAt: now,
      lastHealthyAt: now,
      consecutiveFailures: 0,
      knownTools: tools,
      latencyMs: 0,
    })
    log.info("registered", { server, tools: tools.length })
  }

  export function get(server: string): ServerState | undefined {
    return servers.get(server)
  }

  export function all(): ServerState[] {
    return [...servers.values()]
  }

  export function recordSuccess(
    server: string,
    currentTools: string[],
    latencyMs: number,
  ): { drift: DriftReport | undefined } {
    const state = servers.get(server)
    if (!state) {
      register(server, currentTools)
      return { drift: undefined }
    }

    const now = Date.now()
    const drift = detectDrift(state, currentTools)

    state.status = drift ? "degraded" : "healthy"
    state.lastCheckedAt = now
    state.lastHealthyAt = now
    state.consecutiveFailures = 0
    state.latencyMs = latencyMs

    if (drift) {
      state.knownTools = currentTools
      log.warn("drift detected", { server, added: drift.added.length, removed: drift.removed.length })
    }

    return { drift }
  }

  export function recordFailure(server: string): { unhealthy: boolean; affected: string[] } {
    const state = servers.get(server)
    if (!state) return { unhealthy: false, affected: [] }

    state.consecutiveFailures++
    state.lastCheckedAt = Date.now()

    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
      state.status = "unhealthy"
      const affected = CapabilityRegistry.markMCPUnhealthy(server)
      log.warn("server unhealthy", { server, failures: state.consecutiveFailures })
      return { unhealthy: true, affected }
    }

    state.status = "reconnecting"
    return { unhealthy: false, affected: [] }
  }

  export function markRecovered(server: string, tools: string[]): void {
    const state = servers.get(server)
    if (!state) return
    state.status = "healthy"
    state.consecutiveFailures = 0
    state.lastHealthyAt = Date.now()
    state.knownTools = tools
    log.info("recovered", { server })
  }

  function detectDrift(state: ServerState, currentTools: string[]): DriftReport | undefined {
    const known = new Set(state.knownTools)
    const current = new Set(currentTools)

    const added = currentTools.filter((t) => !known.has(t))
    const removed = state.knownTools.filter((t) => !current.has(t))

    if (added.length === 0 && removed.length === 0) return undefined

    return { server: state.server, added, removed, timestamp: Date.now() }
  }

  export async function emitHealthAudit(
    sessionID: string,
    server: string,
    status: Status,
    toolsDrifted?: string[],
  ): Promise<void> {
    await Audit.append(sessionID, {
      type: "mcp_health",
      id: `audit_mcp_${Date.now()}`,
      server,
      status,
      toolsDrifted,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))

    await Bus.publish(WarmEvent.MCPServerStatus, { server, status })
  }

  export function isHealthy(server: string): boolean {
    const state = servers.get(server)
    return state?.status === "healthy" || state?.status === "degraded"
  }

  export function unhealthyServers(): string[] {
    return all()
      .filter((s) => s.status === "unhealthy")
      .map((s) => s.server)
  }

  export function clear(): void {
    servers.clear()
  }
}
