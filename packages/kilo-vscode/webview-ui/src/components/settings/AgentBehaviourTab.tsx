import { Component, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"

import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type {
  AgentConfig,
  ExtensionMessage,
  McpConfig,
  McpServerConfigInput,
  McpStatus,
  RulesCatalog,
  RulesCatalogItem,
  SlashCommandInfo,
} from "../../types/messages"

type SubtabId = "agents" | "mcpServers" | "rules" | "commands" | "skills"

interface SubtabConfig {
  id: SubtabId
  labelKey: string
}

const subtabs: SubtabConfig[] = [
  { id: "agents", labelKey: "settings.agentBehaviour.subtab.agents" },
  { id: "mcpServers", labelKey: "settings.agentBehaviour.subtab.mcpServers" },
  { id: "rules", labelKey: "settings.agentBehaviour.subtab.rules" },
  { id: "commands", labelKey: "settings.commands.title" },
  { id: "skills", labelKey: "settings.agentBehaviour.subtab.skills" },
]

interface SelectOption {
  value: string
  label: string
}

type McpType = "local" | "remote"
type RulesScope = "local" | "global"
type RulesKind = "rule" | "workflow"

const MCP_TYPE_OPTIONS: Array<{ value: McpType; label: string }> = [
  { value: "local", label: "Local (command)" },
  { value: "remote", label: "Remote (URL)" },
]
const MCP_DOCS_URL = "https://docs.kilocode.ai/features/mcp/using-mcp-in-kilo-code"

const EMPTY_RULES_CATALOG: RulesCatalog = {
  rules: { local: [], global: [] },
  workflows: { local: [], global: [] },
}

interface SettingRowProps {
  label: string
  description: string
  last?: boolean
  children: any
}

const SettingRow: Component<SettingRowProps> = (props) => (
  <div
    data-slot="settings-row"
    style={{
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      padding: "8px 0",
      "border-bottom": props.last ? "none" : "1px solid var(--border-weak-base)",
    }}
  >
    <div style={{ flex: 1, "min-width": 0, "margin-right": "12px" }}>
      <div style={{ "font-weight": "500" }}>{props.label}</div>
      <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
        {props.description}
      </div>
    </div>
    {props.children}
  </div>
)

const AgentBehaviourTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const session = useSession()
  const server = useServer()
  const vscode = useVSCode()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>("agents")
  const [selectedAgent, setSelectedAgent] = createSignal<string>("")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")
  const [newRuleFilename, setNewRuleFilename] = createSignal("")
  const [newRuleScope, setNewRuleScope] = createSignal<RulesScope>("local")
  const [newWorkflowFilename, setNewWorkflowFilename] = createSignal("")
  const [newWorkflowScope, setNewWorkflowScope] = createSignal<RulesScope>("local")
  const [rulesCatalog, setRulesCatalog] = createSignal<RulesCatalog>(EMPTY_RULES_CATALOG)
  const [editingCommandKey, setEditingCommandKey] = createSignal<string | null>(null)
  const [commandName, setCommandName] = createSignal("")
  const [commandValue, setCommandValue] = createSignal("")
  const [commandDescription, setCommandDescription] = createSignal("")
  const [mcpStatus, setMcpStatus] = createSignal<Record<string, McpStatus>>({})
  const [editingMcpName, setEditingMcpName] = createSignal<string | null>(null)
  const [mcpName, setMcpName] = createSignal("")
  const [mcpType, setMcpType] = createSignal<McpType>("local")
  const [mcpCommand, setMcpCommand] = createSignal("")
  const [mcpArgs, setMcpArgs] = createSignal("")
  const [mcpEnvironmentJson, setMcpEnvironmentJson] = createSignal("")
  const [mcpUrl, setMcpUrl] = createSignal("")
  const [mcpHeadersJson, setMcpHeadersJson] = createSignal("")
  const [mcpTimeoutMs, setMcpTimeoutMs] = createSignal("")
  const [mcpEnabled, setMcpEnabled] = createSignal(true)
  const [mcpToolName, setMcpToolName] = createSignal("")
  const [mcpToolEnabled, setMcpToolEnabled] = createSignal(true)
  const [mcpStatusRefreshedAt, setMcpStatusRefreshedAt] = createSignal<number | null>(null)
  const [showOnlyMcpIssues, setShowOnlyMcpIssues] = createSignal(false)
  const [mcpStatusSnapshot, setMcpStatusSnapshot] = createSignal<Record<string, McpStatus>>({})
  const [mcpDiagnosticsTimeline, setMcpDiagnosticsTimeline] = createSignal<
    Record<string, Array<{ level: "info" | "success" | "warn" | "error"; message: string; at: number }>>
  >({})
  const [slashCommands, setSlashCommands] = createSignal<SlashCommandInfo[]>([])

  const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  const mcpToolEntries = createMemo(() => Object.entries(config().tools ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  const mcpTimelineStorageKey = createMemo(() => {
    const currentOrg = server.profileData()?.currentOrgId ?? "personal"
    return `kilo.mcp.timeline.v1.${currentOrg}`
  })
  const discoveredMcpTools = createMemo(() => {
    const byName = new Map<string, { name: string; description?: string; sourceCommand: string }>()

    for (const command of slashCommands()) {
      if (command.source !== "mcp") {
        continue
      }
      const rawName = command.name.trim().replace(/^\//, "")
      if (!rawName) {
        continue
      }
      const candidates = new Set<string>()
      candidates.add(rawName.startsWith("mcp.") ? rawName : `mcp.${rawName}`)
      for (const hint of command.hints ?? []) {
        const normalizedHint = hint.trim()
        if (!normalizedHint) {
          continue
        }
        if (normalizedHint.startsWith("mcp.")) {
          candidates.add(normalizedHint)
        }
      }
      for (const normalized of candidates) {
        if (!byName.has(normalized)) {
          byName.set(normalized, {
            name: normalized,
            description: command.description?.trim() || undefined,
            sourceCommand: rawName,
          })
        }
      }
    }

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const parseRecordJson = (value: string, label: string): Record<string, string> | null => {
    const trimmed = value.trim()
    if (!trimmed) {
      return {}
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("must be a JSON object")
      }
      const record: Record<string, string> = {}
      for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof rawValue === "string") {
          record[key] = rawValue
          continue
        }
        if (rawValue === null || typeof rawValue === "number" || typeof rawValue === "boolean") {
          record[key] = String(rawValue)
          continue
        }
        record[key] = JSON.stringify(rawValue)
      }
      return record
    } catch (error) {
      showToast({
        variant: "error",
        title: `${label} is invalid`,
        description: error instanceof Error ? error.message : "Expected a JSON object.",
      })
      return null
    }
  }

  const resetMcpForm = () => {
    setEditingMcpName(null)
    setMcpName("")
    setMcpType("local")
    setMcpCommand("")
    setMcpArgs("")
    setMcpEnvironmentJson("")
    setMcpUrl("")
    setMcpHeadersJson("")
    setMcpTimeoutMs("")
    setMcpEnabled(true)
  }

  const toObjectString = (value: Record<string, string> | undefined) => {
    if (!value || Object.keys(value).length === 0) {
      return ""
    }
    return JSON.stringify(value, null, 2)
  }

  const getCommandAndArgs = (mcp: McpConfig): { command: string; args: string[] } => {
    const argsFromField = (mcp.args ?? []).filter((arg) => typeof arg === "string" && arg.trim().length > 0)
    if (Array.isArray(mcp.command)) {
      const raw = mcp.command.filter((part) => typeof part === "string" && part.trim().length > 0)
      const command = raw[0] ?? ""
      return { command, args: [...raw.slice(1), ...argsFromField] }
    }
    return {
      command: typeof mcp.command === "string" ? mcp.command : "",
      args: argsFromField,
    }
  }

  const editMcpServer = (name: string, mcp: McpConfig) => {
    const commandData = getCommandAndArgs(mcp)
    setEditingMcpName(name)
    setMcpName(name)
    setMcpTimeoutMs(typeof mcp.timeout === "number" ? String(mcp.timeout) : "")
    setMcpEnabled(mcp.enabled ?? true)
    if (mcp.url) {
      setMcpType("remote")
      setMcpUrl(mcp.url)
      setMcpHeadersJson(toObjectString(mcp.headers))
      setMcpCommand("")
      setMcpArgs("")
      setMcpEnvironmentJson("")
      return
    }

    setMcpType("local")
    setMcpCommand(commandData.command)
    setMcpArgs(commandData.args.join(" "))
    setMcpEnvironmentJson(toObjectString(mcp.env))
    setMcpUrl("")
    setMcpHeadersJson("")
  }

  const statusSummary = (name: string): { label: string; detail?: string; color: string; connected: boolean } => {
    const status = mcpStatus()[name]
    if (!status) {
      return {
        label: "Unknown",
        color: "var(--vscode-descriptionForeground)",
        connected: false,
      }
    }

    if (status.status === "connected") {
      return {
        label: "Connected",
        color: "var(--vscode-testing-iconPassed, #89d185)",
        connected: true,
      }
    }
    if (status.status === "disabled") {
      return {
        label: "Disabled",
        color: "var(--vscode-descriptionForeground)",
        connected: false,
      }
    }
    if (status.status === "needs_auth") {
      return {
        label: "Needs auth",
        color: "var(--vscode-testing-iconQueued, #cca700)",
        connected: false,
      }
    }
    if (status.status === "needs_client_registration") {
      return {
        label: "Needs registration",
        detail: status.error,
        color: "var(--vscode-testing-iconQueued, #cca700)",
        connected: false,
      }
    }
    return {
      label: "Failed",
      detail: status.error,
      color: "var(--vscode-testing-iconFailed, #f14c4c)",
      connected: false,
    }
  }

  const pushMcpTimeline = (
    name: string,
    entry: { level: "info" | "success" | "warn" | "error"; message: string; at?: number },
  ) => {
    const timestamp = entry.at ?? Date.now()
    setMcpDiagnosticsTimeline((prev) => {
      const next = {
        ...prev,
        [name]: [...(prev[name] ?? []), { level: entry.level, message: entry.message, at: timestamp }].slice(-40),
      }
      try {
        localStorage.setItem(mcpTimelineStorageKey(), JSON.stringify(next))
      } catch {
        // Ignore storage errors.
      }
      return next
    })
  }

  const statusDescription = (status: McpStatus): string => {
    if (status.status === "connected") {
      return "connected"
    }
    if (status.status === "disabled") {
      return "disabled"
    }
    if (status.status === "needs_auth") {
      return "needs authentication"
    }
    if (status.status === "needs_client_registration") {
      return "needs client registration"
    }
    return `failed: ${status.error}`
  }

  const mcpServerType = (mcp: McpConfig): McpType => (mcp.url ? "remote" : "local")

  const mcpDiagnosticsText = (name: string, mcp: McpConfig): string => {
    const summary = statusSummary(name)
    const commandData = getCommandAndArgs(mcp)
    const lines: string[] = [
      `name: ${name}`,
      `status: ${summary.label}`,
      `type: ${mcpServerType(mcp)}`,
      `enabled: ${mcp.enabled ?? true}`,
      `timeout: ${typeof mcp.timeout === "number" ? mcp.timeout : "default"}`,
    ]

    if (summary.detail) {
      lines.push(`detail: ${summary.detail}`)
    }

    if (mcp.url) {
      lines.push(`url: ${mcp.url}`)
      lines.push(`headers: ${Object.keys(mcp.headers ?? {}).length}`)
    } else {
      lines.push(`command: ${commandData.command || "(missing)"}`)
      lines.push(`args: ${commandData.args.join(" ") || "(none)"}`)
      lines.push(`env: ${Object.keys(mcp.env ?? {}).length}`)
    }

    if (mcpStatusRefreshedAt()) {
      lines.push(`refreshedAt: ${new Date(mcpStatusRefreshedAt()!).toISOString()}`)
    }
    const timeline = mcpDiagnosticsTimeline()[name] ?? []
    if (timeline.length > 0) {
      lines.push("timeline:")
      for (const entry of timeline.slice(-10)) {
        lines.push(`  - ${new Date(entry.at).toISOString()} [${entry.level}] ${entry.message}`)
      }
    }

    return lines.join("\n")
  }

  const copyMcpDiagnostics = async (name: string, mcp: McpConfig) => {
    try {
      await navigator.clipboard.writeText(mcpDiagnosticsText(name, mcp))
      showToast({ variant: "success", title: "Diagnostics copied", description: name })
    } catch {
      showToast({ variant: "error", title: "Failed to copy diagnostics" })
    }
  }

  const copyAllMcpDiagnostics = async () => {
    try {
      const payload = mcpEntries()
        .map(([name, mcp]) => mcpDiagnosticsText(name, mcp))
        .join("\n\n---\n\n")
      await navigator.clipboard.writeText(payload || "No MCP servers configured")
      showToast({ variant: "success", title: "MCP diagnostics copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy MCP diagnostics" })
    }
  }

  const visibleMcpEntries = createMemo(() => {
    const all = mcpEntries()
    if (!showOnlyMcpIssues()) {
      return all
    }
    return all.filter(([name]) => {
      const status = statusSummary(name)
      return status.label !== "Connected"
    })
  })

  const submitMcpServer = () => {
    const name = mcpName().trim()
    if (!name) {
      showToast({ variant: "error", title: "MCP server name is required" })
      return
    }

    const timeoutRaw = mcpTimeoutMs().trim()
    const timeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined
    if (timeoutRaw && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)) {
      showToast({ variant: "error", title: "Timeout must be a positive integer" })
      return
    }

    const common = {
      enabled: mcpEnabled(),
      ...(timeout ? { timeout } : {}),
    }

    let configInput: McpServerConfigInput
    if (mcpType() === "remote") {
      const url = mcpUrl().trim()
      if (!url) {
        showToast({ variant: "error", title: "Remote MCP URL is required" })
        return
      }
      const headers = parseRecordJson(mcpHeadersJson(), "Headers JSON")
      if (headers === null) {
        return
      }
      configInput = {
        type: "remote",
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...common,
      }
    } else {
      const command = mcpCommand().trim()
      if (!command) {
        showToast({ variant: "error", title: "Local MCP command is required" })
        return
      }
      const environment = parseRecordJson(mcpEnvironmentJson(), "Environment JSON")
      if (environment === null) {
        return
      }
      const args = mcpArgs()
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
      configInput = {
        type: "local",
        command: [command, ...args],
        ...(Object.keys(environment).length > 0 ? { environment } : {}),
        ...common,
      }
    }

    vscode.postMessage({
      type: "addMcpServer",
      name,
      config: configInput,
    })
    pushMcpTimeline(name, {
      level: "info",
      message: editingMcpName() ? "Server configuration updated" : "Server configuration created",
    })
    showToast({
      variant: "success",
      title: editingMcpName() ? "MCP server updated" : "MCP server added",
      description: name,
    })
    resetMcpForm()
  }

  const removeMcpServer = (name: string) => {
    const next = { ...(config().mcp ?? {}) }
    delete next[name]
    updateConfig({ mcp: next })
    setMcpStatus((prev) => {
      const cloned = { ...prev }
      delete cloned[name]
      return cloned
    })
    pushMcpTimeline(name, {
      level: "info",
      message: "Server removed from config",
    })
    showToast({ variant: "success", title: "MCP server removed", description: name })
    setTimeout(() => vscode.postMessage({ type: "requestMcpStatus" }), 250)
  }

  const setMcpServerEnabled = (name: string, enabled: boolean) => {
    const current = config().mcp?.[name]
    if (!current) {
      return
    }
    const next = {
      ...(config().mcp ?? {}),
      [name]: {
        ...current,
        enabled,
      },
    }
    updateConfig({ mcp: next })
    pushMcpTimeline(name, {
      level: "info",
      message: enabled ? "Server enabled" : "Server disabled",
    })
    showToast({
      variant: "success",
      title: enabled ? "MCP server enabled" : "MCP server disabled",
      description: name,
    })
    setTimeout(() => vscode.postMessage({ type: "requestMcpStatus" }), 250)
  }

  const triggerMcpConnection = (name: string, connect: boolean) => {
    pushMcpTimeline(name, {
      level: "info",
      message: connect ? "Connect requested from settings" : "Disconnect requested from settings",
    })
    vscode.postMessage({
      type: connect ? "connectMcpServer" : "disconnectMcpServer",
      name,
    })
  }

  const requestMcpStatus = () => {
    vscode.postMessage({ type: "requestMcpStatus" })
  }

  const openMcpMarketplace = () => {
    window.postMessage(
      {
        type: "action",
        action: "marketplaceButtonClicked",
        values: { marketplaceTab: "mcp" },
      },
      "*",
    )
  }

  const openMcpDocs = () => {
    vscode.postMessage({ type: "openExternal", url: MCP_DOCS_URL })
  }

  const requestSlashCommands = () => {
    vscode.postMessage({ type: "requestSlashCommands" })
  }

  const requestRulesCatalog = () => {
    vscode.postMessage({ type: "requestRulesCatalog" })
  }

  const createRuleOrWorkflow = (kind: RulesKind, scope: RulesScope, filename: string, reset: () => void) => {
    const normalized = filename.trim()
    if (!normalized) {
      showToast({ variant: "error", title: "Filename is required" })
      return
    }
    vscode.postMessage({
      type: "createRuleFile",
      kind,
      scope,
      filename: normalized,
    })
    showToast({
      variant: "success",
      title: `${kind === "rule" ? "Rule" : "Workflow"} file created`,
      description: normalized,
    })
    reset()
    setTimeout(requestRulesCatalog, 200)
  }

  const toggleRuleOrWorkflow = (kind: RulesKind, scope: RulesScope, item: RulesCatalogItem, enabled: boolean) => {
    vscode.postMessage({
      type: "toggleRuleFile",
      kind,
      scope,
      path: item.path,
      enabled,
    })
    setRulesCatalog((prev) => {
      const next: RulesCatalog = {
        rules: {
          local: [...prev.rules.local],
          global: [...prev.rules.global],
        },
        workflows: {
          local: [...prev.workflows.local],
          global: [...prev.workflows.global],
        },
      }
      const list = kind === "rule" ? next.rules[scope] : next.workflows[scope]
      const foundIndex = list.findIndex((entry) => entry.path === item.path)
      if (foundIndex >= 0) {
        list[foundIndex] = { ...list[foundIndex], enabled }
      }
      return next
    })
  }

  const openRuleOrWorkflow = (kind: RulesKind, scope: RulesScope, item: RulesCatalogItem) => {
    vscode.postMessage({
      type: "openRuleFile",
      kind,
      scope,
      path: item.path,
    })
  }

  const deleteRuleOrWorkflow = (kind: RulesKind, scope: RulesScope, item: RulesCatalogItem) => {
    if (!window.confirm(`Delete ${item.name}?`)) {
      return
    }
    vscode.postMessage({
      type: "deleteRuleFile",
      kind,
      scope,
      path: item.path,
    })
    showToast({
      variant: "success",
      title: `${kind === "rule" ? "Rule" : "Workflow"} file deleted`,
      description: item.name,
    })
    setTimeout(requestRulesCatalog, 200)
  }

  const upsertMcpToolPolicy = () => {
    const name = mcpToolName().trim()
    if (!name) {
      showToast({ variant: "error", title: "Tool name is required" })
      return
    }
    const next = { ...(config().tools ?? {}), [name]: mcpToolEnabled() }
    updateConfig({ tools: next })
    setMcpToolName("")
    setMcpToolEnabled(true)
    showToast({
      variant: "success",
      title: "Tool policy updated",
      description: `${name} → ${next[name] ? "allow" : "deny"}`,
    })
  }

  const setMcpToolPolicy = (name: string, enabled: boolean | null) => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    const next = { ...(config().tools ?? {}) }
    if (enabled === null) {
      delete next[trimmed]
    } else {
      next[trimmed] = enabled
    }
    updateConfig({ tools: Object.keys(next).length > 0 ? next : undefined })
  }

  const removeMcpToolPolicy = (name: string) => {
    const next = { ...(config().tools ?? {}) }
    delete next[name]
    updateConfig({ tools: Object.keys(next).length > 0 ? next : undefined })
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "mcpStatusLoaded") {
      const previous = mcpStatusSnapshot()
      for (const [name, nextStatus] of Object.entries(message.status)) {
        const previousStatus = previous[name]
        const changed =
          !previousStatus ||
          previousStatus.status !== nextStatus.status ||
          (previousStatus.status === "failed" &&
            nextStatus.status === "failed" &&
            previousStatus.error !== nextStatus.error) ||
          (previousStatus.status === "needs_client_registration" &&
            nextStatus.status === "needs_client_registration" &&
            previousStatus.error !== nextStatus.error)
        if (!changed) {
          continue
        }
        pushMcpTimeline(name, {
          level:
            nextStatus.status === "connected"
              ? "success"
              : nextStatus.status === "failed"
                ? "error"
                : nextStatus.status === "needs_auth" || nextStatus.status === "needs_client_registration"
                  ? "warn"
                  : "info",
          message: `Status changed to ${statusDescription(nextStatus)}`,
        })
      }
      for (const missing of Object.keys(previous)) {
        if (!(missing in message.status)) {
          pushMcpTimeline(missing, {
            level: "info",
            message: "Status removed from backend response",
          })
        }
      }
      setMcpStatus(message.status)
      setMcpStatusSnapshot(message.status)
      setMcpStatusRefreshedAt(Date.now())
      return
    }
    if (message.type === "slashCommandsLoaded") {
      setSlashCommands(Array.isArray(message.commands) ? message.commands : [])
      return
    }
    if (message.type === "rulesCatalogLoaded") {
      setRulesCatalog(message.catalog)
    }
  })

  onCleanup(unsubscribe)

  createEffect(() => {
    if (activeSubtab() === "mcpServers") {
      requestMcpStatus()
      requestSlashCommands()
    }
  })

  createEffect(() => {
    const key = mcpTimelineStorageKey()
    try {
      const raw = localStorage.getItem(key)
      if (!raw) {
        setMcpDiagnosticsTimeline({})
        return
      }
      const parsed = JSON.parse(raw) as Record<
        string,
        Array<{ level: "info" | "success" | "warn" | "error"; message: string; at: number }>
      >
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setMcpDiagnosticsTimeline({})
        return
      }
      setMcpDiagnosticsTimeline(parsed)
    } catch {
      setMcpDiagnosticsTimeline({})
    }
  })

  createEffect(() => {
    if (activeSubtab() === "rules") {
      requestRulesCatalog()
    }
  })

  const agentNames = createMemo(() => {
    const names = session.agents().map((a) => a.name)
    // Also include any agents from config that might not be in the agent list
    const configAgents = Object.keys(config().agent ?? {})
    for (const name of configAgents) {
      if (!names.includes(name)) {
        names.push(name)
      }
    }
    return names.sort()
  })

  const defaultAgentOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: "Default" },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const agentSelectorOptions = createMemo<SelectOption[]>(() => [
    { value: "", label: "Select an agent to configure…" },
    ...agentNames().map((name) => ({ value: name, label: name })),
  ])

  const currentAgentConfig = createMemo<AgentConfig>(() => {
    const name = selectedAgent()
    if (!name) {
      return {}
    }
    return config().agent?.[name] ?? {}
  })

  const updateAgentConfig = (name: string, partial: Partial<AgentConfig>) => {
    const existing = config().agent ?? {}
    const current = existing[name] ?? {}
    updateConfig({
      agent: {
        ...existing,
        [name]: { ...current, ...partial },
      },
    })
  }

  const instructions = () => config().instructions ?? []

  const addInstruction = () => {
    const value = newInstruction().trim()
    if (!value) {
      return
    }
    const current = [...instructions()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ instructions: current })
    }
    setNewInstruction("")
  }

  const removeInstruction = (index: number) => {
    const current = [...instructions()]
    current.splice(index, 1)
    updateConfig({ instructions: current })
  }

  const skillPaths = () => config().skills?.paths ?? []
  const skillUrls = () => config().skills?.urls ?? []

  const addSkillPath = () => {
    const value = newSkillPath().trim()
    if (!value) {
      return
    }
    const current = [...skillPaths()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, paths: current } })
    }
    setNewSkillPath("")
  }

  const removeSkillPath = (index: number) => {
    const current = [...skillPaths()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, paths: current } })
  }

  const addSkillUrl = () => {
    const value = newSkillUrl().trim()
    if (!value) {
      return
    }
    const current = [...skillUrls()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({ skills: { ...config().skills, urls: current } })
    }
    setNewSkillUrl("")
  }

  const removeSkillUrl = (index: number) => {
    const current = [...skillUrls()]
    current.splice(index, 1)
    updateConfig({ skills: { ...config().skills, urls: current } })
  }

  const commandEntries = createMemo(() => Object.entries(config().command ?? {}).sort(([a], [b]) => a.localeCompare(b)))

  const resetCommandForm = () => {
    setEditingCommandKey(null)
    setCommandName("")
    setCommandValue("")
    setCommandDescription("")
  }

  const editCommand = (name: string, value: { command: string; description?: string }) => {
    setEditingCommandKey(name)
    setCommandName(name)
    setCommandValue(value.command)
    setCommandDescription(value.description ?? "")
  }

  const upsertCommand = () => {
    const name = commandName().trim()
    const command = commandValue().trim()
    const description = commandDescription().trim()
    if (!name || !command) {
      return
    }

    const next = { ...(config().command ?? {}) }
    const previous = editingCommandKey()
    if (previous && previous !== name) {
      delete next[previous]
    }

    next[name] = {
      command,
      description: description || undefined,
    }

    updateConfig({ command: next })
    resetCommandForm()
  }

  const removeCommand = (name: string) => {
    const next = { ...(config().command ?? {}) }
    delete next[name]
    updateConfig({ command: Object.keys(next).length > 0 ? next : undefined })

    if (editingCommandKey() === name) {
      resetCommandForm()
    }
  }

  const renderAgentsSubtab = () => (
    <div>
      {/* Default agent */}
      <Card style={{ "margin-bottom": "12px" }}>
        <SettingRow label="Default Agent" description="Agent to use when none is specified" last>
          <Select
            options={defaultAgentOptions()}
            current={defaultAgentOptions().find((o) => o.value === (config().default_agent ?? ""))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && updateConfig({ default_agent: o.value || undefined })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingRow>
      </Card>

      {/* Agent selector */}
      <div style={{ "margin-bottom": "12px" }}>
        <Select
          options={agentSelectorOptions()}
          current={agentSelectorOptions().find((o) => o.value === selectedAgent())}
          value={(o) => o.value}
          label={(o) => o.label}
          onSelect={(o) => o && setSelectedAgent(o.value)}
          variant="secondary"
          size="small"
          triggerVariant="settings"
        />
      </div>

      <Show when={selectedAgent()}>
        <Card>
          {/* Model override */}
          <SettingRow label="Model Override" description="Override the default model for this agent">
            <TextField
              value={currentAgentConfig().model ?? ""}
              placeholder="e.g. anthropic/claude-sonnet-4-20250514"
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  model: val.trim() || undefined,
                })
              }
            />
          </SettingRow>

          {/* System prompt */}
          <SettingRow label="Custom Prompt" description="Additional system prompt for this agent">
            <TextField
              value={currentAgentConfig().prompt ?? ""}
              placeholder="Custom instructions…"
              multiline
              onChange={(val) =>
                updateAgentConfig(selectedAgent(), {
                  prompt: val.trim() || undefined,
                })
              }
            />
          </SettingRow>

          {/* Temperature */}
          <SettingRow label="Temperature" description="Sampling temperature (0-2)">
            <TextField
              value={currentAgentConfig().temperature?.toString() ?? ""}
              placeholder="Default"
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { temperature: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingRow>

          {/* Top-p */}
          <SettingRow label="Top P" description="Nucleus sampling parameter (0-1)">
            <TextField
              value={currentAgentConfig().top_p?.toString() ?? ""}
              placeholder="Default"
              onChange={(val) => {
                const parsed = parseFloat(val)
                updateAgentConfig(selectedAgent(), { top_p: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingRow>

          {/* Max steps */}
          <SettingRow label="Max Steps" description="Maximum agentic iterations" last>
            <TextField
              value={currentAgentConfig().steps?.toString() ?? ""}
              placeholder="Default"
              onChange={(val) => {
                const parsed = parseInt(val, 10)
                updateAgentConfig(selectedAgent(), { steps: isNaN(parsed) ? undefined : parsed })
              }}
            />
          </SettingRow>
        </Card>
      </Show>
    </div>
  )

  const renderMcpSubtab = () => {
    return (
      <div>
        <Card style={{ "margin-bottom": "16px" }}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-bottom": "12px",
            }}
          >
            Configure MCP servers and manage their connection state. This mirrors the legacy MCP settings workflow.
          </div>
          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", "align-items": "center" }}>
            <Button size="small" variant="secondary" onClick={openMcpMarketplace}>
              Open MCP Marketplace
            </Button>
            <Button size="small" variant="ghost" onClick={requestMcpStatus}>
              Refresh MCP Status
            </Button>
            <Button size="small" variant="ghost" onClick={() => void copyAllMcpDiagnostics()}>
              Copy Diagnostics
            </Button>
            <Button size="small" variant="ghost" onClick={openMcpDocs}>
              MCP Docs
            </Button>
          </div>
          <div
            style={{
              "font-size": "11px",
              color: "var(--vscode-descriptionForeground)",
              "margin-top": "10px",
            }}
          >
            You can also browse installable servers from Marketplace and then fine-tune them here.
          </div>
        </Card>

        <Card style={{ "margin-bottom": "16px" }}>
          <div
            style={{
              "padding-bottom": "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
              "margin-bottom": "10px",
            }}
          >
            <div style={{ "font-weight": "500" }}>{editingMcpName() ? "Edit MCP Server" : "Add MCP Server"}</div>
            <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-top": "2px" }}>
              Define local command or remote URL configuration.
            </div>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <TextField
              value={mcpName()}
              placeholder="Server name (e.g. playwright)"
              onChange={(value) => setMcpName(value)}
            />

            <Select
              options={MCP_TYPE_OPTIONS}
              current={MCP_TYPE_OPTIONS.find((option) => option.value === mcpType())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => {
                if (option) {
                  setMcpType(option.value)
                }
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />

            <Show when={mcpType() === "local"}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <TextField
                  value={mcpCommand()}
                  placeholder="Command (e.g. npx)"
                  onChange={(value) => setMcpCommand(value)}
                />
                <TextField
                  value={mcpArgs()}
                  placeholder="Args separated by spaces (e.g. @playwright/mcp@latest)"
                  onChange={(value) => setMcpArgs(value)}
                />
                <TextField
                  value={mcpEnvironmentJson()}
                  placeholder='Environment JSON (optional, e.g. {"FOO":"bar"})'
                  multiline
                  onChange={(value) => setMcpEnvironmentJson(value)}
                />
              </div>
            </Show>

            <Show when={mcpType() === "remote"}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <TextField
                  value={mcpUrl()}
                  placeholder="Remote URL (e.g. https://example.com/mcp)"
                  onChange={(value) => setMcpUrl(value)}
                />
                <TextField
                  value={mcpHeadersJson()}
                  placeholder='Headers JSON (optional, e.g. {"Authorization":"Bearer ..."})'
                  multiline
                  onChange={(value) => setMcpHeadersJson(value)}
                />
              </div>
            </Show>

            <TextField
              value={mcpTimeoutMs()}
              placeholder="Timeout in milliseconds (optional)"
              onChange={(value) => setMcpTimeoutMs(value)}
            />

            <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px" }}>
              <input
                type="checkbox"
                checked={mcpEnabled()}
                onChange={(event) => setMcpEnabled((event.currentTarget as HTMLInputElement).checked)}
              />
              Enabled
            </label>
          </div>

          <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "10px" }}>
            <Show when={editingMcpName()}>
              <Button size="small" variant="ghost" onClick={resetMcpForm}>
                Cancel
              </Button>
            </Show>
            <Button size="small" onClick={submitMcpServer} disabled={!mcpName().trim()}>
              {editingMcpName() ? "Update MCP Server" : "Add MCP Server"}
            </Button>
          </div>
        </Card>

        <Card>
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "margin-bottom": "8px",
            }}
          >
            <div>
              <div style={{ "font-weight": "500" }}>Configured MCP Servers</div>
              <Show when={mcpStatusRefreshedAt()}>
                {(value) => (
                  <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                    Last refreshed: {new Date(value()).toLocaleTimeString()}
                  </div>
                )}
              </Show>
            </div>
            <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
              <Tooltip
                value={showOnlyMcpIssues() ? "Show all servers" : "Show only servers with issues"}
                placement="top"
              >
                <Button size="small" variant="ghost" onClick={() => setShowOnlyMcpIssues((prev) => !prev)}>
                  {showOnlyMcpIssues() ? "Show all" : "Show issues"}
                </Button>
              </Tooltip>
              <Tooltip value="Copy diagnostics for all MCP servers" placement="top">
                <Button size="small" variant="ghost" onClick={() => void copyAllMcpDiagnostics()}>
                  Copy diagnostics
                </Button>
              </Tooltip>
              <Tooltip value="Refresh MCP status from backend" placement="top">
                <Button size="small" variant="ghost" onClick={requestMcpStatus}>
                  Refresh status
                </Button>
              </Tooltip>
            </div>
          </div>

          <Show
            when={visibleMcpEntries().length > 0}
            fallback={
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                {mcpEntries().length === 0
                  ? "No MCP servers configured yet."
                  : "No MCP servers match the current filter."}
              </div>
            }
          >
            <For each={visibleMcpEntries()}>
              {([name, mcp], index) => {
                const status = () => statusSummary(name)
                const rawStatus = () => mcpStatus()[name]
                const authUrl = () => {
                  const current = rawStatus()
                  if (!current) {
                    return undefined
                  }
                  return typeof current.authUrl === "string" && current.authUrl.trim().length > 0
                    ? current.authUrl
                    : undefined
                }
                const connectLabel = () => {
                  const current = rawStatus()
                  if (current?.status === "connected") {
                    return "Disconnect"
                  }
                  if (current?.status === "needs_auth") {
                    return "Re-authenticate"
                  }
                  if (current?.status === "needs_client_registration") {
                    return "Register"
                  }
                  return "Connect"
                }
                const connectTooltip = () => {
                  const current = rawStatus()
                  if (current?.status === "connected") {
                    return "Disconnect MCP server"
                  }
                  if (current?.status === "needs_auth") {
                    return "Retry OAuth authentication"
                  }
                  if (current?.status === "needs_client_registration") {
                    return "Retry client registration/auth flow"
                  }
                  return "Connect MCP server"
                }
                const enabled = () => mcp.enabled ?? true
                const typeLabel = () => (mcpServerType(mcp) === "remote" ? "Remote" : "Local")
                return (
                  <div
                    style={{
                      padding: "8px 0",
                      "border-bottom":
                        index() < visibleMcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "flex-start",
                        "justify-content": "space-between",
                        gap: "8px",
                      }}
                    >
                      <div style={{ flex: 1, "min-width": 0 }}>
                        <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
                          <div style={{ "font-weight": "500" }}>{name}</div>
                          <span
                            style={{
                              "font-size": "10px",
                              "text-transform": "uppercase",
                              "letter-spacing": "0.4px",
                              padding: "2px 6px",
                              "border-radius": "999px",
                              border: "1px solid var(--border-weak-base)",
                              color: "var(--vscode-descriptionForeground)",
                            }}
                          >
                            {typeLabel()}
                          </span>
                          <Show when={!enabled()}>
                            <span
                              style={{
                                "font-size": "10px",
                                "text-transform": "uppercase",
                                "letter-spacing": "0.4px",
                                padding: "2px 6px",
                                "border-radius": "999px",
                                background: "var(--vscode-badge-background)",
                                color: "var(--vscode-badge-foreground)",
                              }}
                            >
                              Disabled
                            </span>
                          </Show>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "6px",
                            "font-size": "11px",
                            "margin-top": "2px",
                            color: status().color,
                            "font-weight": "500",
                          }}
                        >
                          <span
                            style={{
                              width: "8px",
                              height: "8px",
                              "border-radius": "999px",
                              background: status().color,
                              "flex-shrink": "0",
                            }}
                          />
                          {status().label}
                        </div>
                        <Show when={status().detail}>
                          <div
                            style={{
                              "font-size": "11px",
                              color: "var(--vscode-descriptionForeground)",
                              "margin-top": "2px",
                            }}
                          >
                            {status().detail}
                          </div>
                        </Show>
                        <details style={{ "margin-top": "4px" }}>
                          <summary
                            style={{
                              cursor: "pointer",
                              "font-size": "11px",
                              color: "var(--vscode-descriptionForeground)",
                              "user-select": "none",
                            }}
                          >
                            Diagnostics
                          </summary>
                          <pre
                            style={{
                              margin: "4px 0 0",
                              padding: "6px",
                              "border-radius": "4px",
                              border: "1px solid var(--border-weak-base)",
                              background: "var(--vscode-editor-background)",
                              "font-size": "11px",
                              "font-family": "var(--vscode-editor-font-family, monospace)",
                              "white-space": "pre-wrap",
                              "word-break": "break-word",
                            }}
                          >
                            {mcpDiagnosticsText(name, mcp)}
                          </pre>
                        </details>
                        <details style={{ "margin-top": "4px" }}>
                          <summary
                            style={{
                              cursor: "pointer",
                              "font-size": "11px",
                              color: "var(--vscode-descriptionForeground)",
                              "user-select": "none",
                            }}
                          >
                            Timeline
                          </summary>
                          <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "margin-top": "4px" }}>
                            <For each={(mcpDiagnosticsTimeline()[name] ?? []).slice().reverse().slice(0, 10)}>
                              {(entry) => (
                                <div
                                  style={{
                                    "font-size": "11px",
                                    color:
                                      entry.level === "error"
                                        ? "var(--vscode-errorForeground)"
                                        : entry.level === "warn"
                                          ? "var(--vscode-testing-iconQueued, #cca700)"
                                          : entry.level === "success"
                                            ? "var(--vscode-testing-iconPassed, #89d185)"
                                            : "var(--vscode-descriptionForeground)",
                                    "font-family": "var(--vscode-editor-font-family, monospace)",
                                    "word-break": "break-word",
                                  }}
                                >
                                  {new Date(entry.at).toLocaleString()} [{entry.level}] {entry.message}
                                </div>
                              )}
                            </For>
                            <Show when={(mcpDiagnosticsTimeline()[name] ?? []).length === 0}>
                              <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                                No timeline events recorded yet.
                              </div>
                            </Show>
                          </div>
                        </details>
                        <div
                          style={{
                            "font-size": "11px",
                            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                            "margin-top": "4px",
                            "font-family": "var(--vscode-editor-font-family, monospace)",
                            "word-break": "break-word",
                          }}
                        >
                          <Show when={mcp.command}>
                            <div>
                              command: {getCommandAndArgs(mcp).command} {getCommandAndArgs(mcp).args.join(" ")}
                            </div>
                          </Show>
                          <Show when={mcp.url}>
                            <div>url: {mcp.url}</div>
                          </Show>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                        <Tooltip value="Copy diagnostics" placement="top">
                          <Button size="small" variant="ghost" onClick={() => void copyMcpDiagnostics(name, mcp)}>
                            Copy
                          </Button>
                        </Tooltip>
                        <Tooltip value={language.t("common.edit")} placement="top">
                          <Button size="small" variant="ghost" onClick={() => editMcpServer(name, mcp)}>
                            Edit
                          </Button>
                        </Tooltip>
                        <Show when={authUrl()}>
                          {(url) => (
                            <Tooltip value="Open authentication URL" placement="top">
                              <Button
                                size="small"
                                variant="ghost"
                                onClick={() => vscode.postMessage({ type: "openExternal", url: url() })}
                              >
                                Open Auth URL
                              </Button>
                            </Tooltip>
                          )}
                        </Show>
                        <Tooltip value={connectTooltip()} placement="top">
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={!enabled()}
                            onClick={() => triggerMcpConnection(name, !status().connected)}
                          >
                            {connectLabel()}
                          </Button>
                        </Tooltip>
                        <Tooltip value={enabled() ? "Disable server" : "Enable server"} placement="top">
                          <Button size="small" variant="ghost" onClick={() => setMcpServerEnabled(name, !enabled())}>
                            {enabled() ? "Disable" : "Enable"}
                          </Button>
                        </Tooltip>
                        <Tooltip value={language.t("common.delete")} placement="top">
                          <IconButton
                            size="small"
                            variant="ghost"
                            icon="close"
                            onClick={() => removeMcpServer(name)}
                            aria-label={language.t("common.delete")}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </Show>
        </Card>

        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>MCP Tool Allowlist / Disablement</h4>
        <Card>
          <div
            style={{
              "font-size": "11px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "padding-bottom": "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
            }}
          >
            Manage `config.tools` entries to explicitly allow (`true`) or disable (`false`) tools.
          </div>
          <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", padding: "8px 0 0" }}>
            Discovered from slash-command metadata (`source: mcp`).
          </div>
          <Show when={discoveredMcpTools().length > 0}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px", padding: "8px 0" }}>
              <For each={discoveredMcpTools().slice(0, 30)}>
                {(tool) => {
                  const currentPolicy = () => config().tools?.[tool.name]
                  return (
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        "justify-content": "space-between",
                        border: "1px solid var(--border-weak-base)",
                        "border-radius": "6px",
                        padding: "6px 8px",
                      }}
                    >
                      <div style={{ flex: 1, "min-width": 0 }}>
                        <div
                          style={{
                            "font-size": "12px",
                            "font-family": "var(--vscode-editor-font-family, monospace)",
                            "word-break": "break-word",
                          }}
                        >
                          {tool.name}
                        </div>
                        <Show when={tool.description}>
                          <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                            {tool.description}
                          </div>
                        </Show>
                      </div>
                      <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
                        <Button
                          size="small"
                          variant="ghost"
                          data-state={currentPolicy() === true ? "active" : "idle"}
                          onClick={() => setMcpToolPolicy(tool.name, currentPolicy() === true ? null : true)}
                        >
                          Allow
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          data-state={currentPolicy() === false ? "active" : "idle"}
                          onClick={() => setMcpToolPolicy(tool.name, currentPolicy() === false ? null : false)}
                        >
                          Deny
                        </Button>
                        <Tooltip value="Use this key in manual editor" placement="top">
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => {
                              setMcpToolName(tool.name)
                              setMcpToolEnabled(currentPolicy() !== false)
                            }}
                          >
                            Use
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  )
                }}
              </For>
              <Show when={discoveredMcpTools().length > 30}>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                  +{discoveredMcpTools().length - 30} more discovered tools
                </div>
              </Show>
            </div>
          </Show>
          <Show when={discoveredMcpTools().length === 0}>
            <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", padding: "8px 0" }}>
              No MCP tools discovered yet. Refresh slash commands by reopening this tab after servers connect.
            </div>
          </Show>
          <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0" }}>
            <div style={{ flex: 1 }}>
              <TextField
                value={mcpToolName()}
                placeholder="Tool name (e.g. mcp.playwright.navigate)"
                onChange={setMcpToolName}
              />
            </div>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", "font-size": "12px" }}>
              <input
                type="checkbox"
                checked={mcpToolEnabled()}
                onChange={(event) => setMcpToolEnabled((event.currentTarget as HTMLInputElement).checked)}
              />
              Allow
            </label>
            <Button size="small" onClick={upsertMcpToolPolicy}>
              Save
            </Button>
          </div>

          <For each={mcpToolEntries()}>
            {([toolName, enabled], index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "6px 0",
                  "border-top": "1px solid var(--border-weak-base)",
                  "border-bottom": index() < mcpToolEntries().length - 1 ? "1px solid transparent" : "none",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "12px",
                    flex: 1,
                    "min-width": 0,
                    "word-break": "break-word",
                  }}
                >
                  {toolName}
                </span>
                <span
                  style={{
                    "font-size": "11px",
                    "font-weight": "500",
                    color: enabled
                      ? "var(--vscode-testing-iconPassed, #89d185)"
                      : "var(--vscode-testing-iconFailed, #f14c4c)",
                    "text-transform": "uppercase",
                  }}
                >
                  {enabled ? "ALLOW" : "DENY"}
                </span>
                <Tooltip value={language.t("common.delete")} placement="top">
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeMcpToolPolicy(toolName)}
                    aria-label={language.t("common.delete")}
                  />
                </Tooltip>
              </div>
            )}
          </For>
        </Card>
      </div>
    )
  }

  const renderSkillsSubtab = () => (
    <div>
      {/* Skill paths */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>Skill Folder Paths</h4>
      <Card style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillPaths().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillPath()}
              placeholder="e.g. ./skills"
              onChange={(val) => setNewSkillPath(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillPath()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillPath}>
            Add
          </Button>
        </div>
        <For each={skillPaths()}>
          {(path, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillPaths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {path}
              </span>
              <Tooltip value={language.t("common.delete")} placement="top">
                <IconButton
                  size="small"
                  variant="ghost"
                  icon="close"
                  onClick={() => removeSkillPath(index())}
                  aria-label={language.t("common.delete")}
                />
              </Tooltip>
            </div>
          )}
        </For>
      </Card>

      {/* Skill URLs */}
      <h4 style={{ "margin-top": "0", "margin-bottom": "8px" }}>Skill URLs</h4>
      <Card>
        <div
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": skillUrls().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <TextField
              value={newSkillUrl()}
              placeholder="e.g. https://example.com/skills"
              onChange={(val) => setNewSkillUrl(val)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") addSkillUrl()
              }}
            />
          </div>
          <Button size="small" onClick={addSkillUrl}>
            Add
          </Button>
        </div>
        <For each={skillUrls()}>
          {(url, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < skillUrls().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span
                style={{
                  "font-family": "var(--vscode-editor-font-family, monospace)",
                  "font-size": "12px",
                }}
              >
                {url}
              </span>
              <Tooltip value={language.t("common.delete")} placement="top">
                <IconButton
                  size="small"
                  variant="ghost"
                  icon="close"
                  onClick={() => removeSkillUrl(index())}
                  aria-label={language.t("common.delete")}
                />
              </Tooltip>
            </div>
          )}
        </For>
      </Card>
    </div>
  )

  const renderRulesSubtab = () => {
    const renderCatalogGroup = (
      title: string,
      kind: RulesKind,
      scope: RulesScope,
      entries: RulesCatalogItem[],
      emptyText: string,
    ) => (
      <div style={{ "margin-top": "10px" }}>
        <div style={{ "font-weight": "500", "font-size": "12px", "margin-bottom": "6px" }}>{title}</div>
        <Show
          when={entries.length > 0}
          fallback={
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              {emptyText}
            </div>
          }
        >
          <For each={entries}>
            {(item, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  gap: "8px",
                  padding: "6px 0",
                  "border-bottom": index() < entries.length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    flex: 1,
                    "min-width": 0,
                    "font-size": "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => toggleRuleOrWorkflow(kind, scope, item, event.currentTarget.checked)}
                  />
                  <span
                    style={{
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      "white-space": "nowrap",
                    }}
                  >
                    {item.name}
                  </span>
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <Button size="small" variant="ghost" onClick={() => openRuleOrWorkflow(kind, scope, item)}>
                    Open
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => deleteRuleOrWorkflow(kind, scope, item)}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    )

    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <Card>
          <div
            style={{
              "padding-bottom": "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
            }}
          >
            <div style={{ "font-weight": "500" }}>Additional Instruction Files</div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "margin-top": "2px",
              }}
            >
              Paths to additional instruction files that are included in the system prompt
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              "align-items": "center",
              padding: "8px 0",
              "border-bottom": instructions().length > 0 ? "1px solid var(--border-weak-base)" : "none",
            }}
          >
            <div style={{ flex: 1 }}>
              <TextField
                value={newInstruction()}
                placeholder="e.g. ./INSTRUCTIONS.md"
                onChange={(val) => setNewInstruction(val)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter") addInstruction()
                }}
              />
            </div>
            <Button size="small" onClick={addInstruction}>
              Add
            </Button>
          </div>

          <For each={instructions()}>
            {(instructionPath, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "6px 0",
                  "border-bottom": index() < instructions().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <span
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "12px",
                  }}
                >
                  {instructionPath}
                </span>
                <Tooltip value={language.t("common.delete")} placement="top">
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeInstruction(index())}
                    aria-label={language.t("common.delete")}
                  />
                </Tooltip>
              </div>
            )}
          </For>
        </Card>

        <Card>
          <div
            style={{
              "padding-bottom": "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
            }}
          >
            <div style={{ "font-weight": "500" }}>Rules</div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "margin-top": "2px",
              }}
            >
              Manage rule files from workspace and global `.kilocode/rules`.
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0" }}>
            <select
              value={newRuleScope()}
              onChange={(event) => setNewRuleScope(event.currentTarget.value as RulesScope)}
              style={{
                "background-color": "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                border: "1px solid var(--border-weak-base)",
                padding: "4px 6px",
                "border-radius": "6px",
              }}
            >
              <option value="local">Workspace</option>
              <option value="global">Global</option>
            </select>
            <div style={{ flex: 1 }}>
              <TextField
                value={newRuleFilename()}
                placeholder="new-rule.md"
                onChange={(value) => setNewRuleFilename(value)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    createRuleOrWorkflow("rule", newRuleScope(), newRuleFilename(), () => setNewRuleFilename(""))
                  }
                }}
              />
            </div>
            <Button
              size="small"
              onClick={() => createRuleOrWorkflow("rule", newRuleScope(), newRuleFilename(), () => setNewRuleFilename(""))}
            >
              Create
            </Button>
          </div>

          {renderCatalogGroup("Workspace Rules", "rule", "local", rulesCatalog().rules.local, "No workspace rules found.")}
          {renderCatalogGroup("Global Rules", "rule", "global", rulesCatalog().rules.global, "No global rules found.")}
        </Card>

        <Card>
          <div
            style={{
              "padding-bottom": "8px",
              "border-bottom": "1px solid var(--border-weak-base)",
            }}
          >
            <div style={{ "font-weight": "500" }}>Workflows</div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "margin-top": "2px",
              }}
            >
              Manage reusable workflow files from workspace and global `.kilocode/workflows`.
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0" }}>
            <select
              value={newWorkflowScope()}
              onChange={(event) => setNewWorkflowScope(event.currentTarget.value as RulesScope)}
              style={{
                "background-color": "var(--vscode-input-background)",
                color: "var(--vscode-input-foreground)",
                border: "1px solid var(--border-weak-base)",
                padding: "4px 6px",
                "border-radius": "6px",
              }}
            >
              <option value="local">Workspace</option>
              <option value="global">Global</option>
            </select>
            <div style={{ flex: 1 }}>
              <TextField
                value={newWorkflowFilename()}
                placeholder="new-workflow.md"
                onChange={(value) => setNewWorkflowFilename(value)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    createRuleOrWorkflow("workflow", newWorkflowScope(), newWorkflowFilename(), () =>
                      setNewWorkflowFilename(""),
                    )
                  }
                }}
              />
            </div>
            <Button
              size="small"
              onClick={() =>
                createRuleOrWorkflow("workflow", newWorkflowScope(), newWorkflowFilename(), () =>
                  setNewWorkflowFilename(""),
                )
              }
            >
              Create
            </Button>
          </div>

          {renderCatalogGroup(
            "Workspace Workflows",
            "workflow",
            "local",
            rulesCatalog().workflows.local,
            "No workspace workflows found.",
          )}
          {renderCatalogGroup(
            "Global Workflows",
            "workflow",
            "global",
            rulesCatalog().workflows.global,
            "No global workflows found.",
          )}
        </Card>
      </div>
    )
  }

  const renderCommandsSubtab = () => (
    <div>
      <Card style={{ "margin-bottom": "16px" }}>
        <div
          style={{
            "font-size": "12px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "margin-bottom": "10px",
          }}
        >
          Define reusable slash commands backed by CLI config keys like <code>command.fix-tests</code>.
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <TextField
            value={commandName()}
            placeholder="Command name (e.g. fix-tests)"
            onChange={(value) => setCommandName(value)}
          />
          <TextField
            value={commandValue()}
            placeholder="Shell command (e.g. pnpm test --filter unit)"
            onChange={(value) => setCommandValue(value)}
          />
          <TextField
            value={commandDescription()}
            placeholder="Description (optional)"
            onChange={(value) => setCommandDescription(value)}
          />
        </div>

        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "10px" }}>
          <Show when={editingCommandKey()}>
            <Button size="small" variant="ghost" onClick={resetCommandForm}>
              Cancel
            </Button>
          </Show>
          <Button size="small" onClick={upsertCommand} disabled={!commandName().trim() || !commandValue().trim()}>
            {editingCommandKey() ? "Update Command" : "Add Command"}
          </Button>
        </div>
      </Card>

      <Show
        when={commandEntries().length > 0}
        fallback={
          <Card>
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              No custom commands configured.
            </div>
          </Card>
        }
      >
        <Card>
          <For each={commandEntries()}>
            {([name, value], index) => (
              <div
                style={{
                  padding: "8px 0",
                  "border-bottom": index() < commandEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    "align-items": "flex-start",
                    "justify-content": "space-between",
                    gap: "8px",
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": "500" }}>/{name}</div>
                    <div
                      style={{
                        "font-size": "11px",
                        color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                        "margin-top": "2px",
                        "font-family": "var(--vscode-editor-font-family, monospace)",
                        "word-break": "break-word",
                      }}
                    >
                      {value.command}
                    </div>
                    <Show when={value.description}>
                      <div
                        style={{
                          "font-size": "11px",
                          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                          "margin-top": "2px",
                        }}
                      >
                        {value.description}
                      </div>
                    </Show>
                  </div>

                  <div style={{ display: "flex", gap: "4px" }}>
                    <Button size="small" variant="ghost" onClick={() => editCommand(name, value)}>
                      Edit
                    </Button>
                    <Tooltip value={language.t("common.delete")} placement="top">
                      <IconButton
                        size="small"
                        variant="ghost"
                        icon="close"
                        onClick={() => removeCommand(name)}
                        aria-label={language.t("common.delete")}
                      />
                    </Tooltip>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Card>
      </Show>
    </div>
  )

  const renderSubtabContent = () => {
    switch (activeSubtab()) {
      case "agents":
        return renderAgentsSubtab()
      case "mcpServers":
        return renderMcpSubtab()
      case "rules":
        return renderRulesSubtab()
      case "commands":
        return renderCommandsSubtab()
      case "skills":
        return renderSkillsSubtab()
      default:
        return null
    }
  }

  return (
    <div>
      {/* Horizontal subtab bar */}
      <div
        style={{
          display: "flex",
          gap: "0",
          "border-bottom": "1px solid var(--vscode-panel-border)",
          "margin-bottom": "16px",
        }}
      >
        <For each={subtabs}>
          {(subtab) => (
            <button
              onClick={() => setActiveSubtab(subtab.id)}
              aria-label={language.t(subtab.labelKey)}
              title={language.t(subtab.labelKey)}
              style={{
                padding: "8px 16px",
                border: "none",
                background: "transparent",
                color:
                  activeSubtab() === subtab.id ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                "font-size": "13px",
                "font-weight": activeSubtab() === subtab.id ? "600" : "500",
                "font-family": "var(--vscode-font-family)",
                cursor: "pointer",
                "border-bottom":
                  activeSubtab() === subtab.id ? "2px solid var(--vscode-foreground)" : "2px solid transparent",
                "margin-bottom": "-1px",
              }}
              onMouseEnter={(e) => {
                if (activeSubtab() !== subtab.id) {
                  e.currentTarget.style.color = "var(--vscode-foreground)"
                }
              }}
              onMouseLeave={(e) => {
                if (activeSubtab() !== subtab.id) {
                  e.currentTarget.style.color = "var(--vscode-descriptionForeground)"
                }
              }}
            >
              {language.t(subtab.labelKey)}
            </button>
          )}
        </For>
      </div>

      {/* Subtab content */}
      {renderSubtabContent()}
    </div>
  )
}

export default AgentBehaviourTab
