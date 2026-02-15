import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Disposable, ExtensionContext } from "vscode"
import { logger } from "../../utils/logger"

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_ATTACHMENT_TMP_DIR = path.join(os.tmpdir(), "kilo-code-vscode-attachments")
const SESSION_CACHE_KEY_PREFIX = "kilo-code.new.session-history-cache.v1."
const AGENT_MANAGER_STATE_KEY_PREFIX = "kilo.agentManager.state."

export interface AutoPurgeServiceOptions {
  tempAttachmentsDir?: string
  retentionMs?: number
  intervalMs?: number
  extensionContext?: ExtensionContext
}

export class AutoPurgeService implements Disposable {
  private readonly tempAttachmentsDir: string
  private readonly retentionMs: number
  private readonly intervalMs: number
  private readonly extensionContext: ExtensionContext | null
  private timer: NodeJS.Timeout | null = null

  constructor(options: AutoPurgeServiceOptions = {}) {
    this.tempAttachmentsDir = options.tempAttachmentsDir ?? DEFAULT_ATTACHMENT_TMP_DIR
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.extensionContext = options.extensionContext ?? null
  }

  start(): void {
    if (this.timer) {
      return
    }

    void this.runNow()
    this.timer = setInterval(() => {
      void this.runNow()
    }, this.intervalMs)
  }

  async runNow(): Promise<void> {
    const now = Date.now()
    await this.purgeDirectory(this.tempAttachmentsDir, now).catch((error) => {
      logger.debug("[Kilo New] AutoPurge: failed to purge temp attachment directory", { error })
    })
    if (this.extensionContext) {
      await this.purgeGlobalState(this.extensionContext, now).catch((error) => {
        logger.debug("[Kilo New] AutoPurge: failed to purge stale global state", { error })
      })
    }
  }

  dispose(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  private async purgeDirectory(dirPath: string, nowMs: number): Promise<boolean> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return false
    }

    let hasRemaining = false
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const childHasRemaining = await this.purgeDirectory(entryPath, nowMs)
        if (!childHasRemaining) {
          await fs.rmdir(entryPath).catch(() => {})
        } else {
          hasRemaining = true
        }
        continue
      }

      if (!entry.isFile()) {
        hasRemaining = true
        continue
      }

      const stale = await this.isStale(entryPath, nowMs)
      if (!stale) {
        hasRemaining = true
        continue
      }

      await fs.rm(entryPath, { force: true }).catch((error) => {
        hasRemaining = true
        logger.debug("[Kilo New] AutoPurge: failed to remove stale temp file", { entryPath, error })
      })
    }

    return hasRemaining
  }

  private async isStale(filePath: string, nowMs: number): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath)
      return nowMs - stats.mtimeMs > this.retentionMs
    } catch {
      return false
    }
  }

  private async purgeGlobalState(context: ExtensionContext, nowMs: number): Promise<void> {
    const keys = context.globalState.keys()
    for (const key of keys) {
      if (key.startsWith(SESSION_CACHE_KEY_PREFIX)) {
        const raw = context.globalState.get<unknown>(key)
        if (this.shouldPurgeSessionCache(raw, nowMs)) {
          await context.globalState.update(key, undefined)
        }
        continue
      }

      if (key.startsWith(AGENT_MANAGER_STATE_KEY_PREFIX)) {
        const raw = context.globalState.get<unknown>(key)
        if (this.shouldPurgeAgentManagerState(raw, nowMs)) {
          await context.globalState.update(key, undefined)
        }
      }
    }
  }

  private shouldPurgeSessionCache(raw: unknown, nowMs: number): boolean {
    if (!Array.isArray(raw) || raw.length === 0) {
      return true
    }

    let latestUpdatedAt = 0
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue
      }
      const updatedAt = (entry as { updatedAt?: unknown }).updatedAt
      if (typeof updatedAt !== "string") {
        continue
      }
      const timestamp = Date.parse(updatedAt)
      if (Number.isFinite(timestamp) && timestamp > latestUpdatedAt) {
        latestUpdatedAt = timestamp
      }
    }

    if (latestUpdatedAt === 0) {
      return true
    }
    return nowMs - latestUpdatedAt > this.retentionMs
  }

  private shouldPurgeAgentManagerState(raw: unknown, nowMs: number): boolean {
    if (!raw || typeof raw !== "object") {
      return true
    }

    const state = raw as { worktrees?: unknown; sessionMeta?: unknown }
    const worktrees = Array.isArray(state.worktrees) ? state.worktrees : []
    const hasSessionMeta = !!state.sessionMeta && typeof state.sessionMeta === "object" && Object.keys(state.sessionMeta).length > 0

    if (worktrees.length === 0 && !hasSessionMeta) {
      return true
    }

    let latestCreatedAt = 0
    for (const entry of worktrees) {
      if (!entry || typeof entry !== "object") {
        continue
      }
      const createdAt = (entry as { createdAt?: unknown }).createdAt
      if (typeof createdAt !== "string") {
        continue
      }
      const timestamp = Date.parse(createdAt)
      if (Number.isFinite(timestamp) && timestamp > latestCreatedAt) {
        latestCreatedAt = timestamp
      }
    }

    if (latestCreatedAt === 0) {
      return false
    }
    // Keep agent-manager history longer than temp files to preserve context.
    return nowMs - latestCreatedAt > this.retentionMs * 4
  }
}
