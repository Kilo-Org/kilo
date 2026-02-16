import fs from "node:fs/promises"
import path from "node:path"

export async function realpathOrResolved(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

export function normalizePathForCompare(targetPath: string): string {
  const resolved = path.resolve(targetPath)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export async function isPathInsideAnyRoot(candidatePath: string, roots: readonly string[]): Promise<boolean> {
  const candidateCanonical = normalizePathForCompare(await realpathOrResolved(candidatePath))

  for (const root of roots) {
    if (!root) {
      continue
    }
    const rootCanonical = normalizePathForCompare(await realpathOrResolved(root))
    if (candidateCanonical === rootCanonical || candidateCanonical.startsWith(`${rootCanonical}${path.sep}`)) {
      return true
    }
  }

  return false
}
