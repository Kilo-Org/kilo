import * as vscode from "vscode"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import { KiloProvider } from "./KiloProvider"
import { AgentManagerProvider } from "./AgentManagerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService, type MessagePart } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { KiloCodeActionProvider, KILO_CODE_ACTION_COMMANDS } from "./services/code-actions/KiloCodeActionProvider"
import { BrowserAutomationService } from "./services/browser-automation"
import { AutoPurgeService } from "./services/auto-purge"
import { initializeSettingsSync, readSettingsSyncDiagnostics } from "./services/settings-sync"
import {
  WorkspaceSearchService,
  SimpleCodeIndexService,
  type SearchMatch,
  type CodeIndexStatus,
} from "./services/search/workspace-search"
import {
  ContributionTracker,
  resolveContributionFilePath,
  type ContributionRecord,
} from "./services/contributions/contribution-tracker"
import { initializeLogger, logger, setLoggerDebugEnabled } from "./utils/logger"

const execFile = promisify(execFileCb)
const COMMIT_GENERATION_TIMEOUT_MS = 90_000
const COMMIT_GENERATION_POLL_INTERVAL_MS = 1_000
const MAX_COMMIT_VARIATION_MEMORY = 4
const COMMIT_REGENERATE_ACTION = "Regenerate"
const COMMIT_COPY_ACTION = "Copy to Clipboard"
const DEFAULT_COMMIT_PATCH_EXCLUDE_GLOBS = ["**/*.lock", "**/yarn.lock"] as const
const URL_INGESTION_MAX_CHARS = 16_000
const DEFAULT_CODE_ACTION_TEMPLATES = {
  explain: [
    "Explain this code selection.",
    "Focus on purpose, control flow, edge cases, and any risks.",
    "File: {file}",
    "Selection: {selection}",
    "",
    "{code_block}",
  ].join("\n"),
  fix: [
    "Find and fix issues in this code selection.",
    "Return concrete fixes and summarize what was changed.",
    "File: {file}",
    "Selection: {selection}",
    "Diagnostic: {diagnostic}",
    "",
    "{code_block}",
  ].join("\n"),
  improve: [
    "Improve this code selection while preserving behavior.",
    "Focus on readability, maintainability, and performance where appropriate.",
    "File: {file}",
    "Selection: {selection}",
    "",
    "{code_block}",
  ].join("\n"),
} as const

type GitRepository = {
  rootUri: vscode.Uri
  inputBox: { value: string }
}

type GitApi = {
  repositories: GitRepository[]
}

type GitExtensionExports = {
  getAPI(version: 1): GitApi
}

interface CommitGenerationOptions {
  avoidMessages?: string[]
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Kilo Code")
  context.subscriptions.push(outputChannel)
  initializeLogger(outputChannel)
  setLoggerDebugEnabled(context.extensionMode !== vscode.ExtensionMode.Production)
  logger.info("Kilo Code extension is now active")
  const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
  initializeSettingsSync(context, workspaceDirs)

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context)

  // Create browser automation service (manages Playwright MCP registration)
  const browserAutomationService = new BrowserAutomationService(connectionService)
  browserAutomationService.syncWithSettings()
  const autoPurgeService = new AutoPurgeService({
    tempAttachmentsDir: path.join(os.tmpdir(), "kilo-code-vscode-attachments"),
    extensionContext: context,
  })
  autoPurgeService.start()
  const workspaceSearchService = new WorkspaceSearchService()
  const codeIndexService = new SimpleCodeIndexService()
  const contributionTracker = new ContributionTracker(context)

  const unsubscribeContributionTracking = connectionService.onEvent((event) => {
    if (event.type !== "message.part.updated") {
      return
    }
    const sessionID = connectionService.resolveEventSessionId(event)
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!sessionID || !workspaceDir) {
      return
    }
    contributionTracker.recordFromPart(sessionID, event.properties.part, workspaceDir)
  })

  // Re-register browser automation MCP server on CLI backend reconnect
  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      browserAutomationService.reregisterIfEnabled()
    }
  })

  // Create the provider with shared service
  const provider = new KiloProvider(context, context.extensionUri, connectionService)

  // Register the webview view provider for the sidebar
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider))

  const codeActionProvider = new KiloCodeActionProvider()
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, codeActionProvider, {
      providedCodeActionKinds: Object.values(codeActionProvider.providedCodeActionKinds),
    }),
  )

  // Create Agent Manager provider for editor panel
  const agentManagerProvider = new AgentManagerProvider(context, context.extensionUri, connectionService, (sessionID) => {
    provider.postMessage({ type: "navigate", view: "newTask" })
    provider.postMessage({ type: "openSession", sessionID })
  })
  context.subscriptions.push(agentManagerProvider)

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.plusButtonClicked", () => {
      provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("kilo-code.new.marketplaceButtonClicked", () => {
      provider.postMessage({ type: "action", action: "marketplaceButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.historyButtonClicked", () => {
      provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", () => {
      provider.postMessage({ type: "action", action: "profileButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsButtonClicked", () => {
      provider.postMessage({ type: "action", action: "settingsButtonClicked" })
    }),
    vscode.commands.registerCommand("kilo-code.new.openInTab", () => {
      return openKiloInNewTab(context, connectionService)
    }),
    vscode.commands.registerCommand("kilo-code.new.openWorkspaceTerminal", () => {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
      const terminal = vscode.window.createTerminal({ name: "Kilo Code Terminal", cwd })
      terminal.show(false)
    }),
    vscode.commands.registerCommand("kilo-code.new.searchWorkspace", () => {
      return searchWorkspace(workspaceSearchService)
    }),
    vscode.commands.registerCommand("kilo-code.new.ingestUrlToChat", () => {
      return ingestUrlToChat(provider)
    }),
    vscode.commands.registerCommand("kilo-code.new.semanticSearch", () => {
      return semanticSearch(workspaceSearchService, codeIndexService)
    }),
    vscode.commands.registerCommand("kilo-code.new.rebuildCodeIndex", () => {
      return rebuildCodeIndex(codeIndexService)
    }),
    vscode.commands.registerCommand("kilo-code.new.clearCodeIndex", () => {
      return clearCodeIndex(codeIndexService)
    }),
    vscode.commands.registerCommand("kilo-code.new.getCodeIndexStatus", () => {
      return getCodeIndexStatus(codeIndexService)
    }),
    vscode.commands.registerCommand("kilo-code.new.integration.openGitHubRepo", () => {
      return openGitHubRepository()
    }),
    vscode.commands.registerCommand("kilo-code.new.integration.createPullRequest", () => {
      return openGitHubPullRequest()
    }),
    vscode.commands.registerCommand("kilo-code.new.security.scanWorkspace", () => {
      return scanWorkspaceSecurity(workspaceSearchService)
    }),
    vscode.commands.registerCommand("kilo-code.new.showContributionReport", () => {
      return showContributionReport(contributionTracker)
    }),
    vscode.commands.registerCommand("kilo-code.new.clearContributionReport", () => {
      return clearContributionReport(contributionTracker)
    }),
    vscode.commands.registerCommand("kilo-code.new.settingsSyncDiagnostics", () => {
      return showSettingsSyncDiagnostics(context)
    }),
    vscode.commands.registerCommand("kilo-code.new.openSlashCommandPicker", () => {
      return openSlashCommandPicker(provider)
    }),
    vscode.commands.registerCommand("kilo-code.new.createProjectSlashCommand", () => {
      return createSlashCommandFile("project")
    }),
    vscode.commands.registerCommand("kilo-code.new.createGlobalSlashCommand", () => {
      return createSlashCommandFile("global")
    }),
    vscode.commands.registerCommand("kilo-code.new.runWorkflowCommand", () => {
      return runWorkflowCommand(provider)
    }),
    vscode.commands.registerCommand("kilo-code.new.initializeRepository", () => {
      return initializeRepository(connectionService, provider)
    }),
    vscode.commands.registerCommand("kilo-code.new.generateCommitMessage", () => {
      return generateCommitMessage(provider, connectionService)
    }),
    vscode.commands.registerCommand("kilo-code.new.reviewChanges", () => {
      return reviewChanges(provider)
    }),
    vscode.commands.registerCommand(KILO_CODE_ACTION_COMMANDS.explain, (uri?: vscode.Uri, range?: vscode.Range) =>
      runCodeActionPrompt(provider, "explain", uri, range),
    ),
    vscode.commands.registerCommand(
      KILO_CODE_ACTION_COMMANDS.fix,
      (uri?: vscode.Uri, range?: vscode.Range, diagnosticMessage?: string) =>
        runCodeActionPrompt(provider, "fix", uri, range, diagnosticMessage),
    ),
    vscode.commands.registerCommand(KILO_CODE_ACTION_COMMANDS.improve, (uri?: vscode.Uri, range?: vscode.Range) =>
      runCodeActionPrompt(provider, "improve", uri, range),
    ),
  )

  // Register autocomplete provider
  registerAutocompleteProvider(context, connectionService)

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      unsubscribeStateChange()
      unsubscribeContributionTracking()
      browserAutomationService.dispose()
      autoPurgeService.dispose()
      provider.dispose()
      connectionService.dispose()
    },
  })
}

export function deactivate() {}

async function openSlashCommandPicker(provider: KiloProvider): Promise<void> {
  await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
  provider.postMessage({ type: "navigate", view: "newTask" })
  provider.postMessage({ type: "prefillPrompt", text: "/" })
}

async function showSettingsSyncDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
  const diagnostics = readSettingsSyncDiagnostics(context, workspaceDirs)
  const document = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...diagnostics,
      },
      null,
      2,
    ),
  })
  await vscode.window.showTextDocument(document, { preview: true })
}

function normalizeSlashCommandName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function createSlashCommandFile(scope: "project" | "global"): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (scope === "project" && !workspaceFolder) {
    void vscode.window.showWarningMessage("Open a workspace folder to create a project slash command.")
    return
  }

  const rawName = await vscode.window.showInputBox({
    title: scope === "project" ? "Create Project Slash Command" : "Create Global Slash Command",
    placeHolder: "my-command",
    prompt: "Command name used as /my-command",
    validateInput: (value) => {
      const normalized = normalizeSlashCommandName(value)
      if (!normalized) {
        return "Enter a valid command name"
      }
      return undefined
    },
  })
  if (!rawName) {
    return
  }

  const normalizedName = normalizeSlashCommandName(rawName)
  const description = await vscode.window.showInputBox({
    title: "Command Description (Optional)",
    placeHolder: "Describe what this command does",
  })

  const baseDir =
    scope === "project"
      ? path.join(workspaceFolder!.uri.fsPath, ".kilocode", "commands")
      : path.join(os.homedir(), ".kilocode", "commands")
  const filePath = path.join(baseDir, `${normalizedName}.md`)

  try {
    await fs.mkdir(baseDir, { recursive: true })
    await fs.access(filePath)
    const overwrite = await vscode.window.showWarningMessage(
      `Slash command already exists: /${normalizedName}`,
      { modal: true },
      "Overwrite",
    )
    if (overwrite !== "Overwrite") {
      return
    }
  } catch {
    // File does not exist; continue.
  }

  const body = [
    "---",
    `description: ${description?.trim() || `Run /${normalizedName}`}`,
    "---",
    "",
    "Write your reusable prompt here.",
    "",
    "Use placeholders and concise instructions for best results.",
    "",
  ].join("\n")

  await fs.writeFile(filePath, body, "utf8")
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath))
}

interface WorkflowCommandEntry {
  name: string
  scope: "project" | "global"
  path: string
}

async function listWorkflowCommands(workspaceDir?: string): Promise<WorkflowCommandEntry[]> {
  const roots: Array<{ scope: "project" | "global"; dir: string }> = [
    { scope: "global", dir: path.join(os.homedir(), ".kilocode", "workflows") },
  ]
  if (workspaceDir) {
    roots.unshift({ scope: "project", dir: path.join(workspaceDir, ".kilocode", "workflows") })
  }

  const entries: WorkflowCommandEntry[] = []
  for (const root of roots) {
    try {
      const files = await fs.readdir(root.dir, { withFileTypes: true })
      for (const file of files) {
        if (!file.isFile()) {
          continue
        }
        const ext = path.extname(file.name).toLowerCase()
        if (ext !== ".md" && ext !== ".txt") {
          continue
        }
        entries.push({
          name: path.basename(file.name, ext),
          scope: root.scope,
          path: path.join(root.dir, file.name),
        })
      }
    } catch {
      // Ignore missing directories.
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

async function runWorkflowCommand(provider: KiloProvider): Promise<void> {
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const workflows = await listWorkflowCommands(workspaceDir)
  if (workflows.length === 0) {
    void vscode.window.showInformationMessage("No workflow files found in .kilocode/workflows.")
    return
  }

  const choice = await vscode.window.showQuickPick(
    workflows.map((workflow) => ({
      label: `/${workflow.name}`,
      description: workflow.scope === "project" ? "project workflow" : "global workflow",
      detail: workflow.path,
      workflow,
    })),
    {
      title: "Run Workflow Command",
      placeHolder: "Pick a workflow command to run in chat",
    },
  )

  if (!choice) {
    return
  }

  await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
  provider.postMessage({ type: "navigate", view: "newTask" })
  provider.postMessage({ type: "prefillPrompt", text: `/${choice.workflow.name} ` })
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlToPlainText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")

  const withBreaks = withoutScripts
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|aside|main|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")

  const text = withBreaks.replace(/<[^>]+>/g, " ")
  return decodeHtmlEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

async function ingestUrlToChat(provider: KiloProvider): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Ingest URL Into Chat",
    placeHolder: "https://example.com/article",
    prompt: "Fetch a URL and prefill the chat prompt with extracted content",
    validateInput: (candidate) => {
      const trimmed = candidate.trim()
      if (!trimmed) {
        return "Enter a URL"
      }
      try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return "Only http/https URLs are supported"
        }
        return undefined
      } catch {
        return "Enter a valid URL"
      }
    },
  })

  if (!value) {
    return
  }

  const targetUrl = value.trim()
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    void vscode.window.showErrorMessage("Invalid URL")
    return
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    void vscode.window.showErrorMessage("Only http/https URLs are supported.")
    return
  }

  try {
    const extracted = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Fetching URL content for chat…",
      },
      async () => {
        const response = await fetch(parsed.toString(), { redirect: "follow" })
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`)
        }

        const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
        const body = await response.text()
        const normalized = contentType.includes("text/html") ? htmlToPlainText(body) : body.trim()
        const clipped = normalized.slice(0, URL_INGESTION_MAX_CHARS).trim()
        if (!clipped) {
          throw new Error("URL returned no readable content")
        }
        return clipped
      },
    )

    await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    provider.postMessage({ type: "navigate", view: "newTask" })
    provider.postMessage({
      type: "prefillPrompt",
      text: [
        `Use the fetched URL content below as context: ${parsed.toString()}`,
        "",
        extracted,
      ].join("\n"),
    })
    void vscode.window.showInformationMessage("URL content added to the chat composer.")
  } catch (error) {
    logger.error("[Kilo New] Failed to ingest URL", error)
    void vscode.window.showErrorMessage(
      `Failed to ingest URL: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function initializeRepository(connectionService: KiloConnectionService, provider: KiloProvider): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage("Open a workspace folder before running repository initialization.")
    return
  }

  const workspaceDir = workspaceFolder.uri.fsPath
  const profile = await vscode.window.showQuickPick(
    [
      {
        label: "Standard (Recommended)",
        detail: "General-purpose repository initialization",
        prompt: "/init",
      },
      {
        label: "Web App",
        detail: "Tailor initialization toward frontend/web workflows",
        prompt: "/init\nPrefer web-app conventions, frontend tooling, and UI-focused quality gates.",
      },
      {
        label: "Library / Package",
        detail: "Tailor initialization toward reusable package workflows",
        prompt: "/init\nPrefer library/package conventions, API stability checks, and release hygiene.",
      },
      {
        label: "Backend Service",
        detail: "Tailor initialization toward service/backend workflows",
        prompt: "/init\nPrefer backend-service conventions, reliability checks, and operational safety.",
      },
    ],
    {
      title: "Initialize Repository",
      placeHolder: "Choose initialization profile",
    },
  )

  if (!profile) {
    return
  }

  try {
    const session = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Initializing repository with Kilo…",
      },
      async (progress) => {
        progress.report({ message: "Opening chat surface…", increment: 10 })
        await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)

        progress.report({ message: "Connecting to backend…", increment: 25 })
        await connectionService.connect(workspaceDir)
        const client = connectionService.getHttpClient()

        progress.report({ message: "Creating init session…", increment: 25 })
        const createdSession = await client.createSession(workspaceDir)

        progress.report({ message: "Sending /init request…", increment: 35 })
        await client.sendMessage(createdSession.id, [{ type: "text", text: profile.prompt }], workspaceDir)
        progress.report({ message: "Done", increment: 5 })
        return createdSession
      },
    )

    provider.postMessage({ type: "navigate", view: "newTask" })
    provider.postMessage({ type: "openSession", sessionID: session.id })
    void vscode.window.showInformationMessage(`Kilo repository initialization started (${profile.label}).`)
  } catch (error) {
    logger.error("[Kilo New] Failed to initialize repository via /init", error)
    void vscode.window.showErrorMessage(
      `Failed to initialize repository: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

async function getGitApi(): Promise<GitApi | null> {
  const gitExtension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git")
  if (!gitExtension) {
    return null
  }

  if (!gitExtension.isActive) {
    await gitExtension.activate()
  }

  return gitExtension.exports?.getAPI(1) ?? null
}

async function findRepositoryForWorkspace(workspacePath: string): Promise<GitRepository | null> {
  const git = await getGitApi()
  if (!git) {
    return null
  }

  const candidates = git.repositories
    .filter(
      (repo) =>
        workspacePath.startsWith(repo.rootUri.fsPath) || repo.rootUri.fsPath.startsWith(workspacePath),
    )
    .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)

  return candidates[0] ?? git.repositories[0] ?? null
}

function extractAssistantText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

function normalizeCommitMessage(rawText: string): string {
  let text = rawText.trim()
  const fenced = /```(?:[\w-]+)?\n([\s\S]*?)```/m.exec(text)
  if (fenced?.[1]) {
    text = fenced[1].trim()
  }

  const lines = text
    .replace(/^commit message:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, idx, all) => line.length > 0 || (idx > 0 && idx < all.length - 1))

  if (lines.length === 0) {
    return ""
  }

  const subject = lines[0].replace(/^[-*]\s*/, "").trim().replace(/^["'`]|["'`]$/g, "")
  const body = lines
    .slice(1)
    .join("\n")
    .trim()
  return body ? `${subject}\n\n${body}` : subject
}

function getCommitPatchExcludeArgs(): string[] {
  const configured = vscode.workspace
    .getConfiguration("kilo-code.new")
    .get<string[]>("git.commitMessageExcludeGlobs", [...DEFAULT_COMMIT_PATCH_EXCLUDE_GLOBS])
  const globs = Array.isArray(configured) ? configured : [...DEFAULT_COMMIT_PATCH_EXCLUDE_GLOBS]

  return globs
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(":(exclude)") ? entry : `:(exclude)${entry}`))
}

function buildCommitMessagePrompt(params: {
  nameStatus: string
  stat: string
  stagedPatch: string
  avoidMessages?: string[]
}): string {
  const lines = [
    "Generate a concise git commit message for these staged changes.",
    "Use Conventional Commits format (`type(scope): summary`) when appropriate.",
    "Return only the commit message subject and an optional short body.",
  ]

  if (params.avoidMessages && params.avoidMessages.length > 0) {
    lines.push(
      "",
      "Generate a clearly different alternative from these prior suggestions (do not repeat wording):",
      ...params.avoidMessages.map((entry, index) => `${index + 1}. ${entry}`),
    )
  }

  lines.push(
    "",
    "Staged file changes (name-status):",
    params.nameStatus,
    "",
    "Staged diff stats:",
    params.stat || "(no stats)",
    "",
    "Staged patch excerpt:",
    params.stagedPatch ? params.stagedPatch.slice(0, 14_000) : "(no patch excerpt)",
  )

  return lines.join("\n")
}

async function generateCommitMessageWithCli(
  connectionService: KiloConnectionService,
  cwd: string,
  prompt: string,
): Promise<string> {
  await connectionService.connect(cwd)
  const client = connectionService.getHttpClient()
  let ephemeralSessionID: string | undefined

  try {
    const session = await client.createSession(cwd)
    ephemeralSessionID = session.id

    await client.sendMessage(session.id, [{ type: "text", text: prompt }], cwd)

    const deadline = Date.now() + COMMIT_GENERATION_TIMEOUT_MS
    while (Date.now() < deadline) {
      const messages = await client.getMessages(session.id, cwd)
      const latestAssistant = [...messages].reverse().find((entry) => entry.info.role === "assistant")
      if (latestAssistant?.info.time.completed) {
        const normalized = normalizeCommitMessage(extractAssistantText(latestAssistant.parts))
        if (normalized) {
          return normalized
        }
      }
      await new Promise((resolve) => setTimeout(resolve, COMMIT_GENERATION_POLL_INTERVAL_MS))
    }

    throw new Error("Timed out waiting for generated commit message")
  } finally {
    if (ephemeralSessionID) {
      await client.deleteSession(ephemeralSessionID, cwd).catch(() => undefined)
    }
  }
}

async function generateCommitMessage(
  provider: KiloProvider,
  connectionService: KiloConnectionService,
  options: CommitGenerationOptions = {},
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage("Open a workspace folder before generating a commit message.")
    return
  }

  const cwd = workspaceFolder.uri.fsPath

  try {
    const [nameStatus, stat, stagedPatch] = await Promise.all([
      runGitCommand(cwd, ["diff", "--cached", "--name-status"]),
      runGitCommand(cwd, ["diff", "--cached", "--stat"]),
      runGitCommand(cwd, ["diff", "--cached", "--", ".", ...getCommitPatchExcludeArgs()]).catch(() => ""),
    ])

    if (!nameStatus) {
      void vscode.window.showInformationMessage("No staged changes found. Stage changes first, then try again.")
      return
    }

    const prompt = buildCommitMessagePrompt({
      nameStatus,
      stat,
      stagedPatch,
      avoidMessages: options.avoidMessages,
    })

    try {
      const generated = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.SourceControl,
          title: "Generating commit message with Kilo...",
          cancellable: false,
        },
        async () => generateCommitMessageWithCli(connectionService, cwd, prompt),
      )

      const repository = await findRepositoryForWorkspace(cwd)
      if (repository) {
        repository.inputBox.value = generated
        await vscode.commands.executeCommand("workbench.view.scm")
        const followUp = await vscode.window.showInformationMessage(
          "Commit message generated and inserted into Source Control.",
          COMMIT_REGENERATE_ACTION,
          COMMIT_COPY_ACTION,
        )

        if (followUp === COMMIT_COPY_ACTION) {
          await vscode.env.clipboard.writeText(generated)
          void vscode.window.showInformationMessage("Commit message copied to clipboard.")
          return
        }

        if (followUp === COMMIT_REGENERATE_ACTION) {
          const nextAvoid = [...(options.avoidMessages ?? []), generated].slice(-MAX_COMMIT_VARIATION_MEMORY)
          await generateCommitMessage(provider, connectionService, { avoidMessages: nextAvoid })
          return
        }

        return
      }

      await vscode.env.clipboard.writeText(generated)
      const followUp = await vscode.window.showInformationMessage(
        "Commit message generated and copied to clipboard.",
        COMMIT_REGENERATE_ACTION,
      )
      if (followUp === COMMIT_REGENERATE_ACTION) {
        const nextAvoid = [...(options.avoidMessages ?? []), generated].slice(-MAX_COMMIT_VARIATION_MEMORY)
        await generateCommitMessage(provider, connectionService, { avoidMessages: nextAvoid })
      }
      return
    } catch (error) {
      logger.warn("[Kilo New] Commit message direct generation failed; falling back to chat prefill", error)
    }

    // Fallback path preserves prior behavior if direct generation fails.
    await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    provider.postMessage({ type: "navigate", view: "newTask" })
    provider.postMessage({ type: "prefillPrompt", text: prompt })
    void vscode.window.showWarningMessage("Could not auto-fill Source Control. Prompt was sent to chat instead.")
  } catch (error) {
    logger.error("[Kilo New] Failed to gather staged git context", error)
    void vscode.window.showErrorMessage(
      `Failed to generate commit message context: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

type ReviewScope = "working_tree" | "staged" | "branch_vs_base"

async function resolveReviewBaseRef(cwd: string): Promise<string> {
  const candidates = ["origin/main", "origin/master", "origin/develop", "main", "master", "develop"]
  for (const candidate of candidates) {
    try {
      await runGitCommand(cwd, ["rev-parse", "--verify", candidate])
      return candidate
    } catch {
      // Try next candidate.
    }
  }
  return "HEAD~1"
}

async function reviewChanges(provider: KiloProvider): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage("Open a workspace folder before running code review.")
    return
  }

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "Working Tree", description: "Review uncommitted changes", value: "working_tree" as ReviewScope },
      { label: "Staged", description: "Review changes in the index", value: "staged" as ReviewScope },
      { label: "Branch vs Base", description: "Review current branch against base", value: "branch_vs_base" as ReviewScope },
    ],
    { title: "Review Scope" },
  )

  if (!scopePick) {
    return
  }

  const cwd = workspaceFolder.uri.fsPath
  const scope = scopePick.value

  try {
    let nameStatus = ""
    let stat = ""
    let patch = ""
    let scopeLabel = ""

    if (scope === "working_tree") {
      scopeLabel = "working tree (uncommitted)"
      ;[nameStatus, stat, patch] = await Promise.all([
        runGitCommand(cwd, ["diff", "--name-status"]),
        runGitCommand(cwd, ["diff", "--stat"]),
        runGitCommand(cwd, ["diff"]).catch(() => ""),
      ])
    } else if (scope === "staged") {
      scopeLabel = "staged changes"
      ;[nameStatus, stat, patch] = await Promise.all([
        runGitCommand(cwd, ["diff", "--cached", "--name-status"]),
        runGitCommand(cwd, ["diff", "--cached", "--stat"]),
        runGitCommand(cwd, ["diff", "--cached"]).catch(() => ""),
      ])
    } else {
      const baseRef = await resolveReviewBaseRef(cwd)
      const range = `${baseRef}...HEAD`
      scopeLabel = `branch diff (${range})`
      ;[nameStatus, stat, patch] = await Promise.all([
        runGitCommand(cwd, ["diff", "--name-status", range]),
        runGitCommand(cwd, ["diff", "--stat", range]),
        runGitCommand(cwd, ["diff", range]).catch(() => ""),
      ])
    }

    if (!nameStatus.trim()) {
      void vscode.window.showInformationMessage("No changes found for the selected review scope.")
      return
    }

    const prompt = [
      "Review these code changes like a senior reviewer.",
      "Focus on correctness, regressions, security issues, and missing tests.",
      "Respond with:",
      "1) Findings ordered by severity",
      "2) Open questions/assumptions",
      "3) Short change summary",
      "",
      `Scope: ${scopeLabel}`,
      "",
      "Changed files (name-status):",
      nameStatus,
      "",
      "Diff stats:",
      stat || "(no stats)",
      "",
      "Diff excerpt:",
      patch ? patch.slice(0, 18_000) : "(no diff excerpt)",
    ].join("\n")

    await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
    provider.postMessage({ type: "navigate", view: "newTask" })
    provider.postMessage({ type: "prefillPrompt", text: prompt })
  } catch (error) {
    logger.error("[Kilo New] Failed to gather review context", error)
    void vscode.window.showErrorMessage(
      `Failed to collect review context: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function openKiloInNewTab(context: vscode.ExtensionContext, connectionService: KiloConnectionService) {
  const lastCol = Math.max(...vscode.window.visibleTextEditors.map((e) => e.viewColumn || 0), 0)
  const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0

  if (!hasVisibleEditors) {
    await vscode.commands.executeCommand("workbench.action.newGroupRight")
  }

  const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

  const panel = vscode.window.createWebviewPanel("kilo-code.new.TabPanel", EXTENSION_DISPLAY_NAME, targetCol, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "kilo-dark.svg"),
  }

  const tabProvider = new KiloProvider(context, context.extensionUri, connectionService)
  tabProvider.resolveWebviewPanel(panel)

  // Wait for the new panel to become active before locking the editor group.
  // This avoids the race where VS Code hasn't switched focus yet.
  await waitForWebviewPanelToBeActive(panel)
  await vscode.commands.executeCommand("workbench.action.lockEditorGroup")

  panel.onDidDispose(
    () => {
      logger.info("[Kilo New] Tab panel disposed")
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}

type CodeActionIntent = "explain" | "fix" | "improve"

function getCodeActionTemplate(intent: CodeActionIntent): string {
  const settingKey = `codeActions.${intent}Template`
  const configured = vscode.workspace.getConfiguration("kilo-code.new").get<string>(settingKey)
  return typeof configured === "string" && configured.trim().length > 0
    ? configured
    : DEFAULT_CODE_ACTION_TEMPLATES[intent]
}

function renderCodeActionTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (full, key: string) => {
    return key in variables ? variables[key] : full
  })
}

function buildCodeActionPrompt(
  intent: CodeActionIntent,
  document: vscode.TextDocument,
  selection: vscode.Range,
  selectedText: string,
  diagnosticMessage?: string,
): string {
  const pathLabel = vscode.workspace.asRelativePath(document.uri, false)
  const language = document.languageId || "text"
  const template = getCodeActionTemplate(intent)
  const rendered = renderCodeActionTemplate(template, {
    file: pathLabel,
    selection: `L${selection.start.line + 1}:C${selection.start.character + 1} to L${selection.end.line + 1}:C${selection.end.character + 1}`,
    language,
    code: selectedText,
    code_block: `\`\`\`${language}\n${selectedText}\n\`\`\``,
    diagnostic: diagnosticMessage?.trim() || "(none)",
  })
  return rendered.trim()
}

async function runCodeActionPrompt(
  provider: KiloProvider,
  intent: CodeActionIntent,
  uri?: vscode.Uri,
  range?: vscode.Range,
  diagnosticMessage?: string,
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor
  const targetUri = uri ?? activeEditor?.document.uri
  const targetRange = range ?? activeEditor?.selection

  if (!targetUri || !targetRange) {
    void vscode.window.showWarningMessage("Select code in the editor before running this action.")
    return
  }

  const document =
    activeEditor?.document.uri.toString() === targetUri.toString()
      ? activeEditor.document
      : await vscode.workspace.openTextDocument(targetUri)
  const effectiveRange = targetRange.isEmpty ? document.lineAt(targetRange.start.line).range : targetRange
  const selectedText = document.getText(effectiveRange).trim()

  if (!selectedText) {
    void vscode.window.showWarningMessage("Select non-empty code before running this action.")
    return
  }

  const prompt = buildCodeActionPrompt(intent, document, effectiveRange, selectedText, diagnosticMessage)

  await vscode.commands.executeCommand(`${KiloProvider.viewType}.focus`)
  provider.postMessage({ type: "navigate", view: "newTask" })
  provider.postMessage({ type: "prefillPrompt", text: prompt })
}

function getWorkspaceDir(): string | null {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  return workspaceFolder?.uri.fsPath ?? null
}

function getWorkspaceDirOrWarn(): string | null {
  const workspaceDir = getWorkspaceDir()
  if (workspaceDir) {
    return workspaceDir
  }
  void vscode.window.showWarningMessage("Open a workspace folder first.")
  return null
}

interface SearchQuickPickItem extends vscode.QuickPickItem {
  matchIndex: number
}

interface ParsedSearchQuery {
  pattern: string
  literal: boolean
}

function parseSearchQueryInput(raw: string): ParsedSearchQuery | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.toLowerCase().startsWith("re:")) {
    const pattern = trimmed.slice(3).trim()
    if (!pattern) {
      return null
    }
    return { pattern, literal: false }
  }
  return { pattern: trimmed, literal: true }
}

function toSearchQuickPickItem(match: SearchMatch, matchIndex: number): SearchQuickPickItem {
  const relative = vscode.workspace.asRelativePath(match.file, false)
  return {
    label: relative,
    description: `L${match.line}:C${match.column} • score ${match.score}`,
    detail: match.text,
    matchIndex,
  }
}

async function openSearchMatch(workspaceDir: string, selected: SearchMatch): Promise<void> {
  const resolvedPath = path.isAbsolute(selected.file) ? selected.file : path.join(workspaceDir, selected.file)
  const uri = vscode.Uri.file(resolvedPath)
  const doc = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false })
  const position = new vscode.Position(Math.max(0, selected.line - 1), Math.max(0, selected.column - 1))
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
}

async function searchWorkspace(search: WorkspaceSearchService): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }

  const query = await vscode.window.showInputBox({
    title: "Search Workspace",
    prompt: "Enter text query (prefix with re: for regex)",
    placeHolder: "auth token refresh",
  })
  if (!query?.trim()) {
    return
  }
  const parsedQuery = parseSearchQueryInput(query)
  if (!parsedQuery) {
    void vscode.window.showWarningMessage("Provide a search query.")
    return
  }

  try {
    const matches = await search.searchText(parsedQuery.pattern, workspaceDir, 100, {
      literal: parsedQuery.literal,
    })
    if (matches.length === 0) {
      void vscode.window.showInformationMessage("No matches found.")
      return
    }
    const items = matches.map((match, index) => toSearchQuickPickItem(match, index))
    const picked = await vscode.window.showQuickPick(items, {
      title: `Search results (${matches.length})`,
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked) {
      const selected = matches[picked.matchIndex]
      if (selected) {
        await openSearchMatch(workspaceDir, selected)
      }
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function semanticSearch(search: WorkspaceSearchService, index: SimpleCodeIndexService): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }

  const query = await vscode.window.showInputBox({
    title: "Semantic Search",
    prompt: "Describe what you are looking for",
    placeHolder: "code that handles oauth callback and token refresh",
  })
  if (!query?.trim()) {
    return
  }

  try {
    // Keep filename/path index warm so semantic ranking can leverage path signals.
    await index.search(query, workspaceDir, 20)
    const matches = await search.semanticSearch(query, workspaceDir, 80)
    if (matches.length === 0) {
      void vscode.window.showInformationMessage("No semantic matches found.")
      return
    }
    const items = matches.map((match, index) => toSearchQuickPickItem(match, index))
    const picked = await vscode.window.showQuickPick(items, {
      title: `Semantic results (${matches.length})`,
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked) {
      const selected = matches[picked.matchIndex]
      if (selected) {
        await openSearchMatch(workspaceDir, selected)
      }
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Semantic search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function rebuildCodeIndex(index: SimpleCodeIndexService): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }
  try {
    const snapshot = await index.rebuild(workspaceDir)
    void vscode.window.showInformationMessage(`Indexed ${snapshot.files.length.toLocaleString()} files.`)
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to rebuild code index: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function clearCodeIndex(index: SimpleCodeIndexService): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }
  index.clear(workspaceDir)
  void vscode.window.showInformationMessage("Code index cleared.")
}

function getCodeIndexStatus(index: SimpleCodeIndexService): CodeIndexStatus {
  const workspaceDir = getWorkspaceDir()
  if (!workspaceDir) {
    return {
      systemStatus: "Standby",
      processedItems: 0,
      totalItems: 0,
      currentItemUnit: "files",
      indexedFiles: 0,
      message: "Open a workspace folder to build an index.",
    }
  }
  return index.getStatus(workspaceDir)
}

function normalizeGitRemoteUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith("https://")) {
    return trimmed.replace(/\.git$/i, "")
  }
  const scp = /^git@([^:]+):(.+)$/.exec(trimmed)
  if (scp) {
    return `https://${scp[1]}/${scp[2].replace(/\.git$/i, "")}`
  }
  const ssh = /^ssh:\/\/git@([^/]+)\/(.+)$/.exec(trimmed)
  if (ssh) {
    return `https://${ssh[1]}/${ssh[2].replace(/\.git$/i, "")}`
  }
  return trimmed.replace(/\.git$/i, "")
}

async function getGitHubRepositoryUrl(): Promise<string | null> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return null
  }

  try {
    const remote = await runGitCommand(workspaceDir, ["config", "--get", "remote.origin.url"])
    const normalized = normalizeGitRemoteUrl(remote)
    if (!/^https:\/\/github\.com\//i.test(normalized)) {
      void vscode.window.showWarningMessage("Remote origin is not a GitHub repository.")
      return null
    }
    return normalized
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to read git remote origin: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

async function openGitHubRepository(): Promise<void> {
  const repositoryUrl = await getGitHubRepositoryUrl()
  if (!repositoryUrl) {
    return
  }
  await vscode.env.openExternal(vscode.Uri.parse(repositoryUrl))
}

async function openGitHubPullRequest(): Promise<void> {
  const repositoryUrl = await getGitHubRepositoryUrl()
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!repositoryUrl || !workspaceDir) {
    return
  }

  let branch = "HEAD"
  try {
    branch = await runGitCommand(workspaceDir, ["rev-parse", "--abbrev-ref", "HEAD"])
  } catch {
    // Fall back to HEAD if git branch detection fails.
  }

  const prUrl = `${repositoryUrl}/compare/${encodeURIComponent(branch)}?expand=1`
  await vscode.env.openExternal(vscode.Uri.parse(prUrl))
}

async function scanWorkspaceSecurity(search: WorkspaceSearchService): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }

  const checks = [
    { id: "aws", pattern: "AKIA[0-9A-Z]{16}", label: "AWS Access Key format" },
    { id: "github", pattern: "ghp_[A-Za-z0-9]{30,}", label: "GitHub token format" },
    { id: "private-key", pattern: "BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY", label: "Private key block" },
    { id: "dotenv", pattern: "(API_KEY|SECRET|TOKEN)\\s*=\\s*['\\\"]?[A-Za-z0-9_\\-]{16,}", label: "Secret-like env var" },
  ] as const

  const findings: Array<{ label: string; match: SearchMatch }> = []
  for (const check of checks) {
    try {
      const results = await search.searchText(check.pattern, workspaceDir, 5, { literal: false })
      for (const match of results) {
        findings.push({ label: check.label, match })
      }
    } catch {
      // Continue scanning even if one pattern fails.
    }
  }

  if (findings.length === 0) {
    void vscode.window.showInformationMessage("Security scan completed. No high-signal secret patterns found.")
    return
  }

  interface SecurityFindingPickItem extends vscode.QuickPickItem {
    findingIndex: number
  }

  const sortedFindings = [...findings].sort((a, b) => {
    if (a.label !== b.label) {
      return a.label.localeCompare(b.label)
    }
    if (a.match.file !== b.match.file) {
      return a.match.file.localeCompare(b.match.file)
    }
    return a.match.line - b.match.line
  })

  const items: SecurityFindingPickItem[] = sortedFindings.map((finding, index) => {
    const relative = vscode.workspace.asRelativePath(finding.match.file, false)
    return {
      label: relative,
      description: `${finding.label} • L${finding.match.line}:C${finding.match.column}`,
      detail: finding.match.text,
      findingIndex: index,
    }
  })

  const picked = await vscode.window.showQuickPick(items, {
    title: `Security scan findings (${sortedFindings.length})`,
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (!picked) {
    return
  }

  const finding = sortedFindings[picked.findingIndex]
  if (!finding) {
    return
  }
  await openSearchMatch(workspaceDir, finding.match)
}

function buildContributionQuickPickItem(
  workspaceDir: string,
  entry: ContributionRecord,
): vscode.QuickPickItem & { entryId: string } {
  const location = entry.filePath
    ? vscode.workspace.asRelativePath(resolveContributionFilePath(workspaceDir, entry.filePath), false)
    : "(unknown file)"
  const when = new Date(entry.timestamp)
  const whenLabel = Number.isFinite(when.getTime()) ? when.toLocaleString() : entry.timestamp

  return {
    label: location,
    description: `+${entry.additions} -${entry.deletions} • ${entry.tool}`,
    detail: `${whenLabel}${entry.sessionID ? ` • session ${entry.sessionID}` : ""}`,
    entryId: entry.id,
  }
}

async function showContributionReport(tracker: ContributionTracker): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }

  const records = tracker.list(workspaceDir, 300)
  if (records.length === 0) {
    void vscode.window.showInformationMessage("No tracked AI contributions yet for this workspace.")
    return
  }

  const byFile = new Map<
    string,
    {
      filePath?: string
      additions: number
      deletions: number
      toolSet: Set<string>
      timestamp: string
      latestEntryID: string
      sessionID?: string
    }
  >()

  for (const entry of records) {
    const key = entry.filePath ?? "__unknown__"
    const current = byFile.get(key)
    if (!current) {
      byFile.set(key, {
        filePath: entry.filePath,
        additions: entry.additions,
        deletions: entry.deletions,
        toolSet: new Set([entry.tool]),
        timestamp: entry.timestamp,
        latestEntryID: entry.id,
        sessionID: entry.sessionID,
      })
      continue
    }

    current.additions += entry.additions
    current.deletions += entry.deletions
    current.toolSet.add(entry.tool)
    if (entry.timestamp > current.timestamp) {
      current.timestamp = entry.timestamp
      current.latestEntryID = entry.id
      current.sessionID = entry.sessionID
    }
  }

  const aggregateRecords: ContributionRecord[] = Array.from(byFile.values())
    .map((entry) => ({
      id: entry.latestEntryID,
      sessionID: entry.sessionID ?? "",
      tool: Array.from(entry.toolSet).join(", "),
      filePath: entry.filePath,
      additions: entry.additions,
      deletions: entry.deletions,
      timestamp: entry.timestamp,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  const picks = aggregateRecords.map((entry) => buildContributionQuickPickItem(workspaceDir, entry))
  const picked = await vscode.window.showQuickPick(picks, {
    title: `AI Contributions (${aggregateRecords.length} files)`,
    matchOnDescription: true,
    matchOnDetail: true,
  })

  if (!picked) {
    return
  }

  const selected = aggregateRecords.find((entry) => entry.id === picked.entryId)
  if (!selected?.filePath) {
    return
  }

  const filePath = resolveContributionFilePath(workspaceDir, selected.filePath)
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false })
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to open contribution file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function clearContributionReport(tracker: ContributionTracker): Promise<void> {
  const workspaceDir = getWorkspaceDirOrWarn()
  if (!workspaceDir) {
    return
  }

  const confirmation = await vscode.window.showWarningMessage(
    "Clear tracked AI contribution history for this workspace?",
    { modal: true },
    "Clear",
  )
  if (confirmation !== "Clear") {
    return
  }

  await tracker.clear(workspaceDir)
  void vscode.window.showInformationMessage("AI contribution history cleared.")
}

function waitForWebviewPanelToBeActive(panel: vscode.WebviewPanel): Promise<void> {
  if (panel.active) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const disposable = panel.onDidChangeViewState((event) => {
      if (!event.webviewPanel.active) {
        return
      }
      disposable.dispose()
      resolve()
    })
  })
}
