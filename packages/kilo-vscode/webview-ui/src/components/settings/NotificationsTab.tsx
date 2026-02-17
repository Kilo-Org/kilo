import { Component, createSignal, onCleanup } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface SoundOption {
  value: string
  label: string
}

const SOUND_OPTIONS: SoundOption[] = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
]

const NotificationsTab: Component = () => {
  const vscode = useVSCode()

  const [agentNotify, setAgentNotify] = createSignal(true)
  const [permNotify, setPermNotify] = createSignal(true)
  const [errorNotify, setErrorNotify] = createSignal(true)
  const [agentSound, setAgentSound] = createSignal("default")
  const [permSound, setPermSound] = createSignal("default")
  const [errorSound, setErrorSound] = createSignal("default")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "notificationSettingsLoaded") {
      return
    }
    const s = message.settings
    setAgentNotify(s.notifyAgent)
    setPermNotify(s.notifyPermissions)
    setErrorNotify(s.notifyErrors)
    setAgentSound(s.soundAgent)
    setPermSound(s.soundPermissions)
    setErrorSound(s.soundErrors)
  })

  onCleanup(unsubscribe)
  vscode.postMessage({ type: "requestNotificationSettings" })

  const save = (key: string, value: unknown) => {
    vscode.postMessage({ type: "updateSetting", key, value })
  }

  return (
    <div>
      <Card>
        <SettingsRow title="Agent Completion" description="Show notification when agent completes a task">
          <Switch
            checked={agentNotify()}
            onChange={(checked) => {
              setAgentNotify(checked)
              save("notifications.agent", checked)
            }}
            hideLabel
          >
            Agent Completion
          </Switch>
        </SettingsRow>
        <SettingsRow title="Permission Requests" description="Show notification on permission requests">
          <Switch
            checked={permNotify()}
            onChange={(checked) => {
              setPermNotify(checked)
              save("notifications.permissions", checked)
            }}
            hideLabel
          >
            Permission Requests
          </Switch>
        </SettingsRow>
        <SettingsRow title="Errors" description="Show notification on errors" last>
          <Switch
            checked={errorNotify()}
            onChange={(checked) => {
              setErrorNotify(checked)
              save("notifications.errors", checked)
            }}
            hideLabel
          >
            Errors
          </Switch>
        </SettingsRow>
      </Card>

      <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Sounds</h4>
      <Card>
        <SettingsRow title="Agent Completion Sound" description="Sound to play when agent completes">
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === agentSound())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => {
              if (o) {
                setAgentSound(o.value)
                save("sounds.agent", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow title="Permission Request Sound" description="Sound to play on permission requests">
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === permSound())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => {
              if (o) {
                setPermSound(o.value)
                save("sounds.permissions", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <SettingsRow title="Error Sound" description="Sound to play on errors" last>
          <Select
            options={SOUND_OPTIONS}
            current={SOUND_OPTIONS.find((o) => o.value === errorSound())}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => {
              if (o) {
                setErrorSound(o.value)
                save("sounds.errors", o.value)
              }
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>
    </div>
  )
}

export default NotificationsTab
