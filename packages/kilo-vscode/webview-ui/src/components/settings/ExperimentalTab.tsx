import { Component, For, Show, createMemo } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import SettingsRow from "./SettingsRow"

interface ShareOption {
  value: string
  label: string
}

const SHARE_OPTIONS: ShareOption[] = [
  { value: "manual", label: "Manual" },
  { value: "auto", label: "Auto" },
  { value: "disabled", label: "Disabled" },
]

const ExperimentalTab: Component = () => {
  const { config, updateConfig } = useConfig()

  const experimental = createMemo(() => config().experimental ?? {})

  const updateExperimental = (key: string, value: unknown) => {
    updateConfig({
      experimental: { ...experimental(), [key]: value },
    })
  }

  return (
    <div>
      <Card>
        {/* Share mode */}
        <SettingsRow title="Share Mode" description="How session sharing behaves">
          <Select
            options={SHARE_OPTIONS}
            current={SHARE_OPTIONS.find((o) => o.value === (config().share ?? "manual"))}
            value={(o) => o.value}
            label={(o) => o.label}
            onSelect={(o) => o && updateConfig({ share: o.value as "manual" | "auto" | "disabled" })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>

        <SettingsRow title="Formatter" description="Enable the automatic code formatter">
          <Switch
            checked={config().formatter !== false}
            onChange={(checked) => updateConfig({ formatter: checked ? {} : false })}
            hideLabel
          >
            Formatter
          </Switch>
        </SettingsRow>

        <SettingsRow title="LSP" description="Enable language server protocol integration">
          <Switch
            checked={config().lsp !== false}
            onChange={(checked) => updateConfig({ lsp: checked ? {} : false })}
            hideLabel
          >
            LSP
          </Switch>
        </SettingsRow>

        <SettingsRow title="Disable Paste Summary" description="Don't summarize large pasted content">
          <Switch
            checked={experimental().disable_paste_summary ?? false}
            onChange={(checked) => updateExperimental("disable_paste_summary", checked)}
            hideLabel
          >
            Disable Paste Summary
          </Switch>
        </SettingsRow>

        <SettingsRow title="Batch Tool" description="Enable batching of multiple tool calls">
          <Switch
            checked={experimental().batch_tool ?? false}
            onChange={(checked) => updateExperimental("batch_tool", checked)}
            hideLabel
          >
            Batch Tool
          </Switch>
        </SettingsRow>

        <SettingsRow title="Continue on Deny" description="Continue the agent loop when a permission is denied">
          <Switch
            checked={experimental().continue_loop_on_deny ?? false}
            onChange={(checked) => updateExperimental("continue_loop_on_deny", checked)}
            hideLabel
          >
            Continue on Deny
          </Switch>
        </SettingsRow>

        {/* MCP timeout */}
        <SettingsRow title="MCP Timeout (ms)" description="Timeout for MCP server requests in milliseconds" last>
          <TextField
            value={String(experimental().mcp_timeout ?? 60000)}
            onChange={(val) => {
              const num = parseInt(val, 10)
              if (!isNaN(num) && num > 0) {
                updateExperimental("mcp_timeout", num)
              }
            }}
          />
        </SettingsRow>
      </Card>

      {/* Tool toggles */}
      <Show when={config().tools && Object.keys(config().tools ?? {}).length > 0}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>Tool Toggles</h4>
        <Card>
          <For each={Object.entries(config().tools ?? {})}>
            {([name, enabled], index) => (
              <SettingsRow title={name} description="" last={index() >= Object.keys(config().tools ?? {}).length - 1}>
                <Switch
                  checked={enabled}
                  onChange={(checked) => updateConfig({ tools: { ...config().tools, [name]: checked } })}
                  hideLabel
                >
                  {name}
                </Switch>
              </SettingsRow>
            )}
          </For>
        </Card>
      </Show>
    </div>
  )
}

export default ExperimentalTab
