/**
 * Warm Agents Integration Bridge
 *
 * Provides safe access to warm context from anywhere in the codebase
 * without requiring direct imports of warm modules in upstream files.
 * All globalThis access is centralized here.
 */
import { Log } from "../util/log"
import { Audit } from "./audit"
import { Invariant } from "./invariant"
import type { WarmSession } from "./warm-session"
import type { TaskState } from "./task-state"
import type { AgentState } from "./agent-state"

export namespace WarmIntegration {
  const log = Log.create({ service: "warm.integration" })

  // ---- Context Access ----

  export function getContext(): WarmSession.WarmContext | undefined {
    return (globalThis as any).__warmContext
  }

  export function setContext(ctx: WarmSession.WarmContext): void {
    ;(globalThis as any).__warmContext = ctx
  }

  export function isEnabled(): boolean {
    const ctx = getContext()
    return ctx?.enabled === true
  }

  // ---- Tool Pre-Check ----

  export interface ToolCheckResult {
    allowed: boolean
    reason?: string
    logged: boolean
  }

  export async function checkTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionID: string,
  ): Promise<ToolCheckResult> {
    const ctx = getContext()
    if (!ctx?.enabled || !ctx.activeTask) {
      return { allowed: true, logged: false }
    }

    const result = Invariant.toolPreCheck(toolName, args, ctx.activeTask)

    // Audit log every check
    await Audit.append(sessionID, {
      type: "invariant_check",
      id: `audit_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskID: ctx.activeTask.id,
      phase: "tool_pre",
      check: "blast_radius",
      passed: result.allowed,
      error: result.reason,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))

    if (!result.allowed) {
      log.info("tool blocked by blast-radius", {
        tool: toolName,
        reason: result.reason,
        taskID: ctx.activeTask.id,
      })
    }

    return {
      allowed: result.allowed,
      reason: result.reason,
      logged: true,
    }
  }

  // ---- Audit Helpers ----

  export async function logToolExecution(
    sessionID: string,
    toolName: string,
    args: Record<string, unknown>,
    durationMs: number,
  ): Promise<void> {
    const ctx = getContext()
    if (!ctx?.enabled || !ctx.activeTask) return

    await Audit.append(sessionID, {
      type: "invariant_check",
      id: `audit_exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskID: ctx.activeTask.id,
      phase: "tool_pre",
      check: "tool_execution",
      passed: true,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))
  }

  // ---- Status Formatting ----

  export function formatStatus(): string | undefined {
    const ctx = getContext()
    if (!ctx?.enabled) return undefined

    const parts: string[] = ["[warm]"]

    if (ctx.activeAgent) {
      parts.push(`agent=${ctx.activeAgent.id}(${ctx.activeAgent.lifecycle})`)
    }
    if (ctx.activeTask) {
      parts.push(`task=${ctx.activeTask.id}(${ctx.activeTask.lifecycle})`)
    }

    return parts.join(" ")
  }

  export function formatToolCheck(toolName: string, result: ToolCheckResult): string {
    if (result.allowed) {
      return `[warm] \u2713 ${toolName} within blast radius`
    }
    return `[warm] \u2717 ${toolName} BLOCKED: ${result.reason}`
  }

  export function formatTaskSummary(): string | undefined {
    const ctx = getContext()
    if (!ctx?.enabled || !ctx.activeTask) return undefined

    const t = ctx.activeTask
    const lines: string[] = [
      `[warm] Task: ${t.intent.description}`,
      `[warm] Blast radius: ${t.blastRadius.paths.join(", ")}`,
      `[warm] Operations: ${t.blastRadius.operations.join(", ")}`,
      `[warm] Reversible: ${t.blastRadius.reversible}`,
    ]

    if (ctx.activeAgent) {
      lines.push(`[warm] Agent: ${ctx.activeAgent.agentName} (warmness: ${ctx.activeAgent.warmness})`)
    }

    return lines.join("\n")
  }
}
