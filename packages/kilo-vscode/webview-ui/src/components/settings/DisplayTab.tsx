import { Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"

interface LayoutOption {
  value: string
  label: string
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: "auto", label: "Auto" },
  { value: "stretch", label: "Stretch" },
]

const DisplayTab: Component = () => {
  const { config, updateConfig } = useConfig()

  return (
    <div>
      <Card>
        <div
          data-slot="settings-row"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "8px 0",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <div style={{ flex: 1, "min-width": 0, "margin-right": "12px" }}>
            <div style={{ "font-weight": "500" }}>Username</div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              Custom username displayed in conversations
            </div>
          </div>
          <div style={{ width: "160px" }}>
            <TextField
              value={config().username ?? ""}
              placeholder="User"
              onChange={(val) => updateConfig({ username: val.trim() || undefined })}
            />
          </div>
        </div>

        <div
          data-slot="settings-row"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "8px 0",
          }}
        >
          <div style={{ flex: 1, "min-width": 0, "margin-right": "12px" }}>
            <div style={{ "font-weight": "500" }}>Layout</div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              }}
            >
              Layout mode for the chat interface
            </div>
          </div>
          <Select
            options={LAYOUT_OPTIONS}
            current={LAYOUT_OPTIONS.find((o) => o.value === (config().layout ?? "auto"))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && updateConfig({ layout: o.value as "auto" | "stretch" })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
      </Card>
    </div>
  )
}

export default DisplayTab
