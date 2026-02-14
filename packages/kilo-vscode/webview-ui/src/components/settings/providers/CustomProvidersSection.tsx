import { Component, For, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ProviderConfig } from "../../../types/messages"
import {
  createEmptyCustomProviderDraft,
  draftToProviderConfig,
  providerConfigToDraft,
  type CustomProviderDraft,
} from "./custom-provider-utils"

interface CustomProvidersSectionProps {
  providers: Record<string, ProviderConfig> | undefined
  onChange: (next: Record<string, ProviderConfig> | undefined) => void
}

const CustomProvidersSection: Component<CustomProvidersSectionProps> = (props) => {
  const [editingProviderID, setEditingProviderID] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal<CustomProviderDraft>(createEmptyCustomProviderDraft())

  const customProviders = createMemo(() => Object.entries(props.providers ?? {}).sort(([a], [b]) => a.localeCompare(b)))

  const updateDraft = (key: keyof CustomProviderDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const resetDraft = () => {
    setEditingProviderID(null)
    setDraft(createEmptyCustomProviderDraft())
  }

  const upsertProvider = () => {
    const parsed = draftToProviderConfig(draft())
    if (!parsed.ok) {
      showToast({ variant: "error", title: "Invalid provider configuration", description: parsed.error })
      return
    }

    const nextProviders = { ...(props.providers ?? {}) }
    const previousID = editingProviderID()
    if (previousID && previousID !== parsed.id) {
      delete nextProviders[previousID]
    }
    nextProviders[parsed.id] = parsed.config

    props.onChange(Object.keys(nextProviders).length > 0 ? nextProviders : undefined)
    showToast({
      variant: "success",
      title: previousID ? "Provider updated" : "Provider added",
      description: parsed.id,
    })
    resetDraft()
  }

  const editProvider = (id: string, providerConfig: ProviderConfig) => {
    setEditingProviderID(id)
    setDraft(providerConfigToDraft(id, providerConfig))
  }

  const removeProvider = (id: string) => {
    const nextProviders = { ...(props.providers ?? {}) }
    delete nextProviders[id]
    props.onChange(Object.keys(nextProviders).length > 0 ? nextProviders : undefined)

    if (editingProviderID() === id) {
      resetDraft()
    }

    showToast({ variant: "success", title: "Provider removed", description: id })
  }

  const summarizeProvider = (provider: ProviderConfig): string => {
    const baseURL = provider.options?.baseURL ?? provider.base_url
    const apiKey = provider.options?.apiKey ?? provider.api_key
    const parts: string[] = []

    if (provider.name) {
      parts.push(`name: ${provider.name}`)
    }
    if (provider.api) {
      parts.push(`api: ${provider.api}`)
    }
    if (baseURL) {
      parts.push(`base: ${baseURL}`)
    }
    if (apiKey) {
      parts.push("api_key: *****")
    }
    if ((provider.whitelist?.length ?? 0) > 0) {
      parts.push(`allow: ${provider.whitelist!.length}`)
    }
    if ((provider.blacklist?.length ?? 0) > 0) {
      parts.push(`deny: ${provider.blacklist!.length}`)
    }

    return parts.join(" · ")
  }

  return (
    <>
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
          Configure custom providers in `config.provider`. Supports provider metadata, runtime options, allow/deny
          lists, and per-model overrides JSON.
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "8px 0" }}>
          <TextField
            value={draft().id}
            placeholder="Provider ID (required)"
            onChange={(value) => updateDraft("id", value)}
          />
          <TextField
            value={draft().name}
            placeholder="Display name (optional)"
            onChange={(value) => updateDraft("name", value)}
          />
          <TextField
            value={draft().api}
            placeholder='Adapter API name (optional, e.g. "openai")'
            onChange={(value) => updateDraft("api", value)}
          />
          <TextField
            value={draft().npm}
            placeholder='NPM package (optional, e.g. "@ai-sdk/openai-compatible")'
            onChange={(value) => updateDraft("npm", value)}
          />
          <TextField
            value={draft().apiKey}
            placeholder="API key (optional)"
            onChange={(value) => updateDraft("apiKey", value)}
          />
          <TextField
            value={draft().baseURL}
            placeholder="Base URL (optional)"
            onChange={(value) => updateDraft("baseURL", value)}
          />
          <TextField
            value={draft().enterpriseUrl}
            placeholder="Enterprise URL (optional)"
            onChange={(value) => updateDraft("enterpriseUrl", value)}
          />
          <TextField
            value={draft().timeout}
            placeholder="Request timeout in ms (optional)"
            onChange={(value) => updateDraft("timeout", value)}
          />
          <TextField
            value={draft().setCacheKey}
            placeholder='setCacheKey (optional: "true" or "false")'
            onChange={(value) => updateDraft("setCacheKey", value)}
          />
          <TextField
            value={draft().env}
            placeholder="Environment vars list (optional, one per line or comma-separated)"
            multiline
            onChange={(value) => updateDraft("env", value)}
          />
          <TextField
            value={draft().whitelist}
            placeholder="Model allowlist (optional, one per line or comma-separated)"
            multiline
            onChange={(value) => updateDraft("whitelist", value)}
          />
          <TextField
            value={draft().blacklist}
            placeholder="Model denylist (optional, one per line or comma-separated)"
            multiline
            onChange={(value) => updateDraft("blacklist", value)}
          />
          <TextField
            value={draft().modelsJson}
            placeholder="Models JSON (optional object)"
            multiline
            onChange={(value) => updateDraft("modelsJson", value)}
          />
          <TextField
            value={draft().optionsJson}
            placeholder="Extra options JSON (optional object)"
            multiline
            onChange={(value) => updateDraft("optionsJson", value)}
          />
        </div>

        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "padding-bottom": "8px" }}>
          {editingProviderID() ? (
            <Tooltip value="Cancel provider editing" placement="top">
              <Button size="small" variant="ghost" onClick={resetDraft}>
                Cancel
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip value={editingProviderID() ? "Save provider changes" : "Add custom provider"} placement="top">
            <Button size="small" onClick={upsertProvider} disabled={!draft().id.trim()}>
              {editingProviderID() ? "Update Provider" : "Add Provider"}
            </Button>
          </Tooltip>
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
                  {summarizeProvider(providerConfig)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <Tooltip value="Edit provider" placement="top">
                  <Button size="small" variant="ghost" onClick={() => editProvider(id, providerConfig)}>
                    Edit
                  </Button>
                </Tooltip>
                <Tooltip value="Delete" placement="top">
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeProvider(id)}
                    aria-label="Delete"
                  />
                </Tooltip>
              </div>
            </div>
          )}
        </For>
      </Card>
    </>
  )
}

export default CustomProvidersSection
