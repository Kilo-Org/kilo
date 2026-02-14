import type { Config, ProviderConfig } from "../cli-backend/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of value) {
    const parsed = normalizeString(item)
    if (!parsed || seen.has(parsed)) {
      continue
    }
    seen.add(parsed)
    next.push(parsed)
  }
  return next.length > 0 ? next : undefined
}

function normalizeOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const entries = Object.entries(value).filter(([, optionValue]) => optionValue !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * Normalize provider config aliases into the backend-native shape.
 *
 * Legacy aliases supported by the webview:
 * - api_key -> options.apiKey
 * - base_url -> options.baseURL
 */
export function normalizeProviderConfig(input: ProviderConfig): ProviderConfig {
  const normalized: ProviderConfig = {
    ...input,
    name: normalizeString(input.name),
    api: normalizeString(input.api),
    id: normalizeString(input.id),
    npm: normalizeString(input.npm),
    env: normalizeStringList(input.env),
    whitelist: normalizeStringList(input.whitelist),
    blacklist: normalizeStringList(input.blacklist),
  }

  const options = normalizeOptions(input.options)
  const nextOptions: Record<string, unknown> = { ...(options ?? {}) }

  const legacyApiKey = normalizeString(input.api_key)
  const legacyBaseURL = normalizeString(input.base_url)

  if (legacyApiKey && normalizeString(nextOptions.apiKey) === undefined) {
    nextOptions.apiKey = legacyApiKey
  }

  if (legacyBaseURL && normalizeString(nextOptions.baseURL) === undefined) {
    nextOptions.baseURL = legacyBaseURL
  }

  if (typeof nextOptions.timeout === "number" && (!Number.isFinite(nextOptions.timeout) || nextOptions.timeout <= 0)) {
    delete nextOptions.timeout
  }

  const sanitizedOptions = Object.fromEntries(Object.entries(nextOptions).filter(([, value]) => value !== undefined))
  normalized.options = Object.keys(sanitizedOptions).length > 0 ? sanitizedOptions : undefined

  if (normalized.models && !isRecord(normalized.models)) {
    delete normalized.models
  }

  delete normalized.api_key
  delete normalized.base_url

  return normalized
}

export function normalizeProviderConfigMap(
  input: Record<string, ProviderConfig> | undefined,
): Record<string, ProviderConfig> | undefined {
  if (!input) {
    return undefined
  }

  const next = Object.fromEntries(
    Object.entries(input)
      .filter(([providerID]) => providerID.trim().length > 0)
      .map(([providerID, config]) => [providerID.trim(), normalizeProviderConfig(config)]),
  )

  return Object.keys(next).length > 0 ? next : undefined
}

export function normalizeProviderConfigPatch(input: Partial<Config>): Partial<Config> {
  if (!input.provider) {
    return input
  }

  return {
    ...input,
    provider: normalizeProviderConfigMap(input.provider),
  }
}
