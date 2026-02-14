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
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { AgentConfig, ExtensionMessage, McpConfig, McpServerConfigInput, McpStatus } from "../../types/messages"

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

const MCP_TYPE_OPTIONS: Array<{ value: McpType; label: string }> = [
  { value: "local", label: "Local (command)" },
  { value: "remote", label: "Remote (URL)" },
]

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
  const vscode = useVSCode()
  const [activeSubtab, setActiveSubtab] = createSignal<SubtabId>("agents")
  const [selectedAgent, setSelectedAgent] = createSignal<string>("")
  const [newSkillPath, setNewSkillPath] = createSignal("")
  const [newSkillUrl, setNewSkillUrl] = createSignal("")
  const [newInstruction, setNewInstruction] = createSignal("")
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

  const mcpEntries = createMemo(() => Object.entries(config().mcp ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  const mcpToolEntries = createMemo(() => Object.entries(config().tools ?? {}).sort(([a], [b]) => a.localeCompare(b)))

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
        if (typeof rawValue !== "string") {
          throw new Error(`key "${key}" must map to a string`)
        }
        record[key] = rawValue
      }
      return record
    } catch (error) {
      showToast({
        variant: "error",
        title: `${label} is invalid`,
        description: error instanceof Error ? error.message : "Expected a JSON object with string values.",
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

  const submitMcpServer = () => {
    const name = mcpName().trim()
    if (!name) {
      showToast({ variant: "error", title: "MCP server name is required" })
      return
    }

    const timeoutRaw = mcpTimeoutMs().trim()
    const timeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined
    if (timeoutRaw && (!Number.isFinite(timeout) || timeout <= 0)) {
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
    showToast({ variant: "success", title: "MCP server removed", description: name })
    setTimeout(() => vscode.postMessage({ type: "requestMcpStatus" }), 250)
  }

  const requestMcpStatus = () => {
    vscode.postMessage({ type: "requestMcpStatus" })
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
    showToast({ variant: "success", title: "Tool policy updated", description: `${name} → ${next[name] ? "allow" : "deny"}` })
  }

  const removeMcpToolPolicy = (name: string) => {
    const next = { ...(config().tools ?? {}) }
    delete next[name]
    updateConfig({ tools: Object.keys(next).length > 0 ? next : undefined })
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "mcpStatusLoaded") {
      setMcpStatus(message.status)
      setMcpStatusRefreshedAt(Date.now())
    }
  })

  onCleanup(unsubscribe)

  createEffect(() => {
    if (activeSubtab() === "mcpServers") {
      requestMcpStatus()
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
              "margin-bottom": "10px",
            }}
          >
            Configure MCP servers and manage their connection state.
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <TextField value={mcpName()} placeholder="Server name (e.g. playwright)" onChange={(value) => setMcpName(value)} />

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
          <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
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
            <Button size="small" variant="ghost" onClick={requestMcpStatus}>
              Refresh status
            </Button>
          </div>

          <Show
            when={mcpEntries().length > 0}
            fallback={
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                }}
              >
                No MCP servers configured yet.
              </div>
            }
          >
            <For each={mcpEntries()}>
              {([name, mcp], index) => {
                const status = () => statusSummary(name)
                return (
                  <div
                    style={{
                      padding: "8px 0",
                      "border-bottom": index() < mcpEntries().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
                        <div style={{ "font-weight": "500" }}>{name}</div>
                        <div
                          style={{
                            "font-size": "11px",
                            "margin-top": "2px",
                            color: status().color,
                            "font-weight": "500",
                          }}
                        >
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
                        <Button size="small" variant="ghost" onClick={() => editMcpServer(name, mcp)}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() =>
                            vscode.postMessage({
                              type: status().connected ? "disconnectMcpServer" : "connectMcpServer",
                              name,
                            })
                          }
                        >
                          {status().connected ? "Disconnect" : "Connect"}
                        </Button>
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
          <div style={{ display: "flex", gap: "8px", "align-items": "center", padding: "8px 0" }}>
            <div style={{ flex: 1 }}>
              <TextField value={mcpToolName()} placeholder="Tool name (e.g. mcp.playwright.navigate)" onChange={setMcpToolName} />
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
                    color: enabled ? "var(--vscode-testing-iconPassed, #89d185)" : "var(--vscode-testing-iconFailed, #f14c4c)",
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

  const renderRulesSubtab = () => (
    <div>
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

        {/* Add new instruction path */}
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

        {/* Instructions list */}
        <For each={instructions()}>
          {(path, index) => (
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
                {path}
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
    </div>
  )

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
