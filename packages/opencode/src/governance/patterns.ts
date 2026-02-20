import type { Governance } from "./types"

export namespace GovernancePatterns {
  export interface Pattern {
    test: (command: string, tokens: string[]) => boolean
    severity: Governance.Severity
    category: Governance.Category
    reason: string
    suggestion?: string
  }

  // ---- CRITICAL: always blocked, no override ----

  export const CRITICAL: Pattern[] = [
    {
      test: (cmd) => /:\(\)\s*\{.*\|.*&\s*\}\s*;?\s*:/.test(cmd),
      severity: "critical",
      category: "fork_bomb",
      reason: "Fork bomb detected. This would spawn infinite processes and crash the system.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "rm") return false
        const hasRf = tokens.some((t) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(t))
        const hasRoot = tokens.some((t) => t === "/" || t === "/*" || t === "/.")
        return hasRf && hasRoot
      },
      severity: "critical",
      category: "recursive_delete",
      reason: "Recursive deletion of filesystem root. This would destroy the entire filesystem.",
      suggestion: "Specify an explicit subdirectory instead of '/'.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "rm") return false
        const hasRf = tokens.some((t) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(t))
        const hasHome = tokens.some((t) => t === "~" || t === "$HOME" || t === "~/")
        return hasRf && hasHome
      },
      severity: "critical",
      category: "recursive_delete",
      reason: "Recursive deletion of home directory detected.",
      suggestion: "Target specific files or directories instead of the entire home directory.",
    },
    {
      test: (cmd) => /\bdd\b.*\bof=\/dev\/[sh]d[a-z]/.test(cmd),
      severity: "critical",
      category: "disk_wipe",
      reason: "Direct write to block device detected. This would overwrite disk data.",
      suggestion: "Use file-level operations instead of raw device writes.",
    },
    {
      test: (cmd) => /\bdd\b.*if=\/dev\/(zero|urandom|random).*of=/.test(cmd),
      severity: "critical",
      category: "disk_wipe",
      reason: "Disk wipe pattern detected (dd from /dev/zero or /dev/urandom).",
      suggestion: "Use 'shred' on specific files if secure deletion is needed.",
    },
    {
      test: (cmd) => /\bmkfs(\.\w+)?\s/.test(cmd),
      severity: "critical",
      category: "disk_wipe",
      reason: "Filesystem format command detected. This would erase all data on the target device.",
    },
    {
      test: (cmd) => />\s*\/dev\/[sh]d[a-z]/.test(cmd),
      severity: "critical",
      category: "disk_wipe",
      reason: "Output redirect to block device detected.",
      suggestion: "Redirect to a regular file instead.",
    },
    {
      test: (cmd) => /\bDROP\s+DATABASE\b/i.test(cmd),
      severity: "critical",
      category: "sql_drop",
      reason: "DROP DATABASE command detected. This permanently destroys an entire database.",
      suggestion: "Create a backup first, or use specific table operations.",
    },
    {
      test: (_cmd, tokens) =>
        tokens[0] === "kill" &&
        (tokens.includes("1") || tokens.includes("-9") && tokens.includes("1")),
      severity: "critical",
      category: "service_disruption",
      reason: "Attempting to kill PID 1 (init/systemd). This would crash the system.",
      suggestion: "Target specific process IDs instead.",
    },
  ]

  // ---- HIGH: blocked, requires explicit override ----

  export const HIGH: Pattern[] = [
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "git" || tokens[1] !== "push") return false
        const hasForce = tokens.some((t) => t === "--force" || t === "-f")
        const hasMain = tokens.some((t) => /^(main|master|origin\/main|origin\/master)$/.test(t))
        return hasForce && hasMain
      },
      severity: "high",
      category: "force_push",
      reason: "Force push to main/master branch detected. This could overwrite shared history.",
      suggestion: "Use '--force-with-lease' to a feature branch, or create a PR instead.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "git" || tokens[1] !== "push") return false
        return tokens.some((t) => t === "--force" || t === "-f")
      },
      severity: "high",
      category: "force_push",
      reason: "Force push detected. This could overwrite remote branch history.",
      suggestion: "Use '--force-with-lease' for safer force pushes, or push without --force.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "git" || tokens[1] !== "reset") return false
        return tokens.some((t) => t === "--hard")
      },
      severity: "high",
      category: "hard_reset",
      reason: "git reset --hard detected. This discards all uncommitted changes permanently.",
      suggestion: "Use 'git stash' to save changes before resetting, or use 'git reset --soft'.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "git" || tokens[1] !== "clean") return false
        return tokens.some((t) => /^-[a-z]*f/.test(t))
      },
      severity: "high",
      category: "hard_reset",
      reason: "git clean -f detected. This permanently removes untracked files.",
      suggestion: "Use 'git clean -n' (dry run) first to preview what would be deleted.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "git") return false
        if (tokens[1] === "checkout" && tokens.includes(".")) return true
        if (tokens[1] === "restore" && tokens.includes(".")) return true
        return false
      },
      severity: "high",
      category: "hard_reset",
      reason: "Discarding all uncommitted changes detected.",
      suggestion: "Use 'git stash' to save changes, or target specific files.",
    },
    {
      test: (cmd) => /\bDROP\s+TABLE\b/i.test(cmd),
      severity: "high",
      category: "sql_drop",
      reason: "DROP TABLE command detected. This permanently deletes a database table.",
      suggestion: "Use TRUNCATE for clearing data, or create a backup before dropping.",
    },
    {
      test: (cmd) => /\bTRUNCATE\s+TABLE\b/i.test(cmd),
      severity: "high",
      category: "sql_drop",
      reason: "TRUNCATE TABLE detected. This deletes all data from a table.",
      suggestion: "Use DELETE with a WHERE clause for selective deletion.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "chmod") return false
        return tokens.some((t) => t === "777") && tokens.some((t) => /^-[a-z]*R/.test(t))
      },
      severity: "high",
      category: "permission_escalation",
      reason: "Recursive chmod 777 detected. This makes all files world-readable/writable/executable.",
      suggestion: "Use more restrictive permissions like 755 for directories, 644 for files.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "rm") return false
        const hasRf = tokens.some((t) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(t))
        const SYSTEM_DIRS = [
          "/etc", "/usr", "/var", "/boot", "/bin", "/sbin", "/lib", "/opt",
          "/System", "/Library", "/Applications",
          "C:\\Windows", "C:\\Program Files",
        ]
        const targetsSystem = tokens.some((t) =>
          SYSTEM_DIRS.some((d) => t === d || t.startsWith(d + "/") || t.startsWith(d + "\\")),
        )
        return hasRf && targetsSystem
      },
      severity: "high",
      category: "recursive_delete",
      reason: "Recursive deletion targeting system directory detected.",
      suggestion: "Target specific files within the directory instead.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "systemctl") return false
        return ["stop", "disable", "mask"].some((a) => tokens.includes(a))
      },
      severity: "high",
      category: "service_disruption",
      reason: "Stopping/disabling system service detected.",
      suggestion: "Verify the service name and consider 'systemctl restart' instead.",
    },
  ]

  // ---- MEDIUM: warn but allow ----

  export const MEDIUM: Pattern[] = [
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "chmod") return false
        return tokens.some((t) => t === "777") && !tokens.some((t) => /^-[a-z]*R/.test(t))
      },
      severity: "medium",
      category: "permission_escalation",
      reason: "chmod 777 detected. Consider using more restrictive permissions.",
      suggestion: "Use 755 for directories or 644 for files.",
    },
    {
      test: (cmd) => /curl\s.*\|\s*(ba)?sh/.test(cmd) || /wget\s.*\|\s*(ba)?sh/.test(cmd),
      severity: "medium",
      category: "destructive_command",
      reason: "Piping remote content to shell detected. This executes arbitrary remote code.",
      suggestion: "Download the script first, review it, then execute.",
    },
    {
      test: (_cmd, tokens) => {
        if (tokens[0] !== "rm") return false
        return tokens.some((t) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(t))
      },
      severity: "medium",
      category: "recursive_delete",
      reason: "Recursive force delete detected. Verify the target path is correct.",
      suggestion: "Consider listing files first with 'find' or using 'rm -ri' (interactive).",
    },
    {
      test: (cmd) => /\bDELETE\s+FROM\b/i.test(cmd) && !/\bWHERE\b/i.test(cmd),
      severity: "medium",
      category: "sql_drop",
      reason: "DELETE FROM without WHERE clause detected. This deletes all rows.",
      suggestion: "Add a WHERE clause to target specific rows.",
    },
  ]

  export const ALL: Pattern[] = [...CRITICAL, ...HIGH, ...MEDIUM]
}
