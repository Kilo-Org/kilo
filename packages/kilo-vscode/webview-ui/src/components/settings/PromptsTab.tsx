import { Component, createEffect, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useConfig } from "../../context/config"

const PromptsTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const [draft, setDraft] = createSignal("")

  const serialized = createMemo(() => (config().instructions ?? []).join("\n"))
  const hasChanges = createMemo(() => draft().trim() !== serialized().trim())
  const instructionCount = createMemo(
    () =>
      draft()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0).length,
  )

  createEffect(() => {
    setDraft(serialized())
  })

  const save = () => {
    const next = draft()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    updateConfig({ instructions: next })
    showToast({ variant: "success", title: "Prompts updated" })
  }

  const reset = () => setDraft(serialized())

  return (
    <div>
      <Card>
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "12px" }}>
          <div>
            <div style={{ "font-weight": "600" }}>Global Instructions</div>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "margin-top": "2px" }}>
              One instruction per line. These are appended to agent context for all sessions.
            </div>
          </div>
          <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
            {instructionCount()} active
          </div>
        </div>

        <textarea
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          rows={8}
          style={{
            width: "100%",
            "margin-top": "10px",
            padding: "8px 10px",
            "font-family": "var(--vscode-editor-font-family, monospace)",
            "font-size": "12px",
            "line-height": "1.4",
            color: "var(--vscode-input-foreground)",
            background: "var(--vscode-input-background)",
            border: "1px solid var(--vscode-input-border)",
            "border-radius": "6px",
            resize: "vertical",
            "min-height": "120px",
          }}
          placeholder="Prefer minimal diffs&#10;Run tests after code edits&#10;Use existing project conventions"
        />

        <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "10px" }}>
          <Tooltip value="Discard unsaved prompt changes" placement="top">
            <Button size="small" variant="ghost" disabled={!hasChanges()} onClick={reset}>
              Reset
            </Button>
          </Tooltip>
          <Tooltip value="Save global instructions to settings" placement="top">
            <Button size="small" variant="primary" disabled={!hasChanges()} onClick={save}>
              Save
            </Button>
          </Tooltip>
        </div>
      </Card>
    </div>
  )
}

export default PromptsTab
