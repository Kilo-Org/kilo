import * as vscode from "vscode"
import type { KiloConnectionService, SessionInfo, HttpClient } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * Worktree sessions are fully set up (worktree + server session) before
 * the first message is sent. The interceptor on KiloProvider.attachToWebview
 * routes custom agent-manager messages (e.g., createWorktreeSession).
 * Directory resolution for worktree sessions is handled by KiloProvider's
 * sessionDirectories map, registered via setSessionDirectory() at creation time.
 */
export class AgentManagerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"

  private panel: vscode.WebviewPanel | undefined
  private provider: KiloProvider | undefined
  private outputChannel: vscode.OutputChannel
  private worktrees: WorktreeManager | undefined

  /** Per-session worktree metadata. Only populated for worktree sessions. */
  private meta = new Map<string, { branch: string; path: string; parentBranch: string }>()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.log("Opening Agent Manager panel")

    this.panel = vscode.window.createWebviewPanel(
      AgentManagerProvider.viewType,
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    this.panel.webview.html = this.getHtml(this.panel.webview)

    this.provider = new KiloProvider(this.extensionUri, this.connectionService)
    this.provider.attachToWebview(this.panel.webview, {
      onBeforeMessage: (msg) => this.onMessage(msg),
    })

    void this.recoverWorktrees()
    void this.sendRepoInfo()

    this.panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.provider?.dispose()
      this.provider = undefined
      this.panel = undefined
    })
  }

  // ---------------------------------------------------------------------------
  // Message interceptor
  // ---------------------------------------------------------------------------

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const type = msg.type as string

    // Custom agent-manager messages -- consumed here, never reach KiloProvider
    if (type === "agentManager.createWorktreeSession") return this.onCreateWorktreeSession(msg)
    if (type === "agentManager.requestRepoInfo") {
      void this.sendRepoInfo()
      return null
    }

    // After clearSession, re-register worktree sessions so SSE events keep flowing
    if (type === "clearSession") {
      void Promise.resolve().then(() => {
        if (!this.provider) return
        for (const id of this.meta.keys()) {
          this.provider.trackSession(id)
        }
      })
    }

    return msg
  }

  /**
   * Handle the full worktree session lifecycle for the first message.
   * Creates worktree + session, registers with KiloProvider, sends the first
   * message via httpClient directly.
   */
  private async onCreateWorktreeSession(msg: Record<string, unknown>): Promise<null> {
    const text = (msg.text as string) || ""
    let client: HttpClient

    try {
      client = this.connectionService.getHttpClient()
    } catch {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
      })
      return null
    }

    const mgr = this.getWorktreeManager()
    if (!mgr) {
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: "No workspace folder open" })
      return null
    }

    // Step 1: Create worktree
    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    let worktree: CreateWorktreeResult
    try {
      worktree = await mgr.createWorktree({ prompt: text || "agent-task" })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create worktree: ${err}`,
      })
      return null
    }

    // Step 2: Create session in worktree directory
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch: worktree.branch,
    })

    let session: SessionInfo
    try {
      session = await client.createSession(worktree.path)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      await mgr.removeWorktree(worktree.path)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
      })
      return null
    }

    // Step 3: Store meta + persist session ID
    this.meta.set(session.id, worktree)
    mgr
      .writeMetadata(worktree.path, session.id, worktree.parentBranch)
      .catch((err) => this.log(`Failed to persist worktree metadata: ${err}`))

    // Register with KiloProvider: set directory override so all operations for
    // this session use the worktree path, then register the session itself.
    if (this.provider) {
      this.provider.setSessionDirectory(session.id, worktree.path)
      this.provider.registerSession(session)
    }

    // Notify webview about worktree metadata (for badges/icons)
    this.postToWebview({
      type: "agentManager.sessionMeta",
      sessionId: session.id,
      mode: "worktree",
      branch: worktree.branch,
      path: worktree.path,
      parentBranch: worktree.parentBranch,
    })

    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
      sessionId: session.id,
      branch: worktree.branch,
    })

    // Step 4: Send the first message directly via httpClient
    const fileParts = ((msg.files ?? []) as Array<{ mime: string; url: string }>).map((f) => ({
      type: "file" as const,
      mime: f.mime,
      url: f.url,
    }))
    if (text || fileParts.length > 0) {
      try {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = [
          ...fileParts,
          ...(text ? [{ type: "text" as const, text }] : []),
        ]
        await client.sendMessage(session.id, parts, worktree.path, {
          providerID: msg.providerID as string | undefined,
          modelID: msg.modelID as string | undefined,
          agent: msg.agent as string | undefined,
        })
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error)
        this.postToWebview({ type: "error", message: `Failed to send message: ${err}` })
      }
    }

    this.log(`Worktree session ready: session=${session.id} branch=${worktree.branch}`)
    return null
  }

  // ---------------------------------------------------------------------------
  // Repo info
  // ---------------------------------------------------------------------------

  private async sendRepoInfo(): Promise<void> {
    const mgr = this.getWorktreeManager()
    if (!mgr) return
    try {
      const branch = await mgr.currentBranch()
      this.postToWebview({ type: "agentManager.repoInfo", branch })
    } catch (error) {
      this.log(`Failed to get current branch: ${error}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Worktree management
  // ---------------------------------------------------------------------------

  private async recoverWorktrees(): Promise<void> {
    const mgr = this.getWorktreeManager()
    if (!mgr) return

    try {
      const discovered = await mgr.discoverWorktrees()
      const recovered = discovered.filter((wt) => wt.sessionId)
      for (const wt of recovered) {
        this.meta.set(wt.sessionId!, { branch: wt.branch, path: wt.path, parentBranch: wt.parentBranch })
        this.provider?.setSessionDirectory(wt.sessionId!, wt.path)
        this.provider?.trackSession(wt.sessionId!)
        this.postToWebview({
          type: "agentManager.sessionMeta",
          sessionId: wt.sessionId!,
          mode: "worktree",
          branch: wt.branch,
          path: wt.path,
          parentBranch: wt.parentBranch,
        })
      }
      // Re-send the full session list so worktree sessions appear
      // (the initial loadSessions may have completed before recovery finished)
      if (recovered.length > 0) {
        this.provider?.refreshSessions()
      }
    } catch (error) {
      this.log(`Failed to discover worktrees: ${error}`)
    }
  }

  private getWorktreeManager(): WorktreeManager | undefined {
    if (this.worktrees) return this.worktrees
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) return undefined
    this.worktrees = new WorktreeManager(root, (msg) => this.outputChannel.appendLine(`[WorktreeManager] ${msg}`))
    return this.worktrees
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private postToWebview(message: Record<string, unknown>): void {
    if (this.panel?.webview) void this.panel.webview.postMessage(message)
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Agent Manager",
      port: this.connectionService.getServerInfo()?.port,
    })
  }

  public postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message)
  }

  public dispose(): void {
    this.provider?.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
