import { Component } from "solid-js"

const PromptsTab: Component = () => {
  return (
    <div>
      <div
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "16px",
        }}
      >
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
            "line-height": "1.5",
          }}
        >
          <strong style={{ color: "var(--vscode-foreground)" }}>This section is not implemented yet.</strong> It will
          contain configuration options and explanatory text related to the selected settings category. During
          reimplementation, use this space to validate layout, spacing, scrolling behavior, and navigation state before
          wiring up real controls.
        </p>
      </div>
    </div>
  )
}

export default PromptsTab
