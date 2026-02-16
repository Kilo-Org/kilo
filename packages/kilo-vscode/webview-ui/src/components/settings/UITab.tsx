import { Component, createEffect, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"

interface UiTabState {
  showTimestamps: boolean
  sendMessageOnEnter: boolean
  showTaskTimeline: boolean
}

const STORAGE_KEY = "kilo.settings.uiTab.v1"
const DEFAULT_STATE: UiTabState = {
  showTimestamps: false,
  sendMessageOnEnter: true,
  showTaskTimeline: true,
}

function loadInitialState(): UiTabState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    const parsed = JSON.parse(raw) as Partial<UiTabState>
    return {
      ...DEFAULT_STATE,
      ...parsed,
    }
  } catch {
    return DEFAULT_STATE
  }
}

const UITab: Component = () => {
  const initial = loadInitialState()
  const [showTimestamps, setShowTimestamps] = createSignal(initial.showTimestamps)
  const [sendMessageOnEnter, setSendMessageOnEnter] = createSignal(initial.sendMessageOnEnter)
  const [showTaskTimeline, setShowTaskTimeline] = createSignal(initial.showTaskTimeline)

  // TODO(backend): Replace local UI state with persisted extension settings.
  createEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          showTimestamps: showTimestamps(),
          sendMessageOnEnter: sendMessageOnEnter(),
          showTaskTimeline: showTaskTimeline(),
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
          checked={sendMessageOnEnter()}
          onChange={setSendMessageOnEnter}
          description="Send chat messages with Enter (Shift+Enter for a new line)."
        >
          Send message on Enter
        </Switch>
        <Switch
          checked={showTaskTimeline()}
          onChange={setShowTaskTimeline}
          description="Show task timeline blocks in chat responses."
        >
          Show task timeline
        </Switch>
        <Switch
          checked={showTimestamps()}
          onChange={setShowTimestamps}
          description="Display timestamps next to chat messages."
        >
          Show timestamps
        </Switch>
        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
          TODO: Connect UI settings to backend persistence.
        </div>
      </div>
    </Card>
  )
}

export default UITab

