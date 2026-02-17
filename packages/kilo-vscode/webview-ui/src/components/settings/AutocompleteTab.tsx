import { Component, createSignal, onCleanup } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
  })

  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const updateSetting = (
    key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete",
    value: boolean,
  ) => {
    vscode.postMessage({ type: "updateAutocompleteSetting", key, value })
  }

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title="Enable automatic inline completions"
          description="Automatically show inline completion suggestions as you type"
        >
          <Switch
            checked={enableAutoTrigger()}
            onChange={(checked) => updateSetting("enableAutoTrigger", checked)}
            hideLabel
          >
            Enable automatic inline completions
          </Switch>
        </SettingsRow>

        <SettingsRow
          title="Enable smart inline task keybinding"
          description="Use a smart keybinding for triggering inline tasks"
        >
          <Switch
            checked={enableSmartInlineTaskKeybinding()}
            onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
            hideLabel
          >
            Enable smart inline task keybinding
          </Switch>
        </SettingsRow>

        <SettingsRow
          title="Enable chat textarea autocomplete"
          description="Show autocomplete suggestions in the chat textarea"
          last
        >
          <Switch
            checked={enableChatAutocomplete()}
            onChange={(checked) => updateSetting("enableChatAutocomplete", checked)}
            hideLabel
          >
            Enable chat textarea autocomplete
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default AutocompleteTab
