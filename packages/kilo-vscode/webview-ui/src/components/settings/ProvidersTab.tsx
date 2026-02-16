import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelectorBase } from "../chat/ModelSelector"
import { CustomProvidersSection } from "./providers"
import type { ExtensionMessage, ModelSelection } from "../../types/messages"

interface ProviderOption {
  value: string
  label: string
}

type ProviderDiagnostic = { level: "success" | "error"; message: string; at: number }
type ProviderDiagnosticHistoryEntry = { level: "info" | "success" | "error"; message: string; at: number }

const KILO_GATEWAY_PROVIDER_ID = "kilo"

/** Parse a "provider/model" config string into a ModelSelection (or null). */
function parseModelConfig(raw: string | undefined): ModelSelection | null {
  if (!raw) {
    return null
  }
  const slash = raw.indexOf("/")
  if (slash <= 0) {
    return null
  }
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

function formatProviderOptionLabel(name: string, id: string) {
  return name && name !== id ? `${name} (${id})` : id
}

const SettingsRow: Component<{ label: string; description: string; last?: boolean; children: any }> = (props) => (
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

const ProvidersTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.values(provider.providers())
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ value: entry.id, label: formatProviderOptionLabel(entry.name, entry.id) })),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<ProviderOption | undefined>()
  const [disabledFilter, setDisabledFilter] = createSignal("")
  const [enabledFilter, setEnabledFilter] = createSignal("")
  const [preferGatewayDefault, setPreferGatewayDefault] = createSignal(false)
  const [providerDiagnostics, setProviderDiagnostics] = createSignal<Record<string, ProviderDiagnostic>>({})
  const [providerDiagnosticHistory, setProviderDiagnosticHistory] = createSignal<
    Record<string, ProviderDiagnosticHistoryEntry[]>
  >({})
  const [connectedSnapshot, setConnectedSnapshot] = createSignal<Record<string, boolean>>({})

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []
  const enterpriseAllowList = createMemo(() => server.extensionPolicy()?.allowList)
  const enterprisePolicyActive = createMemo(() => !!enterpriseAllowList() && !enterpriseAllowList()!.allowAll)
  const providerLabelByID = createMemo(() => {
    const entries = providerOptions().map((option) => [option.value, option.label] as const)
    return Object.fromEntries(entries)
  })
  const providerDisplayLabel = (providerID: string) => providerLabelByID()[providerID] ?? providerID
  const matchesProviderFilter = (option: ProviderOption, query: string) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return true
    }
    return option.value.toLowerCase().includes(normalized) || option.label.toLowerCase().includes(normalized)
  }
  const availableDisabledOptions = createMemo(() =>
    providerOptions().filter((option) => !disabledProviders().includes(option.value) && matchesProviderFilter(option, disabledFilter())),
  )
  const availableEnabledOptions = createMemo(() =>
    providerOptions().filter((option) => !enabledProviders().includes(option.value) && matchesProviderFilter(option, enabledFilter())),
  )

  const diagnosticStorageKey = createMemo(() => {
    const currentOrg = server.profileData()?.currentOrgId ?? "personal"
    return `kilo.providers.diagnostics.v1.${currentOrg}`
  })

  const pushProviderDiagnostic = (
    providerID: string,
    entry: { level: "info" | "success" | "error"; message: string; at?: number },
  ) => {
    const timestamp = entry.at ?? Date.now()
    if (entry.level === "success" || entry.level === "error") {
      const latestEntry: ProviderDiagnostic = {
        level: entry.level === "success" ? "success" : "error",
        message: entry.message,
        at: timestamp,
      }
      setProviderDiagnostics((prev) => ({
        ...prev,
        [providerID]: latestEntry,
      }))
    }

    setProviderDiagnosticHistory((prev) => {
      const next = {
        ...prev,
        [providerID]: [...(prev[providerID] ?? []), { level: entry.level, message: entry.message, at: timestamp }].slice(-25),
      }
      try {
        localStorage.setItem(diagnosticStorageKey(), JSON.stringify(next))
      } catch {
        // Ignore storage write failures.
      }
      return next
    })
  }

  const providerPolicyInfo = (providerID: string) => {
    const allowList = enterpriseAllowList()
    if (!allowList || allowList.allowAll) {
      return { blocked: false as const, models: undefined as string[] | undefined }
    }
    const providerRule = allowList.providers?.[providerID]
    if (!providerRule) {
      return { blocked: true as const, models: undefined as string[] | undefined }
    }
    if (providerRule.allowAll) {
      return { blocked: false as const, models: undefined as string[] | undefined }
    }
    const models = Array.isArray(providerRule.models) ? providerRule.models : []
    return {
      blocked: models.length === 0,
      models: models.length > 0 ? models : undefined,
    }
  }

  const copyProviderDiagnostics = async (providerID: string) => {
    try {
      const history = providerDiagnosticHistory()[providerID] ?? []
      const connected = provider.connected().includes(providerID)
      const lines = [
        `provider: ${providerID}`,
        `connected: ${connected}`,
        `entries: ${history.length}`,
        ...history.map((entry) => `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.message}`),
      ]
      await navigator.clipboard.writeText(lines.join("\n"))
      showToast({
        variant: "success",
        title: language.t("settings.providers.connection.toast.diagnosticsCopied"),
        description: providerID,
      })
    } catch {
      showToast({ variant: "error", title: language.t("settings.providers.connection.toast.diagnosticsCopyFailed") })
    }
  }

  const testProviderConnection = (providerID: string, connected: boolean) => {
    pushProviderDiagnostic(providerID, {
      level: "info",
      message: connected
        ? language.t("settings.providers.connection.check.connected")
        : language.t("settings.providers.connection.check.disconnected"),
    })
    if (connected) {
      provider.refresh()
      vscode.postMessage({ type: "requestProviders" })
      return
    }
    connectProvider(providerID)
  }

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "gatewayPreferenceLoaded") {
      setPreferGatewayDefault(!!message.preferGatewayDefault)
      return
    }

    if (message.type === "providersLoaded") {
      const nextSnapshot: Record<string, boolean> = {}
      for (const providerID of Object.keys(message.providers ?? {})) {
        nextSnapshot[providerID] = Array.isArray(message.connected) && message.connected.includes(providerID)
      }

      const previousSnapshot = connectedSnapshot()
      for (const [providerID, isConnected] of Object.entries(nextSnapshot)) {
        const previous = previousSnapshot[providerID]
        if (previous === undefined) {
          continue
        }
        if (previous !== isConnected) {
          pushProviderDiagnostic(providerID, {
            level: isConnected ? "success" : "info",
            message: isConnected
              ? language.t("settings.providers.connection.report.connected")
              : language.t("settings.providers.connection.report.disconnected"),
          })
        }
      }
      setConnectedSnapshot(nextSnapshot)
      return
    }

    if (message.type !== "providerAuthResult") {
      return
    }

    if (message.success) {
      pushProviderDiagnostic(message.providerID, {
        level: "success",
        message:
          message.message ??
          (message.action === "connect"
            ? language.t("settings.providers.connection.auth.connected")
            : language.t("settings.providers.connection.auth.disconnected")),
      })
      showToast({
        variant: "success",
        title:
          message.action === "connect"
            ? language.t("settings.providers.connection.toast.connected")
            : language.t("settings.providers.connection.toast.disconnected"),
        description: message.providerID,
      })
      provider.refresh()
      return
    }

    pushProviderDiagnostic(message.providerID, {
      level: "error",
      message: message.message ?? language.t("settings.providers.connection.auth.failed"),
    })
    showToast({
      variant: "error",
      title:
        message.action === "connect"
          ? language.t("settings.providers.connection.toast.connectFailed")
          : language.t("settings.providers.connection.toast.disconnectFailed"),
      description: message.message ?? message.providerID,
    })
  })
  onCleanup(unsubscribe)

  createEffect(() => {
    const key = diagnosticStorageKey()
    try {
      const raw = localStorage.getItem(key)
      if (!raw) {
        setProviderDiagnosticHistory({})
        setProviderDiagnostics({})
        return
      }
      const parsed = JSON.parse(raw) as Record<string, ProviderDiagnosticHistoryEntry[]>
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setProviderDiagnosticHistory({})
        setProviderDiagnostics({})
        return
      }
      setProviderDiagnosticHistory(parsed)
      const latest: Record<string, ProviderDiagnostic> = {}
      for (const [providerID, entries] of Object.entries(parsed)) {
        const latestErrorOrSuccess = [...(entries ?? [])]
          .reverse()
          .find((entry) => entry.level === "success" || entry.level === "error")
        if (latestErrorOrSuccess) {
          latest[providerID] = {
            level: latestErrorOrSuccess.level === "success" ? "success" : "error",
            message: latestErrorOrSuccess.message,
            at: latestErrorOrSuccess.at,
          }
        }
      }
      setProviderDiagnostics(latest)
    } catch {
      setProviderDiagnosticHistory({})
      setProviderDiagnostics({})
    }
  })

  vscode.postMessage({ type: "requestGatewayPreference" })

  const connectProvider = (providerID: string) => {
    vscode.postMessage({ type: "connectProviderAuth", providerID })
  }

  const disconnectProvider = (providerID: string) => {
    vscode.postMessage({ type: "disconnectProviderAuth", providerID })
  }

  const providerCatalog = createMemo(() => {
    const providers = provider.providers()
    const connected = new Set(provider.connected())
    const defaults = provider.defaults()

    return Object.values(providers)
      .map((entry) => {
        const modelCount = Object.keys(entry.models ?? {}).length
        const defaultModelID = defaults[entry.id]
        const defaultModelName = defaultModelID ? (entry.models?.[defaultModelID]?.name ?? defaultModelID) : undefined
        const policy = providerPolicyInfo(entry.id)
        return {
          id: entry.id,
          name: entry.name,
          connected: connected.has(entry.id),
          modelCount,
          defaultModelName,
          policyBlocked: policy.blocked,
          policyModels: policy.models,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const startupSelection = createMemo<ModelSelection | null>(() => {
    const selection = provider.defaultSelection()
    if (!selection?.providerID || !selection?.modelID) {
      return null
    }
    return selection
  })

  const gatewayDefault = createMemo<ModelSelection | null>(() => {
    const modelID = provider.defaults()[KILO_GATEWAY_PROVIDER_ID]
    if (!modelID) {
      return null
    }
    return { providerID: KILO_GATEWAY_PROVIDER_ID, modelID }
  })
  const gatewayDefaultButtonLabel = createMemo(() => {
    const selection = gatewayDefault()
    return selection
      ? language.t("settings.providers.startup.useGateway.button", { model: selection.modelID })
      : language.t("settings.providers.startup.useGateway.none")
  })

  const addToList = (key: "disabled_providers" | "enabled_providers", value: string) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    if (value && !current.includes(value)) {
      current.push(value)
      updateConfig({ [key]: current })
    }
  }

  const removeFromList = (key: "disabled_providers" | "enabled_providers", index: number) => {
    const current = key === "disabled_providers" ? [...disabledProviders()] : [...enabledProviders()]
    current.splice(index, 1)
    updateConfig({ [key]: current })
  }

  function handleModelSelect(configKey: "model" | "small_model") {
    return (providerID: string, modelID: string) => {
      if (!providerID || !modelID) {
        updateConfig({ [configKey]: undefined })
      } else {
        updateConfig({ [configKey]: `${providerID}/${modelID}` })
      }
    }
  }

  const updateStartupSelection = (selection: ModelSelection) => {
    vscode.postMessage({ type: "updateSetting", key: "model.providerID", value: selection.providerID })
    vscode.postMessage({ type: "updateSetting", key: "model.modelID", value: selection.modelID })
    showToast({
      variant: "success",
      title: language.t("settings.providers.startup.toast.updated"),
      description: `${selection.providerID}/${selection.modelID}`,
    })
  }

  const formatDiagnosticTime = (timestamp: number) => {
    const elapsedMs = Date.now() - timestamp
    const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000))
    if (elapsedSeconds < 60) {
      return language.t("settings.providers.time.secondsAgo", { value: elapsedSeconds })
    }
    const elapsedMinutes = Math.round(elapsedSeconds / 60)
    if (elapsedMinutes < 60) {
      return language.t("settings.providers.time.minutesAgo", { value: elapsedMinutes })
    }
    const elapsedHours = Math.round(elapsedMinutes / 60)
    return language.t("settings.providers.time.hoursAgo", { value: elapsedHours })
  }

  return (
    <div data-component="settings-providers">
      <For each={enterprisePolicyActive() ? [0] : []}>
        {() => (
          <Card style={{ "margin-bottom": "16px" }}>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("settings.providers.enterprisePolicy.note")}
            </div>
          </Card>
        )}
      </For>
      {/* Provider catalog */}
      <Card>
        <div
          class="providers-catalog-header"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "8px",
            "padding-bottom": "8px",
            "border-bottom": providerCatalog().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ "font-weight": "500" }}>{language.t("settings.providers.section.connected")}</div>
          <Tooltip value={language.t("common.refresh")} placement="top">
            <Button variant="ghost" size="small" onClick={() => provider.refresh()}>
              {language.t("common.refresh")}
            </Button>
          </Tooltip>
        </div>

        <For each={providerCatalog()}>
          {(item, index) => (
            <div
              class="providers-catalog-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                gap: "12px",
                padding: "8px 0",
                "border-bottom": index() < providerCatalog().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div class="providers-catalog-info" style={{ flex: 1, "min-width": 0 }}>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <span style={{ "font-weight": "500" }}>{item.name}</span>
                  <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>{item.id}</span>
                </div>
                <div
                  style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}
                >
                  {language.t("settings.providers.catalog.modelsCount", { count: item.modelCount })}
                  {item.defaultModelName
                    ? ` · ${language.t("settings.providers.catalog.defaultModel", { model: item.defaultModelName })}`
                    : ""}
                </div>
                <For each={item.policyModels && item.policyModels.length > 0 ? [item.policyModels] : []}>
                  {(models) => (
                    <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", "margin-top": "2px" }}>
                      {language.t("settings.providers.catalog.policyModels", { models: models.join(", ") })}
                    </div>
                  )}
                </For>
                <For each={item.policyBlocked ? [0] : []}>
                  {() => (
                    <div style={{ "font-size": "11px", color: "var(--vscode-errorForeground)", "margin-top": "2px" }}>
                      {language.t("settings.providers.catalog.policyBlocked")}
                    </div>
                  )}
                </For>
                <For each={providerDiagnostics()[item.id] ? [providerDiagnostics()[item.id]] : []}>
                  {(diagnostic) => (
                    <div
                      style={{
                        "font-size": "11px",
                        color:
                          diagnostic.level === "success"
                            ? "var(--vscode-testing-iconPassed, #89d185)"
                            : "var(--vscode-errorForeground)",
                      }}
                    >
                      {diagnostic.level === "success"
                        ? language.t("settings.providers.catalog.diagnostic.ok")
                        : language.t("settings.providers.catalog.diagnostic.error")}
                      : {diagnostic.message} ·{" "}
                      {formatDiagnosticTime(diagnostic.at)}
                    </div>
                  )}
                </For>
                <details style={{ "margin-top": "4px" }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      "font-size": "11px",
                      color: "var(--vscode-descriptionForeground)",
                      "user-select": "none",
                    }}
                  >
                    {language.t("settings.providers.catalog.diagnostic.history")}
                  </summary>
                  <div style={{ "margin-top": "4px", display: "flex", "flex-direction": "column", gap: "3px" }}>
                    <For each={(providerDiagnosticHistory()[item.id] ?? []).slice().reverse().slice(0, 8)}>
                      {(entry) => (
                        <div
                          style={{
                            "font-size": "11px",
                            color:
                              entry.level === "error"
                                ? "var(--vscode-errorForeground)"
                                : entry.level === "success"
                                  ? "var(--vscode-testing-iconPassed, #89d185)"
                                  : "var(--vscode-descriptionForeground)",
                            "font-family": "var(--vscode-editor-font-family, monospace)",
                          }}
                        >
                          {new Date(entry.at).toLocaleTimeString()} [{entry.level}] {entry.message}
                        </div>
                      )}
                    </For>
                    <For each={(providerDiagnosticHistory()[item.id] ?? []).length === 0 ? [0] : []}>
                      {() => (
                        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                          {language.t("settings.providers.catalog.diagnostic.empty")}
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              </div>

              <div class="providers-catalog-actions" style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span
                  style={{
                    "font-size": "11px",
                    "font-weight": "500",
                    color: item.connected
                      ? "var(--vscode-testing-iconPassed, #89d185)"
                      : "var(--vscode-descriptionForeground)",
                    "text-transform": "capitalize",
                  }}
                >
                  {item.connected
                    ? language.t("settings.aboutKiloCode.status.connected")
                    : language.t("settings.aboutKiloCode.status.disconnected")}
                </span>
                <Tooltip value={language.t("settings.providers.action.test.tooltip")} placement="top">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => testProviderConnection(item.id, item.connected)}
                    disabled={item.policyBlocked && !item.connected}
                  >
                    {language.t("settings.providers.action.test.button")}
                  </Button>
                </Tooltip>
                <Tooltip value={language.t("settings.providers.action.copy.tooltip")} placement="top">
                  <Button size="small" variant="ghost" onClick={() => void copyProviderDiagnostics(item.id)}>
                    {language.t("settings.providers.action.copy.button")}
                  </Button>
                </Tooltip>
                <Tooltip
                  value={
                    item.connected
                      ? language.t("settings.providers.action.disconnect.tooltip")
                      : language.t("settings.providers.action.connect.tooltip")
                  }
                  placement="top">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => (item.connected ? disconnectProvider(item.id) : connectProvider(item.id))}
                    disabled={item.policyBlocked && !item.connected}
                  >
                    {item.connected
                      ? language.t("settings.providers.action.disconnect.button")
                      : language.t("settings.providers.action.connect.button")}
                  </Button>
                </Tooltip>
              </div>
            </div>
          )}
        </For>

        <For each={providerCatalog().length === 0 ? [0] : []}>
          {() => (
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", padding: "8px 0 0" }}>
              {language.t("settings.providers.connected.empty")}
            </div>
          )}
        </For>
      </Card>

      {/* Model selection */}
      <Card style={{ "margin-top": "16px" }}>
        <SettingsRow
          label={language.t("settings.providers.model.default.label")}
          description={language.t("settings.providers.model.default.description")}>
          <ModelSelectorBase
            value={parseModelConfig(config().model)}
            onSelect={handleModelSelect("model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.model.clearLabel")}
          />
        </SettingsRow>
        <SettingsRow
          label={language.t("settings.providers.model.small.label")}
          description={language.t("settings.providers.model.small.description")}
          last
        >
          <ModelSelectorBase
            value={parseModelConfig(config().small_model)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel={language.t("settings.providers.model.clearLabel")}
          />
        </SettingsRow>
      </Card>

      {/* Startup model defaults for new sessions */}
      <Card style={{ "margin-top": "16px" }}>
        <SettingsRow
          label={language.t("settings.providers.startup.label")}
          description={language.t("settings.providers.startup.description")}
        >
          <ModelSelectorBase
            value={startupSelection()}
            onSelect={(providerID, modelID) => {
              if (!providerID || !modelID) {
                return
              }
              updateStartupSelection({ providerID, modelID })
            }}
            placement="bottom-start"
          />
        </SettingsRow>
        <SettingsRow
          label={language.t("settings.providers.startup.preferGateway.label")}
          description={language.t("settings.providers.startup.preferGateway.description")}
        >
          <Switch
            checked={preferGatewayDefault()}
            onChange={(checked) => {
              setPreferGatewayDefault(checked)
              vscode.postMessage({ type: "updateSetting", key: "model.preferGatewayDefault", value: checked })
            }}
            hideLabel
          >
            {language.t("settings.providers.startup.preferGateway.label")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          label={language.t("settings.providers.startup.useGateway.label")}
          description={language.t("settings.providers.startup.useGateway.description")}
          last
        >
          <Tooltip value={language.t("settings.providers.startup.useGateway.tooltip")} placement="top">
            <Button
              size="small"
              variant="ghost"
              disabled={!gatewayDefault()}
              onClick={() => {
                const selection = gatewayDefault()
                if (!selection) {
                  return
                }
                updateStartupSelection(selection)
              }}
            >
              {gatewayDefaultButtonLabel()}
            </Button>
          </Tooltip>
        </SettingsRow>
      </Card>

      <For each={enterprisePolicyActive() ? [0] : []}>
        {() => (
          <Card style={{ "margin-top": "16px" }}>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("settings.providers.custom.policyLocked")}
            </div>
          </Card>
        )}
      </For>

      <Show when={!enterprisePolicyActive()}>
        <CustomProvidersSection
          providers={config().provider}
          onChange={(nextProviders) => updateConfig({ provider: nextProviders })}
        />
      </Show>

      {/* Disabled providers */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.disabled.title")}</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          {language.t("settings.providers.disabled.description")}
        </div>
        <div style={{ padding: "8px 0 0" }}>
          <TextField
            value={disabledFilter()}
            placeholder={language.t("settings.providers.list.searchPlaceholder")}
            onChange={setDisabledFilter}
            aria-label={language.t("settings.providers.list.searchAria")}
          />
        </div>
        <div
          class="providers-inline-add-row"
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": disabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <Select
              options={availableDisabledOptions()}
              current={newDisabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewDisabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder={language.t("settings.providers.list.selectPlaceholder")}
            />
          </div>
          <Tooltip value={language.t("settings.providers.disabled.addTooltip")} placement="top">
            <Button
              size="small"
              onClick={() => {
                if (newDisabled()) {
                  addToList("disabled_providers", newDisabled()!.value)
                  setNewDisabled(undefined)
                }
              }}
            >
              {language.t("settings.providers.list.add")}
            </Button>
          </Tooltip>
        </div>
        <For each={disabledProviders()}>
          {(id, index) => (
            <div
              class="providers-simple-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom":
                  index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span style={{ "font-size": "12px" }}>{providerDisplayLabel(id)}</span>
              <Tooltip value={language.t("common.delete")} placement="top">
                <IconButton
                  size="small"
                  variant="ghost"
                  icon="close"
                  onClick={() => removeFromList("disabled_providers", index())}
                  aria-label={language.t("common.delete")}
                />
              </Tooltip>
            </div>
          )}
        </For>
      </Card>

      {/* Enabled providers (allowlist) */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.enabled.title")}</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          {language.t("settings.providers.enabled.description")}
        </div>
        <div style={{ padding: "8px 0 0" }}>
          <TextField
            value={enabledFilter()}
            placeholder={language.t("settings.providers.list.searchPlaceholder")}
            onChange={setEnabledFilter}
            aria-label={language.t("settings.providers.list.searchAria")}
          />
        </div>
        <div
          class="providers-inline-add-row"
          style={{
            display: "flex",
            gap: "8px",
            "align-items": "center",
            padding: "8px 0",
            "border-bottom": enabledProviders().length > 0 ? "1px solid var(--border-weak-base)" : "none",
          }}
        >
          <div style={{ flex: 1 }}>
            <Select
              options={availableEnabledOptions()}
              current={newEnabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewEnabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder={language.t("settings.providers.list.selectPlaceholder")}
            />
          </div>
          <Tooltip value={language.t("settings.providers.enabled.addTooltip")} placement="top">
            <Button
              size="small"
              onClick={() => {
                if (newEnabled()) {
                  addToList("enabled_providers", newEnabled()!.value)
                  setNewEnabled(undefined)
                }
              }}
            >
              {language.t("settings.providers.list.add")}
            </Button>
          </Tooltip>
        </div>
        <For each={enabledProviders()}>
          {(id, index) => (
            <div
              class="providers-simple-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span style={{ "font-size": "12px" }}>{providerDisplayLabel(id)}</span>
              <Tooltip value={language.t("common.delete")} placement="top">
                <IconButton
                  size="small"
                  variant="ghost"
                  icon="close"
                  onClick={() => removeFromList("enabled_providers", index())}
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

export default ProvidersTab
