import { GovernanceDetector } from "./detector"
import { PathGuard } from "./path-guard"

export namespace GovernanceIntegration {
  export function isEnabled(): boolean {
    return process.env.KILO_DISABLE_GOVERNANCE !== "1"
  }

  export interface ToolCheckResult {
    allowed: boolean
    output?: string
    warnings?: string
  }

  /**
   * Pre-check for bash tool execution.
   * Called before permission checks — governance overrides permissions.
   */
  export function checkBash(
    command: string,
    tokenSets: string[][],
  ): ToolCheckResult {
    if (!isEnabled()) return { allowed: true }

    const result = GovernanceDetector.checkBashCommand(command, tokenSets)

    if (!result.allowed) {
      return {
        allowed: false,
        output: GovernanceDetector.formatRejection(result.verdicts),
      }
    }

    const warnings = GovernanceDetector.formatWarnings(result.verdicts)
    return { allowed: true, warnings: warnings || undefined }
  }

  /**
   * Pre-check for write/edit tool execution.
   */
  export function checkWritePath(
    filepath: string,
    projectRoot: string,
  ): ToolCheckResult {
    if (!isEnabled()) return { allowed: true }

    const result = PathGuard.checkWritePath(filepath, projectRoot)

    if (!result.allowed) {
      return {
        allowed: false,
        output: GovernanceDetector.formatRejection(result.verdicts),
      }
    }

    return { allowed: true }
  }
}
