import { Component, createEffect, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"

interface SlashCommandsUiState {
  enabled: boolean
  prefix: string
}

const STORAGE_KEY = "kilo.settings.slashCommands.ui.v1"
const DEFAULT_STATE: SlashCommandsUiState = {
  enabled: true,
  prefix: "/",
}

function loadInitialState(): SlashCommandsUiState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    const parsed = JSON.parse(raw) as Partial<SlashCommandsUiState>
    return {
      ...DEFAULT_STATE,
      ...parsed,
    }
  } catch {
    return DEFAULT_STATE
  }
}

const SlashCommandsTab: Component = () => {
  const initial = loadInitialState()
  const [enabled, setEnabled] = createSignal(initial.enabled)
  const [prefix, setPrefix] = createSignal(initial.prefix)

  // TODO(backend): Replace local UI state with real slash-command settings APIs.
  createEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          enabled: enabled(),
          prefix: prefix(),
        }),
      )
    } catch {
      // Ignore localStorage write errors.
    }
  })

  return (
    <Card>
      <div style={{ display: "grid", gap: "12px" }}>
        <Switch
          checked={enabled()}
          onChange={setEnabled}
          description="Show slash-command suggestions when typing commands in chat."
        >
          Enable slash command menu
        </Switch>
        <div class="settings-inline-control">
          <TextField
            value={prefix()}
            placeholder="/"
            onChange={(value) => setPrefix(value || "/")}
            label="Command prefix"
          />
        </div>
        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
          TODO: Connect slash command settings to backend persistence.
        </div>
      </div>
    </Card>
  )
}

export default SlashCommandsTab

