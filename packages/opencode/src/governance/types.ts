import z from "zod"

export namespace Governance {
  export const Severity = z.enum(["critical", "high", "medium"])
  export type Severity = z.infer<typeof Severity>

  export const Category = z.enum([
    "destructive_command",
    "force_push",
    "hard_reset",
    "sql_drop",
    "fork_bomb",
    "disk_wipe",
    "permission_escalation",
    "credential_exposure",
    "system_path_write",
    "recursive_delete",
    "service_disruption",
  ])
  export type Category = z.infer<typeof Category>

  export const Verdict = z.object({
    blocked: z.boolean(),
    severity: Severity,
    category: Category,
    command: z.string(),
    pattern: z.string(),
    reason: z.string(),
    suggestion: z.string().optional(),
  })
  export type Verdict = z.infer<typeof Verdict>

  export const CheckResult = z.object({
    allowed: z.boolean(),
    verdicts: z.array(Verdict),
  })
  export type CheckResult = z.infer<typeof CheckResult>
}
