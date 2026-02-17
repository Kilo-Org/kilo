import { Component } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import SettingsRow from "./SettingsRow"

const CheckpointsTab: Component = () => {
  const { config, updateConfig } = useConfig()

  return (
    <div>
      <Card>
        <SettingsRow
          title="Enable Snapshots"
          description="Create checkpoints before file edits so you can restore previous states"
          last
        >
          <Switch
            checked={config().snapshot !== false}
            onChange={(checked) => updateConfig({ snapshot: checked })}
            hideLabel
          >
            Enable Snapshots
          </Switch>
        </SettingsRow>
      </Card>
    </div>
  )
}

export default CheckpointsTab
