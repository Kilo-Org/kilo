import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import zlib from "node:zlib"
import * as YAML from "yaml"
import * as vscode from "vscode"
import * as tarFs from "tar-fs"
import { CustomModeStore } from "./custom-mode-store"
import type {
  MarketplaceCatalogResult,
  MarketplaceInstallOptions,
  MarketplaceInstalledMetadata,
  MarketplaceItem,
  MarketplaceItemType,
  MarketplaceMcpInstallMethod,
  MarketplaceSkillItem,
} from "./types"
import {
  marketplaceItemSchema,
  mcpMarketplaceCatalogSchema,
  modeMarketplaceCatalogSchema,
  skillsMarketplaceCatalogSchema,
} from "./schema"

const CACHE_TTL_MS = 5 * 60_000
const MARKETPLACE_FETCH_RETRIES = 3
const MARKETPLACE_FETCH_TIMEOUT_MS = 12_000
const MARKETPLACE_RETRY_BASE_DELAY_MS = 500
const MAX_SKILL_TARBALL_BYTES = 50 * 1024 * 1024
const SKILL_DOWNLOAD_TIMEOUT_MS = 30_000
const DEFAULT_BACKEND_BASE_URL = "https://kilo.ai"
const DEFAULT_API_BASE_URL = "https://api.kilo.ai"
const SAFE_MARKETPLACE_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])

function getApiUrl(pathname = ""): string {
  const backendBase = process.env.KILOCODE_BACKEND_BASE_URL?.trim()
  if (backendBase && backendBase !== DEFAULT_BACKEND_BASE_URL) {
    return new URL(pathname, backendBase).toString()
  }

  return new URL(pathname, DEFAULT_API_BASE_URL).toString()
}

function isLikelyHtmlDocument(body: string): boolean {
  return /^\s*<!doctype html/i.test(body) || /^\s*<html\b/i.test(body)
}

type CacheEntry = {
  items: MarketplaceItem[]
  fetchedAt: number
}

export class MarketplaceService {
  constructor(private readonly globalStorageFsPath?: string) {}

  private cache: CacheEntry | null = null
  private readonly customModeStore = new CustomModeStore()

  async getCatalog(): Promise<MarketplaceCatalogResult> {
    const errors: string[] = []
    let items: MarketplaceItem[] = []

    try {
      const baseItems = await this.getCachedOrFetchItems()
      items = baseItems
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    const installedMetadata = await this.getInstalledMetadata().catch((error) => {
      errors.push(error instanceof Error ? error.message : String(error))
      return { project: {}, global: {} } satisfies MarketplaceInstalledMetadata
    })
    this.aliasInstalledModesToCatalogIds(items, installedMetadata)

    return {
      items,
      installedMetadata,
      ...(errors.length > 0 ? { errors } : {}),
    }
  }

  invalidateCache(): void {
    this.cache = null
  }

  async installItem(item: MarketplaceItem, options: MarketplaceInstallOptions): Promise<void> {
    switch (item.type) {
      case "mode":
        await this.installMode(item, options.target)
        return
      case "mcp":
        await this.installMcp(item, options)
        return
      case "skill":
        await this.installSkill(item, options.target)
        return
      default:
        throw new Error(`Unsupported marketplace item type: ${String((item as { type?: unknown }).type)}`)
    }
  }

  async removeItem(item: MarketplaceItem, target: "project" | "global"): Promise<void> {
    switch (item.type) {
      case "mode":
        await this.removeMode(item, target)
        return
      case "mcp":
        await this.removeMcp(item, target)
        return
      case "skill":
        await this.removeSkill(item, target)
        return
      default:
        throw new Error(`Unsupported marketplace item type: ${String((item as { type?: unknown }).type)}`)
    }
  }

  private async getCachedOrFetchItems(): Promise<MarketplaceItem[]> {
    const now = Date.now()
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.items
    }

    const [modes, mcps, skills] = await Promise.all([this.fetchModes(), this.fetchMcps(), this.fetchSkills()])
    const items = [...modes, ...mcps, ...skills]
    this.cache = { items, fetchedAt: now }
    return items
  }

  private async fetchModes(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/modes")
    const parsed = this.parseStructured(text)
    const validated = modeMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((item) =>
      marketplaceItemSchema.parse({
        ...item,
        type: "mode",
      }),
    )
  }

  private async fetchMcps(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/mcps")
    const parsed = this.parseStructured(text)
    const validated = mcpMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((item) =>
      marketplaceItemSchema.parse({
        ...item,
        type: "mcp",
      }),
    )
  }

  private async fetchSkills(): Promise<MarketplaceItem[]> {
    const text = await this.fetchCatalogText("/api/marketplace/skills")
    const parsed = this.parseStructured(text)
    const validated = skillsMarketplaceCatalogSchema.parse(parsed)
    return validated.items.map((skill) =>
      marketplaceItemSchema.parse({
        type: "skill",
        id: skill.id,
        name: skill.id,
        description: skill.description,
        category: skill.category,
        githubUrl: skill.githubUrl,
        content: skill.content,
        displayName: this.kebabToTitle(skill.id),
        displayCategory: this.kebabToTitle(skill.category),
      }),
    )
  }

  private async fetchCatalogText(route: string): Promise<string> {
    const requestUrl = getApiUrl(route)
    const requestOrigin = new URL(requestUrl).origin
    const defaultApiOrigin = new URL(DEFAULT_API_BASE_URL).origin
    const isCustomApiBase = requestOrigin !== defaultApiOrigin
    const errors: string[] = []
    let attemptedDefaultFallback = false

    const tryDefaultFallback = async (): Promise<string | null> => {
      if (!isCustomApiBase || attemptedDefaultFallback) {
        return null
      }
      attemptedDefaultFallback = true

      const fallbackUrl = getApiUrlFromBase(DEFAULT_API_BASE_URL, route)
      try {
        const fallbackResponse = await this.fetchWithTimeout(fallbackUrl, MARKETPLACE_FETCH_TIMEOUT_MS)
        const fallbackText = await fallbackResponse.text()
        if (fallbackResponse.ok) {
          return fallbackText
        }
        const fallbackSnippet = fallbackText.trim().slice(0, 140)
        errors.push(
          `Marketplace request fallback failed (${fallbackResponse.status}) ${fallbackUrl}${fallbackSnippet ? `: ${fallbackSnippet}` : ""}`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`Marketplace request fallback failed (${fallbackUrl}): ${message}`)
      }

      return null
    }

    for (let attempt = 1; attempt <= MARKETPLACE_FETCH_RETRIES; attempt++) {
      try {
        const response = await this.fetchWithTimeout(requestUrl, MARKETPLACE_FETCH_TIMEOUT_MS)
        const text = await response.text()
        if (!response.ok) {
          const snippet = text.trim().slice(0, 140)
          const failure = `(${response.status}) ${requestUrl}${snippet ? `: ${snippet}` : ""}`

          // Local custom backends often do not expose marketplace routes. Fall back
          // to the default API immediately instead of waiting through retries.
          if (isCustomApiBase && (response.status === 404 && isLikelyHtmlDocument(text))) {
            const fallbackText = await tryDefaultFallback()
            if (fallbackText !== null) {
              return fallbackText
            }
          }
          if (isCustomApiBase && response.status < 500 && response.status !== 429) {
            const fallbackText = await tryDefaultFallback()
            if (fallbackText !== null) {
              return fallbackText
            }
          }

          if (response.status >= 500 || response.status === 429) {
            errors.push(`Marketplace request failed ${failure}`)
            await this.delayBeforeRetry(attempt)
            continue
          }
          throw new Error(`Marketplace request failed ${failure}`)
        }
        return text
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const hint = this.getLocalhostHint(requestOrigin, message)
        errors.push(`Marketplace request failed (${requestUrl}): ${message}${hint}`)
        const fallbackText = await tryDefaultFallback()
        if (fallbackText !== null) {
          return fallbackText
        }
        await this.delayBeforeRetry(attempt)
      }
    }

    const fallbackText = await tryDefaultFallback()
    if (fallbackText !== null) {
      return fallbackText
    }

    const detail = errors.length > 0 ? ` ${errors.slice(0, 6).join(" | ")}` : ""
    throw new Error(`Marketplace request failed for ${route}.${detail}`)
  }

  private getLocalhostHint(requestOrigin: string, message: string): string {
    const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)
    if (!localhostOrigin) {
      return ""
    }
    if (!/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
      return ""
    }
    return " (local backend is unreachable or not serving /api/marketplace/*)"
  }

  private parseStructured(text: string): unknown {
    const trimmed = text.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      try {
        return YAML.parse(trimmed)
      } catch {
        throw new Error("Marketplace response is not valid JSON or YAML")
      }
    }
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        headers: {
          Accept: "application/json, text/yaml, text/plain",
          "User-Agent": "kilo-code-vscode-marketplace",
        },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async delayBeforeRetry(attempt: number): Promise<void> {
    if (attempt >= MARKETPLACE_FETCH_RETRIES) {
      return
    }
    const delayMs = Math.pow(2, attempt - 1) * MARKETPLACE_RETRY_BASE_DELAY_MS
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  private kebabToTitle(value: string): string {
    return value
      .split("-")
      .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
      .join(" ")
  }

  private hasWorkspaceDir(): boolean {
    return !!vscode.workspace.workspaceFolders?.[0]
  }

  private getWorkspaceDir(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      throw new Error("No workspace folder found")
    }
    return folder.uri.fsPath
  }

  private getDefaultGlobalStoragePath(): string {
    const home = os.homedir()
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "kilocode.kilo-code")
      case "win32":
        return path.join(
          process.env.APPDATA || path.join(home, "AppData", "Roaming"),
          "Code",
          "User",
          "globalStorage",
          "kilocode.kilo-code",
        )
      default:
        return path.join(home, ".config", "Code", "User", "globalStorage", "kilocode.kilo-code")
    }
  }

  private getGlobalStoragePath(): string {
    if (this.globalStorageFsPath && this.globalStorageFsPath.trim().length > 0) {
      return this.globalStorageFsPath
    }
    return this.getDefaultGlobalStoragePath()
  }

  private modeFilePath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getWorkspaceDir(), ".kilocodemodes")
    }
    return path.join(this.getGlobalStoragePath(), "settings", "custom_modes.yaml")
  }

  private getProjectKiloDirectoryPath(): string {
    return path.join(this.getWorkspaceDir(), ".kilocode")
  }

  private getGlobalKiloDirectoryPath(): string {
    return path.join(os.homedir(), ".kilocode")
  }

  private mcpFilePath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getProjectKiloDirectoryPath(), "mcp.json")
    }
    return path.join(this.getGlobalStoragePath(), "settings", "mcp_settings.json")
  }

  private modeRulesRootPath(target: "project" | "global"): string {
    if (target === "project") {
      return this.getProjectKiloDirectoryPath()
    }
    return this.getGlobalKiloDirectoryPath()
  }

  private skillsDirPath(target: "project" | "global"): string {
    if (target === "project") {
      return path.join(this.getProjectKiloDirectoryPath(), "skills")
    }
    return path.join(this.getGlobalKiloDirectoryPath(), "skills")
  }

  private async readYamlObject(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = YAML.parse(raw)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private async readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private async readJsonObjectStrict(filePath: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid JSON structure in ${path.basename(filePath)}`)
    }
    return parsed as Record<string, unknown>
  }

  private async getInstalledMetadata(): Promise<MarketplaceInstalledMetadata> {
    const metadata: MarketplaceInstalledMetadata = { project: {}, global: {} }

    if (this.hasWorkspaceDir()) {
      await this.collectModeMetadata("project", metadata.project)
      await this.collectMcpMetadata("project", metadata.project)
      await this.collectSkillsMetadata("project", metadata.project)
    }

    await this.collectModeMetadata("global", metadata.global)
    await this.collectMcpMetadata("global", metadata.global)
    await this.collectSkillsMetadata("global", metadata.global)

    return metadata
  }

  private async collectModeMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const filePath = this.modeFilePath(target)
    const parsed = await this.readYamlObject(filePath)
    const modes = parsed?.customModes
    if (!Array.isArray(modes)) {
      return
    }
    for (const mode of modes) {
      if (!mode || typeof mode !== "object") {
        continue
      }
      const slug = (mode as Record<string, unknown>).slug
      if (typeof slug === "string" && slug.length > 0) {
        output[slug] = { type: "mode" }
      }
    }
  }

  private aliasInstalledModesToCatalogIds(items: MarketplaceItem[], metadata: MarketplaceInstalledMetadata): void {
    const modeItems = items.filter((item): item is Extract<MarketplaceItem, { type: "mode" }> => item.type === "mode")
    for (const item of modeItems) {
      const slug = this.customModeStore.tryExtractSlug(item)
      if (!slug || slug === item.id) {
        continue
      }
      const projectEntry = metadata.project[slug]
      if (projectEntry && !metadata.project[item.id]) {
        metadata.project[item.id] = projectEntry
      }
      const globalEntry = metadata.global[slug]
      if (globalEntry && !metadata.global[item.id]) {
        metadata.global[item.id] = globalEntry
      }
    }
  }

  private async collectMcpMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const filePath = this.mcpFilePath(target)
    const parsed = await this.readJsonObject(filePath)
    const servers = parsed?.mcpServers
    if (!servers || typeof servers !== "object") {
      return
    }
    for (const key of Object.keys(servers)) {
      output[key] = { type: "mcp" }
    }
  }

  private async collectSkillsMetadata(
    target: "project" | "global",
    output: Record<string, { type: MarketplaceItemType }>,
  ): Promise<void> {
    const dir = this.skillsDirPath(target)
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const skillMd = path.join(dir, entry, "SKILL.md")
      try {
        await fs.access(skillMd)
        output[entry] = { type: "skill" }
      } catch {
        // Ignore non-skill entries.
      }
    }
  }

  private async installMode(item: Extract<MarketplaceItem, { type: "mode" }>, target: "project" | "global"): Promise<void> {
    await this.customModeStore.upsertFromMarketplace(item, {
      modeFilePath: this.modeFilePath(target),
      rulesRootPath: this.modeRulesRootPath(target),
    })
  }

  private async removeMode(item: Extract<MarketplaceItem, { type: "mode" }>, target: "project" | "global"): Promise<void> {
    await this.customModeStore.removeFromMarketplace(item, {
      modeFilePath: this.modeFilePath(target),
      rulesRootPath: this.modeRulesRootPath(target),
    })
  }

  private async installMcp(item: Extract<MarketplaceItem, { type: "mcp" }>, options: MarketplaceInstallOptions): Promise<void> {
    const filePath = this.mcpFilePath(options.target)
    const mcpId = this.sanitizeMarketplaceItemId(item.id, "MCP server")
    const selectedIndex = typeof options.selectedIndex === "number" ? options.selectedIndex : undefined
    let contentToUse = this.resolveMcpInstallContent(item.content, selectedIndex)

    const parameters = { ...(options.parameters ?? {}) }
    const methodParameters = Array.isArray(item.content)
      ? (item.content[selectedIndex ?? 0]?.parameters ?? item.content[0]?.parameters ?? [])
      : []
    const allParameters = [...(item.parameters ?? []), ...(methodParameters ?? [])]
    for (const param of allParameters) {
      const value = parameters[param.key]
      if (value !== undefined) {
        contentToUse = this.replaceTemplateToken(contentToUse, param.key, this.escapeForJsonTemplate(String(value)))
      }
    }

    if (!contentToUse.trim()) {
      throw new Error(`MCP item "${item.id}" has empty server configuration content`)
    }

    const parsedServer = this.validateMcpServerConfig(this.parseStructured(contentToUse))

    let existing: Record<string, unknown> = {}
    try {
      existing = await this.readJsonObjectStrict(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        throw new Error(
          `Cannot install MCP server: ${path.basename(filePath)} contains invalid JSON. Fix the file before installing.`,
        )
      }
    }
    const existingServers =
      existing.mcpServers && typeof existing.mcpServers === "object" ? (existing.mcpServers as Record<string, unknown>) : {}
    const nextServers = { ...existingServers, [mcpId]: parsedServer }

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2), "utf-8")
  }

  private async removeMcp(item: Extract<MarketplaceItem, { type: "mcp" }>, target: "project" | "global"): Promise<void> {
    const mcpId = this.sanitizeMarketplaceItemId(item.id, "MCP server")
    const filePath = this.mcpFilePath(target)
    const existing = await this.readJsonObject(filePath)
    if (!existing) {
      return
    }
    const existingServers =
      existing.mcpServers && typeof existing.mcpServers === "object" ? (existing.mcpServers as Record<string, unknown>) : {}
    if (!(mcpId in existingServers)) {
      return
    }
    const nextServers = { ...existingServers }
    delete nextServers[mcpId]

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2), "utf-8")
  }

  private resolveMcpInstallContent(content: string | MarketplaceMcpInstallMethod[], selectedIndex?: number): string {
    if (typeof content === "string") {
      return content
    }
    const index = selectedIndex ?? 0
    const method = content[index] ?? content[0]
    if (!method || typeof method.content !== "string") {
      throw new Error("No valid MCP installation method found")
    }
    return method.content
  }

  private async installSkill(item: MarketplaceSkillItem, target: "project" | "global"): Promise<void> {
    const skillId = this.sanitizeMarketplaceItemId(item.id, "skill")
    if (typeof item.content !== "string" || item.content.trim().length === 0) {
      throw new Error("Skill item missing tarball URL")
    }
    const tarballUrl = item.content.trim()
    const parsedTarballUrl = new URL(tarballUrl)
    if (parsedTarballUrl.protocol !== "https:" && parsedTarballUrl.protocol !== "http:") {
      throw new Error(`Unsupported URL scheme for skill tarball: ${parsedTarballUrl.protocol}`)
    }

    let response: Response
    try {
      response = await fetch(tarballUrl, {
        headers: {
          Accept: "application/octet-stream, application/x-gzip, */*",
          "User-Agent": "kilo-code-vscode-marketplace",
        },
        signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to download skill tarball: ${message}`)
    }
    if (!response.ok) {
      throw new Error(`Failed to download skill tarball: ${response.statusText || response.status}`)
    }
    const contentLength = response.headers.get("content-length")
    if (contentLength) {
      const parsedLength = Number.parseInt(contentLength, 10)
      if (Number.isFinite(parsedLength) && parsedLength > MAX_SKILL_TARBALL_BYTES) {
        throw new Error(`Skill tarball is too large: ${parsedLength} bytes (max ${MAX_SKILL_TARBALL_BYTES})`)
      }
    }

    const destination = path.join(this.skillsDirPath(target), skillId)
    const tmpFile = path.join(os.tmpdir(), `kilo-skill-${skillId}-${Date.now()}.tar.gz`)

    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.mkdir(destination, { recursive: true })

    try {
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.byteLength > MAX_SKILL_TARBALL_BYTES) {
        throw new Error(`Skill tarball is too large: ${bytes.byteLength} bytes (max ${MAX_SKILL_TARBALL_BYTES})`)
      }
      await fs.writeFile(tmpFile, bytes)
      await pipeline(
        createReadStream(tmpFile),
        zlib.createGunzip(),
        tarFs.extract(destination, {
          strip: 1,
          map: (header) => {
            this.assertSafeTarHeader(header as { name?: string; linkname?: string })
            return header
          },
        }),
      )
      await fs.access(path.join(destination, "SKILL.md"))
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {})
    }
  }

  private async removeSkill(item: MarketplaceSkillItem, target: "project" | "global"): Promise<void> {
    const skillId = this.sanitizeMarketplaceItemId(item.id, "skill")
    const destination = path.join(this.skillsDirPath(target), skillId)
    await fs.rm(destination, { recursive: true, force: true }).catch((error) => {
      console.debug("[Kilo New] Marketplace: removeSkill ignored rm error", { item: item.id, error })
    })
  }

  private replaceTemplateToken(content: string, key: string, value: string): string {
    return content.split(`{{${key}}}`).join(value)
  }

  private escapeForJsonTemplate(value: string): string {
    return JSON.stringify(value).slice(1, -1)
  }

  private sanitizeMarketplaceItemId(rawId: string, kind: string): string {
    const id = rawId.trim()
    if (!SAFE_MARKETPLACE_ID_PATTERN.test(id) || UNSAFE_OBJECT_KEYS.has(id)) {
      throw new Error(`Marketplace ${kind} id "${rawId}" is invalid`)
    }
    return id
  }

  private validateMcpServerConfig(input: unknown): Record<string, unknown> {
    if (!this.isObjectRecord(input)) {
      throw new Error("MCP server configuration must be a JSON object")
    }
    const normalized: Record<string, unknown> = { ...input }

    const command = normalized.command
    const args = normalized.args
    if (Array.isArray(command)) {
      if (command.length === 0 || command.some((part) => typeof part !== "string")) {
        throw new Error("MCP server configuration field \"command\" array must contain strings")
      }
      const [commandName, ...commandArgs] = command
      if (!commandName || commandName.trim().length === 0) {
        throw new Error("MCP server configuration field \"command\" cannot be empty")
      }

      if (args !== undefined) {
        if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
          throw new Error("MCP server configuration field \"args\" must be an array of strings")
        }
        normalized.args = [...commandArgs, ...args]
      } else {
        normalized.args = commandArgs
      }
      normalized.command = commandName
    } else if (command !== undefined && typeof command !== "string") {
      throw new Error("MCP server configuration field \"command\" must be a string or string array")
    }

    if (normalized.args !== undefined) {
      const normalizedArgs = normalized.args
      if (!Array.isArray(normalizedArgs) || normalizedArgs.some((arg) => typeof arg !== "string")) {
        throw new Error("MCP server configuration field \"args\" must be an array of strings")
      }
    }

    const env = normalized.env
    if (env !== undefined && (!this.isObjectRecord(env) || Object.values(env).some((value) => typeof value !== "string"))) {
      throw new Error("MCP server configuration field \"env\" must be an object with string values")
    }

    this.assertNoUnsafeObjectKeys(normalized, "MCP server configuration")
    return normalized
  }

  private assertNoUnsafeObjectKeys(value: unknown, context: string): void {
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.assertNoUnsafeObjectKeys(entry, context)
      }
      return
    }
    if (!this.isObjectRecord(value)) {
      return
    }

    for (const [key, entry] of Object.entries(value)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) {
        throw new Error(`${context} contains unsafe key: ${key}`)
      }
      this.assertNoUnsafeObjectKeys(entry, context)
    }
  }

  private assertSafeTarHeader(header: { name?: string; linkname?: string }): void {
    if (typeof header.name !== "string" || header.name.length === 0) {
      throw new Error("Tar entry is missing a valid name")
    }
    this.assertSafeTarPath(header.name, "tar entry path")
    if (typeof header.linkname === "string" && header.linkname.length > 0) {
      this.assertSafeTarPath(header.linkname, "tar link path")
    }
  }

  private assertSafeTarPath(rawPath: string, label: string): void {
    const normalized = rawPath.replace(/\\/g, "/")
    if (normalized.includes("\0")) {
      throw new Error(`Unsafe ${label}: ${rawPath}`)
    }
    this.assertSafeTarPathAfterStrip(normalized, rawPath, label)

    const stripped = normalized.split("/").slice(1).join("/")
    if (stripped.length > 0) {
      this.assertSafeTarPathAfterStrip(stripped, rawPath, label)
    }
  }

  private assertSafeTarPathAfterStrip(candidatePath: string, rawPath: string, label: string): void {
    if (candidatePath.startsWith("/") || /^[A-Za-z]:\//.test(candidatePath)) {
      throw new Error(`Unsafe ${label}: ${rawPath}`)
    }
    const normalized = path.posix.normalize(candidatePath)
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new Error(`Unsafe ${label}: ${rawPath}`)
    }
  }

  private isObjectRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }
}

function getApiUrlFromBase(baseUrl: string, pathname: string): string {
  return new URL(pathname, baseUrl).toString()
}
