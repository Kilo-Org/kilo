import { Component, For, createMemo, createSignal, onCleanup } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelectorBase } from "../chat/ModelSelector"
import type { ExtensionMessage, ModelSelection, ProviderConfig } from "../../types/messages"

interface ProviderOption {
  value: string
  label: string
}

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
  const language = useLanguage()
  const vscode = useVSCode()

  const providerOptions = createMemo<ProviderOption[]>(() =>
    Object.keys(provider.providers())
      .sort()
      .map((id) => ({ value: id, label: id })),
  )

  const [newDisabled, setNewDisabled] = createSignal<ProviderOption | undefined>()
  const [newEnabled, setNewEnabled] = createSignal<ProviderOption | undefined>()
  const [editingProviderID, setEditingProviderID] = createSignal<string | null>(null)
  const [providerIDInput, setProviderIDInput] = createSignal("")
  const [providerNameInput, setProviderNameInput] = createSignal("")
  const [providerApiKeyInput, setProviderApiKeyInput] = createSignal("")
  const [providerBaseUrlInput, setProviderBaseUrlInput] = createSignal("")
  const [providerModelsJsonInput, setProviderModelsJsonInput] = createSignal("")

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []
  const customProviders = createMemo(() => Object.entries(config().provider ?? {}).sort(([a], [b]) => a.localeCompare(b)))

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "providerAuthResult") {
      return
    }
    if (message.success) {
      showToast({
        variant: "success",
        title: message.action === "connect" ? "Provider connected" : "Provider disconnected",
        description: message.providerID,
      })
      provider.refresh()
      return
    }
    showToast({
      variant: "error",
      title: message.action === "connect" ? "Provider connect failed" : "Provider disconnect failed",
      description: message.message ?? message.providerID,
    })
  })
  onCleanup(unsubscribe)

  const resetProviderForm = () => {
    setEditingProviderID(null)
    setProviderIDInput("")
    setProviderNameInput("")
    setProviderApiKeyInput("")
    setProviderBaseUrlInput("")
    setProviderModelsJsonInput("")
  }

  const formatModelsJson = (models: Record<string, unknown> | undefined) => {
    if (!models || Object.keys(models).length === 0) {
      return ""
    }
    return JSON.stringify(models, null, 2)
  }

  const editCustomProvider = (id: string, providerConfig: ProviderConfig) => {
    setEditingProviderID(id)
    setProviderIDInput(id)
    setProviderNameInput(providerConfig.name ?? "")
    setProviderApiKeyInput(providerConfig.api_key ?? "")
    setProviderBaseUrlInput(providerConfig.base_url ?? "")
    setProviderModelsJsonInput(formatModelsJson(providerConfig.models))
  }

  const parseModelsJson = (): Record<string, unknown> | undefined | null => {
    const raw = providerModelsJsonInput().trim()
    if (!raw) {
      return undefined
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Models JSON must be an object")
      }
      return parsed as Record<string, unknown>
    } catch (error) {
      showToast({
        variant: "error",
        title: "Invalid models JSON",
        description: error instanceof Error ? error.message : "Expected a JSON object.",
      })
      return null
    }
  }

  const upsertCustomProvider = () => {
    const id = providerIDInput().trim()
    if (!id) {
      showToast({ variant: "error", title: "Provider ID is required" })
      return
    }

    const models = parseModelsJson()
    if (models === null) {
      return
    }

    const nextProviders = { ...(config().provider ?? {}) }
    const previousID = editingProviderID()
    if (previousID && previousID !== id) {
      delete nextProviders[previousID]
    }

    nextProviders[id] = {
      name: providerNameInput().trim() || undefined,
      api_key: providerApiKeyInput().trim() || undefined,
      base_url: providerBaseUrlInput().trim() || undefined,
      models,
    }

    updateConfig({ provider: nextProviders })
    showToast({ variant: "success", title: previousID ? "Provider updated" : "Provider added", description: id })
    resetProviderForm()
  }

  const removeCustomProvider = (id: string) => {
    const nextProviders = { ...(config().provider ?? {}) }
    delete nextProviders[id]
    updateConfig({ provider: Object.keys(nextProviders).length > 0 ? nextProviders : undefined })
    if (editingProviderID() === id) {
      resetProviderForm()
    }
    showToast({ variant: "success", title: "Provider removed", description: id })
  }

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
        return {
          id: entry.id,
          name: entry.name,
          connected: connected.has(entry.id),
          modelCount,
          defaultModelName,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
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

  return (
    <div>
      {/* Provider catalog */}
      <Card>
        <div
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
          <Button variant="ghost" size="small" onClick={() => provider.refresh()}>
            {language.t("common.refresh")}
          </Button>
        </div>

        <For each={providerCatalog()}>
          {(item, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                gap: "12px",
                padding: "8px 0",
                "border-bottom": index() < providerCatalog().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ flex: 1, "min-width": 0 }}>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <span style={{ "font-weight": "500" }}>{item.name}</span>
                  <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>{item.id}</span>
                </div>
                <div
                  style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}
                >
                  {item.modelCount} models
                  {item.defaultModelName ? ` · default: ${item.defaultModelName}` : ""}
                </div>
              </div>

              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
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
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => (item.connected ? disconnectProvider(item.id) : connectProvider(item.id))}
                >
                  {item.connected ? "Disconnect" : "Connect"}
                </Button>
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
        <SettingsRow label="Default Model" description="Primary model for conversations">
          <ModelSelectorBase
            value={parseModelConfig(config().model)}
            onSelect={handleModelSelect("model")}
            placement="bottom-start"
            allowClear
            clearLabel="Not set (use server default)"
          />
        </SettingsRow>
        <SettingsRow
          label="Small Model"
          description="Lightweight model for title generation and other quick tasks"
          last
        >
          <ModelSelectorBase
            value={parseModelConfig(config().small_model)}
            onSelect={handleModelSelect("small_model")}
            placement="bottom-start"
            allowClear
            clearLabel="Not set (use server default)"
          />
        </SettingsRow>
      </Card>

      {/* Custom provider config */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Custom Provider Configuration</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          Add or edit OpenAI-compatible provider entries in global config (`config.provider`).
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "8px 0" }}>
          <TextField value={providerIDInput()} placeholder="Provider ID (required)" onChange={(value) => setProviderIDInput(value)} />
          <TextField value={providerNameInput()} placeholder="Display name (optional)" onChange={(value) => setProviderNameInput(value)} />
          <TextField
            value={providerApiKeyInput()}
            placeholder="API key (optional)"
            onChange={(value) => setProviderApiKeyInput(value)}
          />
          <TextField
            value={providerBaseUrlInput()}
            placeholder="Base URL (optional)"
            onChange={(value) => setProviderBaseUrlInput(value)}
          />
          <TextField
            value={providerModelsJsonInput()}
            placeholder='Models JSON (optional, object)'
            multiline
            onChange={(value) => setProviderModelsJsonInput(value)}
          />
        </div>

        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "padding-bottom": "8px" }}>
          {editingProviderID() ? (
            <Button size="small" variant="ghost" onClick={resetProviderForm}>
              Cancel
            </Button>
          ) : null}
          <Button size="small" onClick={upsertCustomProvider} disabled={!providerIDInput().trim()}>
            {editingProviderID() ? "Update Provider" : "Add Provider"}
          </Button>
        </div>

        <For each={customProviders()}>
          {([id, providerConfig], index) => (
            <div
              style={{
                display: "flex",
                "align-items": "flex-start",
                "justify-content": "space-between",
                padding: "8px 0",
                "border-top": "1px solid var(--border-weak-base)",
                "border-bottom": index() < customProviders().length - 1 ? "1px solid transparent" : "none",
                gap: "8px",
              }}
            >
              <div style={{ flex: 1, "min-width": 0 }}>
                <div style={{ "font-weight": "500" }}>{id}</div>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    "margin-top": "2px",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "word-break": "break-word",
                  }}
                >
                  {providerConfig.name ? `name: ${providerConfig.name}` : ""}
                  {providerConfig.base_url ? `${providerConfig.name ? " · " : ""}base: ${providerConfig.base_url}` : ""}
                  {providerConfig.api_key ? " · api_key: *****" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <Button size="small" variant="ghost" onClick={() => editCustomProvider(id, providerConfig)}>
                  Edit
                </Button>
                <Tooltip value={language.t("common.delete")} placement="top">
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeCustomProvider(id)}
                    aria-label={language.t("common.delete")}
                  />
                </Tooltip>
              </div>
            </div>
          )}
        </For>
      </Card>

      {/* Disabled providers */}
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Disabled Providers</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          Providers to hide from the provider list
        </div>
        <div
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
              options={providerOptions().filter((o) => !disabledProviders().includes(o.value))}
              current={newDisabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewDisabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder="Select provider…"
            />
          </div>
          <Button
            size="small"
            onClick={() => {
              if (newDisabled()) {
                addToList("disabled_providers", newDisabled()!.value)
                setNewDisabled(undefined)
              }
            }}
          >
            Add
          </Button>
        </div>
        <For each={disabledProviders()}>
          {(id, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom":
                  index() < disabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span style={{ "font-size": "12px" }}>{id}</span>
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
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Enabled Providers (Allowlist)</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          If set, only these providers will be available (exclusive allowlist)
        </div>
        <div
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
              options={providerOptions().filter((o) => !enabledProviders().includes(o.value))}
              current={newEnabled()}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(o) => setNewEnabled(o)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
              placeholder="Select provider…"
            />
          </div>
          <Button
            size="small"
            onClick={() => {
              if (newEnabled()) {
                addToList("enabled_providers", newEnabled()!.value)
                setNewEnabled(undefined)
              }
            }}
          >
            Add
          </Button>
        </div>
        <For each={enabledProviders()}>
          {(id, index) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "6px 0",
                "border-bottom": index() < enabledProviders().length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <span style={{ "font-size": "12px" }}>{id}</span>
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
