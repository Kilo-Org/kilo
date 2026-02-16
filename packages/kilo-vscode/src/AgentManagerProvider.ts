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
  MessageInfo,
  MessagePart,
  PermissionRequest,
  RemoteSessionMessage,
  RemoteSessionInfo,
  SessionInfo,
} from "./services/cli-backend"

const execFile = promisify(execFileCb)

type OpenSessionCallback = (sessionID: string, directory?: string) => void

type SessionRunStatus = "idle" | "busy" | "retry" | "unknown"

type AgentManagerWebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "configureSetupScript" }
  | { type: "loadSessionMessages"; sessionID?: string }
  | {
      type: "createSession"
      prompt?: string
      agent?: string
      parallel?: boolean
      branch?: string
      versions?: number
      yoloMode?: boolean
      images?: string[]
    }
  | { type: "resumeRemoteSession"; sessionID?: string; text?: string; images?: string[] }
  | { type: "sendSessionMessage"; sessionID?: string; text?: string; images?: string[] }
  | { type: "respondPermission"; sessionID?: string; permissionID?: string; response?: "once" | "always" | "reject" }
  | { type: "abortSession"; sessionID?: string }
  | { type: "deleteSession"; sessionID?: string }
  | { type: "openSession"; sessionID?: string }
  | { type: "sessionShare"; sessionID?: string }
  | { type: "renameSession"; sessionID?: string; label?: string }
  | { type: "showTerminal"; sessionID?: string }
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
  shareURL?: string
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
  | "configureSetupScript"
  | "loadSessionMessages"
  | "createSession"
  | "resumeRemoteSession"
  | "sendSessionMessage"
  | "respondPermission"
  | "abortSession"
  | "deleteSession"
  | "openSession"
  | "sessionShare"
  | "renameSession"
  | "showTerminal"
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
  | {
      type: "agentManagerSessionMessages"
      sessionID: string
      source: "local" | "cloud"
      canSendMessage: boolean
      messages: AgentManagerMessageRow[]
      error?: string
    }

type AgentManagerMessageRow = {
  id: string
  role: "user" | "assistant"
  createdAt: string
  completedAt?: string
  providerID?: string
  modelID?: string
  parts: AgentManagerMessagePartRow[]
}

type AgentManagerMessagePartRow =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool"
      tool: string
      status: "pending" | "running" | "completed" | "error"
      title?: string
      input?: string
      output?: string
      error?: string
    }
  | { type: "file"; mime: string; url: string; filename?: string }

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
  private readonly sessionShareById = new Map<string, string>()
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
      case "configureSetupScript":
        await this.configureSetupScript()
        return
      case "loadSessionMessages":
        await this.loadSessionMessages(message.sessionID)
        return
      case "createSession":
        await this.createSession(
          message.prompt,
          message.agent,
          message.parallel,
          message.branch,
          message.versions,
          message.yoloMode,
          message.images,
        )
        return
      case "resumeRemoteSession":
        await this.resumeRemoteSession(message.sessionID, message.text, message.images)
        return
      case "sendSessionMessage":
        await this.sendSessionMessage(message.sessionID, message.text, message.images)
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
      case "openSession":
        await this.openSessionInMainUI(message.sessionID)
        return
      case "sessionShare":
        await this.sessionShare(message.sessionID)
        return
      case "renameSession":
        await this.renameSession(message.sessionID, message.label)
        return
      case "showTerminal":
        await this.showTerminal(message.sessionID)
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

      const [agents, config, ...sessionResults] = await Promise.all([
        client.listAgents(workspaceDir),
        client.getConfig(workspaceDir).catch(() => undefined),
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
      this.sessionShareById.clear()
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
          if (row.shareURL) {
            this.sessionShareById.set(row.id, row.shareURL)
          }

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
        defaultAgent: this.getDefaultAgent(agents, config?.default_agent),
        workspaceDir,
        ...(errors.length > 0 ? { errors } : {}),
      })
      this.postActionResult("refresh", true, errors.length > 0 ? "Refreshed with warnings" : undefined)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to refresh data", error)
      this.postActionResult("refresh", false, error instanceof Error ? error.message : String(error))
    }
  }

  private async createSession(
    rawPrompt?: string,
    rawAgent?: string,
    parallel?: boolean,
    rawBranch?: string,
    rawVersions?: number,
    _rawYoloMode?: boolean,
    rawImages?: string[],
  ): Promise<void> {
    const workspaceDir = this.getWorkspaceDirectory()
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : ""
    const agent = typeof rawAgent === "string" && rawAgent.trim().length > 0 ? rawAgent.trim() : undefined
    void _rawYoloMode
    const images = this.normalizeImageUrls(rawImages)
    const requestedVersions = typeof rawVersions === "number" && Number.isFinite(rawVersions) ? Math.floor(rawVersions) : 1
    const versions = Math.min(8, Math.max(1, requestedVersions))
    const useWorktree = !!parallel || versions > 1

    try {
      const client = await this.getClient(workspaceDir)
      const branchBase = typeof rawBranch === "string" ? rawBranch.trim() : ""
      const created: Array<{ sessionID: string; message?: string }> = []

      for (let index = 0; index < versions; index++) {
        const versionBranch = useWorktree
          ? branchBase
            ? versions > 1
              ? `${branchBase}-v${index + 1}`
              : branchBase
            : undefined
          : undefined

        const next = useWorktree
          ? await this.createParallelSession({
              client,
              workspaceDir,
              prompt,
              agent,
              branch: versionBranch,
              images,
            })
          : await this.createDefaultSession({ client, workspaceDir, prompt, agent, images })
        created.push(next)

        captureTelemetryEvent("Agent Manager Session Started", {
          sessionId: next.sessionID,
          useWorktree: useWorktree,
        })
      }

      const firstSession = created[0]
      const message = versions > 1 ? `Started ${versions} parallel sessions` : firstSession?.message
      this.postActionResult("createSession", true, message, firstSession?.sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to create session", error)
      captureTelemetryEvent("Agent Manager Session Error", {
        useWorktree,
        error: error instanceof Error ? error.message : String(error),
      })
      this.postActionResult("createSession", false, error instanceof Error ? error.message : String(error))
    }
  }

  private async resumeRemoteSession(sessionID?: string, rawText?: string, rawImages?: string[]): Promise<void> {
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
    const images = this.normalizeImageUrls(rawImages)
    const userPrompt =
      typeof rawText === "string" && rawText.trim().length > 0
        ? rawText.trim()
        : `Continue this cloud session: ${remoteSession.title || sessionID}`

    try {
      const client = await this.getClient(workspaceDir)
      const remoteMessages = await client.getRemoteSessionMessages(sessionID).catch(() => [])
      const messageText = this.buildRemoteContinuationPrompt(remoteSession, remoteMessages, userPrompt)
      const created = await this.createDefaultSession({ client, workspaceDir, prompt: messageText, images })

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
    images?: string[]
  }): Promise<{ sessionID: string; message?: string }> {
    const session = await input.client.createSession(input.workspaceDir)
    this.sessionDirectoryById.set(session.id, input.workspaceDir)

    const state = await this.loadState(input.workspaceDir)
    state.sessionMeta[session.id] = { directory: input.workspaceDir }
    await this.saveState(input.workspaceDir, state)

    const parts = this.buildMessageParts(input.prompt, input.images)
    if (parts.length > 0) {
      await input.client.sendMessage(session.id, parts, input.workspaceDir, {
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
    images?: string[]
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

    const parts = this.buildMessageParts(input.prompt, input.images)
    if (parts.length > 0) {
      await input.client.sendMessage(session.id, parts, worktreePath, {
        agent: input.agent,
      })
    }

    return { sessionID: session.id, message: `Created parallel worktree on branch ${branch}` }
  }

  private async sendSessionMessage(sessionID?: string, rawText?: string, rawImages?: string[]): Promise<void> {
    if (!sessionID) {
      this.postActionResult("sendSessionMessage", false, "Missing session ID")
      return
    }

    const text = typeof rawText === "string" ? rawText.trim() : ""
    const images = this.normalizeImageUrls(rawImages)
    if (!text && images.length === 0) {
      this.postActionResult("sendSessionMessage", false, "Message cannot be empty", sessionID)
      return
    }

    if (this.remoteSessionById.has(sessionID)) {
      await this.resumeRemoteSession(sessionID, text, images)
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()

    try {
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.sendMessage(sessionID, this.buildMessageParts(text, images), directory)
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
      this.sessionShareById.delete(sessionID)
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

  private async sessionShare(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("sessionShare", false, "Missing session ID")
      return
    }

    const shareValue = this.sessionShareById.get(sessionID)
    if (!shareValue) {
      this.postActionResult("sessionShare", false, "Sharing is not available for this session yet", sessionID)
      return
    }

    try {
      const shareUrl = this.toShareUrl(shareValue)
      await vscode.env.clipboard.writeText(shareUrl)
      void vscode.window.showInformationMessage(`Session share link copied: ${shareUrl}`)
      this.postActionResult("sessionShare", true, undefined, sessionID)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to copy share link", { sessionID, error })
      this.postActionResult("sessionShare", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async renameSession(sessionID?: string, rawLabel?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("renameSession", false, "Missing session ID")
      return
    }

    const label = typeof rawLabel === "string" ? rawLabel.trim() : ""
    if (!label) {
      this.postActionResult("renameSession", false, "Session title cannot be empty", sessionID)
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const client = await this.getClient(workspaceDir)
      const directory = await this.resolveSessionDirectory(sessionID)
      await client.updateSession(sessionID, { title: label }, directory)
      this.postActionResult("renameSession", true, undefined, sessionID)
      await this.refreshData()
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to rename session", { sessionID, error })
      this.postActionResult("renameSession", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private toShareUrl(shareValue: string): string {
    if (/^https?:\/\//i.test(shareValue)) {
      return shareValue
    }
    return `https://app.kilo.ai/share/${shareValue}`
  }

  private async showTerminal(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("showTerminal", false, "Missing session ID")
      return
    }

    try {
      const cwd = await this.resolveSessionDirectory(sessionID)
      const terminal = vscode.window.createTerminal({
        name: `Kilo Session ${sessionID.slice(0, 8)}`,
        cwd,
      })
      terminal.show(true)
      this.postActionResult("showTerminal", true, undefined, sessionID)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to open terminal", { sessionID, error })
      this.postActionResult("showTerminal", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private async configureSetupScript(): Promise<void> {
    const workspaceDir = this.getWorkspaceDirectory()
    const kilocodeDir = path.join(workspaceDir, ".kilocode")
    const scriptPath = path.join(kilocodeDir, "setup-script")
    const defaultTemplate = `#!/bin/bash
# Kilo Code Worktree Setup Script
# Runs before an agent starts in a worktree.
set -e

echo "Setting up worktree: $WORKTREE_PATH"
`

    try {
      await fs.mkdir(kilocodeDir, { recursive: true })
      try {
        await fs.access(scriptPath)
      } catch {
        await fs.writeFile(scriptPath, defaultTemplate, "utf-8")
        if (process.platform !== "win32") {
          await fs.chmod(scriptPath, 0o755)
        }
      }

      const doc = await vscode.workspace.openTextDocument(scriptPath)
      await vscode.window.showTextDocument(doc)
      this.postActionResult("configureSetupScript", true)
    } catch (error) {
      logger.error("[Kilo New] AgentManager: failed to configure setup script", { error })
      this.postActionResult("configureSetupScript", false, error instanceof Error ? error.message : String(error))
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
      ...(typeof session.share === "string" && session.share.trim().length > 0 ? { shareURL: session.share.trim() } : {}),
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

  private getDefaultAgent(agents: AgentInfo[], configuredDefaultAgent?: string): string {
    const visible = agents.filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    if (configuredDefaultAgent && visible.some((agent) => agent.name === configuredDefaultAgent)) {
      return configuredDefaultAgent
    }
    return visible[0]?.name ?? "code"
  }

  private async loadSessionMessages(sessionID?: string): Promise<void> {
    if (!sessionID) {
      this.postActionResult("loadSessionMessages", false, "Missing session ID")
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    const client = await this.getClient(workspaceDir)

    if (this.remoteSessionById.has(sessionID)) {
      try {
        const remoteMessages = await client.getRemoteSessionMessages(sessionID)
        const rows = this.toRemoteMessageRows(sessionID, remoteMessages)
        this.postMessage({
          type: "agentManagerSessionMessages",
          sessionID,
          source: "cloud",
          canSendMessage: false,
          messages: rows,
        })
        this.postActionResult("loadSessionMessages", true, undefined, sessionID)
      } catch (error) {
        this.postMessage({
          type: "agentManagerSessionMessages",
          sessionID,
          source: "cloud",
          canSendMessage: false,
          messages: [],
          error: error instanceof Error ? error.message : String(error),
        })
        this.postActionResult("loadSessionMessages", false, error instanceof Error ? error.message : String(error), sessionID)
      }
      return
    }

    try {
      const directory = await this.resolveSessionDirectory(sessionID)
      const result = await client.getMessages(sessionID, directory)
      const rows = result.map((entry) => this.toMessageRow(entry.info, entry.parts))
      this.postMessage({
        type: "agentManagerSessionMessages",
        sessionID,
        source: "local",
        canSendMessage: true,
        messages: rows,
      })
      this.postActionResult("loadSessionMessages", true, undefined, sessionID)
    } catch (error) {
      this.postMessage({
        type: "agentManagerSessionMessages",
        sessionID,
        source: "local",
        canSendMessage: true,
        messages: [],
        error: error instanceof Error ? error.message : String(error),
      })
      this.postActionResult("loadSessionMessages", false, error instanceof Error ? error.message : String(error), sessionID)
    }
  }

  private toMessageRow(info: MessageInfo, parts: MessagePart[]): AgentManagerMessageRow {
    return {
      id: info.id,
      role: info.role,
      createdAt: new Date(info.time.created).toISOString(),
      ...(info.time.completed ? { completedAt: new Date(info.time.completed).toISOString() } : {}),
      ...(typeof info.providerID === "string" ? { providerID: info.providerID } : {}),
      ...(typeof info.modelID === "string" ? { modelID: info.modelID } : {}),
      parts: parts
        .map((part) => this.toMessagePartRow(part))
        .filter((part): part is AgentManagerMessagePartRow => part !== null),
    }
  }

  private toMessagePartRow(part: MessagePart): AgentManagerMessagePartRow | null {
    if (part.type === "text") {
      return { type: "text", text: part.text }
    }
    if (part.type === "reasoning") {
      return { type: "reasoning", text: part.text }
    }
    if (part.type === "file") {
      return {
        type: "file",
        mime: part.mime,
        url: part.url,
        ...(typeof part.filename === "string" ? { filename: part.filename } : {}),
      }
    }
    if (part.type === "tool") {
      const state = part.state
      const serializedInput = this.safeSerialize(state.input)
      if (state.status === "pending") {
        return {
          type: "tool",
          tool: part.tool,
          status: "pending",
          ...(serializedInput ? { input: serializedInput } : {}),
        }
      }
      if (state.status === "running") {
        return {
          type: "tool",
          tool: part.tool,
          status: "running",
          ...(state.title ? { title: state.title } : {}),
          ...(serializedInput ? { input: serializedInput } : {}),
        }
      }
      if (state.status === "completed") {
        return {
          type: "tool",
          tool: part.tool,
          status: "completed",
          ...(state.title ? { title: state.title } : {}),
          ...(serializedInput ? { input: serializedInput } : {}),
          output: state.output,
        }
      }
      return {
        type: "tool",
        tool: part.tool,
        status: "error",
        ...(serializedInput ? { input: serializedInput } : {}),
        error: state.error,
      }
    }
    return null
  }

  private toRemoteMessageRows(sessionID: string, messages: RemoteSessionMessage[]): AgentManagerMessageRow[] {
    return messages
      .map((message, index) => {
        const text = typeof message.text === "string" ? message.text.trim() : ""
        const reasoning = typeof message.reasoning === "string" ? message.reasoning.trim() : ""
        if (!text && !reasoning) {
          return null
        }
        const role = this.toRemoteMessageRole(message) === "User" ? "user" : "assistant"
        const createdAt =
          typeof message.ts === "number" && Number.isFinite(message.ts) ? new Date(message.ts).toISOString() : new Date().toISOString()
        const parts: AgentManagerMessagePartRow[] = []
        if (text) {
          parts.push({ type: "text", text })
        }
        if (reasoning) {
          parts.push({ type: "reasoning", text: reasoning })
        }
        return {
          id: `${sessionID}-${index}`,
          role,
          createdAt,
          parts,
        } satisfies AgentManagerMessageRow
      })
      .filter((row): row is AgentManagerMessageRow => !!row)
  }

  private normalizeImageUrls(rawImages?: string[]): string[] {
    if (!Array.isArray(rawImages)) {
      return []
    }
    return rawImages.filter((entry): entry is string => typeof entry === "string" && entry.startsWith("data:"))
  }

  private buildMessageParts(
    text: string,
    images?: string[],
  ): Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> {
    const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []
    if (text.trim().length > 0) {
      parts.push({ type: "text", text: text.trim() })
    }

    for (const image of this.normalizeImageUrls(images)) {
      const mimeMatch = /^data:([^;]+);/i.exec(image)
      const mime = mimeMatch?.[1] || "image/png"
      parts.push({ type: "file", mime, url: image })
    }

    return parts
  }

  private safeSerialize(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined
    }
    try {
      if (typeof value === "string") {
        return value
      }
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
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
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
    }

    .am-shell {
      display: grid;
      grid-template-columns: 250px 1fr;
      min-height: 100vh;
      max-height: 100vh;
    }

    .am-sidebar {
      border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-height: 100vh;
    }

    .am-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-height: 100vh;
    }

    .am-side-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 35px;
      padding: 0 12px;
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    }

    .am-side-title {
      margin: 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
    }

    .am-side-controls {
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
    }

    .am-primary-action {
      width: 100%;
      justify-content: flex-start;
      font-weight: 600;
      min-height: 36px;
    }

    .am-primary-action-active {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-color: var(--vscode-button-border, transparent);
    }

    .am-section-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .am-section-count {
      font-variant-numeric: tabular-nums;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 6px;
      font-size: 10px;
    }

    .am-bulk-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .am-bulk-row .button {
      width: 100%;
      justify-content: center;
    }

    .am-list {
      overflow: auto;
      flex: 1;
      padding: 2px 0;
      outline: none;
    }

    .am-list:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .am-session-row {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px;
      align-items: flex-start;
      margin-bottom: 0;
      padding: 0 8px;
    }

    .am-session-pick {
      margin-top: 10px;
      width: 16px;
      height: 16px;
      touch-action: manipulation;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }

    .am-session-row[data-picked="true"] .am-session-pick,
    .am-session-row[data-selected="true"] .am-session-pick,
    .am-session-row:hover .am-session-pick,
    .am-session-pick:focus-visible {
      opacity: 1;
      pointer-events: auto;
    }

    .am-session-btn {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      padding: 6px 8px;
      text-align: left;
      cursor: pointer;
      display: grid;
      gap: 4px;
      touch-action: manipulation;
      transition: border-color 120ms ease, background-color 120ms ease;
      min-height: 34px;
    }

    .am-session-btn:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .am-session-btn:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .am-session-btn[data-selected="true"] {
      border-color: transparent;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .am-session-title-row {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }

    .am-status-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      flex: none;
      margin-top: 2px;
    }

    .am-status-dot[data-status="idle"] {
      background: var(--vscode-terminal-ansiGreen, #33b07a);
    }

    .am-status-dot[data-status="busy"],
    .am-status-dot[data-status="retry"] {
      background: var(--vscode-progressBar-background, #4ea0f5);
      animation: am-dot-pulse 1.2s ease-in-out infinite;
    }

    .am-status-dot[data-status="unknown"] {
      background: var(--vscode-descriptionForeground);
      opacity: 0.6;
    }

    .am-session-title {
      font-size: 13px;
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .am-session-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      display: grid;
      gap: 2px;
      overflow-wrap: anywhere;
    }

    .am-badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .am-badge {
      font-size: 10px;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      border-radius: 999px;
      padding: 1px 6px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .am-badge[data-kind="cloud"] {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #4ea0f5) 60%, transparent 40%);
      color: var(--vscode-terminal-ansiBlue, #4ea0f5);
    }

    .am-badge[data-kind="approval"] {
      border-color: color-mix(in srgb, var(--vscode-testing-iconQueued, #cca700) 60%, transparent 40%);
      color: var(--vscode-testing-iconQueued, #cca700);
    }

    .am-detail {
      display: flex;
      flex-direction: column;
      gap: 0;
      min-height: 0;
      padding: 0;
      flex: 1;
      overflow: auto;
    }

    .am-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 12px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .am-session-summary {
      border: 0;
      border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
      border-radius: 0;
      padding: 10px 20px;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      gap: 8px;
    }

    .am-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
    }

    .am-title-block {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .am-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
      overflow-wrap: anywhere;
      line-height: 1.25;
      margin: 0;
    }

    .am-subtitle {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }

    .am-session-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .am-session-actions .button {
      min-height: 30px;
      padding: 4px 10px;
    }

    .am-approval-box {
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 8px;
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      display: grid;
      gap: 8px;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .am-messages {
      border: 0;
      border-radius: 0;
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 420px;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-messages-head {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      min-height: 44px;
    }

    .am-messages-head strong {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .am-message-list {
      padding: 0;
      overflow: auto;
      display: grid;
      gap: 0;
      align-content: flex-start;
      min-height: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-message-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
      background: transparent;
    }

    .am-message-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .am-message-item[data-role="user"] {
      border-left: 2px solid color-mix(in srgb, var(--vscode-terminal-ansiBlue, #4ea0f5) 45%, transparent 55%);
      padding-left: 18px;
    }

    .am-message-icon {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 1px;
      background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background) 16%);
    }

    .am-message-content-wrapper {
      min-width: 0;
      flex: 1;
      display: grid;
      gap: 4px;
    }

    .am-message-header {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex-wrap: wrap;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .am-message-author {
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .am-chip {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 6px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .am-message-ts {
      margin-left: auto;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.9;
    }

    .am-message-body {
      padding: 0;
      display: grid;
      gap: 8px;
      overflow-wrap: anywhere;
    }

    .am-text-part {
      white-space: pre-wrap;
      margin: 0;
      line-height: 1.45;
      font-size: 12px;
    }

    .am-reasoning {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-sideBar-background) 14%);
    }

    .am-reasoning > summary {
      cursor: pointer;
      padding: 6px 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
    }

    .am-reasoning-content {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 8px;
      white-space: pre-wrap;
      font-size: 12px;
    }

    .am-tool {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px;
      display: grid;
      gap: 8px;
      background: color-mix(in srgb, var(--vscode-editor-background) 84%, var(--vscode-sideBar-background) 16%);
    }

    .am-tool-head {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 0;
      flex-wrap: wrap;
      font-size: 12px;
    }

    .am-tool-name {
      font-weight: 600;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .am-tool-status {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .am-tool-status[data-status="pending"] {
      color: var(--vscode-testing-iconQueued, #cca700);
      border-color: color-mix(in srgb, var(--vscode-testing-iconQueued, #cca700) 60%, transparent 40%);
    }

    .am-tool-status[data-status="running"] {
      color: var(--vscode-terminal-ansiBlue, #4ea0f5);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #4ea0f5) 60%, transparent 40%);
    }

    .am-tool-status[data-status="completed"] {
      color: var(--vscode-terminal-ansiGreen, #33b07a);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen, #33b07a) 60%, transparent 40%);
    }

    .am-tool-status[data-status="error"] {
      color: var(--vscode-errorForeground, #f14c4c);
      border-color: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 60%, transparent 40%);
    }

    .am-tool-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }

    .am-tool-section > summary {
      cursor: pointer;
      padding: 6px 8px;
      font-size: 11px;
      user-select: none;
      color: var(--vscode-descriptionForeground);
    }

    .am-tool-pre {
      margin: 0;
      border-top: 1px solid var(--vscode-panel-border);
      padding: 8px;
      white-space: pre-wrap;
      max-height: 280px;
      overflow: auto;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-foreground);
    }

    .am-file {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px;
      display: grid;
      gap: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }

    .am-compose {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 12px 20px 18px;
      display: grid;
      gap: 8px;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-compose-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-height: 32px;
    }

    .am-empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .am-status-line {
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 6px 10px;
      min-height: 28px;
      font-variant-numeric: tabular-nums;
    }

    .warning-list {
      margin: 0;
      padding-left: 16px;
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: var(--vscode-inputValidation-warningForeground);
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
      min-height: 34px;
      font-size: 13px;
      touch-action: manipulation;
    }

    .text-area {
      min-height: 86px;
      resize: vertical;
    }

    .button {
      font: inherit;
      border: 1px solid transparent;
      border-radius: 2px;
      padding: 4px 12px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      touch-action: manipulation;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
    }

    .button.icon {
      width: 30px;
      min-width: 30px;
      height: 30px;
      min-height: 30px;
      padding: 0;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
    }

    .button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    .button.secondary {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .button.secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .button.warn {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border-color: var(--vscode-input-border);
    }

    .button.warn:hover:not(:disabled) {
      background: transparent;
      color: var(--vscode-errorForeground);
      border-color: var(--vscode-errorForeground);
    }

    .button.danger {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-errorForeground);
      color: var(--vscode-button-foreground);
    }

    .button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .button:active {
      transform: scale(0.98);
    }

    .muted {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
    }

    .checkbox input {
      margin: 0;
    }

    /* Old agent-manager parity: sidebar/session list visual language */
    .am-icon-btn {
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: inherit;
      border-radius: 3px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0.65;
      transition: opacity 120ms ease, background-color 120ms ease;
    }

    .am-icon-btn:hover:not(:disabled) {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }

    .am-icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .am-new-agent-item {
      margin: 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 9px 10px;
      text-align: left;
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 120ms ease;
    }

    .am-new-agent-item:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .am-new-agent-item.am-selected {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .am-sidebar-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
      letter-spacing: 0.04em;
    }

    .am-sidebar-section-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .am-session-list {
      flex: 1;
      overflow-y: auto;
      outline: none;
      padding-bottom: 6px;
    }

    .am-no-sessions {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: var(--vscode-font-size);
    }

    .am-session-item {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      padding: 5px 8px;
      cursor: pointer;
      border: 1px solid transparent;
      position: relative;
      color: inherit;
    }

    .am-session-item:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-list-hoverForeground);
    }

    .am-session-item.am-selected {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .am-session-item:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .am-status-icon {
      width: 14px;
      height: 14px;
      margin-top: 2px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      line-height: 1;
      color: var(--vscode-descriptionForeground);
    }

    .am-status-icon.am-idle {
      color: var(--vscode-charts-green, #89d185);
    }

    .am-status-icon.am-running {
      color: var(--vscode-progressBar-background, #4ea0f5);
      animation: am-spin 1s linear infinite;
    }

    .am-status-icon.am-retry {
      color: var(--vscode-charts-yellow, #cca700);
      animation: am-spin 1.1s linear infinite;
    }

    .am-status-icon.am-unknown {
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }

    .am-session-content {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }

    .am-session-label {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .am-session-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .am-meta-indicator {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      opacity: 0.9;
    }

    .am-meta-branch {
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Classic Agent Manager layout parity (old extension visual language) */
    .am-shell {
      display: flex;
      height: 100vh;
      min-height: 100vh;
      max-height: 100vh;
    }

    .am-sidebar {
      width: 250px;
      min-width: 210px;
      max-width: 340px;
      border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
      display: flex;
      flex-direction: column;
      max-height: 100vh;
    }

    .am-sidebar-header {
      height: 35px;
      padding: 0 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .am-sidebar-header .am-icon-btn {
      opacity: 0.6;
    }

    .am-sidebar-header .am-icon-btn:hover:not(:disabled) {
      opacity: 1;
    }

    .am-options-menu-container {
      position: relative;
    }

    .am-options-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      min-width: 180px;
      background: var(--vscode-menu-background, var(--vscode-dropdown-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 100;
      overflow: hidden;
      padding: 4px 0;
    }

    .am-options-item {
      width: 100%;
      border: none;
      background: transparent;
      color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
      text-align: left;
      padding: 7px 12px;
      font-size: 12px;
      cursor: pointer;
    }

    .am-options-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground));
    }

    .am-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      max-height: 100vh;
      background: var(--vscode-editor-background);
    }

    .am-detail {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    }

    .am-session-detail {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .am-new-agent-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin: 8px;
      border-radius: 4px;
      font-weight: 500;
      text-align: left;
    }

    .am-session-item {
      padding: 4px 8px;
      align-items: center;
      gap: 6px;
    }

    .am-session-label {
      font-size: 13px;
      font-weight: 300;
      line-height: 1.35;
      color: var(--vscode-foreground);
    }

    .am-session-meta {
      font-size: 11px;
      opacity: 0.9;
    }

    .am-status-line {
      display: none;
    }

    .am-detail-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-header-info {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 6px;
    }

    .am-header-title {
      font-size: 18px;
      font-weight: 600;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
    }

    .am-header-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      min-width: 0;
    }

    .am-header-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }

    .am-session-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .am-approval-box {
      margin-top: 2px;
      border-radius: 6px;
      background: var(--vscode-editor-background);
    }

    .am-approval-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .am-messages-container {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-messages-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .am-messages-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 100%;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .am-session-error-banner {
      margin: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      font-size: 12px;
    }

    .am-message-item {
      padding: 10px 20px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      border-bottom: 1px solid transparent;
    }

    .am-message-item:hover {
      background: var(--vscode-list-hoverBackground);
      color: var(--vscode-list-hoverForeground);
    }

    .am-user-message {
      border-left: 2px solid color-mix(in srgb, var(--vscode-terminal-ansiBlue, #4ea0f5) 45%, transparent 55%);
      padding-left: 18px;
    }

    .am-message-icon {
      margin-top: 2px;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 0;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }

    .am-message-content-wrapper {
      flex: 1;
      min-width: 0;
    }

    .am-message-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 4px;
      min-width: 0;
    }

    .am-message-author {
      font-size: 13px;
    }

    .am-message-chip {
      display: none;
    }

    .am-message-ts {
      font-size: 11px;
      margin-left: auto;
    }

    .am-message-body {
      font-size: 13px;
      line-height: 1.5;
    }

    .am-chat-input-container {
      padding: 12px 20px 20px;
      border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .am-input-shell {
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .am-chat-input {
      border: none;
      outline: none;
      resize: vertical;
      min-height: 82px;
      max-height: 280px;
      padding: 10px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-size: 13px;
      line-height: 1.45;
      width: 100%;
    }

    .am-chat-input:focus {
      outline: none;
    }

    .am-chat-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px 10px;
      border-top: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
    }

    .am-chat-input-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.85;
    }

    .am-chat-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
    }

    .am-chat-actions .button {
      min-height: 28px;
      padding: 3px 11px;
      font-size: 12px;
      border-radius: 4px;
    }

    .am-send-btn {
      font-size: 14px;
      line-height: 1;
    }

    .am-stop-btn {
      font-size: 12px;
      line-height: 1;
    }

    .am-center-form {
      width: 100%;
      max-width: 800px;
      height: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 20px;
      text-align: center;
    }

    .am-start-controls {
      width: 100%;
      display: grid;
      gap: 8px;
      margin-bottom: 2px;
    }

    .am-center-title {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
    }

    .am-center-subtitle {
      margin: 0 0 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .am-form-label {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .am-prompt-input {
      min-height: 120px;
      width: 100%;
      border-radius: 2px;
    }

    .am-branch-input {
      min-height: 34px;
    }

    .am-session-item.am-selected .am-session-label,
    .am-session-item.am-selected .am-session-meta {
      color: inherit;
    }

    .am-session-item.am-selected .am-meta-indicator {
      opacity: 0.95;
    }

    .am-share-btn {
      opacity: 0;
      margin-left: 4px;
      flex-shrink: 0;
    }

    .am-session-item:hover .am-share-btn,
    .am-session-item.am-selected .am-share-btn {
      opacity: 0.7;
    }

    .am-share-confirm {
      position: absolute;
      top: calc(100% - 2px);
      left: 10px;
      right: 10px;
      z-index: 110;
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      background: var(--vscode-dropdown-background);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 8px;
      display: grid;
      gap: 8px;
    }

    .am-share-confirm-text {
      font-size: 12px;
      color: var(--vscode-foreground);
      line-height: 1.35;
    }

    .am-share-confirm-actions {
      display: flex;
      gap: 8px;
    }

    .am-share-confirm-actions .button {
      min-height: 24px;
      font-size: 11px;
      padding: 2px 10px;
    }

    .am-title-edit-container {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .am-title-input {
      flex: 1;
      min-width: 100px;
      padding: 2px 6px;
      font-size: 18px;
      font-weight: 600;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 3px;
      outline: none;
    }

    .am-title-confirm-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      background: transparent;
      border: none;
      color: var(--vscode-charts-green);
      cursor: pointer;
      border-radius: 3px;
      width: 24px;
      height: 24px;
    }

    .am-title-confirm-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .am-title-text {
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .am-title-text:hover {
      text-decoration: underline;
      text-decoration-style: dotted;
    }

    .am-title-edit-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .am-header-title:hover .am-title-edit-btn {
      opacity: 0.75;
    }

    .am-title-edit-btn:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }

    .am-new-input-shell {
      width: 100%;
      position: relative;
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
      overflow: hidden;
    }

    .am-new-input-shell:focus-within {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .am-new-agent-toolbar {
      position: absolute;
      left: 10px;
      right: 10px;
      bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      z-index: 4;
    }

    .am-new-input-fade {
      position: absolute;
      left: 1px;
      right: 1px;
      bottom: 0;
      height: 46px;
      background: linear-gradient(
        to top,
        var(--vscode-input-background) 55%,
        color-mix(in srgb, var(--vscode-input-background) 88%, transparent 12%) 78%,
        transparent
      );
      pointer-events: none;
      z-index: 2;
    }

    .am-new-images-row {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 44px;
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
      z-index: 5;
    }

    .am-new-image-thumb {
      position: relative;
      width: 34px;
      height: 34px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
      flex: none;
      background: var(--vscode-sideBar-background);
    }

    .am-new-image-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .am-new-image-remove {
      position: absolute;
      top: 1px;
      right: 1px;
      width: 14px;
      height: 14px;
      border: none;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-editor-background) 60%, black 40%);
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .am-new-image-remove:hover {
      background: color-mix(in srgb, var(--vscode-editor-background) 40%, black 60%);
    }

    .am-inline-select {
      min-height: 28px;
      max-width: 220px;
      font-size: 12px;
      padding: 3px 6px;
      border-radius: 4px;
    }

    .am-run-mode-dropdown-inline {
      position: relative;
      display: inline-block;
    }

    .am-run-mode-trigger-inline {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
      opacity: 0.6;
    }

    .am-run-mode-trigger-inline:hover:not(:disabled) {
      opacity: 1;
      color: var(--vscode-foreground);
      background-color: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .am-run-mode-trigger-inline:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .am-run-mode-trigger-inline .am-chevron {
      transition: transform 0.15s;
      opacity: 0.7;
    }

    .am-run-mode-trigger-inline .am-chevron.am-open {
      transform: rotate(180deg);
    }

    .am-run-mode-menu-inline {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 4px;
      min-width: 120px;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
      z-index: 100;
      overflow: hidden;
    }

    .am-run-mode-option-inline {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 10px;
      background: transparent;
      border: none;
      color: var(--vscode-dropdown-foreground);
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;
    }

    .am-run-mode-option-inline:hover:not(:disabled) {
      background: var(--vscode-list-hoverBackground);
    }

    .am-run-mode-option-inline.am-selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .am-version-count {
      font-size: 11px;
      font-weight: 500;
      margin-left: 2px;
    }

    .am-run-mode-trigger-inline.am-locked {
      opacity: 0.5;
      cursor: default;
    }

    .am-run-mode-trigger-inline.am-locked:hover {
      background: transparent;
      border-color: transparent;
    }

    .am-run-mode-trigger-inline.am-yolo-active {
      opacity: 1;
      color: var(--vscode-charts-yellow, #f5c518);
    }

    .am-run-mode-trigger-inline.am-yolo-active:hover:not(:disabled) {
      color: var(--vscode-charts-yellow, #f5c518);
    }

    .am-prompt-input {
      min-height: 240px;
      width: 100%;
      border-radius: 0;
      border: none;
      background: transparent;
      padding: 12px 14px 84px;
      line-height: 1.45;
      resize: none;
    }

    .am-prompt-input:focus {
      outline: none;
    }

    .am-run-mode-menu-inline[hidden] {
      display: none;
    }

    @keyframes am-spin {
      100% {
        transform: rotate(360deg);
      }
    }

    @keyframes am-dot-pulse {
      0% {
        transform: scale(1);
        opacity: 0.85;
      }
      50% {
        transform: scale(1.25);
        opacity: 1;
      }
      100% {
        transform: scale(1);
        opacity: 0.85;
      }
    }

    @media (max-width: 980px) {
      .am-shell {
        flex-direction: column;
      }

      .am-sidebar {
        width: 100%;
        max-height: min(45vh, 320px);
        border-right: 0;
        border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border));
      }

      .am-detail-header {
        flex-direction: column;
      }

      .am-header-actions {
        width: 100%;
        justify-content: flex-start;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .button,
      .am-icon-btn,
      .am-new-agent-item,
      .am-session-item {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <div class="am-shell">
    <aside class="am-sidebar">
      <div class="am-sidebar-header">
        <span>Agent Manager</span>
        <div class="am-options-menu-container">
          <button id="optionsBtn" class="am-icon-btn" type="button" aria-label="Options" title="Options">⋮</button>
          <div id="optionsMenu" class="am-options-dropdown" hidden>
            <button id="setupScriptBtn" class="am-options-item" type="button">Worktree Setup Script</button>
          </div>
        </div>
      </div>

      <button id="newSessionBtn" class="am-new-agent-item" type="button" aria-label="Start a new session">+ New Agent</button>

      <div class="am-sidebar-section-header">
        <span>Sessions</span>
        <div class="am-sidebar-section-actions">
          <button id="refreshBtn" class="am-icon-btn" type="button" aria-label="Refresh sessions" title="Refresh sessions">↻</button>
        </div>
      </div>

      <div id="warningBlock" hidden style="padding: 0 10px 8px;">
        <ul id="warningList" class="warning-list"></ul>
      </div>

      <div class="am-session-list" id="sessionList" tabindex="0" aria-label="Session list"></div>
    </aside>

    <main class="am-main">
      <div class="am-detail" id="detailPane"></div>
      <div class="am-status-line" id="statusLine"></div>
    </main>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()

    const state = {
      sessions: [],
      agents: [],
      defaultAgent: "code",
      workspaceDir: "",
      warnings: [],
      busy: false,
      selectedSessionId: null,
      messagesBySession: new Map(),
      createDraft: {
        prompt: "",
        agent: "code",
        parallel: false,
        branch: "",
        versions: 1,
        yoloMode: true,
        images: [],
      },
      shareConfirmSessionId: null,
      composeDraftBySession: new Map(),
      composeImagesBySession: new Map(),
      messageRefreshTimer: null,
    }

    const refreshBtn = document.getElementById("refreshBtn")
    const newSessionBtn = document.getElementById("newSessionBtn")
    const optionsBtn = document.getElementById("optionsBtn")
    const optionsMenu = document.getElementById("optionsMenu")
    const setupScriptBtn = document.getElementById("setupScriptBtn")
    const warningBlock = document.getElementById("warningBlock")
    const warningList = document.getElementById("warningList")
    const sessionList = document.getElementById("sessionList")
    const detailPane = document.getElementById("detailPane")
    const statusLine = document.getElementById("statusLine")

    function setStatus(message) {
      statusLine.textContent = message || ""
    }

    function setBusy(nextBusy) {
      state.busy = !!nextBusy
      refreshBtn.disabled = state.busy
      renderSidebar()
      renderDetail()
    }

    function isSessionActive(session) {
      return !!session && (session.status === "busy" || session.status === "retry")
    }

    function stopMessageRefreshTimer() {
      if (state.messageRefreshTimer !== null) {
        clearInterval(state.messageRefreshTimer)
        state.messageRefreshTimer = null
      }
    }

    function formatWhen(isoString) {
      const date = new Date(isoString)
      if (Number.isNaN(date.getTime())) {
        return isoString || ""
      }
      return date.toLocaleString()
    }

    function relativeWhen(isoString) {
      const date = new Date(isoString)
      if (Number.isNaN(date.getTime())) {
        return isoString || ""
      }
      const deltaMs = Date.now() - date.getTime()
      const sec = Math.max(1, Math.floor(deltaMs / 1000))
      if (sec < 60) {
        return sec + "s ago"
      }
      const min = Math.floor(sec / 60)
      if (min < 60) {
        return min + "m ago"
      }
      const hr = Math.floor(min / 60)
      if (hr < 24) {
        return hr + "h ago"
      }
      const day = Math.floor(hr / 24)
      return day + "d ago"
    }

    function clearNode(node) {
      while (node.firstChild) {
        node.removeChild(node.firstChild)
      }
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          resolve(typeof reader.result === "string" ? reader.result : "")
        }
        reader.onerror = () => {
          reject(reader.error || new Error("Failed to read image"))
        }
        reader.readAsDataURL(file)
      })
    }

    async function readImageFiles(fileList) {
      const files = Array.from(fileList || []).filter((file) => file && typeof file.type === "string" && file.type.startsWith("image/"))
      const urls = []
      for (const file of files) {
        try {
          const dataUrl = await readFileAsDataUrl(file)
          if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
            urls.push(dataUrl)
          }
        } catch {
          // Ignore failed files and continue with the rest.
        }
      }
      return urls
    }

    function makeButton(label, className, onClick, ariaLabel) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = className ? "button " + className : "button"
      button.textContent = label
      button.disabled = state.busy
      if (ariaLabel) {
        button.setAttribute("aria-label", ariaLabel)
      }
      button.addEventListener("click", onClick)
      return button
    }

    function toAgentOptions() {
      const fallback = state.defaultAgent || "code"
      return state.agents.length > 0 ? state.agents : [{ name: fallback, description: "" }]
    }

    function getSessionById(sessionID) {
      return state.sessions.find((session) => session.id === sessionID) || null
    }

    function updateMessageRefreshTimer() {
      stopMessageRefreshTimer()
      const selectedSession = state.selectedSessionId ? getSessionById(state.selectedSessionId) : null
      if (!selectedSession || selectedSession.source === "cloud" || !isSessionActive(selectedSession)) {
        return
      }
      state.messageRefreshTimer = setInterval(() => {
        const current = state.messagesBySession.get(selectedSession.id)
        if (current && current.loading) {
          return
        }
        requestSessionMessages(selectedSession.id, true)
      }, 2000)
    }

    function selectAdjacentSession(offset) {
      const rows = visibleSessions()
      if (rows.length === 0) {
        return
      }
      const currentIndex = rows.findIndex((session) => session.id === state.selectedSessionId)
      const nextIndex = currentIndex < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, currentIndex + offset))
      setSelectedSession(rows[nextIndex].id)
    }

    function visibleSessions() {
      return state.sessions
    }

    function sanitizeSelection() {
      const known = new Set(state.sessions.map((session) => session.id))
      if (state.selectedSessionId && !known.has(state.selectedSessionId)) {
        state.selectedSessionId = null
      }
    }

    function renderWarnings() {
      clearNode(warningList)
      if (!state.warnings || state.warnings.length === 0) {
        warningBlock.hidden = true
        return
      }
      for (const warning of state.warnings) {
        const row = document.createElement("li")
        row.textContent = warning
        warningList.appendChild(row)
      }
      warningBlock.hidden = false
    }

    function setSelectedSession(sessionID) {
      state.selectedSessionId = sessionID
      state.shareConfirmSessionId = null
      renderSidebar()
      renderDetail()
      updateMessageRefreshTimer()
      if (sessionID) {
        requestSessionMessages(sessionID, false)
      }
    }

    function requestSessionMessages(sessionID, force) {
      if (!sessionID) {
        return
      }

      const current = state.messagesBySession.get(sessionID)
      if (current && !force && !current.error && current.messages.length > 0) {
        return
      }

      state.messagesBySession.set(sessionID, {
        sessionID,
        loading: true,
        error: current ? current.error : undefined,
        source: current ? current.source : "local",
        canSendMessage: current ? current.canSendMessage : true,
        messages: current ? current.messages : [],
      })

      renderDetail()
      vscode.postMessage({ type: "loadSessionMessages", sessionID })
    }

    function makeBadge(text, kind) {
      const badge = document.createElement("span")
      badge.className = "am-badge"
      badge.textContent = text
      if (kind) {
        badge.dataset.kind = kind
      }
      return badge
    }

    function createSessionStatusIcon(session) {
      const icon = document.createElement("div")
      icon.className = "am-status-icon"
      if (session.status === "busy") {
        icon.classList.add("am-running")
        icon.textContent = "⟳"
        icon.title = "Running"
        return icon
      }
      if (session.status === "retry") {
        icon.classList.add("am-retry")
        icon.textContent = "⟳"
        icon.title = "Retrying"
        return icon
      }
      if (session.status === "idle") {
        icon.classList.add("am-idle")
        icon.textContent = "✓"
        icon.title = "Completed"
        return icon
      }
      icon.classList.add("am-unknown")
      icon.textContent = "○"
      icon.title = "Unknown"
      return icon
    }

    function renderSidebar() {
      clearNode(sessionList)

      const rows = visibleSessions()
      if (state.shareConfirmSessionId && !rows.some((session) => session.id === state.shareConfirmSessionId)) {
        state.shareConfirmSessionId = null
      }
      if (newSessionBtn) {
        newSessionBtn.classList.toggle("am-selected", !state.selectedSessionId)
      }

      if (rows.length === 0) {
        const empty = document.createElement("div")
        empty.className = "am-no-sessions"
        empty.textContent = "No active agents yet."
        sessionList.appendChild(empty)
        return
      }

      for (const session of rows) {
        const row = document.createElement("div")
        row.className = session.id === state.selectedSessionId ? "am-session-item am-selected" : "am-session-item"
        row.setAttribute("role", "button")
        row.setAttribute("tabindex", "0")
        row.setAttribute("aria-label", "Open session " + (session.title || session.id))
        row.addEventListener("click", () => {
          setSelectedSession(session.id)
        })
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setSelectedSession(session.id)
          }
        })

        const statusIcon = createSessionStatusIcon(session)

        const content = document.createElement("div")
        content.className = "am-session-content"

        const label = document.createElement("div")
        label.className = "am-session-label"
        label.textContent = session.title || "Untitled"

        const meta = document.createElement("div")
        meta.className = "am-session-meta"
        meta.textContent = relativeWhen(session.updatedAt)

        if (session.source === "cloud") {
          const cloud = document.createElement("span")
          cloud.className = "am-meta-indicator"
          cloud.title = "Cloud session"
          cloud.textContent = "☁ cloud"
          meta.appendChild(cloud)
        } else if (session.isWorktree) {
          const worktree = document.createElement("span")
          worktree.className = "am-meta-indicator"
          worktree.title = "Worktree session"
          worktree.textContent = "⑂ worktree"
          meta.appendChild(worktree)
        }

        if (session.branch) {
          const branch = document.createElement("span")
          branch.className = "am-meta-indicator"
          branch.title = session.branch
          const branchLabel = document.createElement("span")
          branchLabel.className = "am-meta-branch"
          branchLabel.textContent = session.branch
          branch.appendChild(document.createTextNode("⎇"))
          branch.appendChild(branchLabel)
          meta.appendChild(branch)
        }

        if (session.pendingApprovalCount > 0) {
          const approval = document.createElement("span")
          approval.className = "am-meta-indicator"
          approval.title = "Pending approval requests"
          approval.textContent =
            session.pendingApprovalCount + " approval" + (session.pendingApprovalCount === 1 ? "" : "s")
          meta.appendChild(approval)
        }

        content.appendChild(label)
        content.appendChild(meta)

        row.appendChild(statusIcon)
        row.appendChild(content)

        if (session.source === "local") {
          const shareBtn = document.createElement("button")
          shareBtn.type = "button"
          shareBtn.className = "am-icon-btn am-share-btn"
          shareBtn.textContent = "↗"
          shareBtn.title = "Share session"
          shareBtn.setAttribute("aria-label", "Share session")
          shareBtn.disabled = state.busy
          shareBtn.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()
            state.shareConfirmSessionId = state.shareConfirmSessionId === session.id ? null : session.id
            renderSidebar()
          })
          row.appendChild(shareBtn)

          if (state.shareConfirmSessionId === session.id) {
            const confirm = document.createElement("div")
            confirm.className = "am-share-confirm"
            confirm.addEventListener("click", (event) => {
              event.stopPropagation()
            })

            const confirmText = document.createElement("div")
            confirmText.className = "am-share-confirm-text"
            confirmText.textContent = "Would you like to publicly share a snapshot of this session?"
            confirm.appendChild(confirmText)

            const confirmActions = document.createElement("div")
            confirmActions.className = "am-share-confirm-actions"

            const yesBtn = document.createElement("button")
            yesBtn.type = "button"
            yesBtn.className = "button"
            yesBtn.textContent = "Yes"
            yesBtn.disabled = state.busy
            yesBtn.addEventListener("click", (event) => {
              event.preventDefault()
              event.stopPropagation()
              state.shareConfirmSessionId = null
              setBusy(true)
              setStatus("Sharing session...")
              vscode.postMessage({ type: "sessionShare", sessionID: session.id })
              renderSidebar()
            })

            const noBtn = document.createElement("button")
            noBtn.type = "button"
            noBtn.className = "button secondary"
            noBtn.textContent = "No"
            noBtn.disabled = state.busy
            noBtn.addEventListener("click", (event) => {
              event.preventDefault()
              event.stopPropagation()
              state.shareConfirmSessionId = null
              renderSidebar()
            })

            confirmActions.appendChild(yesBtn)
            confirmActions.appendChild(noBtn)
            confirm.appendChild(confirmActions)
            row.appendChild(confirm)
          }
        }

        sessionList.appendChild(row)
      }
    }

    function appendToolSection(parent, title, content, defaultOpen) {
      if (!content || !String(content).trim()) {
        return
      }

      const section = document.createElement("details")
      section.className = "am-tool-section"
      section.open = !!defaultOpen

      const summary = document.createElement("summary")
      summary.textContent = title

      const pre = document.createElement("pre")
      pre.className = "am-tool-pre"
      pre.textContent = String(content)

      section.appendChild(summary)
      section.appendChild(pre)
      parent.appendChild(section)
    }

    function renderMessagePart(part) {
      if (!part || typeof part !== "object") {
        return null
      }

      if (part.type === "text") {
        const text = document.createElement("pre")
        text.className = "am-text-part"
        text.textContent = part.text || ""
        return text
      }

      if (part.type === "reasoning") {
        const reasoning = document.createElement("details")
        reasoning.className = "am-reasoning"

        const summary = document.createElement("summary")
        summary.textContent = "Reasoning"
        const body = document.createElement("div")
        body.className = "am-reasoning-content"
        body.textContent = part.text || ""

        reasoning.appendChild(summary)
        reasoning.appendChild(body)
        return reasoning
      }

      if (part.type === "file") {
        const file = document.createElement("div")
        file.className = "am-file"

        const title = document.createElement("strong")
        title.textContent = part.filename || "File"
        const mime = document.createElement("span")
        mime.textContent = part.mime || ""
        const url = document.createElement("span")
        url.textContent = part.url || ""

        file.appendChild(title)
        if (part.mime) {
          file.appendChild(mime)
        }
        if (part.url) {
          file.appendChild(url)
        }
        return file
      }

      if (part.type === "tool") {
        const tool = document.createElement("div")
        tool.className = "am-tool"

        const head = document.createElement("div")
        head.className = "am-tool-head"

        const name = document.createElement("span")
        name.className = "am-tool-name"
        name.textContent = part.title || part.tool || "Tool"

        const status = document.createElement("span")
        status.className = "am-tool-status"
        status.dataset.status = part.status || "pending"
        status.textContent = part.status || "pending"

        head.appendChild(name)
        head.appendChild(status)
        tool.appendChild(head)

        appendToolSection(tool, "Input", part.input, part.status === "error")
        appendToolSection(tool, "Output", part.output, part.status !== "pending")
        appendToolSection(tool, "Error", part.error, true)

        return tool
      }

      return null
    }

    function renderMessagesForSession(session) {
      const wrap = document.createElement("div")
      wrap.className = "am-messages-container"

      const messageState = state.messagesBySession.get(session.id)

      const list = document.createElement("div")
      list.className = "am-messages-list"

      const canSendMessage = messageState ? !!messageState.canSendMessage : session.source !== "cloud"
      if (!messageState || messageState.loading) {
        const loading = document.createElement("div")
        loading.className = "am-messages-empty"
        loading.textContent = "Loading messages..."
        list.appendChild(loading)
      } else if (messageState.error) {
        const error = document.createElement("div")
        error.className = "am-session-error-banner"
        const text = document.createElement("div")
        text.textContent = "Failed to load messages: " + messageState.error
        const retry = makeButton("Retry", "secondary", () => requestSessionMessages(session.id, true), "Retry loading messages")
        error.appendChild(text)
        error.appendChild(retry)
        list.appendChild(error)
      } else if (!messageState.messages || messageState.messages.length === 0) {
        const empty = document.createElement("div")
        empty.className = "am-messages-empty"
        empty.textContent = "No messages yet. Continue this session below."
        list.appendChild(empty)
      } else {
        for (const message of messageState.messages) {
          const row = document.createElement("div")
          row.className = "am-message-item"
          if (message.role === "user") {
            row.classList.add("am-user-message")
          }

          const icon = document.createElement("div")
          icon.className = "am-message-icon"
          icon.textContent = message.role === "user" ? "👤" : "◉"

          const content = document.createElement("div")
          content.className = "am-message-content-wrapper"

          const rowHead = document.createElement("div")
          rowHead.className = "am-message-header"

          const role = document.createElement("span")
          role.className = "am-message-author"
          role.textContent = message.role === "user" ? "User" : "Assistant"
          rowHead.appendChild(role)

          const when = document.createElement("span")
          when.className = "am-message-ts"
          when.textContent = formatWhen(message.createdAt)
          rowHead.appendChild(when)

          const body = document.createElement("div")
          body.className = "am-message-body"
          const parts = Array.isArray(message.parts) ? message.parts : []
          for (const part of parts) {
            const node = renderMessagePart(part)
            if (node) {
              body.appendChild(node)
            }
          }
          if (body.childElementCount === 0) {
            const fallback = document.createElement("div")
            fallback.className = "muted"
            fallback.textContent = "No renderable content."
            body.appendChild(fallback)
          }

          content.appendChild(rowHead)
          content.appendChild(body)

          row.appendChild(icon)
          row.appendChild(content)
          list.appendChild(row)
        }
      }

      const compose = document.createElement("form")
      compose.className = "am-chat-input-container"

      const shell = document.createElement("div")
      shell.className = "am-input-shell"

      const draft = state.composeDraftBySession.get(session.id) || ""
      const input = document.createElement("textarea")
      input.className = "text-area am-chat-input"
      input.placeholder =
        !canSendMessage
          ? "This session cannot be continued directly"
          : session.source === "cloud"
          ? "Type your task here..."
          : "Type your task here..."
      input.value = draft
      input.disabled = state.busy || !canSendMessage
      input.spellcheck = false
      input.addEventListener("input", () => {
        state.composeDraftBySession.set(session.id, input.value)
      })
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault()
          compose.requestSubmit()
        }
      })

      const composeActions = document.createElement("div")
      composeActions.className = "am-chat-toolbar"

      const hint = document.createElement("span")
      hint.className = "am-chat-input-hint"
      const updateHint = () => {
        if (!canSendMessage) {
          hint.textContent = "This session cannot be continued directly"
          return
        }
        const imageCount = (state.composeImagesBySession.get(session.id) || []).length
        hint.textContent =
          imageCount > 0
            ? imageCount + " image" + (imageCount === 1 ? "" : "s") + " attached"
            : "Press Enter to send, Shift+Enter for new line."
      }
      updateHint()

      const actionGroup = document.createElement("div")
      actionGroup.className = "am-chat-actions"

      const imageInput = document.createElement("input")
      imageInput.type = "file"
      imageInput.accept = "image/*"
      imageInput.multiple = true
      imageInput.hidden = true
      imageInput.disabled = state.busy || !canSendMessage
      imageInput.addEventListener("change", async () => {
        const nextImages = await readImageFiles(imageInput.files)
        imageInput.value = ""
        if (nextImages.length === 0) {
          return
        }
        const currentImages = state.composeImagesBySession.get(session.id) || []
        state.composeImagesBySession.set(session.id, [...currentImages, ...nextImages].slice(0, 8))
        updateHint()
        updateSendState()
      })

      const addImageBtn = document.createElement("button")
      addImageBtn.type = "button"
      addImageBtn.className = "button icon secondary"
      addImageBtn.textContent = "+"
      addImageBtn.title = "Add image"
      addImageBtn.setAttribute("aria-label", "Add image")
      addImageBtn.disabled = state.busy || !canSendMessage
      addImageBtn.addEventListener("click", () => {
        imageInput.click()
      })
      actionGroup.appendChild(imageInput)
      actionGroup.appendChild(addImageBtn)

      if (session.source !== "cloud" && isSessionActive(session)) {
        const stop = document.createElement("button")
        stop.type = "button"
        stop.className = "button icon secondary am-stop-btn"
        stop.textContent = "■"
        stop.title = "Cancel agent"
        stop.setAttribute("aria-label", "Cancel agent")
        stop.disabled = state.busy
        stop.addEventListener("click", () => {
          setBusy(true)
          setStatus("Aborting session...")
          vscode.postMessage({ type: "abortSession", sessionID: session.id })
        })
        actionGroup.appendChild(stop)
      }

      const send = document.createElement("button")
      send.type = "submit"
      send.className = "button icon am-send-btn"
      send.textContent = "➤"
      send.title = session.source === "cloud" ? "Resume local session" : "Send message"
      send.setAttribute("aria-label", session.source === "cloud" ? "Resume local session" : "Send message")
      const updateSendState = () => {
        const imageCount = (state.composeImagesBySession.get(session.id) || []).length
        send.disabled = state.busy || !canSendMessage || (input.value.trim().length === 0 && imageCount === 0)
      }
      updateSendState()

      input.addEventListener("input", () => {
        updateSendState()
      })

      compose.addEventListener("submit", (event) => {
        event.preventDefault()
        const text = input.value.trim()
        const images = state.composeImagesBySession.get(session.id) || []
        if (!text && images.length === 0) {
          return
        }

        setBusy(true)

        if (session.source === "cloud") {
          setStatus("Starting local continuation session...")
          vscode.postMessage({ type: "resumeRemoteSession", sessionID: session.id, text, images })
        } else {
          setStatus("Sending message...")
          vscode.postMessage({ type: "sendSessionMessage", sessionID: session.id, text, images })
        }

        state.composeDraftBySession.set(session.id, "")
        state.composeImagesBySession.set(session.id, [])
        input.value = ""
        updateHint()
        updateSendState()
      })

      actionGroup.appendChild(send)
      composeActions.appendChild(hint)
      composeActions.appendChild(actionGroup)
      shell.appendChild(input)
      shell.appendChild(composeActions)
      compose.appendChild(shell)

      wrap.appendChild(list)
      wrap.appendChild(compose)

      return wrap
    }

    function renderSessionDetail(session) {
      const header = document.createElement("section")
      header.className = "am-detail-header"

      const headerInfo = document.createElement("div")
      headerInfo.className = "am-header-info"

      const title = document.createElement("div")
      title.className = "am-header-title"
      title.title = session.title || "Untitled"

      const renderReadOnlyTitle = () => {
        clearNode(title)
        const titleText = document.createElement("span")
        titleText.className = "am-title-text"
        titleText.textContent = session.title || "Untitled"
        titleText.setAttribute("role", "button")
        titleText.setAttribute("tabindex", "0")
        titleText.title = "Click to rename"

        const startEdit = () => {
          if (state.busy) {
            return
          }

          clearNode(title)
          const wrap = document.createElement("div")
          wrap.className = "am-title-edit-container"

          const input = document.createElement("input")
          input.type = "text"
          input.className = "am-title-input"
          input.value = session.title || "Untitled"
          input.setAttribute("aria-label", "Rename session")

          const commit = () => {
            const trimmed = input.value.trim()
            if (!trimmed || trimmed === (session.title || "Untitled")) {
              renderReadOnlyTitle()
              return
            }
            setBusy(true)
            setStatus("Renaming session...")
            vscode.postMessage({ type: "renameSession", sessionID: session.id, label: trimmed })
            renderReadOnlyTitle()
          }

          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              renderReadOnlyTitle()
            }
          })
          input.addEventListener("blur", () => {
            commit()
          })

          const confirmBtn = document.createElement("button")
          confirmBtn.type = "button"
          confirmBtn.className = "am-title-confirm-btn"
          confirmBtn.textContent = "✓"
          confirmBtn.title = "Confirm rename"
          confirmBtn.setAttribute("aria-label", "Confirm rename")
          confirmBtn.addEventListener("click", (event) => {
            event.preventDefault()
            commit()
          })

          wrap.appendChild(input)
          wrap.appendChild(confirmBtn)
          title.appendChild(wrap)
          window.setTimeout(() => {
            input.focus()
            input.select()
          }, 0)
        }

        titleText.addEventListener("click", () => {
          startEdit()
        })
        titleText.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            startEdit()
          }
        })

        const editBtn = document.createElement("button")
        editBtn.type = "button"
        editBtn.className = "am-title-edit-btn"
        editBtn.textContent = "✎"
        editBtn.title = "Rename session"
        editBtn.setAttribute("aria-label", "Rename session")
        editBtn.disabled = state.busy
        editBtn.addEventListener("click", (event) => {
          event.preventDefault()
          event.stopPropagation()
          startEdit()
        })

        title.appendChild(titleText)
        title.appendChild(editBtn)
      }
      renderReadOnlyTitle()

      const subtitle = document.createElement("div")
      subtitle.className = "am-header-meta"

      const updated = document.createElement("span")
      updated.textContent = "Updated " + relativeWhen(session.updatedAt)
      subtitle.appendChild(updated)

      const source = document.createElement("span")
      source.className = "am-meta-indicator"
      source.textContent = session.source === "cloud" ? "☁ Cloud" : "⌂ Local"
      subtitle.appendChild(source)

      if (session.isWorktree) {
        const worktree = document.createElement("span")
        worktree.className = "am-meta-indicator"
        worktree.textContent = "⑂ Worktree"
        subtitle.appendChild(worktree)
      }

      if (session.branch) {
        const branch = document.createElement("span")
        branch.className = "am-meta-indicator"
        branch.title = session.branch
        const branchLabel = document.createElement("span")
        branchLabel.className = "am-meta-branch"
        branchLabel.textContent = session.branch
        branch.appendChild(document.createTextNode("⎇"))
        branch.appendChild(branchLabel)
        subtitle.appendChild(branch)
      }

      if (session.pendingApprovalCount > 0) {
        const approvalCount = document.createElement("span")
        approvalCount.className = "am-meta-indicator"
        approvalCount.textContent =
          session.pendingApprovalCount + " approval" + (session.pendingApprovalCount === 1 ? "" : "s")
        subtitle.appendChild(approvalCount)
      }

      headerInfo.appendChild(title)
      headerInfo.appendChild(subtitle)

      const actions = document.createElement("div")
      actions.className = "am-header-actions"

      const terminalBtn = document.createElement("button")
      terminalBtn.type = "button"
      terminalBtn.className = "am-icon-btn"
      terminalBtn.textContent = "⌘"
      terminalBtn.title = "Open terminal"
      terminalBtn.setAttribute("aria-label", "Open terminal")
      terminalBtn.disabled = state.busy
      terminalBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "showTerminal", sessionID: session.id })
      })
      actions.appendChild(terminalBtn)

      header.appendChild(headerInfo)
      header.appendChild(actions)

      if (session.nextPendingApproval && session.nextPendingApproval.id) {
        const approval = document.createElement("div")
        approval.className = "am-approval-box"
        const description = document.createElement("div")
        const patternText = Array.isArray(session.nextPendingApproval.patterns) && session.nextPendingApproval.patterns.length > 0
          ? " | " + session.nextPendingApproval.patterns.slice(0, 4).join(", ")
          : ""
        description.textContent = "Pending permission: " + session.nextPendingApproval.permission + patternText
        approval.appendChild(description)

        const approvalActions = document.createElement("div")
        approvalActions.className = "am-approval-buttons"
        approvalActions.appendChild(
          makeButton("Allow Once", "secondary", () => {
            setBusy(true)
            setStatus("Responding to permission...")
            vscode.postMessage({
              type: "respondPermission",
              sessionID: session.id,
              permissionID: session.nextPendingApproval.id,
              response: "once",
            })
          }),
        )
        approvalActions.appendChild(
          makeButton("Allow Always", "secondary", () => {
            setBusy(true)
            setStatus("Responding to permission...")
            vscode.postMessage({
              type: "respondPermission",
              sessionID: session.id,
              permissionID: session.nextPendingApproval.id,
              response: "always",
            })
          }),
        )
        approvalActions.appendChild(
          makeButton("Deny", "warn", () => {
            setBusy(true)
            setStatus("Responding to permission...")
            vscode.postMessage({
              type: "respondPermission",
              sessionID: session.id,
              permissionID: session.nextPendingApproval.id,
              response: "reject",
            })
          }),
        )
        approval.appendChild(approvalActions)
        header.appendChild(approval)
      }

      return header
    }

    function renderNewSessionView() {
      const view = document.createElement("section")
      view.className = "am-session-detail"

      const form = document.createElement("form")
      form.className = "am-center-form"

      const options = toAgentOptions()
      const selectedAgent = state.createDraft.agent || state.defaultAgent || options[0].name

      const prompt = document.createElement("textarea")
      prompt.className = "text-area am-prompt-input"
      prompt.placeholder = "Type your task here..."
      prompt.value = state.createDraft.prompt || ""
      prompt.spellcheck = false
      prompt.autofocus = true
      prompt.rows = 8
      prompt.addEventListener("input", () => {
        state.createDraft.prompt = prompt.value
        updateCreateButton()
        updateToolbarHint()
      })

      prompt.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault()
          form.requestSubmit()
        }
      })

      const inputShell = document.createElement("div")
      inputShell.className = "am-new-input-shell"

      const inputFade = document.createElement("div")
      inputFade.className = "am-new-input-fade"
      inputFade.setAttribute("aria-hidden", "true")

      const imagesRow = document.createElement("div")
      imagesRow.className = "am-new-images-row"

      const renderNewImagePreviews = () => {
        clearNode(imagesRow)
        const images = Array.isArray(state.createDraft.images) ? state.createDraft.images : []
        imagesRow.hidden = images.length === 0
        for (const [index, image] of images.entries()) {
          const thumb = document.createElement("div")
          thumb.className = "am-new-image-thumb"

          const imageNode = document.createElement("img")
          imageNode.src = image
          imageNode.alt = "Selected image " + (index + 1)

          const removeBtn = document.createElement("button")
          removeBtn.type = "button"
          removeBtn.className = "am-new-image-remove"
          removeBtn.textContent = "×"
          removeBtn.title = "Remove image"
          removeBtn.setAttribute("aria-label", "Remove image " + (index + 1))
          removeBtn.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()
            const current = Array.isArray(state.createDraft.images) ? state.createDraft.images : []
            state.createDraft.images = current.filter((_, idx) => idx !== index)
            updateToolbarHint()
            updateCreateButton()
            renderNewImagePreviews()
          })

          thumb.appendChild(imageNode)
          thumb.appendChild(removeBtn)
          imagesRow.appendChild(thumb)
        }
      }

      const toolbar = document.createElement("div")
      toolbar.className = "am-new-agent-toolbar"

      const toolbarHint = document.createElement("div")
      toolbarHint.className = "am-chat-input-hint"
      const updateToolbarHint = () => {
        const imageCount = Array.isArray(state.createDraft.images) ? state.createDraft.images.length : 0
        toolbarHint.textContent =
          imageCount > 0
            ? imageCount + " image" + (imageCount === 1 ? "" : "s") + " attached"
            : "Press Enter to send, Shift+Enter for new line."
      }
      updateToolbarHint()
      toolbar.appendChild(toolbarHint)

      const actions = document.createElement("div")
      actions.className = "am-chat-actions"

      const createImageInput = document.createElement("input")
      createImageInput.type = "file"
      createImageInput.accept = "image/*"
      createImageInput.multiple = true
      createImageInput.hidden = true
      createImageInput.disabled = state.busy
      createImageInput.addEventListener("change", async () => {
        const newImages = await readImageFiles(createImageInput.files)
        createImageInput.value = ""
        if (newImages.length === 0) {
          return
        }
        const currentImages = Array.isArray(state.createDraft.images) ? state.createDraft.images : []
        state.createDraft.images = [...currentImages, ...newImages].slice(0, 8)
        updateToolbarHint()
        updateCreateButton()
        renderNewImagePreviews()
      })

      const addCreateImageBtn = document.createElement("button")
      addCreateImageBtn.type = "button"
      addCreateImageBtn.className = "am-run-mode-trigger-inline"
      addCreateImageBtn.textContent = "+"
      addCreateImageBtn.title = "Add image"
      addCreateImageBtn.setAttribute("aria-label", "Add image")
      addCreateImageBtn.disabled = state.busy
      addCreateImageBtn.addEventListener("click", () => {
        createImageInput.click()
      })
      actions.appendChild(createImageInput)
      actions.appendChild(addCreateImageBtn)

      const modeSelect = document.createElement("select")
      modeSelect.className = "select-input am-inline-select"
      for (const agent of options) {
        const option = document.createElement("option")
        option.value = agent.name
        option.textContent = agent.description ? agent.name + " - " + agent.description : agent.name
        option.selected = agent.name === selectedAgent
        modeSelect.appendChild(option)
      }
      modeSelect.addEventListener("change", () => {
        state.createDraft.agent = modeSelect.value
      })
      actions.appendChild(modeSelect)

      const yoloBtn = document.createElement("button")
      yoloBtn.type = "button"
      yoloBtn.className = "am-run-mode-trigger-inline"
      yoloBtn.textContent = "⚡"
      yoloBtn.title = "Toggle YOLO mode"
      yoloBtn.setAttribute("aria-label", "Toggle YOLO mode")
      yoloBtn.addEventListener("click", () => {
        state.createDraft.yoloMode = !state.createDraft.yoloMode
        yoloBtn.classList.toggle("am-yolo-active", !!state.createDraft.yoloMode)
      })
      yoloBtn.classList.toggle("am-yolo-active", !!state.createDraft.yoloMode)
      actions.appendChild(yoloBtn)

      const runModeWrap = document.createElement("div")
      runModeWrap.className = "am-run-mode-dropdown-inline"

      const runModeBtn = document.createElement("button")
      runModeBtn.type = "button"
      runModeBtn.className = "am-run-mode-trigger-inline"
      const runModeIcon = document.createElement("span")
      const runModeChevron = document.createElement("span")
      runModeChevron.className = "am-chevron"
      runModeChevron.textContent = "▾"

      const runModeMenu = document.createElement("div")
      runModeMenu.className = "am-run-mode-menu-inline"
      runModeMenu.hidden = true

      const updateRunModeTrigger = () => {
        runModeIcon.textContent = state.createDraft.parallel ? "⑂" : "⌂"
        runModeBtn.title = state.createDraft.parallel ? "Worktree" : "Local"
        runModeChevron.classList.toggle("am-open", !runModeMenu.hidden)
      }

      const makeRunModeOption = (label, value) => {
        const option = document.createElement("button")
        option.type = "button"
        option.className = "am-run-mode-option-inline"
        option.textContent = label
        option.addEventListener("click", () => {
          state.createDraft.parallel = value === "worktree"
          runModeMenu.hidden = true
          updateRunModeTrigger()
          updateBranchButton()
        })
        return option
      }

      runModeMenu.appendChild(makeRunModeOption("Local", "local"))
      runModeMenu.appendChild(makeRunModeOption("Worktree", "worktree"))
      runModeBtn.addEventListener("click", (event) => {
        event.preventDefault()
        runModeMenu.hidden = !runModeMenu.hidden
        updateRunModeTrigger()
      })
      runModeBtn.appendChild(runModeIcon)
      runModeBtn.appendChild(runModeChevron)
      runModeWrap.appendChild(runModeBtn)
      runModeWrap.appendChild(runModeMenu)
      actions.appendChild(runModeWrap)

      const versionsWrap = document.createElement("div")
      versionsWrap.className = "am-run-mode-dropdown-inline"

      const versionsBtn = document.createElement("button")
      versionsBtn.type = "button"
      versionsBtn.className = "am-run-mode-trigger-inline"
      const versionsIcon = document.createElement("span")
      versionsIcon.textContent = "◫"
      const versionsCount = document.createElement("span")
      versionsCount.className = "am-version-count"
      const versionsChevron = document.createElement("span")
      versionsChevron.className = "am-chevron"
      versionsChevron.textContent = "▾"

      const versionsMenu = document.createElement("div")
      versionsMenu.className = "am-run-mode-menu-inline"
      versionsMenu.hidden = true
      const updateVersionsTrigger = () => {
        const value = Number.isFinite(state.createDraft.versions) ? Number(state.createDraft.versions) : 1
        versionsCount.textContent = String(value)
        versionsChevron.classList.toggle("am-open", !versionsMenu.hidden)
      }

      const makeVersionOption = (count) => {
        const option = document.createElement("button")
        option.type = "button"
        option.className = "am-run-mode-option-inline"
        option.textContent = count + (count === 1 ? " version" : " versions")
        option.addEventListener("click", () => {
          state.createDraft.versions = count
          if (count > 1) {
            state.createDraft.parallel = true
          }
          versionsMenu.hidden = true
          updateVersionsTrigger()
          updateRunModeTrigger()
          updateBranchButton()
        })
        return option
      }

      versionsMenu.appendChild(makeVersionOption(1))
      versionsMenu.appendChild(makeVersionOption(2))
      versionsMenu.appendChild(makeVersionOption(3))
      versionsMenu.appendChild(makeVersionOption(4))
      versionsBtn.addEventListener("click", (event) => {
        event.preventDefault()
        versionsMenu.hidden = !versionsMenu.hidden
        updateVersionsTrigger()
      })
      versionsBtn.appendChild(versionsIcon)
      versionsBtn.appendChild(versionsCount)
      versionsBtn.appendChild(versionsChevron)
      versionsWrap.appendChild(versionsBtn)
      versionsWrap.appendChild(versionsMenu)
      actions.appendChild(versionsWrap)

      const branchBtn = document.createElement("button")
      branchBtn.type = "button"
      branchBtn.className = "am-run-mode-trigger-inline"
      branchBtn.title = "Select branch"
      branchBtn.setAttribute("aria-label", "Select branch")
      const updateBranchButton = () => {
        const visible = !!state.createDraft.parallel && Number(state.createDraft.versions || 1) === 1
        branchBtn.hidden = !visible
        branchBtn.textContent = state.createDraft.branch ? "⎇ " + state.createDraft.branch : "⎇ Select branch"
      }
      branchBtn.addEventListener("click", () => {
        const next = window.prompt("Branch name (optional)", state.createDraft.branch || "")
        if (next === null) {
          return
        }
        state.createDraft.branch = next.trim()
        updateBranchButton()
      })
      actions.appendChild(branchBtn)

      const create = document.createElement("button")
      create.type = "submit"
      create.className = "button icon am-send-btn"
      create.textContent = "➤"
      create.title = "Start agent"
      create.setAttribute("aria-label", "Start agent")
      create.disabled = state.busy || prompt.value.trim().length === 0

      const updateCreateButton = () => {
        const imageCount = Array.isArray(state.createDraft.images) ? state.createDraft.images.length : 0
        create.disabled = state.busy || (prompt.value.trim().length === 0 && imageCount === 0)
        createImageInput.disabled = state.busy
        addCreateImageBtn.disabled = state.busy
      }
      prompt.addEventListener("input", updateCreateButton)

      form.addEventListener("submit", (event) => {
        event.preventDefault()
        const text = prompt.value.trim()
        const images = Array.isArray(state.createDraft.images) ? state.createDraft.images : []
        if (!text && images.length === 0) {
          return
        }
        setBusy(true)
        setStatus("Creating session...")
        vscode.postMessage({
          type: "createSession",
          prompt: text,
          agent: modeSelect.value || state.defaultAgent,
          parallel: !!state.createDraft.parallel || Number(state.createDraft.versions || 1) > 1,
          branch: state.createDraft.branch || "",
          versions: Number(state.createDraft.versions || 1),
          yoloMode: !!state.createDraft.yoloMode,
          images,
        })
      })

      actions.appendChild(create)
      toolbar.appendChild(actions)
      inputShell.appendChild(prompt)
      inputShell.appendChild(inputFade)
      inputShell.appendChild(imagesRow)
      inputShell.appendChild(toolbar)
      form.appendChild(inputShell)
      updateRunModeTrigger()
      updateVersionsTrigger()
      updateBranchButton()
      updateCreateButton()
      updateToolbarHint()
      renderNewImagePreviews()

      view.appendChild(form)
      return view
    }

    function renderDetail() {
      clearNode(detailPane)

      const selectedSession = state.selectedSessionId ? getSessionById(state.selectedSessionId) : null
      if (!selectedSession) {
        detailPane.appendChild(renderNewSessionView())
        return
      }

      detailPane.appendChild(renderSessionDetail(selectedSession))
      detailPane.appendChild(renderMessagesForSession(selectedSession))
    }

    function renderAll() {
      sanitizeSelection()
      renderWarnings()
      renderSidebar()
      renderDetail()
      updateMessageRefreshTimer()
    }

    refreshBtn.addEventListener("click", () => {
      setBusy(true)
      setStatus("Refreshing sessions...")
      vscode.postMessage({ type: "refresh" })
    })

    function closeOptionsMenu() {
      if (optionsMenu) {
        optionsMenu.hidden = true
      }
    }

    if (optionsBtn && optionsMenu) {
      optionsBtn.addEventListener("click", (event) => {
        event.stopPropagation()
        optionsMenu.hidden = !optionsMenu.hidden
      })
      window.addEventListener("click", () => {
        closeOptionsMenu()
        if (state.shareConfirmSessionId) {
          state.shareConfirmSessionId = null
          renderSidebar()
        }
      })
    }

    if (setupScriptBtn) {
      setupScriptBtn.addEventListener("click", () => {
        closeOptionsMenu()
        vscode.postMessage({ type: "configureSetupScript" })
      })
    }

    sessionList.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        selectAdjacentSession(1)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        selectAdjacentSession(-1)
      }
    })

    newSessionBtn.addEventListener("click", () => {
      state.selectedSessionId = null
      state.shareConfirmSessionId = null
      renderSidebar()
      renderDetail()
      updateMessageRefreshTimer()
    })

    window.addEventListener("message", (event) => {
      const message = event.data
      if (!message || typeof message !== "object") {
        return
      }

      if (message.type === "agentManagerData") {
        state.sessions = Array.isArray(message.sessions) ? message.sessions : []
        state.agents = Array.isArray(message.agents) ? message.agents : []
        state.defaultAgent = typeof message.defaultAgent === "string" && message.defaultAgent ? message.defaultAgent : "code"
        state.workspaceDir = typeof message.workspaceDir === "string" ? message.workspaceDir : ""
        state.warnings = Array.isArray(message.errors) ? message.errors : []
        if (!state.createDraft.agent || !toAgentOptions().some((agent) => agent.name === state.createDraft.agent)) {
          state.createDraft.agent = state.defaultAgent
        }
        setBusy(false)
        renderAll()
        if (state.selectedSessionId) {
          requestSessionMessages(state.selectedSessionId, false)
        }
        setStatus("Ready")
        return
      }

      if (message.type === "agentManagerSessionStatus") {
        const index = state.sessions.findIndex((session) => session.id === message.sessionID)
        if (index >= 0) {
          state.sessions[index].status = message.status
        }
        renderSidebar()
        if (state.selectedSessionId === message.sessionID) {
          renderDetail()
        }
        updateMessageRefreshTimer()
        return
      }

      if (message.type === "agentManagerSessionMessages") {
        state.messagesBySession.set(message.sessionID, {
          sessionID: message.sessionID,
          loading: false,
          source: message.source,
          canSendMessage: !!message.canSendMessage,
          error: message.error,
          messages: Array.isArray(message.messages) ? message.messages : [],
        })
        if (state.selectedSessionId === message.sessionID) {
          renderDetail()
        }
        return
      }

      if (message.type === "agentManagerActionResult") {
        setBusy(false)

        if (message.success) {
          if (message.action === "createSession") {
            state.createDraft.prompt = ""
            state.createDraft.branch = ""
            state.createDraft.parallel = false
            state.createDraft.versions = 1
            state.createDraft.images = []
            if (message.sessionID) {
              state.selectedSessionId = message.sessionID
              requestSessionMessages(message.sessionID, true)
            }
          }
          if (
            (message.action === "sendSessionMessage" || message.action === "respondPermission" || message.action === "resumeRemoteSession") &&
            message.sessionID
          ) {
            requestSessionMessages(message.sessionID, true)
          }

          setStatus((message.action || "action") + " succeeded" + (message.message ? ": " + message.message : ""))
        } else {
          setStatus((message.action || "action") + " failed" + (message.message ? ": " + message.message : ""))
        }

        renderAll()
      }
    })

    setBusy(true)
    renderAll()
    setStatus("Loading sessions...")
    vscode.postMessage({ type: "ready" })
    window.addEventListener("beforeunload", () => {
      stopMessageRefreshTimer()
    })
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
