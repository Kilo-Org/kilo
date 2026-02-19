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
import type { WarmSession as WarmSessionType } from "./warm-session"
import type { TaskState } from "./task-state"
import type { AgentState } from "./agent-state"

export namespace WarmIntegration {
  const log = Log.create({ service: "warm.integration" })

  // ---- Context Access ----

  export function getContext(): WarmSessionType.WarmContext | undefined {
    return (globalThis as any).__warmContext
  }

  export function setContext(ctx: WarmSessionType.WarmContext): void {
    ;(globalThis as any).__warmContext = ctx
  }

  export function isEnabled(): boolean {
    // Check both explicit context and env var
    const ctx = getContext()
    if (ctx?.enabled) return true
    return process.env.KILO_WARM === "1"
  }

  /**
   * Lazily initialize warm context for a session if KILO_WARM=1 is set
   * but no context exists yet. This handles the TUI case where the
   * worker thread has the env var but warm init hasn't happened yet.
   */
  export async function ensureContext(sessionID: string): Promise<WarmSessionType.WarmContext | undefined> {
    const existing = getContext()
    if (existing?.enabled) return existing

    if (process.env.KILO_WARM !== "1") return undefined

    // Lazy init: create warm context on first tool call
    const { WarmSession } = await import("./warm-session")
    const ctx = WarmSession.createContext(sessionID, {
      autoApproveDispatch: false,
    })
    setContext(ctx)

    // Register default agent
    await WarmSession.registerAgent(ctx, {
      id: `agent_${sessionID.slice(0, 16)}`,
      agentName: "code",
      capabilities: ["read", "edit", "bash", "write", "glob", "grep", "webfetch", "websearch", "task"],
    })

    // Create default task scoped to working directory
    await WarmSession.createDefaultTask(ctx, {
      message: "interactive session",
      workingDirectory: process.cwd().replace(/\\/g, "/"),
    })

    log.info("warm context auto-initialized", {
      sessionID,
      agentID: ctx.activeAgent?.id,
      taskID: ctx.activeTask?.id,
      scope: ctx.activeTask?.blastRadius.paths,
    })

    return ctx
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
    // Auto-initialize if KILO_WARM env is set but context doesn't exist yet
    const ctx = await ensureContext(sessionID)
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

  // ---- Sub-Task / Hierarchical Scope ----

  export interface SubTaskResult {
    taskID: string
    parentTaskID: string
    narrowed: boolean
    scope: string[]
    previousTask?: TaskState.Info
  }

  /**
   * Called when the Task tool spawns a sub-agent.
   * Creates a sub-task with inferred or explicit narrower scope.
   * Swaps the active task to the sub-task, restores parent on completion.
   */
  export async function createSubTask(
    sessionID: string,
    message: string,
    blastRadius?: Partial<{
      paths: string[]
      operations: string[]
      mcpTools: string[]
      reversible: boolean
    }>,
  ): Promise<SubTaskResult | undefined> {
    const ctx = await ensureContext(sessionID)
    if (!ctx?.enabled || !ctx.activeTask) return undefined

    const { WarmSession } = await import("./warm-session")
    const parentTask = ctx.activeTask

    const { task, narrowed } = await WarmSession.createSubTask(ctx, {
      message,
      parentTask,
      blastRadius: blastRadius as any,
    })

    // Swap active task to the sub-task
    ctx.activeTask = task

    log.info("sub-task activated", {
      taskID: task.id,
      parentTaskID: parentTask.id,
      narrowed,
      scope: task.blastRadius.paths,
    })

    return {
      taskID: task.id,
      parentTaskID: parentTask.id,
      narrowed,
      scope: task.blastRadius.paths,
      previousTask: parentTask,
    }
  }

  /**
   * Called when a sub-agent completes. Restores the parent task as active.
   */
  export async function completeSubTask(
    sessionID: string,
    parentTask: TaskState.Info,
  ): Promise<void> {
    const ctx = getContext()
    if (!ctx?.enabled) return

    const { WarmSession } = await import("./warm-session")

    // Complete the current sub-task
    await WarmSession.completeTask(ctx).catch((e) =>
      log.warn("sub-task completion failed", { error: e }),
    )

    // Restore parent task
    ctx.activeTask = parentTask

    log.info("parent task restored", {
      taskID: parentTask.id,
    })
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
