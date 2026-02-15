import type { ProviderConfig, ProviderModelConfig, ProviderOptionsConfig } from "../../../types/messages"

export interface CustomProviderDraft {
  id: string
  name: string
  api: string
  npm: string
  apiKey: string
  baseURL: string
  enterpriseUrl: string
  timeout: string
  setCacheKey: string
  env: string
  whitelist: string
  blacklist: string
  modelsJson: string
  optionsJson: string
}

export type DraftToProviderResult =
  | {
      ok: true
      id: string
      config: ProviderConfig
    }
  | {
      ok: false
      error: string
    }

const KNOWN_OPTION_KEYS = new Set(["apiKey", "baseURL", "enterpriseUrl", "timeout", "setCacheKey"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseStringList(raw: string): string[] | undefined {
  const entries = raw
    .split(/\n|,/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    return undefined
  }
  return Array.from(new Set(entries))
}

function parseObjectJSON(
  raw: string,
  label: string,
): { ok: true; value?: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: true }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!isRecord(parsed)) {
      return { ok: false, error: `${label} must be a JSON object.` }
    }
    return { ok: true, value: parsed }
  } catch (error) {
    return { ok: false, error: `${label} is invalid JSON: ${error instanceof Error ? error.message : "parse error"}` }
  }
}

function stringifyObject(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return ""
  }
  return JSON.stringify(value, null, 2)
}

function formatStringList(value: unknown): string {
  if (!Array.isArray(value)) {
    return ""
  }
  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  return entries.join("\n")
}

function validateModelsConfig(
  models: Record<string, unknown> | undefined,
): { ok: true; value: Record<string, ProviderModelConfig> | undefined } | { ok: false; error: string } {
  if (!models) {
    return { ok: true, value: undefined }
  }

  for (const [modelKey, candidate] of Object.entries(models)) {
    if (!isRecord(candidate)) {
      return { ok: false, error: `Model \"${modelKey}\" must be a JSON object.` }
    }

    const { id, name, status, provider, options, headers, variants } = candidate
    if (id !== undefined && typeof id !== "string") {
      return { ok: false, error: `Model \"${modelKey}\" field \"id\" must be a string.` }
    }
    if (name !== undefined && typeof name !== "string") {
      return { ok: false, error: `Model \"${modelKey}\" field \"name\" must be a string.` }
    }
    if (status !== undefined && !["active", "alpha", "beta", "deprecated"].includes(String(status))) {
      return { ok: false, error: `Model \"${modelKey}\" field \"status\" must be active/alpha/beta/deprecated.` }
    }
    if (provider !== undefined) {
      if (!isRecord(provider)) {
        return { ok: false, error: `Model \"${modelKey}\" field \"provider\" must be an object.` }
      }
      if (provider.npm !== undefined && typeof provider.npm !== "string") {
        return { ok: false, error: `Model \"${modelKey}\" field \"provider.npm\" must be a string.` }
      }
    }
    if (options !== undefined && !isRecord(options)) {
      return { ok: false, error: `Model \"${modelKey}\" field \"options\" must be an object.` }
    }
    if (headers !== undefined) {
      if (!isRecord(headers)) {
        return { ok: false, error: `Model \"${modelKey}\" field \"headers\" must be an object.` }
      }
      for (const [headerKey, headerValue] of Object.entries(headers)) {
        if (typeof headerValue !== "string") {
          return {
            ok: false,
            error: `Model \"${modelKey}\" header \"${headerKey}\" must be a string.`,
          }
        }
      }
    }
    if (variants !== undefined) {
      if (!isRecord(variants)) {
        return { ok: false, error: `Model \"${modelKey}\" field \"variants\" must be an object.` }
      }
      for (const [variantKey, variantValue] of Object.entries(variants)) {
        if (!isRecord(variantValue)) {
          return {
            ok: false,
            error: `Model \"${modelKey}\" variant \"${variantKey}\" must be an object.`,
          }
        }
      }
    }
  }

  return { ok: true, value: models as Record<string, ProviderModelConfig> }
}

export function createEmptyCustomProviderDraft(): CustomProviderDraft {
  return {
    id: "",
    name: "",
    api: "",
    npm: "",
    apiKey: "",
    baseURL: "",
    enterpriseUrl: "",
    timeout: "",
    setCacheKey: "",
    env: "",
    whitelist: "",
    blacklist: "",
    modelsJson: "",
    optionsJson: "",
  }
}

export function providerConfigToDraft(id: string, provider: ProviderConfig): CustomProviderDraft {
  const options = isRecord(provider.options) ? provider.options : {}
  const optionEntries = Object.entries(options).filter(
    ([key, value]) => !KNOWN_OPTION_KEYS.has(key) && value !== undefined,
  )
  const extraOptions = optionEntries.length > 0 ? Object.fromEntries(optionEntries) : undefined

  return {
    id,
    name: provider.name ?? "",
    api: provider.api ?? "",
    npm: provider.npm ?? "",
    apiKey: nonEmptyString(options.apiKey) ?? provider.api_key ?? "",
    baseURL: nonEmptyString(options.baseURL) ?? provider.base_url ?? "",
    enterpriseUrl: nonEmptyString(options.enterpriseUrl) ?? "",
    timeout:
      typeof options.timeout === "number" && Number.isFinite(options.timeout) && options.timeout > 0
        ? String(options.timeout)
        : "",
    setCacheKey: typeof options.setCacheKey === "boolean" ? String(options.setCacheKey) : "",
    env: formatStringList(provider.env),
    whitelist: formatStringList(provider.whitelist),
    blacklist: formatStringList(provider.blacklist),
    modelsJson: stringifyObject(provider.models),
    optionsJson: stringifyObject(extraOptions),
  }
}

export function draftToProviderConfig(draft: CustomProviderDraft): DraftToProviderResult {
  const id = draft.id.trim()
  if (!id) {
    return { ok: false, error: "Provider ID is required." }
  }

  const parsedModels = parseObjectJSON(draft.modelsJson, "Models JSON")
  if (!parsedModels.ok) {
    return parsedModels
  }
  const validatedModels = validateModelsConfig(parsedModels.value)
  if (!validatedModels.ok) {
    return validatedModels
  }

  const parsedOptions = parseObjectJSON(draft.optionsJson, "Extra options JSON")
  if (!parsedOptions.ok) {
    return parsedOptions
  }

  const options: ProviderOptionsConfig = { ...(parsedOptions.value ?? {}) }

  const apiKey = nonEmptyString(draft.apiKey)
  if (apiKey) {
    options.apiKey = apiKey
  }

  const baseURL = nonEmptyString(draft.baseURL)
  if (baseURL) {
    options.baseURL = baseURL
  }

  const enterpriseUrl = nonEmptyString(draft.enterpriseUrl)
  if (enterpriseUrl) {
    options.enterpriseUrl = enterpriseUrl
  }

  const timeoutRaw = draft.timeout.trim()
  if (timeoutRaw) {
    const timeout = Number(timeoutRaw)
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return { ok: false, error: "Request timeout must be a positive number (milliseconds)." }
    }
    options.timeout = timeout
  }

  const setCacheKeyRaw = draft.setCacheKey.trim().toLowerCase()
  if (setCacheKeyRaw) {
    if (setCacheKeyRaw === "true") {
      options.setCacheKey = true
    } else if (setCacheKeyRaw === "false") {
      options.setCacheKey = false
    } else {
      return { ok: false, error: 'setCacheKey must be either "true" or "false".' }
    }
  }

  const config: ProviderConfig = {
    id,
    name: nonEmptyString(draft.name),
    api: nonEmptyString(draft.api),
    npm: nonEmptyString(draft.npm),
    env: parseStringList(draft.env),
    whitelist: parseStringList(draft.whitelist),
    blacklist: parseStringList(draft.blacklist),
    options: Object.keys(options).length > 0 ? options : undefined,
    models: validatedModels.value,
  }

  return { ok: true, id, config }
}
