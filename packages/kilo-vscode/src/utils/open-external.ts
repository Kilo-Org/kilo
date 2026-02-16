import { z } from "zod"

export const ALLOWED_OPEN_EXTERNAL_SCHEMES = new Set(["https:", "vscode:"])

export function parseAllowedOpenExternalUrl(rawUrl: unknown): string | null {
  const parsedInput = z.string().trim().min(1).safeParse(rawUrl)
  if (!parsedInput.success) {
    return null
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(parsedInput.data)
  } catch {
    return null
  }

  if (!ALLOWED_OPEN_EXTERNAL_SCHEMES.has(parsedUrl.protocol)) {
    return null
  }

  return parsedUrl.toString()
}
