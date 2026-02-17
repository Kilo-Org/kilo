import { Component } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import SettingsRow from "./SettingsRow"

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
        <SettingsRow title="Username" description="Custom username displayed in conversations">
          <div style={{ width: "160px" }}>
            <TextField
              value={config().username ?? ""}
              placeholder="User"
              onChange={(val) => updateConfig({ username: val.trim() || undefined })}
            />
          </div>
        </SettingsRow>

        <SettingsRow title="Layout" description="Layout mode for the chat interface" last>
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
        </SettingsRow>
      </Card>
    </div>
  )
}

export default DisplayTab
