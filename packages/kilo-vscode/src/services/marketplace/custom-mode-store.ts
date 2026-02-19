import fs from "node:fs/promises"
import path from "node:path"
import * as YAML from "yaml"
import type { MarketplaceModeItem } from "./types"

type RuleFile = {
  relativePath: string
  content: string
}

type ParsedMarketplaceMode = {
  slug: string
  modeRecord: Record<string, unknown>
  rulesFiles: RuleFile[]
}

const SAFE_MODE_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])

class WriteQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export class CustomModeStore {
  private readonly writes = new WriteQueue()

  tryExtractSlug(item: MarketplaceModeItem): string | undefined {
    try {
      return this.parseMarketplaceMode(item).slug
    } catch {
      return undefined
    }
  }

  async upsertFromMarketplace(
    item: MarketplaceModeItem,
    options: { modeFilePath: string; rulesRootPath: string },
  ): Promise<void> {
    const parsedMode = this.parseMarketplaceMode(item)
    await this.writes.enqueue(async () => {
      let fileData: Record<string, unknown> = {}
      try {
        fileData = await this.readModeFileStrict(options.modeFilePath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "ENOENT") {
          throw new Error(
            `Cannot install mode: ${path.basename(options.modeFilePath)} contains invalid YAML. Fix the file before installing.`,
          )
        }
      }

      const existingModes = Array.isArray(fileData.customModes) ? fileData.customModes : []
      const nextModes = existingModes.filter((mode) => {
        if (!isRecord(mode)) {
          return true
        }
        return mode.slug !== parsedMode.slug
      })
      nextModes.push(parsedMode.modeRecord)

      await fs.mkdir(path.dirname(options.modeFilePath), { recursive: true })
      await fs.writeFile(options.modeFilePath, YAML.stringify({ ...fileData, customModes: nextModes }), "utf-8")
      await this.syncRulesFolder(options.rulesRootPath, parsedMode.slug, parsedMode.rulesFiles)
    })
  }

  async removeFromMarketplace(
    item: MarketplaceModeItem,
    options: { modeFilePath: string; rulesRootPath: string },
  ): Promise<void> {
    const parsedMode = this.parseMarketplaceMode(item)
    await this.writes.enqueue(async () => {
      const fileData = await this.readModeFile(options.modeFilePath)
      if (fileData) {
        const existingModes = Array.isArray(fileData.customModes) ? fileData.customModes : []
        const nextModes = existingModes.filter((mode) => {
          if (!isRecord(mode)) {
            return true
          }
          return mode.slug !== parsedMode.slug
        })
        await fs.mkdir(path.dirname(options.modeFilePath), { recursive: true })
        await fs.writeFile(options.modeFilePath, YAML.stringify({ ...fileData, customModes: nextModes }), "utf-8")
      }

      await fs.rm(path.join(options.rulesRootPath, `rules-${parsedMode.slug}`), { recursive: true, force: true })
    })
  }

  private parseMarketplaceMode(item: MarketplaceModeItem): ParsedMarketplaceMode {
    const parsed = YAML.parse(item.content)
    if (!isRecord(parsed)) {
      throw new Error("Invalid mode content")
    }

    const customModes = parsed.customModes
    let candidate: Record<string, unknown>
    if (Array.isArray(customModes)) {
      const embeddedModes = customModes.filter(isRecord)
      if (embeddedModes.length !== 1) {
        throw new Error("Invalid mode content: expected exactly one mode in customModes")
      }
      candidate = { ...embeddedModes[0] }
    } else {
      candidate = { ...parsed }
    }

    const rawSlug = typeof candidate.slug === "string" && candidate.slug.trim().length > 0 ? candidate.slug : item.id
    const slug = this.sanitizeModeSlug(rawSlug)
    const rulesFiles = this.extractRuleFiles(candidate.rulesFiles)
    delete candidate.rulesFiles
    candidate.slug = slug

    return {
      slug,
      modeRecord: candidate,
      rulesFiles,
    }
  }

  private extractRuleFiles(input: unknown): RuleFile[] {
    if (!Array.isArray(input)) {
      return []
    }

    const output: RuleFile[] = []
    for (const entry of input) {
      if (!isRecord(entry)) {
        continue
      }
      const rawPath = entry.relativePath
      const rawContent = entry.content
      if (typeof rawPath !== "string" || typeof rawContent !== "string") {
        continue
      }
      const relativePath = this.normalizeRelativeRulePath(rawPath)
      output.push({
        relativePath,
        content: rawContent,
      })
    }
    return output
  }

  private sanitizeModeSlug(rawSlug: string): string {
    const slug = rawSlug.trim()
    if (!SAFE_MODE_SLUG_PATTERN.test(slug) || UNSAFE_OBJECT_KEYS.has(slug)) {
      throw new Error(`Invalid mode slug: ${rawSlug}`)
    }
    return slug
  }

  private normalizeRelativeRulePath(rawPath: string): string {
    const normalizedInput = rawPath.replace(/\\/g, "/")
    const oldFormatMatch = normalizedInput.match(/^rules-[^/]+\/+/)
    const stripped = oldFormatMatch ? normalizedInput.slice(oldFormatMatch[0].length) : normalizedInput
    const normalizedPath = path.posix.normalize(stripped)
    if (
      normalizedPath.length === 0 ||
      normalizedPath.startsWith("/") ||
      normalizedPath === "." ||
      normalizedPath.split("/").some((part) => part === "..")
    ) {
      throw new Error(`Invalid rules file path: ${rawPath}`)
    }
    return normalizedPath
  }

  private async syncRulesFolder(rulesRootPath: string, slug: string, rulesFiles: RuleFile[]): Promise<void> {
    const rulesFolderPath = path.join(rulesRootPath, `rules-${slug}`)
    await fs.rm(rulesFolderPath, { recursive: true, force: true })
    if (rulesFiles.length === 0) {
      return
    }

    for (const ruleFile of rulesFiles) {
      const targetPath = path.join(rulesFolderPath, ruleFile.relativePath)
      const normalizedTarget = path.normalize(targetPath)
      const normalizedBase = path.normalize(rulesFolderPath)
      if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(normalizedBase + path.sep)) {
        throw new Error(`Invalid rules file path: ${ruleFile.relativePath}`)
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, ruleFile.content, "utf-8")
    }
  }

  private async readModeFile(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8")
      const parsed = YAML.parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  private async readModeFileStrict(filePath: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(filePath, "utf-8")
    const parsed = YAML.parse(raw)
    if (!isRecord(parsed)) {
      throw new Error(`Invalid YAML structure in ${path.basename(filePath)}`)
    }
    return parsed
  }
}
