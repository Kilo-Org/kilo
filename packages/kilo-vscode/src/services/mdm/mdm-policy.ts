import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { z } from "zod"
import type { ProfileData } from "../cli-backend"

const mdmConfigSchema = z
  .object({
    requireCloudAuth: z.boolean(),
    organizationId: z.string().trim().min(1).optional(),
  })
  .strict()

export type MdmPolicyConfig = z.infer<typeof mdmConfigSchema> & {
  sourcePath: string
}

export type MdmComplianceResult =
  | {
      compliant: true
    }
  | {
      compliant: false
      reason: string
    }

const PROD_FILE = "mdm.json"
const DEV_FILE = "mdm.dev.json"

function getCandidateConfigPaths(isDevelopment: boolean): string[] {
  const files = isDevelopment ? [DEV_FILE, PROD_FILE] : [PROD_FILE]
  const platform = os.platform()

  const roots =
    platform === "win32"
      ? [
          path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "KiloCode"),
          path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "RooCode"),
        ]
      : platform === "darwin"
        ? ["/Library/Application Support/KiloCode", "/Library/Application Support/RooCode"]
        : ["/etc/kilo-code", "/etc/roo-code"]

  const candidates: string[] = []
  for (const root of roots) {
    for (const file of files) {
      candidates.push(path.join(root, file))
    }
  }

  return candidates
}

/**
 * Load machine-level MDM policy configuration if present.
 * Returns null when no config file exists or all files are invalid.
 */
export async function loadMdmPolicyConfig(isDevelopment: boolean): Promise<MdmPolicyConfig | null> {
  const candidates = getCandidateConfigPaths(isDevelopment)

  for (const candidatePath of candidates) {
    let raw: string
    try {
      raw = await fs.readFile(candidatePath, "utf-8")
    } catch {
      continue
    }

    try {
      const parsed = mdmConfigSchema.parse(JSON.parse(raw))
      return {
        ...parsed,
        sourcePath: candidatePath,
      }
    } catch {
      // Ignore invalid config and continue to next candidate.
      continue
    }
  }

  return null
}

export function evaluateMdmCompliance(
  policy: MdmPolicyConfig | null,
  profileData: ProfileData | null | undefined,
): MdmComplianceResult {
  if (!policy || !policy.requireCloudAuth) {
    return { compliant: true }
  }

  if (!profileData) {
    return {
      compliant: false,
      reason: "Your organization requires Kilo Code Cloud authentication. Please sign in to continue.",
    }
  }

  if (policy.organizationId && profileData.currentOrgId !== policy.organizationId) {
    return {
      compliant: false,
      reason: `You must be authenticated with organization \"${policy.organizationId}\" to continue.`,
    }
  }

  return { compliant: true }
}
