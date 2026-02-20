import type { Governance } from "./types"
import { GovernancePatterns } from "./patterns"

export namespace GovernanceDetector {
  /**
   * Check a bash command against all destructive patterns.
   *
   * @param command  Raw command string
   * @param tokenSets  Token arrays extracted from tree-sitter AST (one per command in a pipeline/chain)
   */
  export function checkBashCommand(
    command: string,
    tokenSets: string[][],
  ): Governance.CheckResult {
    const verdicts: Governance.Verdict[] = []

    for (const tokens of tokenSets) {
      for (const pattern of GovernancePatterns.ALL) {
        if (pattern.test(command, tokens)) {
          verdicts.push({
            blocked: pattern.severity === "critical" || pattern.severity === "high",
            severity: pattern.severity,
            category: pattern.category,
            command: tokens.join(" "),
            pattern: pattern.reason.split(".")[0],
            reason: pattern.reason,
            suggestion: pattern.suggestion,
          })
        }
      }
    }

    const deduped = deduplicateVerdicts(verdicts)
    const hasBlocking = deduped.some((v) => v.blocked)

    return {
      allowed: !hasBlocking,
      verdicts: deduped,
    }
  }

  function deduplicateVerdicts(verdicts: Governance.Verdict[]): Governance.Verdict[] {
    const ORDER: Record<string, number> = { critical: 3, high: 2, medium: 1 }
    const seen = new Map<string, Governance.Verdict>()

    for (const v of verdicts) {
      const key = `${v.category}:${v.command}`
      const existing = seen.get(key)
      if (!existing || ORDER[v.severity]! > ORDER[existing.severity]!) {
        seen.set(key, v)
      }
    }
    return Array.from(seen.values())
  }

  /**
   * Format blocked verdicts into a human-readable rejection message.
   *
   * Following the Governed Agent Protocol:
   * "Refusal is honest engagement, not withdrawal."
   */
  export function formatRejection(verdicts: Governance.Verdict[]): string {
    const blocked = verdicts.filter((v) => v.blocked)
    if (blocked.length === 0) return ""

    const lines: string[] = [
      "[governance] Command blocked by the Governed Agent Protocol",
      "",
    ]

    for (const v of blocked) {
      lines.push(`  Severity:  ${v.severity.toUpperCase()}`)
      lines.push(`  Category:  ${v.category}`)
      lines.push(`  Reason:    ${v.reason}`)
      if (v.suggestion) {
        lines.push(`  Suggest:   ${v.suggestion}`)
      }
      lines.push("")
    }

    lines.push("This safety check cannot be bypassed by permission settings.")
    lines.push("If you believe this is a false positive, set KILO_DISABLE_GOVERNANCE=1.")

    return lines.join("\n")
  }

  /**
   * Format medium-severity warnings to append to tool output.
   */
  export function formatWarnings(verdicts: Governance.Verdict[]): string {
    const warnings = verdicts.filter((v) => v.severity === "medium")
    if (warnings.length === 0) return ""

    const lines = ["", "<governance_warning>"]
    for (const w of warnings) {
      lines.push(`  Warning: ${w.reason}`)
      if (w.suggestion) lines.push(`  Suggestion: ${w.suggestion}`)
    }
    lines.push("</governance_warning>")
    return lines.join("\n")
  }
}
