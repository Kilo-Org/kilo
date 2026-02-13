/**
 * Dummy file ignore controller for autocomplete context filtering.
 *
 * TODO: Implement proper file ignore logic based on .gitignore, .kilocodeignore,
 * or CLI backend access control APIs. For now, this allows everything except
 * known sensitive file patterns.
 */

const SENSITIVE_PATTERNS = [".env", ".env.local", ".env.production", ".env.staging", ".env.development", ".env.*"]

function isSensitiveFile(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? ""
  return SENSITIVE_PATTERNS.some((pattern) => {
    if (pattern.includes("*")) {
      const prefix = pattern.split("*")[0]
      return basename.startsWith(prefix)
    }
    return basename === pattern
  })
}

export class FileIgnoreController {
  async initialize(): Promise<void> {
    // No-op for now
  }

  /**
   * Returns true if the file can be read/used as autocomplete context.
   */
  validateAccess(filePath: string): boolean {
    return !isSensitiveFile(filePath)
  }

  /**
   * Filter a list of candidate paths to those allowed.
   */
  filterPaths(paths: string[]): string[] {
    return paths.filter((p) => this.validateAccess(p))
  }

  /**
   * Returns user-facing instructions explaining why access is restricted.
   */
  getInstructions(): string | undefined {
    return undefined
  }

  dispose(): void {
    // No-op
  }
}
