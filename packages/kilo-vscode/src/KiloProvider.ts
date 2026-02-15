import * as vscode from "vscode"
import path from "node:path"
import os from "node:os"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { z } from "zod"
import { diffLines } from "diff"
import {
  type CommandDefinition,
  type Config,
  type HttpClient,
  type McpConfig,
  type ProfileData,
  type SessionInfo,
  type SSEEvent,
  type KiloConnectionService,
  type MessagePart,
} from "./services/cli-backend"
import { handleChatCompletionRequest } from "./services/autocomplete/chat-autocomplete/handleChatCompletionRequest"
import { handleChatCompletionAccepted } from "./services/autocomplete/chat-autocomplete/handleChatCompletionAccepted"
import { readSettingsActiveTab, writeLastProviderAuth, writeSettingsActiveTab } from "./services/settings-sync"
import { logger } from "./utils/logger"
import { parseAllowedOpenExternalUrl } from "./utils/open-external"
import { captureTelemetryEvent, parseTelemetryProperties, telemetryEventNameSchema } from "./utils/telemetry"
import { RulesWorkflowsService } from "./services/settings/rules-workflows"
import {
  validateAutocompleteSettingUpdate,
  validateConfigPatch,
  validateSettingUpdate,
  type SettingsValidationIssue,
} from "./services/settings/validation"
import { MarketplaceService, marketplaceItemSchema, type MarketplaceItem } from "./services/marketplace"
import { evaluateMdmCompliance, loadMdmPolicyConfig, type MdmPolicyConfig } from "./services/mdm/mdm-policy"
const RETRY_ACTION_LABEL = "Retry"
const OPEN_PROFILE_ACTION_LABEL = "Open Profile"
const SIGN_IN_ACTION_LABEL = "Sign In"
const NOTIFICATION_DEDUPE_MS = 10_000
const ATTACHMENT_EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
}
const ATTACHMENT_MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
}
const MAX_PASTED_ATTACHMENT_BYTES = 10 * 1024 * 1024
const SESSION_HISTORY_CACHE_KEY = "kilo-code.new.session-history-cache.v1"

type GitResource = { resourceUri: vscode.Uri }
type GitRepository = {
  rootUri: vscode.Uri
  state: {
    indexChanges: GitResource[]
    workingTreeChanges: GitResource[]
    mergeChanges: GitResource[]
  }
}
type GitApi = { repositories: GitRepository[] }
type GitExtensionExports = { getAPI(version: 1): GitApi }

const webviewSessionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revert: z
    .object({
      messageID: z.string(),
    })
    .optional(),
  metadata: z
    .object({
      cost: z.number().optional(),
      model: z.string().optional(),
      messageCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
  summary: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
    })
    .optional(),
})

const webviewSessionsSchema = z.array(webviewSessionSchema)

const organizationAllowListSchema = z
  .object({
    allowAll: z.boolean().optional().default(true),
    providers: z
      .record(
        z.string(),
        z.object({
          allowAll: z.boolean().optional().default(true),
          models: z.array(z.string()).optional(),
        }),
      )
      .optional()
      .default({}),
  })
  .strict()

const extensionSettingsEnvelopeSchema = z
  .object({
    organization: z.record(z.string(), z.unknown()).optional(),
    user: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export class KiloProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "kilo-code.new.sidebarView"
  private static readonly notificationTimestamps = new Map<string, number>()

  private webview: vscode.Webview | null = null
  private currentSession: SessionInfo | null = null
  private connectionState: "connecting" | "connected" | "reconnecting" | "disconnected" | "error" = "connecting"
  private loginAttempt = 0
  private isWebviewReady = false
  /** Cached providersLoaded payload so requestProviders can be served before httpClient is ready */
  private cachedProvidersMessage: unknown = null
  /** Cached agentsLoaded payload so requestAgents can be served before httpClient is ready */
  private cachedAgentsMessage: unknown = null
  /** Cached configLoaded payload so requestConfig can be served before httpClient is ready */
  private cachedConfigMessage: unknown = null
  /** Cached extension policy payload for org/MDM-aware UX gating */
  private cachedExtensionPolicyMessage: unknown = null
  /** Local machine policy loaded from MDM config files when present. */
  private mdmPolicy: MdmPolicyConfig | null = null
  /** Most recent cloud profile payload; undefined means unknown/not fetched yet. */
  private latestProfileData: ProfileData | null | undefined = undefined

  private trackedSessionIds: Set<string> = new Set()
  private unsubscribeEvent: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private webviewMessageDisposable: vscode.Disposable | null = null
  private readonly attachmentTempDir = path.join(os.tmpdir(), "kilo-code-vscode-attachments")
  private readonly marketplaceService = new MarketplaceService()
  private readonly rulesWorkflowsService: RulesWorkflowsService

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.rulesWorkflowsService = new RulesWorkflowsService(extensionContext)
  }

  /**
   * Convenience getter that returns the shared HttpClient or null if not yet connected.
   * Preserves the existing null-check pattern used throughout handler methods.
   */
  private get httpClient(): HttpClient | null {
    try {
      return this.connectionService.getHttpClient()
    } catch {
      return null
    }
  }

  private async loadMdmPolicy(): Promise<void> {
    try {
      this.mdmPolicy = await loadMdmPolicyConfig(this.extensionContext.extensionMode !== vscode.ExtensionMode.Production)
      if (this.mdmPolicy) {
        logger.info(`[Kilo New] MDM policy loaded from ${this.mdmPolicy.sourcePath}`)
      }
    } catch (error) {
      this.mdmPolicy = null
      logger.error("[Kilo New] Failed to load MDM policy:", error)
    }
  }

  private async pushProfileData(profileData: ProfileData | null): Promise<void> {
    this.latestProfileData = profileData
    this.postMessage({ type: "profileData", data: profileData })
    await this.fetchAndSendExtensionPolicy()
  }

  private async ensureMdmComplianceOrReject(action: "create-session" | "send-message"): Promise<boolean> {
    if (!this.mdmPolicy?.requireCloudAuth) {
      return true
    }

    const client = this.httpClient
    if (this.latestProfileData === undefined && client) {
      try {
        const profileData = await client.getProfile()
        await this.pushProfileData(profileData)
      } catch (error) {
        logger.debug("[Kilo New] Failed to fetch profile for MDM compliance check", error)
      }
    }

    const compliance = evaluateMdmCompliance(this.mdmPolicy, this.latestProfileData)
    if (compliance.compliant) {
      return true
    }

    const actionLabel = action === "create-session" ? "create a new task" : "send messages"
    const message = `${compliance.reason} Unable to ${actionLabel}.`
    this.postMessage({ type: "error", message })
    this.postMessage({ type: "navigate", view: "profile" })

    if (this.shouldShowNotification(`mdm-noncompliant:${compliance.reason}`)) {
      void vscode.window
        .showWarningMessage(message, OPEN_PROFILE_ACTION_LABEL, SIGN_IN_ACTION_LABEL)
        .then((selection) => {
          if (selection === OPEN_PROFILE_ACTION_LABEL) {
            void vscode.commands.executeCommand("kilo-code.new.sidebarView.focus")
            this.postMessage({ type: "navigate", view: "profile" })
            return
          }
          if (selection === SIGN_IN_ACTION_LABEL) {
            void vscode.commands.executeCommand("kilo-code.new.sidebarView.focus")
            this.postMessage({ type: "navigate", view: "profile" })
            void this.handleLogin()
          }
        })
    }

    return false
  }

  /**
   * Synchronize current extension-side state to the webview.
   * This is primarily used after a webview refresh where early postMessage calls
   * may have been dropped before the webview registered its message listeners.
   */
  private async syncWebviewState(reason: string): Promise<void> {
    const serverInfo = this.connectionService.getServerInfo()
    logger.debug("[Kilo New] KiloProvider: 🔄 syncWebviewState()", {
      reason,
      isWebviewReady: this.isWebviewReady,
      connectionState: this.connectionState,
      hasHttpClient: !!this.httpClient,
      hasServerInfo: !!serverInfo,
    })

    if (!this.isWebviewReady) {
      logger.debug("[Kilo New] KiloProvider: ⏭️ syncWebviewState skipped (webview not ready)")
      return
    }

    // Always push connection state first so the UI can render appropriately.
    this.postMessage({
      type: "connectionState",
      state: this.connectionState,
    })

    // Re-send ready so the webview can recover after refresh.
    if (serverInfo) {
      const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
      this.postMessage({
        type: "ready",
        serverInfo,
        vscodeLanguage: vscode.env.language,
        languageOverride: langConfig.get<string>("language"),
      })
    }
    this.sendSettingsUiState()
    this.sendCommandApprovalSettings()
    this.sendGatewayPreference()
    if (this.cachedExtensionPolicyMessage) {
      this.postMessage(this.cachedExtensionPolicyMessage)
    }

    // Always attempt to fetch+push profile when connected.
    if (this.connectionState === "connected" && this.httpClient) {
      logger.debug("[Kilo New] KiloProvider: 👤 syncWebviewState fetching profile...")
      try {
        const profileData = await this.httpClient.getProfile()
        logger.debug("[Kilo New] KiloProvider: 👤 syncWebviewState profile:", profileData ? "received" : "null")
        await this.pushProfileData(profileData)
      } catch (error) {
        logger.error("[Kilo New] KiloProvider: ❌ syncWebviewState failed to fetch profile:", error)
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    // Store the webview references
    this.isWebviewReady = false
    this.webview = webviewView.webview

    // Set up webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    }

    // Set HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(webviewView.webview)

    // Initialize connection to CLI backend
    this.initializeConnection()
  }

  /**
   * Resolve a WebviewPanel for displaying the Kilo webview in an editor tab.
   */
  public resolveWebviewPanel(panel: vscode.WebviewPanel): void {
    // WebviewPanel can be restored/reloaded; ensure we don't treat it as ready prematurely.
    this.isWebviewReady = false
    this.webview = panel.webview

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    }

    panel.webview.html = this._getHtmlForWebview(panel.webview)

    // Handle messages from webview (shared handler)
    this.setupWebviewMessageHandler(panel.webview)

    this.initializeConnection()
  }

  /**
   * Set up the shared message handler for both sidebar and tab webviews.
   * Handles ALL message types so tabs have full functionality.
   */
  private setupWebviewMessageHandler(webview: vscode.Webview): void {
    this.webviewMessageDisposable?.dispose()
    this.webviewMessageDisposable = webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "webviewReady":
          logger.debug("[Kilo New] KiloProvider: ✅ webviewReady received")
          this.isWebviewReady = true
          await this.syncWebviewState("webviewReady")
          break
        case "sendMessage": {
          const files = z
            .array(z.object({ mime: z.string(), url: z.string().startsWith("file://") }))
            .optional()
            .catch(undefined)
            .parse(message.files)
          await this.handleSendMessage(
            message.text,
            message.sessionID,
            message.providerID,
            message.modelID,
            message.agent,
            files,
          )
          break
        }
        case "abort":
          await this.handleAbort(message.sessionID)
          break
        case "permissionResponse":
          await this.handlePermissionResponse(message.permissionId, message.sessionID, message.response)
          break
        case "createSession":
          await this.handleCreateSession()
          break
        case "clearSession":
          this.currentSession = null
          this.trackedSessionIds.clear()
          break
        case "loadMessages":
          await this.handleLoadMessages(message.sessionID)
          break
        case "createTodo":
          if (typeof message.content === "string") {
            await this.handleCreateTodo(message.sessionID, message.content, message.status, message.priority)
          }
          break
        case "updateTodo":
          if (typeof message.todoID === "string") {
            await this.handleUpdateTodo(
              message.sessionID,
              message.todoID,
              typeof message.content === "string" ? message.content : undefined,
              message.status,
              message.priority,
            )
          }
          break
        case "deleteTodo":
          if (typeof message.todoID === "string") {
            await this.handleDeleteTodo(message.sessionID, message.todoID)
          }
          break
        case "loadSessions":
          await this.handleLoadSessions()
          break
        case "requestMarketplaceData":
          await this.handleRequestMarketplaceData()
          break
        case "installMarketplaceItem":
          await this.handleInstallMarketplaceItem(message.item, message.target, message.selectedIndex, message.parameters)
          break
        case "removeMarketplaceItem":
          await this.handleRemoveMarketplaceItem(message.item, message.target)
          break
        case "telemetryEvent":
          this.handleTelemetryEvent(message.event, message.properties)
          break
        case "login":
          await this.handleLogin()
          break
        case "cancelLogin":
          this.loginAttempt++
          this.postMessage({ type: "deviceAuthCancelled" })
          break
        case "logout":
          await this.handleLogout()
          break
        case "setOrganization":
          if (typeof message.organizationId === "string" || message.organizationId === null) {
            await this.handleSetOrganization(message.organizationId)
          }
          break
        case "refreshProfile":
          await this.handleRefreshProfile()
          break
        case "openExternal":
          await this.openExternalFromWebview(message.url)
          break
        case "openMarkdownPreview":
          if (typeof message.text === "string") {
            await this.handleOpenMarkdownPreview(message.text)
          }
          break
        case "openFileAttachment": {
          const url = z.string().startsWith("file://").safeParse(message.url)
          if (url.success) {
            await this.handleOpenFileAttachment(url.data)
          }
          break
        }
        case "saveFileAttachment":
          if (typeof message.url === "string") {
            await this.handleSaveFileAttachment(
              message.url,
              typeof message.name === "string" ? message.name : undefined,
              typeof message.mime === "string" ? message.mime : undefined,
            )
          }
          break
        case "openFilePath":
          if (typeof message.path === "string") {
            await this.handleOpenFilePath(message.path)
          }
          break
        case "openDiffPreview":
          if (typeof message.before === "string" && typeof message.after === "string") {
            await this.handleOpenDiffPreview(
              typeof message.path === "string" ? message.path : undefined,
              message.before,
              message.after,
            )
          }
          break
        case "openBatchDiffPreview":
          if (Array.isArray(message.diffs)) {
            await this.handleOpenBatchDiffPreview(
              message.diffs
                .filter(
                  (entry: unknown): entry is { path?: string; before: string; after: string } =>
                    !!entry &&
                    typeof entry === "object" &&
                    typeof (entry as { before?: unknown }).before === "string" &&
                    typeof (entry as { after?: unknown }).after === "string",
                )
                .map((entry: { path?: string; before: string; after: string }) => ({
                  path: typeof entry.path === "string" ? entry.path : undefined,
                  before: entry.before,
                  after: entry.after,
                })),
            )
          }
          break
        case "openTerminal":
          await this.handleOpenTerminal(message.cwd, message.command)
          break
        case "revertMessage":
          if (typeof message.messageID === "string") {
            await this.handleRevertMessage(message.sessionID, message.messageID)
          }
          break
        case "forkSession":
          await this.handleForkSession(message.sessionID, message.messageID)
          break
        case "openForkSessionPicker":
          await this.handleOpenForkSessionPicker(message.sessionID)
          break
        case "openCheckpointPicker":
          await this.handleOpenCheckpointPicker(message.sessionID)
          break
        case "unrevertSession":
          await this.handleUnrevertSession(message.sessionID)
          break
        case "pasteAttachments": {
          const files = z
            .array(
              z.object({
                mime: z.string(),
                name: z.string().optional(),
                dataUrl: z.string().startsWith("data:"),
              }),
            )
            .safeParse(message.files)
          if (files.success) {
            await this.handlePasteAttachments(files.data)
          }
          break
        }
        case "selectFiles":
          await this.handleSelectFiles()
          break
        case "requestProviders":
          await this.fetchAndSendProviders()
          break
        case "requestSettingsUiState":
          this.sendSettingsUiState()
          break
        case "settingsTabChanged":
          await writeSettingsActiveTab(this.extensionContext, message.tab)
          break
        case "connectProviderAuth":
          await this.handleConnectProviderAuth(message.providerID)
          break
        case "disconnectProviderAuth":
          await this.handleDisconnectProviderAuth(message.providerID)
          break
        case "compact":
          await this.handleCompact(message.sessionID, message.providerID, message.modelID)
          break
        case "requestAgents":
          await this.fetchAndSendAgents()
          break
        case "questionReply":
          await this.handleQuestionReply(message.requestID, message.answers)
          break
        case "questionReject":
          await this.handleQuestionReject(message.requestID)
          break
        case "requestConfig":
          await this.fetchAndSendConfig()
          break
        case "requestRulesCatalog":
          await this.handleRequestRulesCatalog()
          break
        case "createRuleFile":
          await this.handleCreateRuleFile(message.kind, message.scope, message.filename)
          break
        case "openRuleFile":
          await this.handleOpenRuleFile(message.kind, message.scope, message.path)
          break
        case "deleteRuleFile":
          await this.handleDeleteRuleFile(message.kind, message.scope, message.path)
          break
        case "toggleRuleFile":
          await this.handleToggleRuleFile(message.kind, message.scope, message.path, message.enabled)
          break
        case "requestSlashCommands":
          await this.handleRequestSlashCommands()
          break
        case "requestMcpStatus":
          await this.fetchAndSendMcpStatus()
          break
        case "addMcpServer":
          await this.handleAddMcpServer(message.name, message.config)
          break
        case "connectMcpServer":
          await this.handleConnectMcpServer(message.name)
          break
        case "disconnectMcpServer":
          await this.handleDisconnectMcpServer(message.name)
          break
        case "updateConfig": {
          const validated = validateConfigPatch(message.config)
          if (!validated.ok) {
            this.postConfigValidationError(validated.issues)
            await this.fetchAndSendConfig()
            break
          }
          await this.handleUpdateConfig(validated.value)
          break
        }
        case "setLanguage":
          await vscode.workspace
            .getConfiguration("kilo-code.new")
            .update("language", message.locale || undefined, vscode.ConfigurationTarget.Global)
          break
        case "requestAutocompleteSettings":
          this.sendAutocompleteSettings()
          break
        case "updateAutocompleteSetting": {
          const validated = validateAutocompleteSettingUpdate(message.key, message.value)
          if (!validated.ok) {
            this.postSettingValidationError(typeof message.key === "string" ? message.key : undefined, validated.issues)
            this.sendAutocompleteSettings()
            break
          }

          await vscode.workspace
            .getConfiguration("kilo-code.new.autocomplete")
            .update(validated.value.key, validated.value.value, vscode.ConfigurationTarget.Global)
          this.sendAutocompleteSettings()
          break
        }
        case "requestChatCompletion":
          void handleChatCompletionRequest(
            { type: "requestChatCompletion", text: message.text, requestId: message.requestId },
            { postMessage: (msg) => this.postMessage(msg) },
            this.connectionService,
          )
          break
        case "chatCompletionAccepted":
          handleChatCompletionAccepted({ type: "chatCompletionAccepted", suggestionLength: message.suggestionLength })
          break
        case "deleteSession":
          await this.handleDeleteSession(message.sessionID)
          break
        case "renameSession":
          await this.handleRenameSession(message.sessionID, message.title)
          break
        case "updateSetting": {
          const validated = validateSettingUpdate(message.key, message.value)
          if (!validated.ok) {
            this.postSettingValidationError(typeof message.key === "string" ? message.key : undefined, validated.issues)
            this.sendBrowserSettings()
            this.sendNotificationSettings()
            break
          }

          await this.handleUpdateSetting(validated.value.key, validated.value.value)
          if (validated.value.key.startsWith("browserAutomation.")) {
            this.sendBrowserSettings()
          }
          if (validated.value.key.startsWith("model.")) {
            await this.fetchAndSendProviders()
          }
          if (validated.value.key.startsWith("notifications.") || validated.value.key.startsWith("sounds.")) {
            this.sendNotificationSettings()
          }
          if (validated.value.key === "allowedCommands" || validated.value.key === "deniedCommands") {
            this.sendCommandApprovalSettings()
          }
          if (validated.value.key === "model.preferGatewayDefault") {
            this.sendGatewayPreference()
            await this.fetchAndSendProviders()
          }
          break
        }
        case "requestBrowserSettings":
          this.sendBrowserSettings()
          break
        case "requestNotificationSettings":
          this.sendNotificationSettings()
          break
        case "requestCommandApprovalSettings":
          this.sendCommandApprovalSettings()
          break
        case "requestGatewayPreference":
          this.sendGatewayPreference()
          break
        case "seeNewChanges":
          await this.handleSeeNewChanges(message.sessionID)
          break
        case "retryConnection":
          this.connectionState = "connecting"
          this.postMessage({ type: "connectionState", state: "connecting" })
          await this.initializeConnection()
          break
      }
    })
  }

  /**
   * Validate and open external URLs requested by the webview.
   * Only allows explicit safe schemes to reduce openExternal abuse.
   */
  private async openExternalFromWebview(rawUrl: unknown): Promise<void> {
    const safeUrl = parseAllowedOpenExternalUrl(rawUrl)
    if (!safeUrl) {
      logger.warn("[Kilo New] KiloProvider: Blocked openExternal request", { rawUrl })
      return
    }

    await vscode.env.openExternal(vscode.Uri.parse(safeUrl))
  }

  private async handleOpenMarkdownPreview(markdown: string): Promise<void> {
    const content = markdown.trim()
    if (!content) {
      return
    }

    try {
      const doc = await vscode.workspace.openTextDocument({ language: "markdown", content })
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Beside,
      })
      await vscode.commands.executeCommand("markdown.showPreviewToSide", doc.uri)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open markdown preview:", error)
    }
  }

  private getPrimaryWorkspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  private isRuleKind(value: unknown): value is "rule" | "workflow" {
    return value === "rule" || value === "workflow"
  }

  private isRuleScope(value: unknown): value is "global" | "local" {
    return value === "global" || value === "local"
  }

  private async handleRequestRulesCatalog(): Promise<void> {
    try {
      const catalog = await this.rulesWorkflowsService.list(this.getPrimaryWorkspacePath())
      this.postMessage({ type: "rulesCatalogLoaded", catalog })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to load rules/workflows catalog:", error)
      this.postMessage({
        type: "error",
        message: `Failed to load rules/workflows: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private async handleCreateRuleFile(kind: unknown, scope: unknown, filename: unknown): Promise<void> {
    if (!this.isRuleKind(kind) || !this.isRuleScope(scope) || typeof filename !== "string") {
      return
    }

    try {
      await this.rulesWorkflowsService.createFile({
        kind,
        scope,
        filename,
        workspaceDir: this.getPrimaryWorkspacePath(),
      })
      await this.handleRequestRulesCatalog()
    } catch (error) {
      this.postMessage({
        type: "error",
        message: `Failed to create ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private async handleOpenRuleFile(kind: unknown, scope: unknown, filePath: unknown): Promise<void> {
    if (!this.isRuleKind(kind) || !this.isRuleScope(scope) || typeof filePath !== "string") {
      return
    }

    try {
      await this.rulesWorkflowsService.openFile({
        kind,
        scope,
        filePath,
        workspaceDir: this.getPrimaryWorkspacePath(),
      })
    } catch (error) {
      this.postMessage({
        type: "error",
        message: `Failed to open ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private async handleDeleteRuleFile(kind: unknown, scope: unknown, filePath: unknown): Promise<void> {
    if (!this.isRuleKind(kind) || !this.isRuleScope(scope) || typeof filePath !== "string") {
      return
    }

    try {
      await this.rulesWorkflowsService.deleteFile({
        kind,
        scope,
        filePath,
        workspaceDir: this.getPrimaryWorkspacePath(),
      })
      await this.handleRequestRulesCatalog()
    } catch (error) {
      this.postMessage({
        type: "error",
        message: `Failed to delete ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private async handleToggleRuleFile(kind: unknown, scope: unknown, filePath: unknown, enabled: unknown): Promise<void> {
    if (!this.isRuleKind(kind) || !this.isRuleScope(scope) || typeof filePath !== "string" || typeof enabled !== "boolean") {
      return
    }

    try {
      await this.rulesWorkflowsService.toggleFile({
        kind,
        scope,
        filePath,
        enabled,
        workspaceDir: this.getPrimaryWorkspacePath(),
      })
      await this.handleRequestRulesCatalog()
    } catch (error) {
      this.postMessage({
        type: "error",
        message: `Failed to update ${kind}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private async handleOpenFileAttachment(fileUrl: string): Promise<void> {
    try {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(fileUrl))
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open file attachment:", error)
    }
  }

  private inferAttachmentFilename(rawUrl: string, rawName?: string, mime?: string): string {
    const explicitName = rawName?.trim()
    if (explicitName) {
      return explicitName.replace(/[\\/:*?"<>|]/g, "_")
    }

    try {
      if (rawUrl.startsWith("file://")) {
        const basename = path.basename(vscode.Uri.parse(rawUrl).fsPath)
        if (basename) {
          return basename
        }
      } else if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        const parsed = new URL(rawUrl)
        const basename = path.basename(decodeURIComponent(parsed.pathname))
        if (basename && basename !== "/" && basename !== ".") {
          return basename
        }
      }
    } catch {
      // Fall through to mime-derived fallback.
    }

    const extension = mime ? ATTACHMENT_MIME_TO_EXT[mime.toLowerCase()] : undefined
    return `attachment${extension ?? ""}`
  }

  private decodeDataUrl(dataUrl: string): Uint8Array {
    const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl)
    if (!match) {
      throw new Error("Invalid data URL")
    }
    const isBase64 = !!match[2]
    const payload = match[3] ?? ""
    const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8")
    return new Uint8Array(buffer)
  }

  private async readAttachmentBytes(rawUrl: string): Promise<Uint8Array> {
    if (rawUrl.startsWith("file://")) {
      return vscode.workspace.fs.readFile(vscode.Uri.parse(rawUrl))
    }
    if (rawUrl.startsWith("data:")) {
      return this.decodeDataUrl(rawUrl)
    }
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      const response = await fetch(rawUrl)
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`)
      }
      const bytes = await response.arrayBuffer()
      return new Uint8Array(bytes)
    }
    throw new Error("Unsupported attachment URL scheme")
  }

  private async handleSaveFileAttachment(rawUrl: string, rawName?: string, mime?: string): Promise<void> {
    const sourceUrl = rawUrl.trim()
    if (!sourceUrl) {
      return
    }

    try {
      const filename = this.inferAttachmentFilename(sourceUrl, rawName, mime)
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri
      const defaultUri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, filename)
        : vscode.Uri.file(path.join(os.homedir(), filename))

      const target = await vscode.window.showSaveDialog({
        defaultUri,
        saveLabel: "Save",
      })
      if (!target) {
        return
      }

      const bytes = await this.readAttachmentBytes(sourceUrl)
      await vscode.workspace.fs.writeFile(target, bytes)
      void vscode.window.showInformationMessage(`Saved attachment: ${path.basename(target.fsPath)}`)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to save file attachment:", { url: sourceUrl, error })
      void vscode.window.showErrorMessage(
        `Failed to save attachment: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }
  }

  private async handleOpenFilePath(rawPath: string): Promise<void> {
    const value = rawPath.trim()
    if (!value) {
      return
    }

    try {
      const uri = value.startsWith("file://")
        ? vscode.Uri.parse(value)
        : vscode.Uri.file(
            path.isAbsolute(value)
              ? value
              : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(), value),
          )
      await vscode.commands.executeCommand("vscode.open", uri)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open file path:", { path: value, error })
    }
  }

  private getDiffStats(before: string, after: string): { additions: number; deletions: number } {
    const chunks = diffLines(before, after)
    let additions = 0
    let deletions = 0
    for (const chunk of chunks) {
      if (chunk.added) {
        additions += chunk.count ?? 0
      } else if (chunk.removed) {
        deletions += chunk.count ?? 0
      }
    }
    return { additions, deletions }
  }

  private async handleOpenDiffPreview(
    rawPath: string | undefined,
    before: string,
    after: string,
    options?: { preview?: boolean },
  ): Promise<void> {
    try {
      const left = await vscode.workspace.openTextDocument({ content: before })
      const right = await vscode.workspace.openTextDocument({ content: after })
      const title = rawPath?.trim() ? `${path.basename(rawPath)} (before ↔ after)` : "Diff Preview"
      await vscode.commands.executeCommand("vscode.diff", left.uri, right.uri, title, {
        preview: options?.preview ?? true,
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open diff preview:", error)
    }
  }

  private async handleOpenBatchDiffPreview(
    diffs: Array<{ path?: string; before: string; after: string }>,
  ): Promise<void> {
    const validDiffs = diffs.filter((entry) => entry.before !== entry.after)
    if (validDiffs.length === 0) {
      return
    }

    if (validDiffs.length === 1) {
      const only = validDiffs[0]
      await this.handleOpenDiffPreview(only.path, only.before, only.after)
      return
    }

    type DiffPickItem = vscode.QuickPickItem & {
      index: number
      openAll?: boolean
    }

    const picks: DiffPickItem[] = [
      {
        label: "Open All Diffs",
        description: `${validDiffs.length} files`,
        detail: "Open all file diffs in editor tabs for batch review",
        index: -1,
        openAll: true,
      },
      ...validDiffs.map((entry, index) => {
        const stats = this.getDiffStats(entry.before, entry.after)
        const label = entry.path?.trim() ? entry.path : `Changed file ${index + 1}`
        return {
          label,
          description: `+${stats.additions} -${stats.deletions}`,
          detail: "Open this file diff",
          index,
        }
      }),
    ]

    const picked = await vscode.window.showQuickPick(picks, {
      title: `Review Changed Files (${validDiffs.length})`,
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (!picked) {
      return
    }

    if (picked.openAll) {
      for (const entry of validDiffs) {
        await this.handleOpenDiffPreview(entry.path, entry.before, entry.after, { preview: false })
      }
      return
    }

    const selected = validDiffs[picked.index]
    if (!selected) {
      return
    }
    await this.handleOpenDiffPreview(selected.path, selected.before, selected.after)
  }

  private resolveTerminalCwd(rawCwd: unknown): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    if (typeof rawCwd !== "string" || rawCwd.trim().length === 0) {
      return workspaceRoot
    }

    const trimmed = rawCwd.trim()
    const candidate = path.isAbsolute(trimmed) ? trimmed : path.resolve(workspaceRoot, trimmed)
    const normalizedRoot = path.resolve(workspaceRoot)
    const normalizedCandidate = path.resolve(candidate)
    const withinRoot =
      normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    return withinRoot ? normalizedCandidate : normalizedRoot
  }

  private async handleOpenTerminal(rawCwd: unknown, rawCommand: unknown): Promise<void> {
    const cwd = this.resolveTerminalCwd(rawCwd)
    const terminal = vscode.window.createTerminal({ name: "Kilo Code Terminal", cwd })
    terminal.show(false)

    if (typeof rawCommand === "string") {
      const command = rawCommand.trim()
      if (command.length > 0) {
        terminal.sendText(command, true)
      }
    }
  }

  private async handleSelectFiles(): Promise<void> {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach",
      filters: {
        "Images and PDFs": ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "pdf"],
        Images: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
        PDFs: ["pdf"],
      },
    })

    if (!fileUris || fileUris.length === 0) {
      return
    }

    type SelectedFile = { mime: string; url: string; name: string; previewUrl?: string }
    const files = fileUris
      .map<SelectedFile | null>((uri) => {
        const mime = this.getAttachmentMime(uri)
        if (!mime) return null
        const previewUrl =
          mime.startsWith("image/") && this.webview && this.canPreviewLocalResource(uri)
            ? this.webview.asWebviewUri(uri).toString()
            : undefined
        return {
          mime,
          url: uri.toString(),
          name: path.basename(uri.fsPath),
          previewUrl,
        }
      })
      .filter((file): file is SelectedFile => file !== null)

    if (files.length === 0) {
      return
    }

    this.postMessage({
      type: "filesSelected",
      files,
    })
  }

  private async handlePasteAttachments(files: Array<{ mime: string; name?: string; dataUrl: string }>): Promise<void> {
    if (files.length === 0) {
      return
    }

    await fs.mkdir(this.attachmentTempDir, { recursive: true })

    type SelectedFile = { mime: string; url: string; name: string; previewUrl?: string }
    const selectedFiles: SelectedFile[] = []

    for (const file of files) {
      const mime = file.mime.trim().toLowerCase()
      if (!mime.startsWith("image/") && mime !== "application/pdf") {
        continue
      }

      const bytes = this.decodeBase64DataUrl(file.dataUrl)
      if (!bytes || bytes.length === 0 || bytes.length > MAX_PASTED_ATTACHMENT_BYTES) {
        continue
      }

      const ext = this.getAttachmentExtensionForMime(mime, file.name)
      const stem = this.sanitizeAttachmentStem(file.name)
      const fileName = `${Date.now()}-${randomUUID()}-${stem}${ext}`
      const filePath = path.join(this.attachmentTempDir, fileName)

      try {
        await fs.writeFile(filePath, bytes)
      } catch (error) {
        logger.error("[Kilo New] KiloProvider: Failed to persist pasted attachment:", error)
        continue
      }

      const uri = vscode.Uri.file(filePath)
      selectedFiles.push({
        mime,
        url: uri.toString(),
        name: file.name || fileName,
        previewUrl:
          mime.startsWith("image/") && this.webview && this.canPreviewLocalResource(uri)
            ? this.webview.asWebviewUri(uri).toString()
            : undefined,
      })
    }

    if (selectedFiles.length === 0) {
      return
    }

    this.postMessage({
      type: "filesSelected",
      files: selectedFiles,
    })
  }

  private async handleSeeNewChanges(_sessionID?: string): Promise<void> {
    const git = await this.getGitApi()
    if (!git) {
      void vscode.window.showWarningMessage("Git integration is unavailable.")
      return
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      void vscode.window.showInformationMessage("Open a workspace folder to review changes.")
      return
    }

    const repo = git.repositories
      .filter(
        (candidate) =>
          workspaceFolder.uri.fsPath.startsWith(candidate.rootUri.fsPath) ||
          candidate.rootUri.fsPath.startsWith(workspaceFolder.uri.fsPath),
      )
      .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0]

    if (!repo) {
      void vscode.window.showInformationMessage("No Git repository found for this workspace.")
      return
    }

    const changes = [...repo.state.workingTreeChanges, ...repo.state.indexChanges, ...repo.state.mergeChanges]
    if (changes.length === 0) {
      void vscode.window.showInformationMessage("No new changes to review.")
      return
    }

    await vscode.commands.executeCommand("workbench.view.scm")
    const first = changes[0]
    if (!first?.resourceUri) {
      return
    }

    try {
      await vscode.commands.executeCommand("git.openChange", first.resourceUri)
    } catch {
      await vscode.commands.executeCommand("vscode.open", first.resourceUri)
    }
  }

  private async getGitApi(): Promise<GitApi | undefined> {
    const gitExtension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git")
    if (!gitExtension) {
      return undefined
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate()
    }

    return gitExtension.exports?.getAPI(1)
  }

  /**
   * Initialize connection to the CLI backend server.
   * Subscribes to the shared KiloConnectionService.
   */
  private async initializeConnection(): Promise<void> {
    logger.debug("[Kilo New] KiloProvider: 🔧 Starting initializeConnection...")

    // Clean up any existing subscriptions (e.g., sidebar re-shown)
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      await this.loadMdmPolicy()

      // Connect the shared service (no-op if already connected)
      await this.connectionService.connect(workspaceDir)

      // Subscribe to SSE events for this webview (filtered by tracked sessions)
      this.unsubscribeEvent = this.connectionService.onEventFiltered(
        (event) => {
          const sessionId = this.connectionService.resolveEventSessionId(event)

          // message.part.updated is always session-scoped; if we can't determine the session, drop it.
          if (!sessionId) {
            return event.type !== "message.part.updated"
          }

          return this.trackedSessionIds.has(sessionId)
        },
        (event) => {
          this.handleSSEEvent(event)
        },
      )

      // Subscribe to connection state changes
      this.unsubscribeState = this.connectionService.onStateChange(async (state) => {
        const previousState = this.connectionState
        this.connectionState = state
        this.postMessage({ type: "connectionState", state })

        if (state === "reconnecting" && previousState !== "reconnecting") {
          this.notifyConnectionLost()
        }

        if (state === "connected") {
          try {
            const client = this.httpClient
            if (client) {
              const profileData = await client.getProfile()
              await this.pushProfileData(profileData)
            }
            await this.syncWebviewState("sse-connected")
          } catch (error) {
            logger.error("[Kilo New] KiloProvider: ❌ Failed during connected state handling:", error)
            this.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : "Failed to sync after connecting",
            })
          }
        }
      })

      // Get current state and push to webview
      const serverInfo = this.connectionService.getServerInfo()
      this.connectionState = this.connectionService.getConnectionState()

      if (serverInfo) {
        const langConfig = vscode.workspace.getConfiguration("kilo-code.new")
        this.postMessage({
          type: "ready",
          serverInfo,
          vscodeLanguage: vscode.env.language,
          languageOverride: langConfig.get<string>("language"),
        })
      }

      this.postMessage({ type: "connectionState", state: this.connectionState })
      await this.syncWebviewState("initializeConnection")

      // Fetch providers and agents, then send to webview
      await this.fetchAndSendProviders()
      await this.fetchAndSendAgents()
      await this.fetchAndSendConfig()
      await this.fetchAndSendExtensionPolicy()
      this.sendNotificationSettings()
      this.sendCommandApprovalSettings()
      this.sendGatewayPreference()

      logger.debug("[Kilo New] KiloProvider: ✅ initializeConnection completed successfully")
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: ❌ Failed to initialize connection:", error)
      this.notifyConnectionStartError(error)
      this.connectionState = "error"
      this.postMessage({
        type: "connectionState",
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect to CLI backend",
      })
    }
  }

  /**
   * Convert SessionInfo to webview format.
   */
  private sessionToWebview(
    session: SessionInfo,
    metadata?: {
      cost?: number
      model?: string
      messageCount?: number
    },
  ) {
    return {
      id: session.id,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
      ...(session.revert?.messageID ? { revert: { messageID: session.revert.messageID } } : {}),
      ...(metadata ? { metadata } : {}),
      summary: session.summary,
    }
  }

  /**
   * Ensure a connected HttpClient exists, attempting a lazy reconnect when needed.
   * This prevents user-triggered actions (history refresh, open session) from failing
   * with a stale "Not connected" state after transient backend disconnects.
   */
  private async ensureHttpClient(): Promise<HttpClient | null> {
    const existing = this.httpClient
    if (existing) {
      return existing
    }

    const workspaceDir = this.getWorkspaceDirectory()
    try {
      await this.connectionService.connect(workspaceDir)
      this.connectionState = this.connectionService.getConnectionState()
      this.postMessage({ type: "connectionState", state: this.connectionState })
      return this.httpClient
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: lazy reconnect failed", error)
      return null
    }
  }

  /**
   * Handle creating a new session.
   */
  private async handleCreateSession(): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }
    if (!(await this.ensureMdmComplianceOrReject("create-session"))) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const session = await client.createSession(workspaceDir)
      this.currentSession = session
      this.trackedSessionIds.add(session.id)

      // Notify webview of the new session
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(session),
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to create session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create session",
      })
    }
  }

  /**
   * Handle loading messages for a session.
   */
  private async handleLoadMessages(sessionID: string): Promise<void> {
    // Track the session so we receive its SSE events
    this.trackedSessionIds.add(sessionID)

    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const messagesData = await client.getMessages(sessionID, workspaceDir)

      // Update currentSession so fallback logic in handleSendMessage/handleAbort
      // references the correct session after switching to a historical session.
      // Non-blocking: don't let a failure here prevent messages from loading.
      client
        .getSession(sessionID, workspaceDir)
        .then((session) => {
          if (!this.currentSession || this.currentSession.id === sessionID) {
            this.currentSession = session
          }
        })
        .catch((err) => logger.error("[Kilo New] KiloProvider: Failed to fetch session for tracking:", err))

      // Convert to webview format, including cost/tokens for assistant messages
      const messages = messagesData.map((m) => ({
        id: m.info.id,
        sessionID: m.info.sessionID,
        role: m.info.role,
        parts: m.parts.map((part) => this.mapPartForWebview(part)),
        createdAt: new Date(m.info.time.created).toISOString(),
        providerID: m.info.providerID,
        modelID: m.info.modelID,
        cost: m.info.cost,
        tokens: m.info.tokens,
      }))

      for (const message of messages) {
        this.connectionService.recordMessageSessionId(message.id, message.sessionID)
      }

      this.postMessage({
        type: "messagesLoaded",
        sessionID,
        messages,
      })

      await this.refreshTodosForSession(sessionID, workspaceDir)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to load messages:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load messages",
      })
    }
  }

  private mapTodoStatus(status: string): "pending" | "in_progress" | "completed" | "cancelled" {
    if (status === "in_progress" || status === "completed" || status === "cancelled" || status === "pending") {
      return status
    }
    return "pending"
  }

  private async refreshTodosForSession(sessionID: string, workspaceDir: string): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }
    try {
      const todos = await client.getTodos(sessionID, workspaceDir)
      this.postMessage({
        type: "todoUpdated",
        sessionID,
        items: todos.map((todo) => ({
          id: todo.id,
          content: todo.content,
          status: this.mapTodoStatus(todo.status),
          priority:
            todo.priority === "high" || todo.priority === "low" || todo.priority === "medium"
              ? todo.priority
              : undefined,
        })),
      })
    } catch (error) {
      logger.debug("[Kilo New] KiloProvider: No todos loaded for session", { sessionID, error })
    }
  }

  private async handleCreateTodo(
    sessionID: string | undefined,
    content: string,
    status?: "pending" | "in_progress" | "completed" | "cancelled",
    priority?: "high" | "medium" | "low",
  ): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }
    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }
    const trimmed = content.trim()
    if (!trimmed) {
      return
    }
    const workspaceDir = this.getWorkspaceDirectory()
    await client.createTodo(targetSessionID, { content: trimmed, status, priority }, workspaceDir)
    await this.refreshTodosForSession(targetSessionID, workspaceDir)
  }

  private async handleUpdateTodo(
    sessionID: string | undefined,
    todoID: string,
    content?: string,
    status?: "pending" | "in_progress" | "completed" | "cancelled",
    priority?: "high" | "medium" | "low",
  ): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }
    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    const changes: {
      content?: string
      status?: "pending" | "in_progress" | "completed" | "cancelled"
      priority?: "high" | "medium" | "low"
    } = {}
    if (typeof content === "string") {
      const trimmed = content.trim()
      if (trimmed.length > 0) {
        changes.content = trimmed
      }
    }
    if (status) {
      changes.status = status
    }
    if (priority) {
      changes.priority = priority
    }
    if (Object.keys(changes).length === 0) {
      return
    }

    const workspaceDir = this.getWorkspaceDirectory()
    await client.updateTodo(targetSessionID, todoID, changes, workspaceDir)
    await this.refreshTodosForSession(targetSessionID, workspaceDir)
  }

  private async handleDeleteTodo(sessionID: string | undefined, todoID: string): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }
    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }
    const workspaceDir = this.getWorkspaceDirectory()
    await client.deleteTodo(targetSessionID, todoID, workspaceDir)
    await this.refreshTodosForSession(targetSessionID, workspaceDir)
  }

  private async buildSessionHistoryMetadata(
    client: HttpClient,
    workspaceDir: string,
    sessions: SessionInfo[],
  ): Promise<Map<string, { cost?: number; model?: string; messageCount?: number }>> {
    const result = new Map<string, { cost?: number; model?: string; messageCount?: number }>()
    const targets = [...sessions].sort((a, b) => b.time.updated - a.time.updated).slice(0, 20)

    await Promise.all(
      targets.map(async (session) => {
        try {
          const messages = await client.getMessages(session.id, workspaceDir)
          if (messages.length === 0) {
            return
          }

          let totalCost = 0
          let model: string | undefined
          for (const entry of messages) {
            if (entry.info.role !== "assistant") {
              continue
            }
            totalCost += entry.info.cost ?? 0
          }

          for (let index = messages.length - 1; index >= 0; index--) {
            const info = messages[index]?.info
            if (!info || info.role !== "assistant") {
              continue
            }
            if (info.providerID && info.modelID) {
              model = `${info.providerID}/${info.modelID}`
              break
            }
            if (info.modelID) {
              model = info.modelID
              break
            }
          }

          result.set(session.id, {
            ...(totalCost > 0 ? { cost: totalCost } : {}),
            ...(model ? { model } : {}),
            messageCount: messages.length,
          })
        } catch (error) {
          logger.debug("[Kilo New] KiloProvider: Failed to build session history metadata", {
            sessionID: session.id,
            error,
          })
        }
      }),
    )

    return result
  }

  /**
   * Handle loading all sessions.
   */
  private async handleLoadSessions(): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      const cachedSessions = this.readCachedSessions()
      if (cachedSessions.length > 0) {
        this.postMessage({
          type: "sessionsLoaded",
          sessions: cachedSessions,
        })
        this.postMessage({
          type: "error",
          message: "Not connected to CLI backend. Showing cached session history.",
        })
        return
      }
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const sessions = await client.listSessions(workspaceDir)
      const metadataBySessionID = await this.buildSessionHistoryMetadata(client, workspaceDir, sessions)
      const webviewSessions = sessions.map((session) => this.sessionToWebview(session, metadataBySessionID.get(session.id)))

      this.postMessage({
        type: "sessionsLoaded",
        sessions: webviewSessions,
      })
      await this.writeCachedSessions(webviewSessions)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to load sessions:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  }

  private parseMarketplaceItem(rawItem: unknown): MarketplaceItem | null {
    const parsed = marketplaceItemSchema.safeParse(rawItem)
    return parsed.success ? parsed.data : null
  }

  private parseMarketplaceTarget(rawTarget: unknown): "project" | "global" {
    return z.enum(["project", "global"]).catch("project").parse(rawTarget)
  }

  private parseMarketplaceSelectedIndex(rawSelectedIndex: unknown): number | undefined {
    const parsed = z.number().int().min(0).safeParse(rawSelectedIndex)
    return parsed.success ? parsed.data : undefined
  }

  private parseMarketplaceParameters(rawParameters: unknown): Record<string, unknown> {
    const parsed = z.record(z.string(), z.unknown()).safeParse(rawParameters)
    return parsed.success ? parsed.data : {}
  }

  private getCachedAllowListPolicy():
    | { allowAll: boolean; providers: Record<string, { allowAll: boolean; models?: string[] }> }
    | null {
    const envelope =
      this.cachedExtensionPolicyMessage &&
      typeof this.cachedExtensionPolicyMessage === "object" &&
      !Array.isArray(this.cachedExtensionPolicyMessage)
        ? (this.cachedExtensionPolicyMessage as { policy?: unknown })
        : null
    const policy =
      envelope?.policy && typeof envelope.policy === "object" && !Array.isArray(envelope.policy)
        ? (envelope.policy as Record<string, unknown>)
        : null
    const parsed = organizationAllowListSchema.safeParse(policy?.allowList)
    if (!parsed.success) {
      return null
    }
    return {
      allowAll: parsed.data.allowAll,
      providers: parsed.data.providers,
    }
  }

  private getOrganizationPolicyViolation(providerID?: string, modelID?: string): string | null {
    const allowList = this.getCachedAllowListPolicy()
    if (!allowList || allowList.allowAll) {
      return null
    }

    const provider = providerID?.trim()
    const model = modelID?.trim()
    if (!provider || !model) {
      return "Organization policy requires selecting an allowed provider/model before sending."
    }

    const providerRule = allowList.providers[provider]
    if (!providerRule) {
      return `Provider \"${provider}\" is blocked by organization policy.`
    }
    if (providerRule.allowAll) {
      return null
    }

    const models = Array.isArray(providerRule.models) ? providerRule.models : []
    if (models.length === 0) {
      return `Provider \"${provider}\" has no allowed models under organization policy.`
    }
    if (!models.includes(model)) {
      return `Model \"${model}\" is not allowed for provider \"${provider}\" by organization policy.`
    }

    return null
  }

  private sessionHistoryCacheKey(workspaceDir?: string): string {
    const root = workspaceDir || this.getWorkspaceDirectory()
    const encoded = Buffer.from(root).toString("base64url")
    return `${SESSION_HISTORY_CACHE_KEY}.${encoded}`
  }

  private parseExtensionPolicy(
    extensionSettings: unknown,
  ): {
    fetchedAt: string
    allowList?: { allowAll: boolean; providers: Record<string, { allowAll: boolean; models?: string[] }> }
    featureFlags?: Record<string, boolean>
    mdmEnforced?: boolean
    mdm?: {
      requiredCloudAuth: boolean
      requiredOrganizationId?: string
      compliant: boolean
      reason?: string
      sourcePath?: string
    }
    organizationRaw?: Record<string, unknown>
    userRaw?: Record<string, unknown>
  } | null {
    const parsed = extensionSettingsEnvelopeSchema.safeParse(extensionSettings)
    const organizationRaw = (parsed.success ? parsed.data.organization : undefined) ?? {}
    const userRaw = (parsed.success ? parsed.data.user : undefined) ?? {}

    const directRecord =
      !parsed.success && extensionSettings && typeof extensionSettings === "object" && !Array.isArray(extensionSettings)
        ? (extensionSettings as Record<string, unknown>)
        : {}

    const allowListCandidate =
      organizationRaw.allowList ?? organizationRaw.organizationAllowList ?? directRecord.allowList ?? directRecord.organizationAllowList
    const allowListParsed = organizationAllowListSchema.safeParse(allowListCandidate)
    const allowList = allowListParsed.success
      ? {
          allowAll: allowListParsed.data.allowAll,
          providers: allowListParsed.data.providers,
        }
      : undefined

    const featureFlagsSource =
      (userRaw.features && typeof userRaw.features === "object" ? (userRaw.features as Record<string, unknown>) : undefined) ??
      (organizationRaw.featureFlags && typeof organizationRaw.featureFlags === "object"
        ? (organizationRaw.featureFlags as Record<string, unknown>)
        : undefined)
    const featureFlags: Record<string, boolean> = {}
    if (featureFlagsSource) {
      for (const [key, value] of Object.entries(featureFlagsSource)) {
        if (typeof value === "boolean") {
          featureFlags[key] = value
        }
      }
    }

    const mdmSources = [
      organizationRaw.mdm,
      organizationRaw.mdmPolicy,
      organizationRaw.mdmEnforced,
      organizationRaw.managed,
      organizationRaw.policyManaged,
      directRecord.mdm,
      directRecord.mdmPolicy,
      directRecord.mdmEnforced,
    ]
    const mdmEnforced =
      mdmSources.some((value) => value === true || (typeof value === "object" && value !== null)) ||
      !!this.mdmPolicy?.requireCloudAuth
    const mdmCompliance = evaluateMdmCompliance(this.mdmPolicy, this.latestProfileData)
    const mdmDetails = this.mdmPolicy
      ? {
          requiredCloudAuth: this.mdmPolicy.requireCloudAuth,
          ...(this.mdmPolicy.organizationId ? { requiredOrganizationId: this.mdmPolicy.organizationId } : {}),
          compliant: mdmCompliance.compliant,
          ...(!mdmCompliance.compliant ? { reason: mdmCompliance.reason } : {}),
          sourcePath: this.mdmPolicy.sourcePath,
        }
      : undefined

    const hasOrganization = Object.keys(organizationRaw).length > 0
    const hasUser = Object.keys(userRaw).length > 0
    const hasFeatureFlags = Object.keys(featureFlags).length > 0
    if (!allowList && !hasFeatureFlags && !mdmEnforced && !mdmDetails && !hasOrganization && !hasUser) {
      return null
    }

    return {
      fetchedAt: new Date().toISOString(),
      ...(allowList ? { allowList } : {}),
      ...(hasFeatureFlags ? { featureFlags } : {}),
      ...(mdmEnforced ? { mdmEnforced: true } : {}),
      ...(mdmDetails ? { mdm: mdmDetails } : {}),
      ...(hasOrganization ? { organizationRaw } : {}),
      ...(hasUser ? { userRaw } : {}),
    }
  }

  private async fetchAndSendExtensionPolicy(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      const policy = this.parseExtensionPolicy(undefined)
      const message = {
        type: "extensionPolicyLoaded",
        policy,
      }
      this.cachedExtensionPolicyMessage = message
      this.postMessage(message)
      return
    }

    try {
      const extensionSettings = await client.getExtensionSettings()
      const policy = this.parseExtensionPolicy(extensionSettings)
      const message = {
        type: "extensionPolicyLoaded",
        policy,
      }
      this.cachedExtensionPolicyMessage = message
      this.postMessage(message)
    } catch (error) {
      logger.debug("[Kilo New] KiloProvider: Failed to fetch extension policy settings", error)
      const fallbackPolicy = this.parseExtensionPolicy(undefined)
      const message = {
        type: "extensionPolicyLoaded",
        policy: fallbackPolicy,
      }
      this.cachedExtensionPolicyMessage = message
      this.postMessage(message)
    }
  }

  private readCachedSessions(): Array<{
    id: string
    title?: string
    createdAt: string
    updatedAt: string
    revert?: { messageID: string }
    metadata?: { cost?: number; model?: string; messageCount?: number }
    summary?: { additions: number; deletions: number; files: number }
  }> {
    const raw = this.extensionContext.globalState.get<unknown>(this.sessionHistoryCacheKey())
    const parsed = webviewSessionsSchema.safeParse(raw)
    if (!parsed.success) {
      return []
    }
    return parsed.data
  }

  private async writeCachedSessions(
    sessions: Array<{
      id: string
      title?: string
      createdAt: string
      updatedAt: string
      revert?: { messageID: string }
      metadata?: { cost?: number; model?: string; messageCount?: number }
      summary?: { additions: number; deletions: number; files: number }
    }>,
  ): Promise<void> {
    await this.extensionContext.globalState.update(this.sessionHistoryCacheKey(), sessions.slice(0, 200))
  }

  private handleTelemetryEvent(rawEvent: unknown, rawProperties?: unknown): void {
    const event = telemetryEventNameSchema.safeParse(rawEvent)
    if (!event.success) {
      return
    }

    captureTelemetryEvent(event.data, parseTelemetryProperties(rawProperties))
  }

  private async handleRequestMarketplaceData(): Promise<void> {
    const errors: string[] = []
    let extensionSettings: unknown = undefined
    const client = this.httpClient ?? (await this.ensureHttpClient())

    if (client) {
      try {
        extensionSettings = await client.getExtensionSettings()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    try {
      const result = await this.marketplaceService.getCatalog({ extensionSettings })
      this.postMessage({
        type: "marketplaceData",
        items: result.items,
        installedMetadata: result.installedMetadata,
        errors: [...errors, ...(result.errors ?? [])],
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch marketplace data:", error)
      this.postMessage({
        type: "marketplaceData",
        items: [],
        installedMetadata: { project: {}, global: {} },
        errors: [...errors, error instanceof Error ? error.message : String(error)],
      })
    }
  }

  private async handleInstallMarketplaceItem(
    rawItem: unknown,
    rawTarget: unknown,
    rawSelectedIndex?: unknown,
    rawParameters?: unknown,
  ): Promise<void> {
    const item = this.parseMarketplaceItem(rawItem)
    if (!item) {
      this.postMessage({
        type: "marketplaceActionResult",
        action: "install",
        success: false,
        error: "Invalid marketplace item payload",
      })
      return
    }

    try {
      const target = this.parseMarketplaceTarget(rawTarget)
      const selectedIndex = this.parseMarketplaceSelectedIndex(rawSelectedIndex)
      const parameters = this.parseMarketplaceParameters(rawParameters)

      await this.marketplaceService.installItem(item, { target, selectedIndex, parameters })
      const installationMethodName =
        item.type === "mcp" && Array.isArray(item.content) && typeof selectedIndex === "number"
          ? item.content[selectedIndex]?.name
          : undefined
      captureTelemetryEvent("Marketplace Item Installed", {
        itemId: item.id,
        itemType: item.type,
        itemName: item.name,
        target,
        hasParameters: Object.keys(parameters).length > 0,
        ...(typeof installationMethodName === "string" ? { installationMethodName } : {}),
      })
      this.marketplaceService.invalidateCache()
      await this.handleRequestMarketplaceData()
      this.postMessage({
        type: "marketplaceActionResult",
        action: "install",
        success: true,
        itemID: item.id,
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to install marketplace item:", error)
      this.postMessage({
        type: "marketplaceActionResult",
        action: "install",
        success: false,
        itemID: item.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async handleRemoveMarketplaceItem(rawItem: unknown, rawTarget: unknown): Promise<void> {
    const item = this.parseMarketplaceItem(rawItem)
    if (!item) {
      this.postMessage({
        type: "marketplaceActionResult",
        action: "remove",
        success: false,
        error: "Invalid marketplace item payload",
      })
      return
    }

    try {
      const target = this.parseMarketplaceTarget(rawTarget)
      await this.marketplaceService.removeItem(item, target)
      captureTelemetryEvent("Marketplace Item Removed", {
        itemId: item.id,
        itemType: item.type,
        itemName: item.name,
        target,
      })
      this.marketplaceService.invalidateCache()
      await this.handleRequestMarketplaceData()
      this.postMessage({
        type: "marketplaceActionResult",
        action: "remove",
        success: true,
        itemID: item.id,
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to remove marketplace item:", error)
      this.postMessage({
        type: "marketplaceActionResult",
        action: "remove",
        success: false,
        itemID: item.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Handle deleting a session.
   */
  private async handleDeleteSession(sessionID: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      await client.deleteSession(sessionID, workspaceDir)
      this.trackedSessionIds.delete(sessionID)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = null
      }
      this.postMessage({ type: "sessionDeleted", sessionID })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to delete session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete session",
      })
    }
  }

  /**
   * Handle renaming a session.
   */
  private async handleRenameSession(sessionID: string, title: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const updated = await client.updateSession(sessionID, { title }, workspaceDir)
      if (this.currentSession?.id === sessionID) {
        this.currentSession = updated
      }
      this.postMessage({ type: "sessionUpdated", session: this.sessionToWebview(updated) })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to rename session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rename session",
      })
    }
  }

  /**
   * Fetch providers from the backend and send to webview.
   *
   * The backend `/provider` endpoint returns `all` as an array-like object with
   * numeric keys ("0", "1", …). The webview and sendMessage both need providers
   * keyed by their real `provider.id` (e.g. "anthropic", "openai"). We re-key
   * the map here so the rest of the code can use provider.id everywhere.
   */
  private async fetchAndSendProviders(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      // httpClient not ready — serve from cache if available
      if (this.cachedProvidersMessage) {
        this.postMessage(this.cachedProvidersMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const response = await client.listProviders(workspaceDir)

      // Re-key providers from numeric indices to provider.id
      const normalized: typeof response.all = {}
      for (const provider of Object.values(response.all)) {
        normalized[provider.id] = provider
      }

      const config = vscode.workspace.getConfiguration("kilo-code.new.model")
      const configuredProviderID = config.get<string>("providerID", "kilo")
      const configuredModelID = config.get<string>("modelID", "kilo/auto")
      const preferGatewayDefault = config.get<boolean>("preferGatewayDefault", false)
      const configuredIsFallback = configuredProviderID === "kilo" && configuredModelID === "kilo/auto"
      const gatewayDefaultModelID = response.default.kilo

      const isValidSelection = (
        selection: { providerID: string; modelID: string } | undefined,
      ): selection is {
        providerID: string
        modelID: string
      } => {
        if (!selection) {
          return false
        }
        return !!normalized[selection.providerID]?.models?.[selection.modelID]
      }

      const firstValidDefaultFromBackend = (): { providerID: string; modelID: string } | undefined => {
        for (const [providerID, modelID] of Object.entries(response.default)) {
          if (normalized[providerID]?.models?.[modelID]) {
            return { providerID, modelID }
          }
        }
        return undefined
      }

      const firstModelFromCatalog = (): { providerID: string; modelID: string } | undefined => {
        for (const providerID of Object.keys(normalized)) {
          const firstModelID = Object.keys(normalized[providerID]?.models ?? {})[0]
          if (firstModelID) {
            return { providerID, modelID: firstModelID }
          }
        }
        return undefined
      }

      let defaultSelection = {
        providerID: configuredProviderID,
        modelID: configuredModelID,
      }

      if ((configuredIsFallback || preferGatewayDefault) && gatewayDefaultModelID) {
        defaultSelection = { providerID: "kilo", modelID: gatewayDefaultModelID }
      }

      if (!isValidSelection(defaultSelection)) {
        const gatewayFallback =
          gatewayDefaultModelID && normalized.kilo?.models?.[gatewayDefaultModelID]
            ? { providerID: "kilo", modelID: gatewayDefaultModelID }
            : undefined
        defaultSelection =
          gatewayFallback ?? firstValidDefaultFromBackend() ?? firstModelFromCatalog() ?? defaultSelection
      }

      const message = {
        type: "providersLoaded",
        providers: normalized,
        connected: response.connected,
        defaults: response.default,
        defaultSelection,
      }
      this.cachedProvidersMessage = message
      this.postMessage(message)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch providers:", error)
    }
  }

  private sendSettingsUiState(): void {
    this.postMessage({
      type: "settingsUiStateLoaded",
      activeTab: readSettingsActiveTab(this.extensionContext),
    })
  }

  /**
   * Fetch agents (modes) from the backend and send to webview.
   */
  private async fetchAndSendAgents(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      if (this.cachedAgentsMessage) {
        this.postMessage(this.cachedAgentsMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const agents = await client.listAgents(workspaceDir)

      // Filter to only visible primary/all modes (not subagents, not hidden)
      const visible = agents.filter((a) => a.mode !== "subagent" && !a.hidden)

      // Find default agent: first one in list (CLI sorts default first)
      const defaultAgent = visible.length > 0 ? visible[0].name : "code"

      const message = {
        type: "agentsLoaded",
        agents: visible.map((a) => ({
          name: a.name,
          description: a.description,
          mode: a.mode,
          native: a.native,
          color: a.color,
        })),
        defaultAgent,
      }
      this.cachedAgentsMessage = message
      this.postMessage(message)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch agents:", error)
    }
  }

  /**
   * Fetch backend config and send to webview.
   */
  private async fetchAndSendConfig(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      if (this.cachedConfigMessage) {
        this.postMessage(this.cachedConfigMessage)
      }
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const config = await client.getConfig(workspaceDir)

      const message = {
        type: "configLoaded",
        config,
      }
      this.cachedConfigMessage = message
      this.postMessage(message)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch config:", error)
    }
  }

  /**
   * Fetch slash commands from CLI and send a normalized payload to the webview.
   */
  private async handleRequestSlashCommands(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      this.postMessage({
        type: "slashCommandsLoaded",
        commands: [],
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const commands = await client.listCommands(workspaceDir)
      this.postMessage({
        type: "slashCommandsLoaded",
        commands: commands.map((command) => this.commandToWebview(command)),
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch slash commands:", error)
      this.postMessage({
        type: "slashCommandsLoaded",
        commands: [],
        error: error instanceof Error ? error.message : "Failed to fetch slash commands",
      })
    }
  }

  /**
   * Fetch MCP server status and send to webview.
   */
  private async fetchAndSendMcpStatus(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      this.postMessage({
        type: "mcpStatusLoaded",
        status: {},
      })
      return
    }

    try {
      const status = await client.getMcpStatus()
      this.postMessage({
        type: "mcpStatusLoaded",
        status,
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fetch MCP status:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to fetch MCP status",
      })
    }
  }

  /**
   * Read notification/sound settings from VS Code config and push to webview.
   */
  private sendNotificationSettings(): void {
    const notifications = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    this.postMessage({
      type: "notificationSettingsLoaded",
      settings: {
        notifyAgent: notifications.get<boolean>("agent", true),
        notifyPermissions: notifications.get<boolean>("permissions", true),
        notifyErrors: notifications.get<boolean>("errors", true),
        soundAgent: sounds.get<string>("agent", "default"),
        soundPermissions: sounds.get<string>("permissions", "default"),
        soundErrors: sounds.get<string>("errors", "default"),
      },
    })
  }

  private sendCommandApprovalSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new")
    const normalize = (input: unknown): string[] => {
      if (!Array.isArray(input)) {
        return []
      }
      const normalized = input
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
      return Array.from(new Set(normalized))
    }

    this.postMessage({
      type: "commandApprovalSettingsLoaded",
      settings: {
        allowedCommands: normalize(config.get<unknown>("allowedCommands", [])),
        deniedCommands: normalize(config.get<unknown>("deniedCommands", [])),
      },
    })
  }

  private sendGatewayPreference(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.model")
    this.postMessage({
      type: "gatewayPreferenceLoaded",
      preferGatewayDefault: config.get<boolean>("preferGatewayDefault", false),
    })
  }

  private postConfigValidationError(issues: SettingsValidationIssue[]): void {
    logger.warn("[Kilo New] KiloProvider: Rejected invalid config update", { issues })
    this.postMessage({
      type: "configValidationError",
      message: "Invalid configuration update",
      issues,
    })
  }

  private commandToWebview(command: CommandDefinition): {
    name: string
    description?: string
    source?: "command" | "mcp" | "skill"
    hints?: string[]
  } {
    return {
      name: command.name,
      description: command.description,
      source: command.source,
      hints: Array.isArray(command.hints) ? command.hints : [],
    }
  }

  private postSettingValidationError(key: string | undefined, issues: SettingsValidationIssue[]): void {
    logger.warn("[Kilo New] KiloProvider: Rejected invalid setting update", { key, issues })
    this.postMessage({
      type: "settingValidationError",
      key,
      message: "Invalid setting update",
      issues,
    })
  }

  /**
   * Handle config update request from the webview.
   * Applies a partial config update via the global config endpoint, then pushes
   * the full merged config back to the webview.
   */
  private async handleUpdateConfig(partial: Partial<Config>): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    try {
      const updated = await client.updateConfig(partial)

      const message = {
        type: "configUpdated",
        config: updated,
      }
      this.cachedConfigMessage = { type: "configLoaded", config: updated }
      this.postMessage(message)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to update config:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update config",
      })
    }
  }

  private async handleAddMcpServer(name: unknown, config: unknown): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }

    if (typeof name !== "string" || !name.trim()) {
      this.postMessage({ type: "error", message: "Invalid MCP server name" })
      return
    }

    const parsedConfig = z
      .union([
        z.object({
          type: z.literal("local"),
          command: z.array(z.string().trim().min(1)).min(1),
          environment: z.record(z.string(), z.string()).optional(),
          enabled: z.boolean().optional(),
          timeout: z.number().int().positive().optional(),
        }),
        z.object({
          type: z.literal("remote"),
          url: z.string().trim().min(1),
          headers: z.record(z.string(), z.string()).optional(),
          enabled: z.boolean().optional(),
          timeout: z.number().int().positive().optional(),
        }),
      ])
      .safeParse(config)

    if (!parsedConfig.success) {
      this.postMessage({
        type: "error",
        message: parsedConfig.error.issues[0]?.message ?? "Invalid MCP server config",
      })
      return
    }

    try {
      await client.addMcpServer(name.trim(), parsedConfig.data as McpConfig)
      await this.fetchAndSendConfig()
      await this.fetchAndSendMcpStatus()
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to add MCP server:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to add MCP server",
      })
    }
  }

  private async handleConnectMcpServer(name: unknown): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }
    if (typeof name !== "string" || !name.trim()) {
      this.postMessage({ type: "error", message: "Invalid MCP server name" })
      return
    }

    try {
      await client.connectMcpServer(name.trim())
      await this.fetchAndSendMcpStatus()
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to connect MCP server:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to connect MCP server",
      })
    }
  }

  private async handleDisconnectMcpServer(name: unknown): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }
    if (typeof name !== "string" || !name.trim()) {
      this.postMessage({ type: "error", message: "Invalid MCP server name" })
      return
    }

    try {
      await client.disconnectMcpServer(name.trim())
      await this.fetchAndSendMcpStatus()
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to disconnect MCP server:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to disconnect MCP server",
      })
    }
  }

  /**
   * Handle sending a message from the webview.
   */
  private async handleSendMessage(
    text: string,
    sessionID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    files?: Array<{ mime: string; url: string }>,
  ): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }
    if (!(await this.ensureMdmComplianceOrReject("send-message"))) {
      return
    }
    const policyViolation = this.getOrganizationPolicyViolation(providerID, modelID)
    if (policyViolation) {
      this.postMessage({
        type: "error",
        message: policyViolation,
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Create session if needed
      if (!sessionID && !this.currentSession) {
        this.currentSession = await client.createSession(workspaceDir)
        this.trackedSessionIds.add(this.currentSession.id)
        // Notify webview of the new session
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(this.currentSession),
        })
      }

      const targetSessionID = sessionID || this.currentSession?.id
      if (!targetSessionID) {
        throw new Error("No session available")
      }

      // Build parts array with file context and user text
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = []

      // Inject active editor file as context
      const editor = vscode.window.activeTextEditor
      if (editor && editor.document.uri.scheme === "file") {
        const url = editor.document.uri.toString()
        const already = files?.some((f) => f.url === url)
        if (!already) {
          parts.push({ type: "file", mime: "text/plain", url })
        }
      }

      // Add any explicitly attached files from the webview
      if (files) {
        for (const f of files) {
          parts.push({ type: "file", mime: f.mime, url: f.url })
        }
      }

      parts.push({ type: "text", text })

      await client.sendMessage(targetSessionID, parts, workspaceDir, {
        providerID,
        modelID,
        agent,
      })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to send message:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to send message",
      })
    }
  }

  /**
   * Handle abort request from the webview.
   */
  private async handleAbort(sessionID?: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      await client.abortSession(targetSessionID, workspaceDir)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to abort session:", error)
    }
  }

  /**
   * Handle compact (context summarization) request from the webview.
   */
  private async handleCompact(sessionID?: string, providerID?: string, modelID?: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const target = sessionID || this.currentSession?.id
    if (!target) {
      logger.error("[Kilo New] KiloProvider: No sessionID for compact")
      return
    }

    if (!providerID || !modelID) {
      logger.error("[Kilo New] KiloProvider: No model selected for compact")
      this.postMessage({
        type: "error",
        message: "No model selected. Connect a provider to compact this session.",
      })
      return
    }
    const policyViolation = this.getOrganizationPolicyViolation(providerID, modelID)
    if (policyViolation) {
      this.postMessage({
        type: "error",
        message: policyViolation,
      })
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      await client.summarize(target, providerID, modelID, workspaceDir)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to compact session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to compact session",
      })
    }
  }

  private async handleRevertMessage(sessionID: string | undefined, messageID: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      logger.error("[Kilo New] KiloProvider: No sessionID for revert")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const updated = await client.revertSession(targetSessionID, messageID, workspaceDir)
      if (this.currentSession?.id === updated.id) {
        this.currentSession = updated
      }
      this.postMessage({
        type: "sessionUpdated",
        session: this.sessionToWebview(updated),
      })
      await this.handleLoadMessages(updated.id)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to revert session message:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to revert message",
      })
    }
  }

  private async handleUnrevertSession(sessionID?: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const updated = await client.unrevertSession(targetSessionID, workspaceDir)
      if (this.currentSession?.id === updated.id) {
        this.currentSession = updated
      }
      this.postMessage({
        type: "sessionUpdated",
        session: this.sessionToWebview(updated),
      })
      await this.handleLoadMessages(updated.id)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to unrevert session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to redo session state",
      })
    }
  }

  private async handleForkSession(sessionID?: string, messageID?: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      logger.error("[Kilo New] KiloProvider: No sessionID for fork")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const forked = await client.forkSession(targetSessionID, workspaceDir, messageID)
      this.currentSession = forked
      this.trackedSessionIds.add(forked.id)
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(forked),
      })
      await this.handleLoadMessages(forked.id)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to fork session:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to fork session",
      })
    }
  }

  private async handleOpenForkSessionPicker(sessionID?: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const children = await client.listSessionChildren(targetSessionID, workspaceDir)
      if (children.length === 0) {
        void vscode.window.showInformationMessage("No forked child sessions found.")
        return
      }

      const picks = children
        .sort((a, b) => b.time.updated - a.time.updated)
        .map((child) => ({
          label: child.title || "Untitled",
          description: new Date(child.time.updated).toLocaleString(),
          detail: child.id,
          session: child,
        }))

      const choice = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select a forked session",
      })
      if (!choice) {
        return
      }

      this.currentSession = choice.session
      this.trackedSessionIds.add(choice.session.id)
      this.postMessage({
        type: "sessionCreated",
        session: this.sessionToWebview(choice.session),
      })
      await this.handleLoadMessages(choice.session.id)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open fork session picker:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load fork sessions",
      })
    }
  }

  private summarizeCheckpointMessage(message: { info: { role: string }; parts: MessagePart[] }): string {
    const textParts = message.parts
      .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0)
    const summary = textParts[0] ?? ""
    if (!summary) {
      return message.info.role === "user" ? "(user message)" : "(assistant message)"
    }
    return summary.length > 90 ? `${summary.slice(0, 90)}…` : summary
  }

  private async handleOpenCheckpointPicker(sessionID?: string): Promise<void> {
    const client = this.httpClient
    if (!client) {
      this.postMessage({
        type: "error",
        message: "Not connected to CLI backend",
      })
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      return
    }

    const workspaceDir = this.getPrimaryWorkspacePath()
    if (!workspaceDir) {
      this.postMessage({
        type: "error",
        message: "No workspace is open.",
      })
      return
    }

    try {
      const messages = await client.getMessages(targetSessionID, workspaceDir)
      if (messages.length === 0) {
        void vscode.window.showInformationMessage("No checkpoints available for this session yet.")
        return
      }

      const items = messages
        .map((message, index) => {
          const created = new Date(message.info.time.created).toLocaleTimeString()
          const role = message.info.role === "user" ? "User" : "Assistant"
          return {
            label: `${role} · ${created}`,
            description: `#${index + 1}`,
            detail: this.summarizeCheckpointMessage({ info: { role: message.info.role }, parts: message.parts }),
            messageID: message.info.id,
          }
        })
        .reverse()

      const picked = await vscode.window.showQuickPick(items, {
        title: "Restore Checkpoint",
        placeHolder: "Select a message checkpoint to restore the session to",
      })
      if (!picked) {
        return
      }

      const action = await vscode.window.showWarningMessage(
        "Restore this checkpoint? Later messages in this session will be removed.",
        { modal: true },
        "Restore",
      )
      if (action !== "Restore") {
        return
      }

      await this.handleRevertMessage(targetSessionID, picked.messageID)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to open checkpoint picker:", error)
      this.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to open checkpoint picker",
      })
    }
  }

  /**
   * Handle permission response from the webview.
   */
  private async handlePermissionResponse(
    permissionId: string,
    sessionID: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      return
    }

    const targetSessionID = sessionID || this.currentSession?.id
    if (!targetSessionID) {
      logger.error("[Kilo New] KiloProvider: No sessionID for permission response")
      return
    }

    try {
      const workspaceDir = this.getWorkspaceDirectory()
      await client.respondToPermission(targetSessionID, permissionId, response, workspaceDir)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to respond to permission:", error)
    }
  }

  /**
   * Handle question reply from the webview.
   */
  private async handleQuestionReply(requestID: string, answers: string[][]): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await client.replyToQuestion(requestID, answers, this.getWorkspaceDirectory())
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to reply to question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle question reject (dismiss) from the webview.
   */
  private async handleQuestionReject(requestID: string): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "questionError", requestID })
      return
    }

    try {
      await client.rejectQuestion(requestID, this.getWorkspaceDirectory())
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to reject question:", error)
      this.postMessage({ type: "questionError", requestID })
    }
  }

  /**
   * Handle login request from the webview.
   * Uses the provider OAuth flow: authorize → open browser → callback (polls until complete).
   * Sends device auth messages so the webview can display a QR code, verification code, and timer.
   */
  private async handleLogin(): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      return
    }

    const attempt = ++this.loginAttempt

    logger.debug("[Kilo New] KiloProvider: 🔐 Starting login flow...")

    try {
      const workspaceDir = this.getWorkspaceDirectory()

      // Step 1: Initiate OAuth authorization
      const auth = await client.oauthAuthorize("kilo", 0, workspaceDir)
      logger.debug("[Kilo New] KiloProvider: 🔐 Got auth URL:", auth.url)

      // Parse code from instructions (format: "Open URL and enter code: ABCD-1234")
      const codeMatch = auth.instructions?.match(/code:\s*(\S+)/i)
      const code = codeMatch ? codeMatch[1] : undefined

      // Step 2: Open browser for user to authorize
      vscode.env.openExternal(vscode.Uri.parse(auth.url))

      // Send device auth details to webview
      this.postMessage({
        type: "deviceAuthStarted",
        code,
        verificationUrl: auth.url,
        expiresIn: 900, // 15 minutes default
      })

      // Step 3: Wait for callback (blocks until polling completes)
      await client.oauthCallback("kilo", 0, workspaceDir)

      // Check if this attempt was cancelled
      if (attempt !== this.loginAttempt) {
        return
      }

      logger.debug("[Kilo New] KiloProvider: 🔐 Login successful")

      // Step 4: Fetch profile and push to webview
      const profileData = await client.getProfile()
      await this.pushProfileData(profileData)
      this.postMessage({ type: "deviceAuthComplete" })

      // Step 5: If user has organizations, navigate to profile view so they can pick one
      if (profileData?.profile.organizations && profileData.profile.organizations.length > 0) {
        this.postMessage({ type: "navigate", view: "profile" })
      }
    } catch (error) {
      if (attempt !== this.loginAttempt) {
        return
      }
      this.postMessage({
        type: "deviceAuthFailed",
        error: error instanceof Error ? error.message : "Login failed",
      })
    }
  }

  private async handleConnectProviderAuth(providerID: unknown): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }
    if (typeof providerID !== "string" || providerID.trim().length === 0) {
      this.postMessage({ type: "error", message: "Invalid provider ID" })
      return
    }

    const id = providerID.trim()
    try {
      const workspaceDir = this.getWorkspaceDirectory()
      const auth = await client.oauthAuthorize(id, 0, workspaceDir)
      await vscode.env.openExternal(vscode.Uri.parse(auth.url))
      await client.oauthCallback(id, 0, workspaceDir)
      await writeLastProviderAuth(this.extensionContext, id)
      await this.fetchAndSendProviders()
      if (id === "kilo") {
        await this.handleRefreshProfile()
      }
      this.postMessage({ type: "providerAuthResult", providerID: id, action: "connect", success: true })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed provider OAuth connect:", { providerID: id, error })
      const message = error instanceof Error ? error.message : "Failed to connect provider"
      this.postMessage({
        type: "providerAuthResult",
        providerID: id,
        action: "connect",
        success: false,
        message,
      })
      this.postMessage({ type: "error", message })
    }
  }

  private async handleDisconnectProviderAuth(providerID: unknown): Promise<void> {
    const client = await this.ensureHttpClient()
    if (!client) {
      this.postMessage({ type: "error", message: "Not connected to CLI backend" })
      return
    }
    if (typeof providerID !== "string" || providerID.trim().length === 0) {
      this.postMessage({ type: "error", message: "Invalid provider ID" })
      return
    }

    const id = providerID.trim()
    try {
      await client.removeAuth(id)
      await writeLastProviderAuth(this.extensionContext, id)
      await this.fetchAndSendProviders()
      if (id === "kilo") {
        await this.pushProfileData(null)
      }
      this.postMessage({ type: "providerAuthResult", providerID: id, action: "disconnect", success: true })
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed provider disconnect:", { providerID: id, error })
      const message = error instanceof Error ? error.message : "Failed to disconnect provider"
      this.postMessage({
        type: "providerAuthResult",
        providerID: id,
        action: "disconnect",
        success: false,
        message,
      })
      this.postMessage({ type: "error", message })
    }
  }

  /**
   * Handle organization switch request from the webview.
   * Persists the selection and refreshes profile + providers since both change with org context.
   */
  private async handleSetOrganization(organizationId: string | null): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }

    logger.debug("[Kilo New] KiloProvider: Switching organization:", organizationId ?? "personal")
    try {
      await client.setOrganization(organizationId)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to switch organization:", error)
      // Re-fetch current profile to reset webview state (clears switching indicator)
      const profileData = await client.getProfile()
      await this.pushProfileData(profileData)
      return
    }

    // Org switch succeeded — refresh profile and providers independently (best-effort)
    try {
      const profileData = await client.getProfile()
      await this.pushProfileData(profileData)
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to refresh profile after org switch:", error)
    }
    try {
      await this.fetchAndSendProviders()
    } catch (error) {
      logger.error("[Kilo New] KiloProvider: Failed to refresh providers after org switch:", error)
    }
    await this.fetchAndSendExtensionPolicy()
  }

  /**
   * Handle logout request from the webview.
   */
  private async handleLogout(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }

    logger.debug("[Kilo New] KiloProvider: 🚪 Logging out...")
    await client.removeAuth("kilo")
    logger.debug("[Kilo New] KiloProvider: 🚪 Logged out successfully")
    await this.pushProfileData(null)
  }

  /**
   * Handle profile refresh request from the webview.
   */
  private async handleRefreshProfile(): Promise<void> {
    const client = this.httpClient ?? (await this.ensureHttpClient())
    if (!client) {
      return
    }

    logger.debug("[Kilo New] KiloProvider: 🔄 Refreshing profile...")
    const profileData = await client.getProfile()
    await this.pushProfileData(profileData)
  }

  /**
   * Handle a generic setting update from the webview.
   * The key uses dot notation relative to `kilo-code.new` (e.g. "browserAutomation.enabled").
   */
  private async handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const parts = key.split(".")
    const section = parts.slice(0, -1).join(".")
    const leaf = parts[parts.length - 1]
    const config = vscode.workspace.getConfiguration(`kilo-code.new${section ? `.${section}` : ""}`)
    await config.update(leaf, value, vscode.ConfigurationTarget.Global)
  }

  /**
   * Read the current browser automation settings and push them to the webview.
   */
  private sendBrowserSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    this.postMessage({
      type: "browserSettingsLoaded",
      settings: {
        enabled: config.get<boolean>("enabled", false),
        useSystemChrome: config.get<boolean>("useSystemChrome", true),
        headless: config.get<boolean>("headless", false),
      },
    })
  }

  /**
   * Extract sessionID from an SSE event, if applicable.
   * Returns undefined for global events (server.connected, server.heartbeat).
   */
  private extractSessionID(event: SSEEvent): string | undefined {
    return this.connectionService.resolveEventSessionId(event)
  }

  private mapPartForWebview(part: MessagePart): MessagePart {
    if (part.type !== "file") {
      return part
    }

    if (!this.webview || !part.url.startsWith("file://")) {
      return part
    }

    try {
      const uri = vscode.Uri.parse(part.url)
      if (!this.canPreviewLocalResource(uri)) {
        return part
      }
      return {
        ...part,
        originalUrl: part.url,
        url: this.webview.asWebviewUri(uri).toString(),
      }
    } catch {
      return part
    }
  }

  /**
   * Handle SSE events from the CLI backend.
   * Filters events by tracked session IDs so each webview only sees its own sessions.
   */
  private handleSSEEvent(event: SSEEvent): void {
    // Extract sessionID from the event
    const sessionID = this.extractSessionID(event)

    // Events without sessionID (server.connected, server.heartbeat) → always forward
    // Events with sessionID → only forward if this webview tracks that session
    // message.part.updated is always session-scoped; if we can't determine the session, drop it to avoid cross-webview leakage.
    if (!sessionID && event.type === "message.part.updated") {
      return
    }
    if (sessionID && !this.trackedSessionIds.has(sessionID)) {
      return
    }

    // Forward relevant events to webview
    switch (event.type) {
      case "message.part.updated": {
        // The part contains the full part data including messageID, delta is optional text delta
        const part = event.properties.part as { messageID?: string; sessionID?: string }
        const messageID = part.messageID || ""

        const resolvedSessionID = sessionID
        if (!resolvedSessionID) {
          return
        }
        this.postMessage({
          type: "partUpdated",
          sessionID: resolvedSessionID,
          messageID,
          part: this.mapPartForWebview(event.properties.part),
          delta: event.properties.delta ? { type: "text-delta", textDelta: event.properties.delta } : undefined,
        })
        break
      }

      case "message.updated":
        // Message info updated — forward cost/tokens for assistant messages
        this.postMessage({
          type: "messageCreated",
          message: {
            id: event.properties.info.id,
            sessionID: event.properties.info.sessionID,
            role: event.properties.info.role,
            createdAt: new Date(event.properties.info.time.created).toISOString(),
            providerID: event.properties.info.providerID,
            modelID: event.properties.info.modelID,
            cost: event.properties.info.cost,
            tokens: event.properties.info.tokens,
          },
        })
        break

      case "session.status":
        this.postMessage({
          type: "sessionStatus",
          sessionID: event.properties.sessionID,
          status: event.properties.status.type,
        })
        break

      case "permission.asked":
        this.postMessage({
          type: "permissionRequest",
          permission: {
            id: event.properties.id,
            sessionID: event.properties.sessionID,
            toolName: event.properties.permission,
            permission: event.properties.permission,
            patterns: event.properties.patterns,
            always: event.properties.always,
            args: event.properties.metadata,
            message: `Permission required: ${event.properties.permission}`,
            tool: event.properties.tool,
          },
        })
        break

      case "todo.updated": {
        // Opencode emits "todos"; older adapters may emit "items".
        const todoItems = event.properties.items ?? event.properties.todos ?? []
        this.postMessage({
          type: "todoUpdated",
          sessionID: event.properties.sessionID,
          items: todoItems.map((todo) => ({
            id: todo.id,
            content: todo.content,
            status: this.mapTodoStatus(todo.status),
            priority:
              todo.priority === "high" || todo.priority === "low" || todo.priority === "medium"
                ? todo.priority
                : undefined,
          })),
        })
        break
      }

      case "question.asked":
        this.postMessage({
          type: "questionRequest",
          question: {
            id: event.properties.id,
            sessionID: event.properties.sessionID,
            questions: event.properties.questions,
            tool: event.properties.tool,
          },
        })
        break

      case "question.replied":
        this.postMessage({
          type: "questionResolved",
          requestID: event.properties.requestID,
        })
        break

      case "question.rejected":
        this.postMessage({
          type: "questionResolved",
          requestID: event.properties.requestID,
        })
        break

      case "session.created":
        // Store session if we don't have one yet
        if (!this.currentSession) {
          this.currentSession = event.properties.info
          this.trackedSessionIds.add(event.properties.info.id)
        }
        // Notify webview
        this.postMessage({
          type: "sessionCreated",
          session: this.sessionToWebview(event.properties.info),
        })
        break

      case "session.updated":
        // Keep local state in sync (e.g. title generation)
        if (this.currentSession?.id === event.properties.info.id) {
          this.currentSession = event.properties.info
        }
        this.postMessage({
          type: "sessionUpdated",
          session: this.sessionToWebview(event.properties.info),
        })
        break
    }
  }

  private shouldShowNotification(key: string): boolean {
    const now = Date.now()
    const lastShown = KiloProvider.notificationTimestamps.get(key)
    if (lastShown && now - lastShown < NOTIFICATION_DEDUPE_MS) {
      return false
    }
    KiloProvider.notificationTimestamps.set(key, now)
    return true
  }

  private notifyConnectionStartError(error: unknown): void {
    if (!this.shouldShowNotification("connection-start-error")) {
      return
    }

    const message = error instanceof Error ? error.message : "Failed to start CLI server or connect to backend"
    void vscode.window.showErrorMessage(`Kilo Code: ${message}`, RETRY_ACTION_LABEL).then((action) => {
      if (action === RETRY_ACTION_LABEL) {
        this.connectionState = "connecting"
        this.postMessage({ type: "connectionState", state: "connecting" })
        void this.initializeConnection()
      }
    })
  }

  private notifyConnectionLost(): void {
    if (!this.shouldShowNotification("connection-lost")) {
      return
    }

    void vscode.window
      .showWarningMessage("Kilo Code lost connection to the CLI backend.", RETRY_ACTION_LABEL)
      .then((action) => {
        if (action === RETRY_ACTION_LABEL) {
          this.connectionState = "connecting"
          this.postMessage({ type: "connectionState", state: "connecting" })
          void this.initializeConnection()
        }
      })
  }

  /**
   * Read autocomplete settings from VS Code configuration and push to the webview.
   */
  private sendAutocompleteSettings(): void {
    const config = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
    this.postMessage({
      type: "autocompleteSettingsLoaded",
      settings: {
        enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
        enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
        enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      },
    })
  }

  /**
   * Post a message to the webview.
   * Public so toolbar button commands can send messages.
   */
  public postMessage(message: unknown): void {
    if (!this.webview) {
      const type =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof (message as { type?: unknown }).type === "string"
          ? (message as { type: string }).type
          : "<unknown>"
      logger.warn("[Kilo New] KiloProvider: ⚠️ postMessage dropped (no webview)", { type })
      return
    }

    void this.webview.postMessage(message).then(undefined, (error) => {
      logger.error("[Kilo New] KiloProvider: ❌ postMessage failed", error)
    })
  }

  /**
   * Get the workspace directory.
   */
  private getAttachmentMime(uri: vscode.Uri): string | null {
    const ext = path.extname(uri.fsPath).toLowerCase()
    return ATTACHMENT_EXT_TO_MIME[ext] ?? null
  }

  private decodeBase64DataUrl(dataUrl: string): Buffer | null {
    const match = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
    if (!match) {
      return null
    }
    try {
      return Buffer.from(match[1], "base64")
    } catch {
      return null
    }
  }

  private getAttachmentExtensionForMime(mime: string, name?: string): string {
    if (name) {
      const ext = path.extname(name).toLowerCase()
      if (ext && ATTACHMENT_EXT_TO_MIME[ext] === mime) {
        return ext
      }
    }
    return ATTACHMENT_MIME_TO_EXT[mime] ?? ""
  }

  private sanitizeAttachmentStem(name?: string): string {
    const base = (name ? path.basename(name, path.extname(name)) : "pasted-attachment").trim()
    const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    return cleaned || "pasted-attachment"
  }

  private canPreviewLocalResource(uri: vscode.Uri): boolean {
    if (uri.scheme !== "file") {
      return false
    }
    if (vscode.workspace.getWorkspaceFolder(uri)) {
      return true
    }

    const tempRoot = path.resolve(this.attachmentTempDir)
    const target = path.resolve(uri.fsPath)
    return target === tempRoot || target.startsWith(`${tempRoot}${path.sep}`)
  }

  private getLocalResourceRoots(): vscode.Uri[] {
    const roots = [this.extensionUri]
    const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
    return [...roots, ...workspaceRoots, vscode.Uri.file(this.attachmentTempDir)]
  }

  private getWorkspaceDirectory(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath
    }
    // Extension host cwd is not guaranteed to be a valid user project path.
    // Fall back to home for backend APIs that require an absolute directory.
    return os.homedir()
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"))
    const iconsBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons"))

    const nonce = getNonce()

    // CSP allows:
    // - default-src 'none': Block everything by default
    // - style-src: Allow inline styles and our CSS file
    // - script-src 'nonce-...': Only allow scripts with our nonce
    // - connect-src: allow only extension-local resource origin (no localhost wildcard network access)
    // - img-src: Allow images from webview and data URIs
    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline' ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: https:`,
    ].join("; ")

    return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>Kilo Code</title>
	<link rel="stylesheet" href="${styleUri}">
	<style>
		html, body {
			margin: 0;
			padding: 0;
			height: 100%;
			overflow: hidden;
		}
		body {
			background-color: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
		}
		#root {
			height: 100%;
		}
		.container {
			height: 100%;
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">window.ICONS_BASE_URI = "${iconsBaseUri}";</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }

  /**
   * Dispose of the provider and clean up subscriptions.
   * Does NOT kill the server — that's the connection service's job.
   */
  dispose(): void {
    this.unsubscribeEvent?.()
    this.unsubscribeState?.()
    this.webviewMessageDisposable?.dispose()
    this.trackedSessionIds.clear()
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
