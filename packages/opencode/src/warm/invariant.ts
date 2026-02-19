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

  // ---- Hierarchical Blast-Radius ----

  /**
   * Validate that a child task's blast-radius is contained within the parent's.
   * Returns the effective (narrowed) blast-radius or an error.
   */
  export function validateChildScope(
    parentBlastRadius: TaskState.BlastRadius,
    childBlastRadius: Partial<TaskState.BlastRadius>,
  ): CheckResult & { effectiveScope?: TaskState.BlastRadius } {
    const childPaths = childBlastRadius.paths ?? parentBlastRadius.paths
    const childOps = childBlastRadius.operations ?? parentBlastRadius.operations

    // Every child path must be within at least one parent path
    for (const cp of childPaths) {
      if (!matchesGlob(cp.replace("/**", "").replace("/*", ""), parentBlastRadius.paths)) {
        return {
          allowed: false,
          reason: `Child path "${cp}" escapes parent blast radius [${parentBlastRadius.paths.join(", ")}]`,
        }
      }
    }

    // Every child operation must be in the parent's allowed operations
    for (const op of childOps) {
      if (!parentBlastRadius.operations.includes(op)) {
        return {
          allowed: false,
          reason: `Child operation "${op}" not allowed by parent [${parentBlastRadius.operations.join(", ")}]`,
        }
      }
    }

    // Child MCP tools must be subset of parent's (or parent allows all with empty array)
    const childMcp = childBlastRadius.mcpTools ?? []
    if (parentBlastRadius.mcpTools.length > 0) {
      for (const tool of childMcp) {
        if (!parentBlastRadius.mcpTools.includes(tool)) {
          return {
            allowed: false,
            reason: `Child MCP tool "${tool}" not in parent's allowed tools`,
          }
        }
      }
    }

    return {
      allowed: true,
      effectiveScope: {
        paths: childPaths,
        operations: childOps,
        mcpTools: childMcp,
        reversible: childBlastRadius.reversible ?? parentBlastRadius.reversible,
      },
    }
  }

  /**
   * Infer a narrower blast-radius from a task description.
   * Extracts file paths and directories mentioned in the message.
   */
  export function inferScopeFromMessage(
    message: string,
    parentPaths: string[],
  ): string[] {
    const inferred: string[] = []

    // Match file paths like src/auth/login.js, ./config/settings.json, etc.
    const pathPattern = /(?:^|\s|["'`])([./]*(?:[\w.-]+\/)+[\w.-]+(?:\.\w+)?)/g
    let match: RegExpExecArray | null
    while ((match = pathPattern.exec(message)) !== null) {
      const filePath = match[1].replace(/^\.\//, "")
      // Extract the directory containing the file
      const dir = filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : filePath
      const scopePath = `${dir}/**`
      if (!inferred.includes(scopePath)) {
        inferred.push(scopePath)
      }
    }

    // Match directory references like "the auth module", "in src/auth"
    const dirPattern = /(?:in |the |update |fix |read |edit |modify )(?:the )?([./]*(?:[\w.-]+\/)*[\w.-]+)/gi
    while ((match = dirPattern.exec(message)) !== null) {
      const dir = match[1].replace(/^\.\//, "")
      // Skip if it looks like a full sentence, not a path
      if (dir.includes(" ") || dir.length > 100) continue
      const scopePath = dir.includes(".") ? `${dir.split("/").slice(0, -1).join("/")}/**` : `${dir}/**`
      if (scopePath !== "/**" && !inferred.includes(scopePath)) {
        inferred.push(scopePath)
      }
    }

    if (inferred.length === 0) return parentPaths

    // Extract the root directory from parent paths for anchoring relative paths
    const parentRoot = parentPaths.length > 0
      ? parentPaths[0].replace("/**", "").replace("/*", "")
      : ""

    // Try both raw inferred paths and anchored versions (relative → absolute)
    const anchored: string[] = []
    for (const p of inferred) {
      const raw = p.replace("/**", "").replace("/*", "")
      if (matchesGlob(raw, parentPaths)) {
        // Already within parent scope as-is
        anchored.push(p)
      } else if (parentRoot) {
        // Anchor the relative path within the parent root
        const joined = `${parentRoot}/${raw}`
        if (matchesGlob(joined, parentPaths)) {
          anchored.push(`${parentRoot}/${raw}/**`)
        }
      }
    }

    return anchored.length > 0 ? anchored : parentPaths
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
