import { Component, For, createMemo, createSignal, onCleanup } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { ModelSelectorBase } from "../chat/ModelSelector"
import { CustomProvidersSection } from "./providers"
import type { ExtensionMessage, ModelSelection } from "../../types/messages"

interface ProviderOption {
  value: string
  label: string
}

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

  const disabledProviders = () => config().disabled_providers ?? []
  const enabledProviders = () => config().enabled_providers ?? []

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
    return selection ? `Use ${selection.modelID}` : "No gateway default"
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
      title: "Startup model updated",
      description: `${selection.providerID}/${selection.modelID}`,
    })
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
          <Tooltip value={language.t("common.refresh")} placement="top">
            <Button variant="ghost" size="small" onClick={() => provider.refresh()}>
              {language.t("common.refresh")}
            </Button>
          </Tooltip>
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
                <Tooltip value={item.connected ? "Disconnect provider" : "Connect provider"} placement="top">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => (item.connected ? disconnectProvider(item.id) : connectProvider(item.id))}
                  >
                    {item.connected ? "Disconnect" : "Connect"}
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

      {/* Startup model defaults for new sessions */}
      <Card style={{ "margin-top": "16px" }}>
        <SettingsRow
          label="Startup Model (New Sessions)"
          description="Default model preselected when you open a new chat session"
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
          label="Use Kilo Gateway Default"
          description="Pin startup model to the backend default model for Kilo Gateway"
          last
        >
          <Tooltip value="Use the default model exposed by the Kilo Gateway provider" placement="top">
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

      <CustomProvidersSection
        providers={config().provider}
        onChange={(nextProviders) => updateConfig({ provider: nextProviders })}
      />

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
          <Tooltip value="Add selected provider to hidden list" placement="top">
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
          </Tooltip>
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
          <Tooltip value="Add selected provider to allowlist" placement="top">
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
          </Tooltip>
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
