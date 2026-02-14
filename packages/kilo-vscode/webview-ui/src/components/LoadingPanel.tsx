import { Component, Show } from "solid-js"

interface LoadingPanelProps {
  message: string
  showSpinner?: boolean
}

const LoadingPanel: Component<LoadingPanelProps> = (props) => {
  return (
    <div class="connection-state-panel">
      <Show when={props.showSpinner ?? true}>
        <div class="connection-state-spinner" aria-hidden="true" />
      </Show>
      <p class="connection-state-message">{props.message}</p>
    </div>
  )
}

export default LoadingPanel
