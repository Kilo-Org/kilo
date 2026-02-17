// kilocode_change - new file
import { createHash } from "crypto"

/**
 * Collection naming utilities for codebase search
 * Uses SHA-256 hash-based naming to match Kilo Code VSCode extension pattern
 */
export namespace CodebaseSearchCollection {
  /**
   * Generate collection name from workspace path
   * Uses SHA-256 hash truncated to 16 hex chars
   * Pattern: ws-{hash16}
   *
   * This matches the Kilo Code VSCode extension pattern for compatibility
   * with collections created by the extension.
   */
  export function generateFromWorkspace(workspacePath: string): string {
    const hash = createHash("sha256").update(workspacePath).digest("hex")
    return `ws-${hash.substring(0, 16)}`
  }

  /**
   * Get collection name for a workspace
   * Returns explicit collection name if provided, otherwise generates one
   */
  export function get(workspacePath: string, explicitCollection?: string): string {
    return explicitCollection || generateFromWorkspace(workspacePath)
  }

  /**
   * Check if a collection name follows the Kilo pattern
   */
  export function isKiloPattern(collectionName: string): boolean {
    return /^ws-[a-f0-9]{16}$/.test(collectionName)
  }
}
