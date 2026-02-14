import { z } from "zod"
import type { Config } from "../cli-backend/types"
import { normalizeProviderConfigPatch } from "./provider-config-normalization"

export interface SettingsValidationIssue {
  path: string
  message: string
  code: string
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: SettingsValidationIssue[] }

type ValidatedSettingKey =
  | "browserAutomation.enabled"
  | "browserAutomation.useSystemChrome"
  | "browserAutomation.headless"
  | "model.providerID"
  | "model.modelID"
  | "notifications.agent"
  | "notifications.permissions"
  | "notifications.errors"
  | "sounds.agent"
  | "sounds.permissions"
  | "sounds.errors"

type ValidatedAutocompleteSettingKey =
  | "enableAutoTrigger"
  | "enableSmartInlineTaskKeybinding"
  | "enableChatAutocomplete"

const nonEmptyStringSchema = z.string().trim().min(1, "Must not be empty")
const stringArraySchema = z.array(nonEmptyStringSchema).transform((values) => Array.from(new Set(values)))
const unknownRecordSchema = z.record(z.string(), z.unknown())
const permissionLevelSchema = z.enum(["allow", "ask", "deny"])
const soundSettingSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["default", "none"]),
)

const permissionConfigSchema = z.record(z.string(), permissionLevelSchema)

const agentConfigSchema = z
  .object({
    model: nonEmptyStringSchema.optional(),
    variant: nonEmptyStringSchema.optional(),
    prompt: nonEmptyStringSchema.optional(),
    temperature: z.number().finite().optional(),
    top_p: z.number().finite().optional(),
    steps: z.number().int().positive().optional(),
    permission: permissionConfigSchema.optional(),
  })
  .strict()

const providerStatusSchema = z.enum(["active", "alpha", "beta", "deprecated"])

const providerModelConfigSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
    name: nonEmptyStringSchema.optional(),
    status: providerStatusSchema.optional(),
    provider: z
      .object({
        npm: nonEmptyStringSchema.optional(),
      })
      .passthrough()
      .optional(),
    options: unknownRecordSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    variants: z.record(z.string(), unknownRecordSchema).optional(),
  })
  .passthrough()

const providerOptionsConfigSchema = z
  .object({
    apiKey: nonEmptyStringSchema.optional(),
    baseURL: nonEmptyStringSchema.optional(),
    enterpriseUrl: nonEmptyStringSchema.optional(),
    setCacheKey: z.boolean().optional(),
    timeout: z.union([z.number().finite().positive(), z.literal(false)]).optional(),
  })
  .passthrough()

const providerConfigSchema = z
  .object({
    id: nonEmptyStringSchema.optional(),
    name: nonEmptyStringSchema.optional(),
    api: nonEmptyStringSchema.optional(),
    npm: nonEmptyStringSchema.optional(),
    env: stringArraySchema.optional(),
    whitelist: stringArraySchema.optional(),
    blacklist: stringArraySchema.optional(),
    options: providerOptionsConfigSchema.optional(),
    models: z.record(z.string(), providerModelConfigSchema).optional(),
    // Legacy aliases still accepted and normalized post-parse.
    api_key: nonEmptyStringSchema.optional(),
    base_url: nonEmptyStringSchema.optional(),
  })
  .passthrough()

const mcpConfigSchema = z
  .object({
    command: z.union([nonEmptyStringSchema, z.array(nonEmptyStringSchema).min(1)]).optional(),
    args: stringArraySchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: nonEmptyStringSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    type: z.enum(["local", "remote"]).optional(),
    enabled: z.boolean().optional(),
    timeout: z.number().int().positive().optional(),
  })
  .passthrough()

const commandConfigSchema = z
  .object({
    command: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
  })
  .strict()

const skillsConfigSchema = z
  .object({
    paths: stringArraySchema.optional(),
    urls: stringArraySchema.optional(),
  })
  .strict()

const watcherConfigSchema = z
  .object({
    ignore: stringArraySchema.optional(),
  })
  .strict()

const compactionConfigSchema = z
  .object({
    auto: z.boolean().optional(),
    prune: z.boolean().optional(),
  })
  .strict()

const experimentalConfigSchema = z
  .object({
    disable_paste_summary: z.boolean().optional(),
    batch_tool: z.boolean().optional(),
    primary_tools: stringArraySchema.optional(),
    continue_loop_on_deny: z.boolean().optional(),
    mcp_timeout: z.number().int().positive().max(600_000).optional(),
  })
  .strict()

const configPatchSchema = z
  .object({
    permission: permissionConfigSchema.optional(),
    model: nonEmptyStringSchema.optional(),
    small_model: nonEmptyStringSchema.optional(),
    default_agent: nonEmptyStringSchema.optional(),
    agent: z.record(z.string(), agentConfigSchema).optional(),
    provider: z.record(z.string(), providerConfigSchema).optional(),
    disabled_providers: stringArraySchema.optional(),
    enabled_providers: stringArraySchema.optional(),
    mcp: z.record(z.string(), mcpConfigSchema).optional(),
    command: z.record(z.string(), commandConfigSchema).optional(),
    instructions: stringArraySchema.optional(),
    skills: skillsConfigSchema.optional(),
    snapshot: z.boolean().optional(),
    share: z.enum(["manual", "auto", "disabled"]).optional(),
    username: nonEmptyStringSchema.optional(),
    watcher: watcherConfigSchema.optional(),
    formatter: z.union([z.literal(false), unknownRecordSchema]).optional(),
    lsp: z.union([z.literal(false), unknownRecordSchema]).optional(),
    compaction: compactionConfigSchema.optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    keybinds: z.record(z.string(), nonEmptyStringSchema).optional(),
    layout: z.enum(["auto", "stretch"]).optional(),
    experimental: experimentalConfigSchema.optional(),
  })
  .strict()

const settingSchemas: Record<ValidatedSettingKey, z.ZodTypeAny> = {
  "browserAutomation.enabled": z.boolean(),
  "browserAutomation.useSystemChrome": z.boolean(),
  "browserAutomation.headless": z.boolean(),
  "model.providerID": nonEmptyStringSchema,
  "model.modelID": nonEmptyStringSchema,
  "notifications.agent": z.boolean(),
  "notifications.permissions": z.boolean(),
  "notifications.errors": z.boolean(),
  "sounds.agent": soundSettingSchema,
  "sounds.permissions": soundSettingSchema,
  "sounds.errors": soundSettingSchema,
}

const autocompleteKeySchema = z.enum(["enableAutoTrigger", "enableSmartInlineTaskKeybinding", "enableChatAutocomplete"])

const autocompleteValueSchema = z.boolean()

function pathFromIssuePath(path: Array<string | number>): string {
  if (path.length === 0) {
    return "$"
  }
  let out = ""
  for (const part of path) {
    if (typeof part === "number") {
      out += `[${part}]`
      continue
    }
    out += out.length === 0 ? part : `.${part}`
  }
  return out
}

function toIssues(error: z.ZodError): SettingsValidationIssue[] {
  return error.issues.map((issue) => ({
    path: pathFromIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }))
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item))
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)])
    return Object.fromEntries(entries)
  }
  return value
}

export function validateConfigPatch(input: unknown): ValidationResult<Partial<Config>> {
  const parsed = configPatchSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, issues: toIssues(parsed.error) }
  }

  const normalized = normalizeProviderConfigPatch(parsed.data as Partial<Config>)

  return {
    ok: true,
    value: stripUndefinedDeep(normalized) as Partial<Config>,
  }
}

export function validateSettingUpdate(
  key: unknown,
  value: unknown,
): ValidationResult<{ key: ValidatedSettingKey; value: unknown }> {
  if (typeof key !== "string" || !(key in settingSchemas)) {
    return {
      ok: false,
      issues: [{ path: "key", message: "Unsupported setting key", code: "unrecognized_key" }],
    }
  }

  const typedKey = key as ValidatedSettingKey
  const parsed = settingSchemas[typedKey].safeParse(value)
  if (!parsed.success) {
    return { ok: false, issues: toIssues(parsed.error) }
  }

  return { ok: true, value: { key: typedKey, value: parsed.data } }
}

export function validateAutocompleteSettingUpdate(
  key: unknown,
  value: unknown,
): ValidationResult<{ key: ValidatedAutocompleteSettingKey; value: boolean }> {
  const parsedKey = autocompleteKeySchema.safeParse(key)
  if (!parsedKey.success) {
    return { ok: false, issues: toIssues(parsedKey.error) }
  }

  const parsedValue = autocompleteValueSchema.safeParse(value)
  if (!parsedValue.success) {
    return { ok: false, issues: toIssues(parsedValue.error) }
  }

  return {
    ok: true,
    value: {
      key: parsedKey.data,
      value: parsedValue.data,
    },
  }
}
