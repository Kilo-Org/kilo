import { Component, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useConfig } from "../../context/config"

const DEFAULT_TERMINAL_KEYBINDS = {
  terminal_suspend: "ctrl+z",
  terminal_title_toggle: "none",
} as const

type TerminalKeybindID = keyof typeof DEFAULT_TERMINAL_KEYBINDS

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

const TerminalTab: Component = () => {
  const { config, updateConfig } = useConfig()

  const keybinds = createMemo(() => config().keybinds ?? {})

  const updateKeybind = (key: TerminalKeybindID, value: string) => {
    const normalized = value.trim()
    updateConfig({
      keybinds: {
        ...keybinds(),
        [key]: normalized || DEFAULT_TERMINAL_KEYBINDS[key],
      },
    })
  }

  const resetDefaults = () => {
    updateConfig({
      keybinds: {
        ...keybinds(),
        ...DEFAULT_TERMINAL_KEYBINDS,
      },
    })
  }

  return (
    <div>
      <Card>
        <div
          style={{
            "font-size": "12px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "line-height": "1.5",
          }}
        >
          Configure CLI terminal keybind overrides used by the opencode runtime.
          <br />
          VS Code keyboard shortcuts are still configured in VS Code keybindings.
        </div>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Terminal Keybinds</h4>

      <Card>
        <SettingsRow label="Suspend Terminal" description="Keybind used by the CLI terminal to suspend the process.">
          <div style={{ width: "180px" }}>
            <TextField
              value={keybinds().terminal_suspend ?? DEFAULT_TERMINAL_KEYBINDS.terminal_suspend}
              placeholder={DEFAULT_TERMINAL_KEYBINDS.terminal_suspend}
              onChange={(value) => updateKeybind("terminal_suspend", value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label="Toggle Terminal Title"
          description="Keybind used by the CLI terminal to toggle the terminal title."
          last
        >
          <div style={{ width: "180px" }}>
            <TextField
              value={keybinds().terminal_title_toggle ?? DEFAULT_TERMINAL_KEYBINDS.terminal_title_toggle}
              placeholder={DEFAULT_TERMINAL_KEYBINDS.terminal_title_toggle}
              onChange={(value) => updateKeybind("terminal_title_toggle", value)}
            />
          </div>
        </SettingsRow>
      </Card>

      <div style={{ "margin-top": "12px", display: "flex", "justify-content": "flex-end" }}>
        <Tooltip value="Restore terminal keybind overrides to defaults" placement="top">
          <Button size="small" variant="secondary" onClick={resetDefaults}>
            Reset terminal keybinds
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

export default TerminalTab
