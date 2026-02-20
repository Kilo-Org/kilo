import path from "path"
import type { Governance } from "./types"

export namespace PathGuard {
  const UNIX_SYSTEM_PATHS = [
    "/etc", "/usr", "/boot", "/bin", "/sbin", "/lib", "/lib64",
    "/opt", "/var/lib", "/var/log", "/proc", "/sys", "/dev",
    "/System", "/Library",
  ]

  const WINDOWS_SYSTEM_PATHS = [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
  ]

  const SYSTEM_PATHS =
    process.platform === "win32"
      ? [...WINDOWS_SYSTEM_PATHS, ...UNIX_SYSTEM_PATHS]
      : UNIX_SYSTEM_PATHS

  const CREDENTIAL_FILES = new Set([
    ".env", ".env.local", ".env.production", ".env.staging",
    "id_rsa", "id_ed25519", "id_dsa", "id_ecdsa",
    "id_rsa.pub", "id_ed25519.pub",
    "credentials.json", "service-account.json",
    ".npmrc", ".pypirc",
    "secrets.yml", "secrets.yaml", "secrets.json",
    "vault.json", "keystore.jks",
    ".htpasswd", "shadow", "passwd",
    "private.pem", "private.key",
    "master.key", "credentials.yml.enc",
    "token.json", "auth.json",
  ])

  const CREDENTIAL_DIRS = new Set([
    ".ssh", ".gnupg", ".aws", ".azure", ".gcloud", ".kube", ".docker",
  ])

  export function checkWritePath(
    filepath: string,
    projectRoot: string,
  ): Governance.CheckResult {
    const verdicts: Governance.Verdict[] = []
    const normalized = path.resolve(filepath)
    const basename = path.basename(normalized)
    const parts = normalized.split(path.sep)

    // System paths
    for (const sysPath of SYSTEM_PATHS) {
      const normalizedSys = path.resolve(sysPath)
      if (normalized.startsWith(normalizedSys + path.sep) || normalized === normalizedSys) {
        verdicts.push({
          blocked: true,
          severity: "critical",
          category: "system_path_write",
          command: `write ${filepath}`,
          pattern: "system_path",
          reason: `Writing to system path '${sysPath}' is blocked. This could corrupt the operating system.`,
          suggestion: "Write to a location within your project directory instead.",
        })
        break
      }
    }

    // Credential files
    if (CREDENTIAL_FILES.has(basename)) {
      verdicts.push({
        blocked: true,
        severity: "high",
        category: "credential_exposure",
        command: `write ${filepath}`,
        pattern: "credential_file",
        reason: `Writing to credential file '${basename}' is blocked. This file may contain secrets.`,
        suggestion: "Use environment variables or a secrets manager instead.",
      })
    }

    // Credential directories
    for (const dir of parts) {
      if (CREDENTIAL_DIRS.has(dir)) {
        verdicts.push({
          blocked: true,
          severity: "high",
          category: "credential_exposure",
          command: `write ${filepath}`,
          pattern: "credential_directory",
          reason: `Writing to credential directory '${dir}' is blocked.`,
          suggestion: "Manage credential files manually, not through automated agents.",
        })
        break
      }
    }

    const hasBlocking = verdicts.some((v) => v.blocked)

    return {
      allowed: !hasBlocking,
      verdicts,
    }
  }
}
