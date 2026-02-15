import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import * as vscode from "vscode"
import { logger } from "./utils/logger"
import { captureTelemetryEvent } from "./utils/telemetry"
import type {
  AgentInfo,
  KiloConnectionService,
  PermissionRequest,
  RemoteSessionInfo,
  SessionInfo,
} from "./services/cli-backend"

const execFile = promisify(execFileCb)

type OpenSessionCallback = (sessionID: string, directory?: string) => void

type SessionRunStatus = "idle" | "busy" | "retry" | "unknown"

type AgentManagerWebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "createSession"; prompt?: string; agent?: string; parallel?: boolean; branch?: string }
  | { type: "resumeRemoteSession"; sessionID?: string; text?: string }
  | { type: "sendSessionMessage"; sessionID?: string; text?: string }
  | { type: "respondPermission"; sessionID?: string; permissionID?: string; response?: "once" | "always" | "reject" }
  | { type: "abortSession"; sessionID?: string }
  | { type: "deleteSession"; sessionID?: string }
  | { type: "bulkAbort"; sessionIDs?: string[] }
  | { type: "bulkDelete"; sessionIDs?: string[] }
  | { type: "openSession"; sessionID?: string }
  | { type: "openWorktree"; sessionID?: string }
  | { type: "removeWorktree"; sessionID?: string }

type AgentManagerSessionRow = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  status: SessionRunStatus
  directory: string
  directoryLabel: string
  source: "local" | "cloud"
  isWorktree: boolean
  worktreePath?: string
  branch?: string
  pendingApprovalCount: number
  nextPendingApproval?: {
    id: string
    permission: string
    patterns: string[]
  }
  canOpenInChat: boolean
  canSendMessage: boolean
}

type WorktreeRecord = {
  path: string
  branch: string
  createdAt: string
}

type SessionMeta = {
  directory: string
  worktreePath?: string
  branch?: string
}

type PersistedState = {
  worktrees: WorktreeRecord[]
  sessionMeta: Record<string, SessionMeta>
}

type AgentManagerAction =
  | "refresh"
  | "createSession"
  | "resumeRemoteSession"
  | "sendSessionMessage"
  | "respondPermission"
  | "abortSession"
  | "deleteSession"
  | "bulkAbort"
  | "bulkDelete"
  | "openSession"
  | "openWorktree"
  | "removeWorktree"

type AgentManagerExtensionToWebviewMessage =
  | {
      type: "agentManagerData"
      sessions: AgentManagerSessionRow[]
      agents: Array<{ name: string; description?: string }>
      defaultAgent: string
      workspaceDir: string
      errors?: string[]
    }
  | {
      type: "agentManagerActionResult"
      action: AgentManagerAction
      success: boolean
      message?: string
      sessionID?: string
    }
  | {
      type: "agentManagerSessionStatus"
      sessionID: string
      status: SessionRunStatus
    }

/**
 * AgentManagerProvider manages the Agent Manager webview panel.
 * It opens in the editor area and orchestrates multiple sessions/worktrees.
 */
export class AgentManagerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"

  private panel: vscode.WebviewPanel | undefined
  private panelDisposables: vscode.Disposable[] = []
  private readonly sessionDirectoryById = new Map<string, string>()
  private readonly sessionStatusById = new Map<string, SessionRunStatus>()
  private readonly remoteSessionById = new Map<string, RemoteSessionInfo>()
  private readonly pendingPermissionsBySession = new Map<string, PermissionRequest[]>()
  private refreshTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly onOpenSession?: OpenSessionCallback,
  ) {}

  /**
   * Open or focus the Agent Manager panel.
   */
  public openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    this.panel = vscode.window.createWebviewPanel(AgentManagerProvider.viewType, "Agent Manager", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })
    captureTelemetryEvent("Agent Manager Opened")

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview)

    this.panel.webview.onDidReceiveMessage(
      (message: AgentManagerWebviewToExtensionMessage) => {
        void this.handleWebviewMessage(message)
      },
      null,
      this.panelDisposables,
    )

    const unsubscribeEvents = this.connectionService.onEvent((event) => {
      switch (event.type) {
        case "session.status": {
          const previousStatus = this.sessionStatusById.get(event.properties.sessionID)
          const statusType = event.properties.status.type
          const status: SessionRunStatus = statusType === "busy" || statusType === "retry" ? statusType : "idle"
          if ((previousStatus === "busy" || previousStatus === "retry") && status === "idle") {
            captureTelemetryEvent("Agent Manager Session Completed", {
              sessionId: event.properties.sessionID,
              useWorktree: this.isWorktreeSession(event.properties.sessionID),
            })
          }
          this.sessionStatusById.set(event.properties.sessionID, status)
          this.postMessage({ type: "agentManagerSessionStatus", sessionID: event.properties.sessionID, status })
          break
        }
        case "session.idle": {
          const previousStatus = this.sessionStatusById.get(event.properties.sessionID)
          if (previousStatus === "busy" || previousStatus === "retry") {
            captureTelemetryEvent("Agent Manager Session Completed", {
              sessionId: event.properties.sessionID,
              useWorktree: this.isWorktreeSession(event.properties.sessionID),
            })
          }
          this.sessionStatusById.set(event.properties.sessionID, "idle")
          this.postMessage({ type: "agentManagerSessionStatus", sessionID: event.properties.sessionID, status: "idle" })
          break
        }
        case "session.created":
        case "session.updated":
          this.scheduleRefreshData()
          break
        case "permission.asked":
          this.trackPendingPermission(event.properties)
          this.scheduleRefreshData(80)
          break
        case "permission.replied":
          this.clearPendingPermission(event.properties.sessionID, event.properties.requestID)
          this.scheduleRefreshData(80)
          break
      }
    })

    this.panelDisposables.push({ dispose: unsubscribeEvents })

    this.panel.onDidDispose(
      () => {
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer)
          this.refreshTimer = undefined
        }
        this.panelDisposables.forEach((d) => d.dispose())
        this.panelDisposables = []
        this.panel = undefined
      },
      null,
      this.panelDisposables,
    )
  }

  public dispose(): void {
    this.panel?.dispose()
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    this.panelDisposables.forEach((d) => d.dispose())
    this.panelDisposables = []
  }

  private async handleWebviewMessage(message: AgentManagerWebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        await this.refreshData()
        return
      case "createSession":
        await this.createSession(message.prompt, message.agent, message.parallel, message.branch)
        return
      case "resumeRemoteSession":
        await this.resumeRemoteSession(message.sessionID, message.text)
        return
      case "sendSessionMessage":
        await this.sendSessionMessage(message.sessionID, message.text)
        return
      case "respondPermission":
        await this.respondPermission(message.sessionID, message.permissionID, message.response)
        return
      case "abortSession":
        await this.abortSession(message.sessionID)
        return
      case "deleteSession":
        await this.deleteSession(message.sessionID)
        return
      case "bulkAbort":
        await this.bulkAbort(message.sessionIDs)
        return
      case "bulkDelete":
        await this.bulkDelete(message.sessionIDs)
        return
      case "openSession":
        await this.openSessionInMainUI(message.sessionID)
        return
      case "openWorktree":
        await this.openWorktree(message.sessionID)
        return
      case "removeWorktree":
        await this.removeWorktree(message.sessionID)
        return
      default:
        return
    }
  }

  private scheduleRefreshData(delayMs = 400): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refreshData()
    }, delayMs)
  }

  private trackPendingPermission(request: PermissionRequest): void {
    const existing = this.pendingPermissionsBySession.get(request.sessionID) ?? []
    if (existing.some((entry) => entry.id === request.id)) {
      return
    }
    this.pendingPermissionsBySession.set(request.sessionID, [...existing, request])
  }

  private clearPendingPermission(sessionID: string, requestID: string): void {
    const existing = this.pendingPermissionsBySession.get(sessionID)
    if (!existing || existing.length === 0) {
      return
    }
    const remaining = existing.filter((entry) => entry.id !== requestID)
    if (remaining.length === 0) {
      this.pendingPermissionsBySession.delete(sessionID)
      return
    }
    this.pendingPermissionsBySession.set(sessionID, remaining)
  }

  private getPendingPermissionSummary(sessionID: string): {
    pendingApprovalCount: number
    nextPendingApproval?: { id: string; permission: string; patterns: string[] }
  } {
    const pending = this.pendingPermissionsBySession.get(sessionID) ?? []
    const next = pending[0]
    return {
      pendingApprovalCount: pending.length,
      ...(next
        ? {
            nextPendingApproval: {
              id: next.id,
              permission: next.permission,
              patterns: Array.isArray(next.patterns) ? next.patterns : [],
            },
          }
        : {}),
    }
  }

  private async refreshData(): Promise<void> {
    const workspaceDir = this.getWorkspaceDirectory()
    const errors: string[] = []

    try {
      const client = await this.getClient(workspaceDir)
      const state = await this.loadState(workspaceDir)
      const worktreeRecords = await this.filterExistingWorktrees(state.worktrees)

      if (worktreeRecords.length !== state.worktrees.length) {
        state.worktrees = worktreeRecords
        await this.saveState(workspaceDir, state)
      }

      const directories = [workspaceDir, ...worktreeRecords.map((worktree) => worktree.path)]
      const uniqueDirectories = [...new Set(directories)]

      const [agents, ...sessionResults] = await Promise.all([
        client.listAgents(workspaceDir),
        ...uniqueDirectories.map(async (directory) => {
          try {
            const sessions = await client.listSessions(directory)
            return { directory, sessions }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            errors.push(`Failed to load sessions for ${directory}: ${message}`)
            return { directory, sessions: [] as SessionInfo[] }
          }
        }),
      ])

      const byId = new Map<string, AgentManagerSessionRow>()
      this.sessionDirectoryById.clear()
      this.remoteSessionById.clear()

      let stateDirty = false
      for (const result of sessionResults) {
        for (const session of result.sessions) {
          this.sessionDirectoryById.set(session.id, result.directory)

          const meta = state.sessionMeta[session.id]
          const worktree = worktreeRecords.find((record) => record.path === result.directory)
          const isWorktree = result.directory !== workspaceDir
          const worktreePath = isWorktree ? result.directory : meta?.worktreePath
          const branch = meta?.branch ?? worktree?.branch

          if (!meta || meta.directory !== result.directory || meta.worktreePath !== worktreePath || meta.branch !== branch) {
            state.sessionMeta[session.id] = {
              directory: result.directory,
              ...(worktreePath ? { worktreePath } : {}),
              ...(branch ? { branch } : {}),
            }
            stateDirty = true
          }

          const row = this.toSessionRow(session, workspaceDir, {
            directory: result.directory,
            worktreePath,
            branch,
          })

          const existing = byId.get(session.id)
          if (!existing || Date.parse(row.updatedAt) > Date.parse(existing.updatedAt)) {
            byId.set(session.id, row)
          }
        }
      }

      if (stateDirty) {
        await this.saveState(workspaceDir, state)
      }

      try {
        const remoteSessions = await client.listRemoteSessions(50)
        const normalizedWorkspaceGitUrl = await this.getNormalizedWorkspaceGitUrl(workspaceDir)
        const filteredRemoteSessions = this.filterRemoteSessionsByGitUrl(remoteSessions, normalizedWorkspaceGitUrl)
        for (const remote of filteredRemoteSessions) {
          if (!remote.sessionID || byId.has(remote.sessionID)) {
            continue
          }
          this.remoteSessionById.set(remote.sessionID, remote)
          byId.set(remote.sessionID, this.toRemoteSessionRow(remote))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`Failed to load cloud sessions: ${message}`)
      }

      const knownSessionIds = new Set(byId.keys())
      for (const sessionID of this.pendingPermissionsBySession.keys()) {
        if (!knownSessionIds.has(sessionID)) {
          this.pendingPermissionsBySession.delete(sessionID)
        }
      }

      this.postMessage({
        type: "agentManagerData",
        sessions: [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        agents: this.toVisibleAgents(agents),
        defaultAgent: this.getDefaultAgent(agents),
        workspaceDir,
        ...(errors.length > 0 ? { errors } : {}),
      })
      this.postActionResult("refresh", true, errors.length > 0 ? "Refreshed with warnings" : undefined)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to refresh data", error)
      this.postActionResult("refresh", false, error instanceof Error ? error.message : String(error))
    }
  }

  private async createSession(rawPrompt?: string, rawAgent?: string, parallel?: boolean, rawBranch?: string): Promise<void> {
    const workspaceDir = this.getWorkspaceDirectory()
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : ""
    const agent = typeof rawAgent === "string" && rawAgent.trim().length > 0 ? rawAgent.trim() : undefined

    try {
      const client = await this.getClient(workspaceDir)

      const created = parallel
        ? await this.createParallelSession({
            client,
            workspaceDir,
            prompt,
            agent,
            branch: typeof rawBranch === "string" ? rawBranch : undefined,
          })
        : await this.createDefaultSession({ client, workspaceDir, prompt, agent })

      captureTelemetryEvent("Agent Manager Session Started", {
        sessionId: created.sessionID,
        useWorktree: !!parallel,
      })
      this.postActionResult("createSession", true, created.message, created.sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to create session", error)
      captureTelemetryEvent("Agent Manager Session Error", {
        useWorktree: !!parallel,
        error: error instanceof Error ? error.message : String(error),
      })
      this.postActionResult("createSession", false, error instanceof Error ? error.message : String(error))
    }
  }

  private async resumeRemoteSession(sessionID?: string, rawText?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("resumeRemoteSession", false, "Missing session ID")
      return
    }

    const remoteSession = this.remoteSessionById.get(sessionID)
    if (!remoteSession) {
      this.postActionResult("resumeRemoteSession", false, "Cloud session not found", sessionID)
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    const userPrompt =
      typeof rawText === "string" && rawText.trim().length > 0
        ? rawText.trim()
        : `Continue this cloud session: ${remoteSession.title || sessionID}`

    try {
      const client = await this.getClient(workspaceDir)
      const remoteMessages = await client.getRemoteSessionMessages(sessionID).catch(() => [])
      const messageText = this.buildRemoteContinuationPrompt(remoteSession, remoteMessages, userPrompt)
      const created = await this.createDefaultSession({ client, workspaceDir, prompt: messageText })

      captureTelemetryEvent("Agent Manager Session Started", {
        sessionId: created.sessionID,
        useWorktree: false,
        source: "cloud_resume",
      })
      this.onOpenSession?.(created.sessionID, workspaceDir)
      this.postActionResult("resumeRemoteSession", true, "Started local continuation session", created.sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to resume cloud session", { sessionID, error })
      captureTelemetryEvent("Agent Manager Session Error", {
        sessionId: sessionID,
        useWorktree: false,
        source: "cloud_resume",
        error: error instanceof Error ? error.message : String(error),
      })
      this.postActionResult("resumeRemoteSession", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async createDefaultSession(input: {
    client: Awaited<ReturnType<AgentManagerProvider["getClient"]>>
    workspaceDir: string
    prompt: string
    agent?: string
  }): Promise<{ sessionID: string; message?: string }> {
    const session = await input.client.createSession(input.workspaceDir)
    this.sessionDirectoryById.set(session.id, input.workspaceDir)

    const state = await this.loadState(input.workspaceDir)
    state.sessionMeta[session.id] = { directory: input.workspaceDir }
    await this.saveState(input.workspaceDir, state)

    if (input.prompt.length > 0) {
      await input.client.sendMessage(session.id, [{ type: "text", text: input.prompt }], input.workspaceDir, {
        agent: input.agent,
      })
    }

    return { sessionID: session.id }
  }

  private async createParallelSession(input: {
    client: Awaited<ReturnType<AgentManagerProvider["getClient"]>>
    workspaceDir: string
    prompt: string
    agent?: string
    branch?: string
  }): Promise<{ sessionID: string; message?: string }> {
    await this.assertParallelModeSupported(input.workspaceDir)

    const branch = this.normalizeBranchName(input.branch)
    const suffix = String(Date.now()).slice(-6)
    const safeBranch = branch.replace(/[\/]/g, "-")
    const worktreePath = path.join(input.workspaceDir, ".kilocode", "worktrees", `${safeBranch}-${suffix}`)

    await fs.mkdir(path.dirname(worktreePath), { recursive: true })

    try {
      await this.runGit(["worktree", "add", "-b", branch, worktreePath], input.workspaceDir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already exists|exists/i.test(message)) {
        throw error
      }
      await this.runGit(["worktree", "add", worktreePath, branch], input.workspaceDir)
    }

    await this.ensureWorktreeGitExclude(input.workspaceDir)

    const session = await input.client.createSession(worktreePath)
    this.sessionDirectoryById.set(session.id, worktreePath)

    const state = await this.loadState(input.workspaceDir)
    state.worktrees = this.upsertWorktreeRecord(state.worktrees, {
      path: worktreePath,
      branch,
      createdAt: new Date().toISOString(),
    })
    state.sessionMeta[session.id] = {
      directory: worktreePath,
      worktreePath,
      branch,
    }
    await this.saveState(input.workspaceDir, state)

    if (input.prompt.length > 0) {
      await input.client.sendMessage(session.id, [{ type: "text", text: input.prompt }], worktreePath, {
        agent: input.agent,
      })
    }

    return { sessionID: session.id, message: `Created parallel worktree on branch ${branch}` }
  }

  private async sendSessionMessage(sessionID?: string, rawText?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("sendSessionMessage", false, "Missing session ID")
      return
    }

    const text = typeof rawText === "string" ? rawText.trim() : ""
    if (!text) {
      this.postActionResult("sendSessionMessage", false, "Message cannot be empty", sessionID)
      return
    }

    if (this.remoteSessionById.has(sessionID)) {
      await this.resumeRemoteSession(sessionID, text)
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()

    try {
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.sendMessage(sessionID, [{ type: "text", text }], directory)
      this.postActionResult("sendSessionMessage", true, "Message sent", sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to send session message", { sessionID, error })
      this.postActionResult("sendSessionMessage", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async respondPermission(
    sessionID?: string,
    permissionID?: string,
    response?: "once" | "always" | "reject",
  ): Promise<void> {
    if (!sessionID) {
      this.postActionResult("respondPermission", false, "Missing session ID")
      return
    }
    if (!permissionID) {
      this.postActionResult("respondPermission", false, "Missing permission ID", sessionID)
      return
    }
    if (!response || (response !== "once" && response !== "always" && response !== "reject")) {
      this.postActionResult("respondPermission", false, "Invalid permission response", sessionID)
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    try {
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.respondToPermission(sessionID, permissionID, response, directory)
      this.clearPendingPermission(sessionID, permissionID)
      this.postActionResult("respondPermission", true, `Sent ${response} reply`, sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to respond to permission", {
        sessionID,
        permissionID,
        response,
        error,
      })
      this.postActionResult("respondPermission", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async abortSession(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("abortSession", false, "Missing session ID")
      return
    }
    const workspaceDir = this.getWorkspaceDirectory()
    try {
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.abortSession(sessionID, directory)
      captureTelemetryEvent("Agent Manager Session Stopped", {
        sessionId: sessionID,
        useWorktree: directory !== workspaceDir,
      })
      this.sessionStatusById.set(sessionID, "idle")
      this.postMessage({ type: "agentManagerSessionStatus", sessionID, status: "idle" })
      this.postActionResult("abortSession", true, undefined, sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to abort session", { sessionID, error })
      captureTelemetryEvent("Agent Manager Session Error", {
        sessionId: sessionID,
        useWorktree: this.isWorktreeSession(sessionID),
        error: error instanceof Error ? error.message : String(error),
      })
      this.postActionResult("abortSession", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async deleteSession(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("deleteSession", false, "Missing session ID")
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    try {
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.deleteSession(sessionID, directory)
      this.sessionStatusById.delete(sessionID)
      this.sessionDirectoryById.delete(sessionID)
      this.pendingPermissionsBySession.delete(sessionID)

      const state = await this.loadState(workspaceDir)
      if (state.sessionMeta[sessionID]) {
        delete state.sessionMeta[sessionID]
        await this.saveState(workspaceDir, state)
      }

      this.postActionResult("deleteSession", true, undefined, sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to delete session", { sessionID, error })
      this.postActionResult("deleteSession", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async bulkAbort(sessionIDs?: string[]): Promise<void> {
    const ids = Array.isArray(sessionIDs) ? [...new Set(sessionIDs.filter((id) => typeof id === "string" && id.length > 0))] : []
    if (ids.length === 0) {
      this.postActionResult("bulkAbort", false, "No sessions selected")
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    const client = await this.getClient(workspaceDir)
    const failures: string[] = []

    for (const sessionID of ids) {
      try {
        const directory = await this.resolveSessionDirectory(sessionID)
        await client.abortSession(sessionID, directory)
      } catch (error) {
        failures.push(`${sessionID}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (failures.length > 0) {
      this.postActionResult("bulkAbort", false, failures.join(" | "))
    } else {
      this.postActionResult("bulkAbort", true, `Aborted ${ids.length} session${ids.length === 1 ? "" : "s"}`)
    }

    await this.refreshData()
  }

  private async bulkDelete(sessionIDs?: string[]): Promise<void> {
    const ids = Array.isArray(sessionIDs) ? [...new Set(sessionIDs.filter((id) => typeof id === "string" && id.length > 0))] : []
    if (ids.length === 0) {
      this.postActionResult("bulkDelete", false, "No sessions selected")
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    const client = await this.getClient(workspaceDir)
    const failures: string[] = []

    const state = await this.loadState(workspaceDir)

    for (const sessionID of ids) {
      try {
        const directory = await this.resolveSessionDirectory(sessionID)
        await client.deleteSession(sessionID, directory)
        this.sessionStatusById.delete(sessionID)
        this.sessionDirectoryById.delete(sessionID)
        this.pendingPermissionsBySession.delete(sessionID)
        delete state.sessionMeta[sessionID]
      } catch (error) {
        failures.push(`${sessionID}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await this.saveState(workspaceDir, state)

    if (failures.length > 0) {
      this.postActionResult("bulkDelete", false, failures.join(" | "))
    } else {
      this.postActionResult("bulkDelete", true, `Deleted ${ids.length} session${ids.length === 1 ? "" : "s"}`)
    }

    await this.refreshData()
  }

  private async openSessionInMainUI(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("openSession", false, "Missing session ID")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const directory = await this.resolveSessionDirectory(sessionID)

      if (directory !== workspaceDir) {
        const selection = await vscode.window.showInformationMessage(
          "This session belongs to a parallel worktree. Open that worktree in a new window?",
          "Open Worktree",
        )
        if (selection === "Open Worktree") {
          await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(directory), true)
          this.postActionResult("openSession", true, "Opened worktree in a new window", sessionID)
          return
        }
        this.postActionResult("openSession", false, "Session belongs to a worktree", sessionID)
        return
      }

      this.onOpenSession?.(sessionID, directory)
      this.postActionResult("openSession", true, undefined, sessionID)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to open session in main UI", { sessionID, error })
      this.postActionResult("openSession", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async openWorktree(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("openWorktree", false, "Missing session ID")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const state = await this.loadState(workspaceDir)
      const meta = state.sessionMeta[sessionID]
      const worktreePath = meta?.worktreePath
      if (!worktreePath) {
        this.postActionResult("openWorktree", false, "Session is not running in a worktree", sessionID)
        return
      }

      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktreePath), true)
      this.postActionResult("openWorktree", true, "Opened worktree in a new window", sessionID)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to open worktree", { sessionID, error })
      this.postActionResult("openWorktree", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async removeWorktree(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("removeWorktree", false, "Missing session ID")
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()

    try {
      const state = await this.loadState(workspaceDir)
      const meta = state.sessionMeta[sessionID]
      const worktreePath = meta?.worktreePath

      if (!worktreePath) {
        this.postActionResult("removeWorktree", false, "Session is not associated with a worktree", sessionID)
        return
      }

      try {
        await this.runGit(["worktree", "remove", "--force", worktreePath], workspaceDir)
      } catch (error) {
        logger.warn("[Kilo New] AgentManager: git worktree remove failed, falling back to fs.rm", { error })
        await fs.rm(worktreePath, { recursive: true, force: true })
      }

      state.worktrees = state.worktrees.filter((record) => record.path !== worktreePath)
      for (const [id, sessionMeta] of Object.entries(state.sessionMeta)) {
        if (sessionMeta.worktreePath === worktreePath) {
          delete state.sessionMeta[id]
          this.sessionDirectoryById.delete(id)
          this.sessionStatusById.delete(id)
        }
      }
      await this.saveState(workspaceDir, state)

      this.postActionResult("removeWorktree", true, "Worktree removed", sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to remove worktree", { sessionID, error })
      this.postActionResult("removeWorktree", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async assertParallelModeSupported(workspaceDir: string): Promise<void> {
    const gitDirPath = path.join(workspaceDir, ".git")
    const gitStat = await fs.stat(gitDirPath).catch(() => null)
    if (!gitStat) {
      throw new Error("Parallel mode requires a git repository")
    }

    if (!gitStat.isDirectory()) {
      throw new Error("Parallel mode must be started from the main repository root, not from an existing worktree")
    }

    const inside = await this.runGit(["rev-parse", "--is-inside-work-tree"], workspaceDir)
    if (inside.trim() !== "true") {
      throw new Error("Parallel mode requires a git working tree")
    }
  }

  private normalizeBranchName(input?: string): string {
    const candidate = (input ?? "").trim()
    const fallback = `kilo-agent-${Date.now()}`
    const branch = candidate.length > 0 ? candidate : fallback

    if (
      !/^[A-Za-z0-9._/-]+$/.test(branch) ||
      branch.includes("..") ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.includes("@{")
    ) {
      throw new Error("Invalid branch name")
    }

    return branch
  }

  private async ensureWorktreeGitExclude(workspaceDir: string): Promise<void> {
    const infoDir = path.join(workspaceDir, ".git", "info")
    const excludePath = path.join(infoDir, "exclude")
    await fs.mkdir(infoDir, { recursive: true })

    const marker = ".kilocode/worktrees/"
    const existing = await fs.readFile(excludePath, "utf-8").catch(() => "")
    if (existing.includes(marker)) {
      return
    }

    const next = `${existing.trimEnd()}\n${marker}\n`
    await fs.writeFile(excludePath, next, "utf-8")
  }

  private async runGit(args: string[], cwd: string): Promise<string> {
    const { stdout, stderr } = await execFile("git", args, {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024,
    })
    return `${stdout}${stderr}`.trim()
  }

  private async getClient(workspaceDir: string) {
    if (this.connectionService.getConnectionState() !== "connected") {
      await this.connectionService.connect(workspaceDir)
    }
    return this.connectionService.getHttpClient()
  }

  private getWorkspaceDirectory(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]
    return folder?.uri.fsPath ?? os.homedir()
  }

  private async resolveSessionDirectory(sessionID: string): Promise<string> {
    const fromMemory = this.sessionDirectoryById.get(sessionID)
    if (fromMemory) {
      return fromMemory
    }

    const workspaceDir = this.getWorkspaceDirectory()
    const state = await this.loadState(workspaceDir)
    const fromState = state.sessionMeta[sessionID]?.directory
    if (fromState) {
      this.sessionDirectoryById.set(sessionID, fromState)
      return fromState
    }

    return workspaceDir
  }

  private isWorktreeSession(sessionID: string): boolean {
    const workspaceDir = this.getWorkspaceDirectory()
    const directory = this.sessionDirectoryById.get(sessionID)
    return typeof directory === "string" ? directory !== workspaceDir : false
  }

  private toSessionRow(
    session: SessionInfo,
    workspaceDir: string,
    meta: { directory: string; worktreePath?: string; branch?: string },
  ): AgentManagerSessionRow {
    const status = this.sessionStatusById.get(session.id) ?? "unknown"
    const relative = path.relative(workspaceDir, meta.directory)
    const directoryLabel =
      meta.directory === workspaceDir
        ? "main workspace"
        : relative && !relative.startsWith("..")
          ? `./${relative}`
          : meta.directory

    return {
      id: session.id,
      title: session.title || "Untitled",
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
      status,
      directory: meta.directory,
      directoryLabel,
      source: "local",
      isWorktree: !!meta.worktreePath,
      ...(meta.worktreePath ? { worktreePath: meta.worktreePath } : {}),
      ...(meta.branch ? { branch: meta.branch } : {}),
      ...this.getPendingPermissionSummary(session.id),
      canOpenInChat: meta.directory === workspaceDir,
      canSendMessage: true,
    }
  }

  private toRemoteSessionRow(session: RemoteSessionInfo): AgentManagerSessionRow {
    return {
      id: session.sessionID,
      title: session.title || "Untitled",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: "idle",
      directory: "cloud",
      directoryLabel: "cloud session",
      source: "cloud",
      isWorktree: false,
      pendingApprovalCount: 0,
      canOpenInChat: false,
      canSendMessage: false,
    }
  }

  private async getNormalizedWorkspaceGitUrl(workspaceDir: string): Promise<string | null> {
    const raw = await this.runGit(["config", "--get", "remote.origin.url"], workspaceDir).catch(() => "")
    const trimmed = raw.trim()
    if (!trimmed) {
      return null
    }
    return this.normalizeGitUrl(trimmed)
  }

  private normalizeGitUrl(url: string): string {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return url
    }
    try {
      const parsed = new URL(url)
      parsed.username = ""
      parsed.password = ""
      return parsed.toString()
    } catch {
      return url
    }
  }

  private filterRemoteSessionsByGitUrl(sessions: RemoteSessionInfo[], workspaceGitUrl: string | null): RemoteSessionInfo[] {
    if (!workspaceGitUrl) {
      return sessions.filter((session) => !session.gitUrl)
    }

    return sessions.filter((session) => {
      if (!session.gitUrl) {
        return false
      }
      return this.normalizeGitUrl(session.gitUrl) === workspaceGitUrl
    })
  }

  private buildRemoteContinuationPrompt(
    remoteSession: RemoteSessionInfo,
    remoteMessages: Array<{ type?: string; say?: string; ask?: string; text?: string; reasoning?: string; ts?: number }>,
    userPrompt: string,
  ): string {
    const transcriptLines = remoteMessages
      .filter((message) => typeof message.text === "string" && message.text.trim().length > 0)
      .slice(-24)
      .map((message) => {
        const role = this.toRemoteMessageRole(message)
        const text = (message.text || "").replace(/\s+/g, " ").trim().slice(0, 420)
        return `${role}: ${text}`
      })
      .filter((line) => line.length > 0)

    const transcript = transcriptLines.length > 0 ? transcriptLines.join("\n") : "No transcript available from cloud session."

    return [
      "Continue this prior cloud session in a new local session.",
      `Cloud session ID: ${remoteSession.sessionID}`,
      `Cloud session title: ${remoteSession.title || "Untitled"}`,
      `Recent cloud transcript:\n${transcript}`,
      `User continuation request:\n${userPrompt}`,
    ].join("\n\n")
  }

  private toRemoteMessageRole(message: { type?: string; say?: string }): "User" | "Assistant" {
    if (message.type === "ask") {
      return "Assistant"
    }
    if (message.say === "user_feedback" || message.say === "user_feedback_diff") {
      return "User"
    }
    return "Assistant"
  }

  private toVisibleAgents(agents: AgentInfo[]): Array<{ name: string; description?: string }> {
    return agents
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({ name: agent.name, description: agent.description }))
  }

  private getDefaultAgent(agents: AgentInfo[]): string {
    const visible = agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    return visible[0]?.name ?? "code"
  }

  private getStorageKey(workspaceDir: string): string {
    return `kilo.agentManager.state.${encodeURIComponent(workspaceDir)}`
  }

  private async loadState(workspaceDir: string): Promise<PersistedState> {
    const key = this.getStorageKey(workspaceDir)
    const raw = this.extensionContext.globalState.get<PersistedState>(key)
    if (!raw) {
      return { worktrees: [], sessionMeta: {} }
    }

    return {
      worktrees: Array.isArray(raw.worktrees) ? raw.worktrees.filter((record) => !!record?.path && !!record?.branch) : [],
      sessionMeta: raw.sessionMeta && typeof raw.sessionMeta === "object" ? raw.sessionMeta : {},
    }
  }

  private async saveState(workspaceDir: string, state: PersistedState): Promise<void> {
    const key = this.getStorageKey(workspaceDir)
    await this.extensionContext.globalState.update(key, state)
  }

  private async filterExistingWorktrees(worktrees: WorktreeRecord[]): Promise<WorktreeRecord[]> {
    const result: WorktreeRecord[] = []
    for (const worktree of worktrees) {
      try {
        const stat = await fs.stat(worktree.path)
        if (stat.isDirectory()) {
          result.push(worktree)
        }
      } catch {
        // Drop stale worktree records.
      }
    }
    return result
  }

  private upsertWorktreeRecord(worktrees: WorktreeRecord[], next: WorktreeRecord): WorktreeRecord[] {
    const existing = worktrees.filter((record) => record.path !== next.path)
    existing.push(next)
    return existing.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }

  private postActionResult(
    action: AgentManagerAction,
    success: boolean,
    message?: string,
    sessionID?: string,
  ): void {
    this.postMessage({ type: "agentManagerActionResult", action, success, message, sessionID })
  }

  private postMessage(message: AgentManagerExtensionToWebviewMessage): void {
    if (!this.panel) {
      return
    }

    void this.panel.webview.postMessage(message).then(undefined, (error) => {
      logger.error("[Kilo New] AgentManager: postMessage failed", error)
    })
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Agent Manager</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 14px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }
    .layout {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 1080px;
      margin: 0 auto;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background) 16%);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .split {
      display: grid;
      gap: 12px;
      grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 860px) {
      .split {
        grid-template-columns: 1fr;
      }
    }
    .search-input,
    .text-input,
    .select-input,
    .text-area {
      font: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 6px 8px;
      width: 100%;
    }
    .text-area {
      min-height: 74px;
      resize: vertical;
    }
    .button {
      font: inherit;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      min-height: 30px;
    }
    .button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .button.warn {
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }
    .button.danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .status-line {
      min-height: 18px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .session-list {
      display: grid;
      gap: 8px;
    }
    .session {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .session-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .session-main {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .session-title {
      font-size: 14px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .session-id {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .status-badge {
      align-self: flex-start;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .status-badge[data-status="busy"],
    .status-badge[data-status="retry"] {
      color: var(--vscode-progressBar-background, #4daafc);
      border-color: color-mix(in srgb, var(--vscode-progressBar-background, #4daafc) 70%, transparent 30%);
    }
    .status-badge[data-status="idle"] {
      color: var(--vscode-terminal-ansiGreen, #4ec9b0);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen, #4ec9b0) 70%, transparent 30%);
    }
    .approval-badge {
      align-self: flex-start;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid color-mix(in srgb, var(--vscode-testing-iconQueued, #cca700) 70%, transparent 30%);
      color: var(--vscode-testing-iconQueued, #cca700);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .session-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .session-approval {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      padding: 6px 8px;
      overflow-wrap: anywhere;
    }
    .session-continue {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .session-continue .text-input {
      flex: 1;
    }
    .session-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .error-list {
      margin: 0;
      padding-left: 16px;
      display: grid;
      gap: 3px;
      font-size: 12px;
      color: var(--vscode-inputValidation-warningForeground);
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="toolbar">
      <h1 class="title">Agent Manager</h1>
      <div class="row">
        <button id="refreshBtn" class="button secondary" type="button">Refresh</button>
      </div>
    </div>

    <div class="split">
      <div class="card">
        <div><strong>Start Session</strong></div>
        <div class="row">
          <label for="agentSelect" class="muted">Mode</label>
          <select id="agentSelect" class="select-input"></select>
        </div>
        <textarea id="promptInput" class="text-area" placeholder="Optional kickoff prompt"></textarea>
        <label class="checkbox">
          <input id="parallelToggle" type="checkbox" />
          Start in parallel worktree mode
        </label>
        <input id="branchInput" class="text-input" placeholder="Branch name (optional, parallel mode)" />
        <div class="row">
          <button id="createBtn" class="button" type="button">Create Session</button>
          <span id="workspaceLabel" class="muted"></span>
        </div>
      </div>

      <div class="card">
        <div><strong>Bulk Controls</strong></div>
        <input id="searchInput" class="search-input" placeholder="Search sessions by title, id, branch, or path" />
        <div class="row">
          <button id="bulkAbortBtn" class="button secondary" type="button">Abort Selected</button>
          <button id="bulkDeleteBtn" class="button danger" type="button">Delete Selected</button>
          <span id="selectedCount" class="muted">0 selected</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div><strong>Sessions</strong></div>
      <div id="warningBlock" hidden>
        <ul id="warningList" class="error-list"></ul>
      </div>
      <div class="session-list" id="sessionList"></div>
      <div class="muted" id="emptyState" hidden>No sessions match the current filters.</div>
    </div>

    <div class="status-line" id="statusLine"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    let sessions = []
    let agents = []
    let defaultAgent = "code"
    let busy = false
    let selected = new Set()

    const refreshBtn = document.getElementById("refreshBtn")
    const createBtn = document.getElementById("createBtn")
    const promptInput = document.getElementById("promptInput")
    const agentSelect = document.getElementById("agentSelect")
    const workspaceLabel = document.getElementById("workspaceLabel")
    const parallelToggle = document.getElementById("parallelToggle")
    const branchInput = document.getElementById("branchInput")
    const searchInput = document.getElementById("searchInput")
    const bulkAbortBtn = document.getElementById("bulkAbortBtn")
    const bulkDeleteBtn = document.getElementById("bulkDeleteBtn")
    const selectedCount = document.getElementById("selectedCount")
    const sessionList = document.getElementById("sessionList")
    const emptyState = document.getElementById("emptyState")
    const warningBlock = document.getElementById("warningBlock")
    const warningList = document.getElementById("warningList")
    const statusLine = document.getElementById("statusLine")

    function setBusy(nextBusy) {
      busy = !!nextBusy
      refreshBtn.disabled = busy
      createBtn.disabled = busy
      bulkAbortBtn.disabled = busy || selected.size === 0
      bulkDeleteBtn.disabled = busy || selected.size === 0
    }

    function setStatus(message) {
      statusLine.textContent = message || ""
    }

    function formatWhen(isoString) {
      const date = new Date(isoString)
      if (Number.isNaN(date.getTime())) {
        return isoString
      }
      return date.toLocaleString()
    }

    function populateAgents() {
      while (agentSelect.firstChild) {
        agentSelect.removeChild(agentSelect.firstChild)
      }

      const options = agents.length > 0 ? agents : [{ name: defaultAgent, description: "" }]
      for (const agent of options) {
        const option = document.createElement("option")
        option.value = agent.name
        option.textContent = agent.description ? agent.name + " - " + agent.description : agent.name
        if (agent.name === defaultAgent) {
          option.selected = true
        }
        agentSelect.appendChild(option)
      }
    }

    function updateSelectedCount() {
      selectedCount.textContent = selected.size + " selected"
      bulkAbortBtn.disabled = busy || selected.size === 0
      bulkDeleteBtn.disabled = busy || selected.size === 0
    }

    function filteredSessions() {
      const query = (searchInput.value || "").trim().toLowerCase()
      if (!query) {
        return sessions
      }
      return sessions.filter((session) => {
        const text = [session.title, session.id, session.branch || "", session.directoryLabel || ""].join(" ").toLowerCase()
        return text.includes(query)
      })
    }

    function makeButton(label, className, onClick) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = label
      button.className = className ? "button " + className : "button"
      button.disabled = busy
      button.addEventListener("click", onClick)
      return button
    }

    function renderWarnings(errors) {
      while (warningList.firstChild) {
        warningList.removeChild(warningList.firstChild)
      }

      if (!errors || errors.length === 0) {
        warningBlock.hidden = true
        return
      }

      for (const error of errors) {
        const li = document.createElement("li")
        li.textContent = error
        warningList.appendChild(li)
      }
      warningBlock.hidden = false
    }

    function renderSessions() {
      while (sessionList.firstChild) {
        sessionList.removeChild(sessionList.firstChild)
      }

      const rows = filteredSessions()

      if (!rows.length) {
        emptyState.hidden = false
        return
      }

      emptyState.hidden = true

      for (const session of rows) {
        const container = document.createElement("div")
        container.className = "session"

        const head = document.createElement("div")
        head.className = "session-head"

        const main = document.createElement("div")
        main.className = "session-main"

        const title = document.createElement("div")
        title.className = "session-title"
        title.textContent = session.title || "Untitled"

        const id = document.createElement("div")
        id.className = "session-id"
        id.textContent = session.id

        const meta = document.createElement("div")
        meta.className = "session-meta"
        meta.textContent =
          "Updated " +
          formatWhen(session.updatedAt) +
          " • " +
          (session.source === "cloud" ? "cloud" : session.directoryLabel) +
          (session.branch ? " • branch " + session.branch : "") +
          (session.pendingApprovalCount > 0 ? " • approvals " + session.pendingApprovalCount : "")

        main.appendChild(title)
        main.appendChild(id)
        main.appendChild(meta)

        const status = document.createElement("span")
        status.className = "status-badge"
        status.dataset.status = session.status || "unknown"
        status.textContent = session.status || "unknown"

        head.appendChild(main)
        head.appendChild(status)
        if (session.pendingApprovalCount > 0) {
          const approvalBadge = document.createElement("span")
          approvalBadge.className = "approval-badge"
          approvalBadge.textContent = session.pendingApprovalCount + " approval" + (session.pendingApprovalCount === 1 ? "" : "s")
          head.appendChild(approvalBadge)
        }

        const actionRow = document.createElement("div")
        actionRow.className = "session-actions"

        const checkLabel = document.createElement("label")
        checkLabel.className = "checkbox"
        const check = document.createElement("input")
        check.type = "checkbox"
        check.checked = selected.has(session.id)
        check.disabled = session.source === "cloud"
        check.addEventListener("change", () => {
          if (check.checked) {
            selected.add(session.id)
          } else {
            selected.delete(session.id)
          }
          updateSelectedCount()
        })
        const checkText = document.createElement("span")
        checkText.textContent = session.source === "cloud" ? "Cloud" : "Select"
        checkLabel.appendChild(check)
        checkLabel.appendChild(checkText)
        actionRow.appendChild(checkLabel)

        const openChatBtn = makeButton("Open Chat", "secondary", () => {
          vscode.postMessage({ type: "openSession", sessionID: session.id })
        })
        if (!session.canOpenInChat) {
          openChatBtn.disabled = true
          openChatBtn.title =
            session.source === "cloud"
              ? "Cloud sessions need to be resumed locally first"
              : "Worktree sessions should be continued from Agent Manager"
        }
        actionRow.appendChild(openChatBtn)

        if (session.source !== "cloud") {
          if (session.nextPendingApproval && session.nextPendingApproval.id) {
            actionRow.appendChild(
              makeButton("Allow Once", "secondary", () => {
                vscode.postMessage({
                  type: "respondPermission",
                  sessionID: session.id,
                  permissionID: session.nextPendingApproval.id,
                  response: "once",
                })
              }),
            )
            actionRow.appendChild(
              makeButton("Allow Always", "secondary", () => {
                vscode.postMessage({
                  type: "respondPermission",
                  sessionID: session.id,
                  permissionID: session.nextPendingApproval.id,
                  response: "always",
                })
              }),
            )
            actionRow.appendChild(
              makeButton("Deny", "warn", () => {
                vscode.postMessage({
                  type: "respondPermission",
                  sessionID: session.id,
                  permissionID: session.nextPendingApproval.id,
                  response: "reject",
                })
              }),
            )
          }
          actionRow.appendChild(
            makeButton("Abort", "secondary", () => {
              vscode.postMessage({ type: "abortSession", sessionID: session.id })
            }),
          )

          actionRow.appendChild(
            makeButton("Delete", "danger", () => {
              const ok = window.confirm("Delete this session permanently?")
              if (!ok) return
              vscode.postMessage({ type: "deleteSession", sessionID: session.id })
            }),
          )
        } else {
          actionRow.appendChild(
            makeButton("Resume Local", "secondary", () => {
              vscode.postMessage({ type: "resumeRemoteSession", sessionID: session.id })
            }),
          )
        }

        if (session.isWorktree) {
          actionRow.appendChild(
            makeButton("Open Worktree", "secondary", () => {
              vscode.postMessage({ type: "openWorktree", sessionID: session.id })
            }),
          )
          actionRow.appendChild(
            makeButton("Remove Worktree", "warn", () => {
              const ok = window.confirm("Remove this worktree folder? The git branch is preserved.")
              if (!ok) return
              vscode.postMessage({ type: "removeWorktree", sessionID: session.id })
            }),
          )
        }

        if (session.nextPendingApproval) {
          const approvalInfo = document.createElement("div")
          approvalInfo.className = "session-approval"
          const patterns = Array.isArray(session.nextPendingApproval.patterns) ? session.nextPendingApproval.patterns : []
          approvalInfo.textContent =
            "Pending permission: " +
            session.nextPendingApproval.permission +
            (patterns.length > 0 ? " • " + patterns.slice(0, 4).join(", ") : "")
          container.appendChild(approvalInfo)
        }

        const continueRow = document.createElement("div")
        continueRow.className = "session-continue"

        const continueInput = document.createElement("input")
        continueInput.className = "text-input"
        continueInput.placeholder =
          session.source === "cloud"
            ? "Enter a continuation message to start a local session"
            : "Send follow-up message to this session"
        continueInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            const text = continueInput.value
            if (session.source === "cloud") {
              vscode.postMessage({ type: "resumeRemoteSession", sessionID: session.id, text })
            } else {
              if (!text.trim()) return
              vscode.postMessage({ type: "sendSessionMessage", sessionID: session.id, text })
            }
            continueInput.value = ""
          }
        })

        const sendBtn = makeButton(session.source === "cloud" ? "Resume Local" : "Send", "", () => {
          const text = continueInput.value
          if (session.source === "cloud") {
            vscode.postMessage({ type: "resumeRemoteSession", sessionID: session.id, text })
          } else {
            if (!text.trim()) return
            vscode.postMessage({ type: "sendSessionMessage", sessionID: session.id, text })
          }
          continueInput.value = ""
        })

        continueRow.appendChild(continueInput)
        continueRow.appendChild(sendBtn)

        container.appendChild(head)
        container.appendChild(actionRow)
        container.appendChild(continueRow)
        sessionList.appendChild(container)
      }
    }

    refreshBtn.addEventListener("click", () => {
      setBusy(true)
      setStatus("Refreshing sessions...")
      vscode.postMessage({ type: "refresh" })
    })

    createBtn.addEventListener("click", () => {
      setBusy(true)
      setStatus(parallelToggle.checked ? "Creating parallel worktree session..." : "Creating session...")
      vscode.postMessage({
        type: "createSession",
        prompt: promptInput.value,
        agent: agentSelect.value || defaultAgent,
        parallel: !!parallelToggle.checked,
        branch: branchInput.value,
      })
    })

    searchInput.addEventListener("input", () => {
      renderSessions()
    })

    bulkAbortBtn.addEventListener("click", () => {
      if (selected.size === 0) return
      setBusy(true)
      setStatus("Aborting selected sessions...")
      vscode.postMessage({ type: "bulkAbort", sessionIDs: Array.from(selected) })
    })

    bulkDeleteBtn.addEventListener("click", () => {
      if (selected.size === 0) return
      const ok = window.confirm("Delete all selected sessions permanently?")
      if (!ok) return
      setBusy(true)
      setStatus("Deleting selected sessions...")
      vscode.postMessage({ type: "bulkDelete", sessionIDs: Array.from(selected) })
    })

    window.addEventListener("message", (event) => {
      const message = event.data
      if (!message || typeof message !== "object") {
        return
      }

      if (message.type === "agentManagerData") {
        sessions = Array.isArray(message.sessions) ? message.sessions : []
        agents = Array.isArray(message.agents) ? message.agents : []
        defaultAgent = typeof message.defaultAgent === "string" && message.defaultAgent ? message.defaultAgent : "code"
        workspaceLabel.textContent = message.workspaceDir || ""

        const sessionIds = new Set(sessions.filter((session) => session.source !== "cloud").map((session) => session.id))
        selected = new Set(Array.from(selected).filter((id) => sessionIds.has(id)))

        populateAgents()
        renderWarnings(Array.isArray(message.errors) ? message.errors : [])
        renderSessions()
        updateSelectedCount()
        setBusy(false)
        setStatus("Ready")
        return
      }

      if (message.type === "agentManagerSessionStatus") {
        const index = sessions.findIndex((session) => session.id === message.sessionID)
        if (index >= 0) {
          sessions[index].status = message.status
          renderSessions()
        }
        return
      }

      if (message.type === "agentManagerActionResult") {
        setBusy(false)
        if (message.success) {
          if (message.action === "createSession") {
            promptInput.value = ""
            branchInput.value = ""
          }
          if (message.action === "bulkDelete") {
            selected.clear()
            updateSelectedCount()
          }
          setStatus((message.action || "action") + " succeeded" + (message.message ? ": " + message.message : ""))
        } else {
          setStatus((message.action || "action") + " failed" + (message.message ? ": " + message.message : ""))
        }
      }
    })

    setBusy(true)
    setStatus("Loading sessions...")
    updateSelectedCount()
    vscode.postMessage({ type: "ready" })
  </script>
</body>
</html>`
  }
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
