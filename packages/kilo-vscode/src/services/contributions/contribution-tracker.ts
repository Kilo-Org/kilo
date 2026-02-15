import type * as vscode from "vscode"
import path from "node:path"
import { diffLines } from "diff"
import { logger } from "../../utils/logger"

const STORAGE_KEY_PREFIX = "contributionTracker.records.v1"
const MAX_RECORDS = 2000

type DiffTarget = {
  path?: string
  before: string
  after: string
}

type ToolPartState = {
  status?: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

type ToolPartPayload = {
  type?: string
  id?: string
  messageID?: string
  tool?: string
  state?: ToolPartState
}

export interface ContributionRecord {
  id: string
  sessionID: string
  messageID?: string
  partID?: string
  tool: string
  filePath?: string
  additions: number
  deletions: number
  timestamp: string
}

function toRecordKey(workspaceDir: string): string {
  return `${STORAGE_KEY_PREFIX}:${workspaceDir}`
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function lineCount(value: string): number {
  const split = value.split("\n")
  if (split.length > 0 && split[split.length - 1] === "") {
    split.pop()
  }
  return split.length
}

function calculateStats(before: string, after: string): { additions: number; deletions: number } {
  const chunks = diffLines(before, after)
  let additions = 0
  let deletions = 0

  for (const chunk of chunks) {
    const count = typeof chunk.count === "number" ? chunk.count : lineCount(chunk.value ?? "")
    if (chunk.added) {
      additions += count
      continue
    }
    if (chunk.removed) {
      deletions += count
    }
  }

  return { additions, deletions }
}

function pushTarget(targets: DiffTarget[], pathValue: unknown, before: unknown, after: unknown): void {
  if (typeof before !== "string" || typeof after !== "string") {
    return
  }
  if (before === after) {
    return
  }
  targets.push({
    path: normalizePath(pathValue),
    before,
    after,
  })
}

function extractDiffTargets(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown>): DiffTarget[] {
  const targets: DiffTarget[] = []
  const filediff = metadata.filediff
  const filediffObject = filediff && typeof filediff === "object" ? (filediff as Record<string, unknown>) : undefined

  if (tool === "edit" || tool === "fast_edit_file") {
    pushTarget(
      targets,
      filediffObject?.path ?? filediffObject?.file ?? input.filePath,
      filediffObject?.before ?? input.oldString ?? "",
      filediffObject?.after ?? input.newString ?? "",
    )
    return targets
  }

  if (tool === "write") {
    pushTarget(
      targets,
      filediffObject?.path ?? filediffObject?.file ?? input.filePath,
      filediffObject?.before ?? "",
      filediffObject?.after ?? input.content ?? "",
    )
    return targets
  }

  if (tool === "apply_patch") {
    const files = metadata.files
    if (!Array.isArray(files)) {
      return targets
    }
    for (const entry of files) {
      if (!entry || typeof entry !== "object") {
        continue
      }
      const file = entry as Record<string, unknown>
      pushTarget(
        targets,
        file.filePath ?? file.path ?? file.relativePath,
        file.before ?? "",
        file.after ?? "",
      )
    }
  }

  return targets
}

export class ContributionTracker {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(workspaceDir: string, limit = 200): ContributionRecord[] {
    const raw = this.context.workspaceState.get<ContributionRecord[]>(toRecordKey(workspaceDir), [])
    return Array.isArray(raw) ? raw.slice(-Math.max(1, limit)).reverse() : []
  }

  async clear(workspaceDir: string): Promise<void> {
    await this.context.workspaceState.update(toRecordKey(workspaceDir), [])
  }

  recordFromPart(sessionID: string, part: unknown, workspaceDir: string): void {
    const payload = part as ToolPartPayload
    if (payload?.type !== "tool") {
      return
    }
    const tool = typeof payload.tool === "string" ? payload.tool : ""
    if (!["edit", "write", "apply_patch", "fast_edit_file"].includes(tool)) {
      return
    }

    const state = payload.state ?? {}
    if (state.status !== "completed") {
      return
    }

    const input = state.input ?? {}
    const metadata = state.metadata ?? {}
    const targets = extractDiffTargets(tool, input, metadata)
    if (targets.length === 0) {
      return
    }

    const now = new Date().toISOString()
    const existing = this.context.workspaceState.get<ContributionRecord[]>(toRecordKey(workspaceDir), [])
    const records = Array.isArray(existing) ? [...existing] : []
    const existingIds = new Set(records.map((record) => record.id))

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]
      const filePath = target.path
      const dedupeBase = [sessionID, payload.messageID ?? "", payload.id ?? "", tool, filePath ?? `file-${index}`].join(":")
      const id = dedupeBase
      if (existingIds.has(id)) {
        continue
      }

      const stats = calculateStats(target.before, target.after)
      records.push({
        id,
        sessionID,
        messageID: payload.messageID,
        partID: payload.id,
        tool,
        filePath,
        additions: stats.additions,
        deletions: stats.deletions,
        timestamp: now,
      })
      existingIds.add(id)
    }

    const trimmed = records.slice(-MAX_RECORDS)
    void this.context.workspaceState.update(toRecordKey(workspaceDir), trimmed).then(
      undefined,
      (error: unknown) => {
        logger.error("[Kilo New] ContributionTracker: failed to persist records", error)
      },
    )
  }
}

export function resolveContributionFilePath(workspaceDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath)
}
