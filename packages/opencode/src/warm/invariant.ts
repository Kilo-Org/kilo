import { Log } from "../util/log"
import type { TaskState } from "./task-state"
import type { Audit } from "./audit"

export namespace Invariant {
  const log = Log.create({ service: "warm.invariant" })

  export interface CheckResult {
    allowed: boolean
    reason?: string
  }

  const TOOL_OPERATION_MAP: Record<string, TaskState.BlastRadius["operations"][number]> = {
    read: "read",
    grep: "read",
    glob: "read",
    list: "read",
    write: "write",
    edit: "write",
    multiedit: "write",
    apply_patch: "write",
    bash: "execute",
    webfetch: "network",
    websearch: "network",
  }

  export function classifyToolOperation(toolName: string): TaskState.BlastRadius["operations"][number] {
    const base = toolName.split("_")[0]
    return TOOL_OPERATION_MAP[base] ?? TOOL_OPERATION_MAP[toolName] ?? "execute"
  }

  export function matchesGlob(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern === "**" || pattern === "**/*") return true
      if (filePath.startsWith(pattern.replace("/**", "").replace("/*", ""))) return true
      if (filePath === pattern) return true
    }
    return false
  }

  export function toolPreCheck(
    toolName: string,
    args: Record<string, unknown>,
    task: TaskState.Info,
  ): CheckResult {
    const op = classifyToolOperation(toolName)
    if (!task.blastRadius.operations.includes(op)) {
      log.warn("operation denied", { toolName, operation: op, taskID: task.id })
      return {
        allowed: false,
        reason: `Operation "${op}" not declared in blast radius for task ${task.id}`,
      }
    }

    const targetPath = extractTargetPath(toolName, args)
    if (targetPath && !matchesGlob(targetPath, task.blastRadius.paths)) {
      log.warn("path denied", { toolName, targetPath, taskID: task.id })
      return {
        allowed: false,
        reason: `Path "${targetPath}" outside declared blast radius [${task.blastRadius.paths.join(", ")}]`,
      }
    }

    if (isMCPTool(toolName) && !task.blastRadius.mcpTools.includes(toolName)) {
      log.warn("mcp tool denied", { toolName, taskID: task.id })
      return {
        allowed: false,
        reason: `MCP tool "${toolName}" not declared in blast radius`,
      }
    }

    return { allowed: true }
  }

  export function checkPreconditions(task: TaskState.Info): { passed: boolean; failures: string[] } {
    const failures: string[] = []
    for (const cond of task.preconditions) {
      if (cond.passed === false) {
        failures.push(`Precondition "${cond.check}" failed: ${cond.error ?? "unknown"}`)
      }
    }
    return { passed: failures.length === 0, failures }
  }

  export function checkPostconditions(task: TaskState.Info): { passed: boolean; failures: string[] } {
    const failures: string[] = []
    for (const cond of task.postconditions) {
      if (cond.passed === false) {
        failures.push(`Postcondition "${cond.check}" failed: ${cond.error ?? "unknown"}`)
      }
    }
    return { passed: failures.length === 0, failures }
  }

  export function validateFilesWithinBlastRadius(
    filesChanged: string[],
    blastRadius: TaskState.BlastRadius,
  ): { passed: boolean; violations: string[] } {
    const violations = filesChanged.filter((f) => !matchesGlob(f, blastRadius.paths))
    return {
      passed: violations.length === 0,
      violations,
    }
  }

  function extractTargetPath(toolName: string, args: Record<string, unknown>): string | undefined {
    if (typeof args.file_path === "string") return args.file_path
    if (typeof args.path === "string") return args.path
    if (typeof args.filePath === "string") return args.filePath
    if (typeof args.command === "string") return undefined
    return undefined
  }

  function isMCPTool(toolName: string): boolean {
    return toolName.includes("_") && !Object.keys(TOOL_OPERATION_MAP).includes(toolName)
  }

  export function toAuditEntry(
    id: string,
    taskID: string,
    phase: "precondition" | "postcondition" | "tool_pre" | "tool_post",
    check: string,
    passed: boolean,
    error?: string,
  ): Extract<Audit.Entry, { type: "invariant_check" }> {
    return {
      type: "invariant_check",
      id,
      taskID,
      phase,
      check,
      passed,
      error,
      timestamp: Date.now(),
    }
  }
}
