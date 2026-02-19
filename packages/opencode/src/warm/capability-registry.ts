import { Log } from "../util/log"
import type { AgentState } from "./agent-state"

export namespace CapabilityRegistry {
  const log = Log.create({ service: "warm.capability-registry" })

  export interface AgentCapabilities {
    agentID: string
    agentName: string
    tools: Set<string>
    mcpServers: Set<string>
    fileScopes: Set<string>
  }

  const registry = new Map<string, AgentCapabilities>()

  export function register(agent: AgentState.Info): void {
    registry.set(agent.id, {
      agentID: agent.id,
      agentName: agent.agentName,
      tools: new Set(agent.capabilities),
      mcpServers: new Set(agent.mcpServers),
      fileScopes: new Set(agent.context.projectScope),
    })
    log.info("registered", { agentID: agent.id, tools: agent.capabilities.length })
  }

  export function unregister(agentID: string): void {
    registry.delete(agentID)
  }

  export function get(agentID: string): AgentCapabilities | undefined {
    return registry.get(agentID)
  }

  export function findQualified(requirements: {
    capabilities?: string[]
    mcpServers?: string[]
  }): AgentCapabilities[] {
    const results: AgentCapabilities[] = []
    for (const entry of registry.values()) {
      let qualified = true
      if (requirements.capabilities) {
        for (const cap of requirements.capabilities) {
          if (!entry.tools.has(cap)) {
            qualified = false
            break
          }
        }
      }
      if (qualified && requirements.mcpServers) {
        for (const server of requirements.mcpServers) {
          if (!entry.mcpServers.has(server)) {
            qualified = false
            break
          }
        }
      }
      if (qualified) results.push(entry)
    }
    return results
  }

  export function updateTools(agentID: string, tools: string[]): void {
    const entry = registry.get(agentID)
    if (!entry) return
    entry.tools = new Set(tools)
  }

  export function markMCPUnhealthy(server: string): string[] {
    const affected: string[] = []
    for (const entry of registry.values()) {
      if (entry.mcpServers.has(server)) {
        affected.push(entry.agentID)
      }
    }
    if (affected.length) {
      log.warn("mcp unhealthy", { server, affectedAgents: affected.length })
    }
    return affected
  }

  export function clear(): void {
    registry.clear()
  }

  export function all(): AgentCapabilities[] {
    return [...registry.values()]
  }
}
