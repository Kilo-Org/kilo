import { Component, For, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ProviderConfig } from "../../../types/messages"
import { useLanguage } from "../../../context/language"
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
  const language = useLanguage()
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
      showToast({
        variant: "error",
        title: language.t("settings.providers.custom.toast.invalid"),
        description: parsed.error,
      })
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
      title: previousID
        ? language.t("settings.providers.custom.toast.updated")
        : language.t("settings.providers.custom.toast.added"),
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

    showToast({ variant: "success", title: language.t("settings.providers.custom.toast.removed"), description: id })
  }

  const summarizeProvider = (provider: ProviderConfig): string => {
    const baseURL = provider.options?.baseURL ?? provider.base_url
    const apiKey = provider.options?.apiKey ?? provider.api_key
    const parts: string[] = []

    if (provider.name) {
      parts.push(`${language.t("settings.providers.custom.summary.name")}: ${provider.name}`)
    }
    if (provider.api) {
      parts.push(`${language.t("settings.providers.custom.summary.api")}: ${provider.api}`)
    }
    if (baseURL) {
      parts.push(`${language.t("settings.providers.custom.summary.base")}: ${baseURL}`)
    }
    if (apiKey) {
      parts.push(`${language.t("settings.providers.custom.summary.apiKey")}: *****`)
    }
    if ((provider.whitelist?.length ?? 0) > 0) {
      parts.push(`${language.t("settings.providers.custom.summary.allow")}: ${provider.whitelist!.length}`)
    }
    if ((provider.blacklist?.length ?? 0) > 0) {
      parts.push(`${language.t("settings.providers.custom.summary.deny")}: ${provider.blacklist!.length}`)
    }

    return parts.join(" · ")
  }

  return (
    <>
      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>{language.t("settings.providers.custom.title")}</h4>
      <Card>
        <div
          style={{
            "font-size": "11px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "padding-bottom": "8px",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          {language.t("settings.providers.custom.description")}
        </div>

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px", padding: "8px 0" }}>
          <TextField
            value={draft().id}
            placeholder={language.t("settings.providers.custom.field.id")}
            onChange={(value) => updateDraft("id", value)}
          />
          <TextField
            value={draft().name}
            placeholder={language.t("settings.providers.custom.field.name")}
            onChange={(value) => updateDraft("name", value)}
          />
          <TextField
            value={draft().api}
            placeholder={language.t("settings.providers.custom.field.api")}
            onChange={(value) => updateDraft("api", value)}
          />
          <TextField
            value={draft().npm}
            placeholder={language.t("settings.providers.custom.field.npm")}
            onChange={(value) => updateDraft("npm", value)}
          />
          <TextField
            value={draft().apiKey}
            placeholder={language.t("settings.providers.custom.field.apiKey")}
            onChange={(value) => updateDraft("apiKey", value)}
          />
          <TextField
            value={draft().baseURL}
            placeholder={language.t("settings.providers.custom.field.baseUrl")}
            onChange={(value) => updateDraft("baseURL", value)}
          />
          <TextField
            value={draft().enterpriseUrl}
            placeholder={language.t("settings.providers.custom.field.enterpriseUrl")}
            onChange={(value) => updateDraft("enterpriseUrl", value)}
          />
          <TextField
            value={draft().timeout}
            placeholder={language.t("settings.providers.custom.field.timeout")}
            onChange={(value) => updateDraft("timeout", value)}
          />
          <TextField
            value={draft().setCacheKey}
            placeholder={language.t("settings.providers.custom.field.setCacheKey")}
            onChange={(value) => updateDraft("setCacheKey", value)}
          />
          <TextField
            value={draft().env}
            placeholder={language.t("settings.providers.custom.field.env")}
            multiline
            onChange={(value) => updateDraft("env", value)}
          />
          <TextField
            value={draft().whitelist}
            placeholder={language.t("settings.providers.custom.field.allow")}
            multiline
            onChange={(value) => updateDraft("whitelist", value)}
          />
          <TextField
            value={draft().blacklist}
            placeholder={language.t("settings.providers.custom.field.deny")}
            multiline
            onChange={(value) => updateDraft("blacklist", value)}
          />
          <TextField
            value={draft().modelsJson}
            placeholder={language.t("settings.providers.custom.field.modelsJson")}
            multiline
            onChange={(value) => updateDraft("modelsJson", value)}
          />
          <TextField
            value={draft().optionsJson}
            placeholder={language.t("settings.providers.custom.field.optionsJson")}
            multiline
            onChange={(value) => updateDraft("optionsJson", value)}
          />
        </div>

        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "padding-bottom": "8px" }}>
          {editingProviderID() ? (
            <Tooltip value={language.t("settings.providers.custom.action.cancelTooltip")} placement="top">
              <Button size="small" variant="ghost" onClick={resetDraft}>
                {language.t("common.cancel")}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip
            value={
              editingProviderID()
                ? language.t("settings.providers.custom.action.saveTooltip")
                : language.t("settings.providers.custom.action.addTooltip")
            }
            placement="top">
            <Button size="small" onClick={upsertProvider} disabled={!draft().id.trim()}>
              {editingProviderID()
                ? language.t("settings.providers.custom.action.update")
                : language.t("settings.providers.custom.action.add")}
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
                <Tooltip value={language.t("settings.providers.custom.action.editTooltip")} placement="top">
                  <Button size="small" variant="ghost" onClick={() => editProvider(id, providerConfig)}>
                    {language.t("common.edit")}
                  </Button>
                </Tooltip>
                <Tooltip value={language.t("common.delete")} placement="top">
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    onClick={() => removeProvider(id)}
                    aria-label={language.t("common.delete")}
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
