import { Component, createSignal, onCleanup } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

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
    <div data-component="autocomplete-settings" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
      <Switch
        checked={enableAutoTrigger()}
        onChange={(checked) => updateSetting("enableAutoTrigger", checked)}
        description="Automatically show inline completion suggestions as you type"
      >
        Enable automatic inline completions
      </Switch>

      <Switch
        checked={enableSmartInlineTaskKeybinding()}
        onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
        description="Use a smart keybinding for triggering inline tasks"
      >
        Enable smart inline task keybinding
      </Switch>

      <Switch
        checked={enableChatAutocomplete()}
        onChange={(checked) => updateSetting("enableChatAutocomplete", checked)}
        description="Show autocomplete suggestions in the chat textarea"
      >
        Enable chat textarea autocomplete
      </Switch>
    </div>
  )
}

export default AutocompleteTab
