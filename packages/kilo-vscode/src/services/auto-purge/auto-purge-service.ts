import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Disposable } from "vscode"
import { logger } from "../../utils/logger"

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_ATTACHMENT_TMP_DIR = path.join(os.tmpdir(), "kilo-code-vscode-attachments")

export interface AutoPurgeServiceOptions {
  tempAttachmentsDir?: string
  retentionMs?: number
  intervalMs?: number
}

export class AutoPurgeService implements Disposable {
  private readonly tempAttachmentsDir: string
  private readonly retentionMs: number
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | null = null

  constructor(options: AutoPurgeServiceOptions = {}) {
    this.tempAttachmentsDir = options.tempAttachmentsDir ?? DEFAULT_ATTACHMENT_TMP_DIR
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
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
}
