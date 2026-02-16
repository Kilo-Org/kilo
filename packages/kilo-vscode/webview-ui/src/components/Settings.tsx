import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon, type IconProps } from "@kilocode/kilo-ui/icon"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../context/language"
import ProvidersTab from "./settings/ProvidersTab"
import AgentBehaviourTab from "./settings/AgentBehaviourTab"
import AutoApproveTab from "./settings/AutoApproveTab"
import SlashCommandsTab from "./settings/SlashCommandsTab"
import BrowserTab from "./settings/BrowserTab"
import CheckpointsTab from "./settings/CheckpointsTab"
import DisplayTab from "./settings/DisplayTab"
import UITab from "./settings/UITab"
import AutocompleteTab from "./settings/AutocompleteTab"
import NotificationsTab from "./settings/NotificationsTab"
import ContextTab from "./settings/ContextTab"
import TerminalTab from "./settings/TerminalTab"
import PromptsTab from "./settings/PromptsTab"
import ExperimentalTab from "./settings/ExperimentalTab"
import LanguageTab from "./settings/LanguageTab"
import AboutKiloCodeTab from "./settings/AboutKiloCodeTab"
import { useServer } from "../context/server"
import { useVSCode } from "../context/vscode"

export interface SettingsProps {
  onBack?: () => void
}

type SettingsTabId =
  | "providers"
  | "autoApprove"
  | "slashCommands"
  | "browser"
  | "checkpoints"
  | "autocomplete"
  | "display"
  | "notifications"
  | "context"
  | "terminal"
  | "agentBehaviour"
  | "prompts"
  | "ui"
  | "experimental"
  | "language"
  | "aboutKiloCode"

type SettingsTabMeta = {
  value: SettingsTabId
  labelKey: string
  icon: IconProps["name"]
  section: "server" | "desktop"
}

const SETTINGS_TABS: SettingsTabMeta[] = [
  { value: "providers", labelKey: "settings.providers.title", icon: "providers", section: "server" },
  { value: "autoApprove", labelKey: "settings.autoApprove.title", icon: "checklist", section: "server" },
  { value: "slashCommands", labelKey: "settings.slashCommands.title", icon: "comment", section: "server" },
  { value: "browser", labelKey: "settings.browser.title", icon: "window-cursor", section: "server" },
  { value: "checkpoints", labelKey: "settings.checkpoints.title", icon: "branch", section: "server" },
  { value: "autocomplete", labelKey: "settings.autocomplete.title", icon: "code-lines", section: "desktop" },
  { value: "display", labelKey: "settings.display.title", icon: "eye", section: "desktop" },
  { value: "notifications", labelKey: "settings.notifications.title", icon: "circle-check", section: "desktop" },
  { value: "context", labelKey: "settings.context.title", icon: "server", section: "server" },
  { value: "terminal", labelKey: "settings.terminal.title", icon: "console", section: "server" },
  { value: "agentBehaviour", labelKey: "settings.agentBehaviour.title", icon: "brain", section: "server" },
  { value: "prompts", labelKey: "settings.prompts.title", icon: "comment", section: "server" },
  { value: "ui", labelKey: "settings.ui.title", icon: "menu", section: "desktop" },
  { value: "experimental", labelKey: "settings.experimental.title", icon: "settings-gear", section: "server" },
  { value: "language", labelKey: "settings.language.title", icon: "speech-bubble", section: "desktop" },
  { value: "aboutKiloCode", labelKey: "settings.aboutKiloCode.title", icon: "help", section: "desktop" },
]

const Settings: Component<SettingsProps> = (props) => {
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const [activeTab, setActiveTab] = createSignal<SettingsTabId>("providers")
  const [search, setSearch] = createSignal("")
  const [isCompactMode, setIsCompactMode] = createSignal(false)
  let tabsShellRef: HTMLDivElement | undefined

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "settingsUiStateLoaded" && typeof message.activeTab === "string") {
      const tab = SETTINGS_TABS.find((item) => item.value === message.activeTab)?.value
      if (tab) {
        setActiveTab(tab)
      }
    }
  })
  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestSettingsUiState" })

  onMount(() => {
    const shell = tabsShellRef
    if (!shell) {
      return
    }

    const updateCompactMode = (width: number) => {
      setIsCompactMode(width < 760)
    }

    updateCompactMode(shell.clientWidth)

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateCompactMode(entry.contentRect.width)
      }
    })
    observer.observe(shell)
    onCleanup(() => observer.disconnect())
  })

  const handleTabChange = (nextTab: string) => {
    const normalized = SETTINGS_TABS.find((tab) => tab.value === nextTab)?.value
    if (!normalized) {
      return
    }
    setActiveTab(normalized)
    vscode.postMessage({ type: "settingsTabChanged", tab: normalized })
  }

  const handleSave = () => {
    showToast({
      variant: "default",
      title: language.t("settings.status.autoSaved"),
    })
  }

  const filteredTabs = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) {
      return SETTINGS_TABS
    }
    return SETTINGS_TABS.filter((tab) => language.t(tab.labelKey).toLowerCase().includes(query))
  })

  const orderedTabs = createMemo(() => filteredTabs())

  createEffect(() => {
    const active = activeTab()
    if (filteredTabs().some((tab) => tab.value === active)) {
      return
    }
    const firstVisible = filteredTabs()[0]
    if (!firstVisible) {
      return
    }
    setActiveTab(firstVisible.value)
    vscode.postMessage({ type: "settingsTabChanged", tab: firstVisible.value })
  })

  return (
    <div class="settings-view">
      {/* Header */}
      <div class="settings-view-header">
        <Tooltip value={language.t("common.goBack")} placement="bottom">
          <Button variant="ghost" size="small" onClick={() => props.onBack?.()}>
            <Icon name="arrow-left" />
          </Button>
        </Tooltip>
        <h2 class="settings-view-title">{language.t("sidebar.settings")}</h2>
        <div class="settings-view-spacer" />
        <Tooltip value={language.t("settings.status.autoSaved")} placement="bottom">
          <Button variant="secondary" size="small" onClick={handleSave} title={language.t("common.save")} disabled>
            {language.t("common.save")}
          </Button>
        </Tooltip>
      </div>

      <div class="settings-view-search">
        <TextField value={search()} placeholder={language.t("settings.search.placeholder")} onChange={setSearch} />
      </div>

      <div ref={tabsShellRef} class="settings-tabs-shell">
        <Tabs
          orientation="vertical"
          variant="settings"
          value={activeTab()}
          onChange={handleTabChange}
          classList={{
            "settings-tabs": true,
            "settings-tabs-compact": isCompactMode(),
          }}
          style={{ flex: 1, overflow: "hidden" }}
        >
          <Tabs.List class="settings-tabs-list">
            <For each={orderedTabs()}>
              {(tab) => (
                <Tabs.Trigger
                  value={tab.value}
                  classList={{
                    "settings-tab-trigger": true,
                    "settings-tab-trigger-compact": isCompactMode(),
                  }}
                  title={isCompactMode() ? language.t(tab.labelKey) : undefined}
                >
                  <Icon name={tab.icon} />
                  <span class="settings-tab-label">{language.t(tab.labelKey)}</span>
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>

          <Tabs.Content value="providers" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.providers.title")}</h3>
            <ProvidersTab />
          </Tabs.Content>
          <Tabs.Content value="agentBehaviour" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.agentBehaviour.title")}</h3>
            <AgentBehaviourTab />
          </Tabs.Content>
          <Tabs.Content value="autoApprove" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.autoApprove.title")}</h3>
            <AutoApproveTab />
          </Tabs.Content>
          <Tabs.Content value="slashCommands" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.slashCommands.title")}</h3>
            <SlashCommandsTab />
          </Tabs.Content>
          <Tabs.Content value="browser" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.browser.title")}</h3>
            <BrowserTab />
          </Tabs.Content>
          <Tabs.Content value="checkpoints" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.checkpoints.title")}</h3>
            <CheckpointsTab />
          </Tabs.Content>
          <Tabs.Content value="display" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.display.title")}</h3>
            <DisplayTab />
          </Tabs.Content>
          <Tabs.Content value="autocomplete" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.autocomplete.title")}</h3>
            <AutocompleteTab />
          </Tabs.Content>
          <Tabs.Content value="notifications" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.notifications.title")}</h3>
            <NotificationsTab />
          </Tabs.Content>
          <Tabs.Content value="context" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.context.title")}</h3>
            <ContextTab />
          </Tabs.Content>
          <Tabs.Content value="terminal" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.terminal.title")}</h3>
            <TerminalTab />
          </Tabs.Content>
          <Tabs.Content value="prompts" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.prompts.title")}</h3>
            <PromptsTab />
          </Tabs.Content>
          <Tabs.Content value="ui" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.ui.title")}</h3>
            <UITab />
          </Tabs.Content>
          <Tabs.Content value="experimental" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.experimental.title")}</h3>
            <ExperimentalTab />
          </Tabs.Content>
          <Tabs.Content value="language" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.language.title")}</h3>
            <LanguageTab />
          </Tabs.Content>
          <Tabs.Content value="aboutKiloCode" class="settings-tab-content">
            <h3 class="settings-tab-title">{language.t("settings.aboutKiloCode.title")}</h3>
            <AboutKiloCodeTab
              port={server.serverInfo()?.port ?? null}
              connectionState={server.connectionState()}
              extensionPolicy={server.extensionPolicy()}
            />
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  )
}

export default Settings
