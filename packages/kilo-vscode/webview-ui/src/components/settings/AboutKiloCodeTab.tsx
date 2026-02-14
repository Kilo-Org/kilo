import { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useLanguage } from "../../context/language"
import { useConfig } from "../../context/config"
import type { Config, ConnectionState } from "../../types/messages"

export interface AboutKiloCodeTabProps {
  port: number | null
  connectionState: ConnectionState
}

const AboutKiloCodeTab: Component<AboutKiloCodeTabProps> = (props) => {
  const language = useLanguage()
  const { config, updateConfig, loading } = useConfig()
  let fileInputRef: HTMLInputElement | undefined

  const exportSettings = () => {
    const data = config()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const date = new Date().toISOString().slice(0, 10)
    anchor.href = url
    anchor.download = `kilo-settings-${date}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showToast({ variant: "success", title: "Settings exported" })
  }

  const triggerImport = () => {
    fileInputRef?.click()
  }

  const handleImport = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      return
    }

    try {
      const contents = await file.text()
      const parsed = JSON.parse(contents) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Settings file must contain a JSON object.")
      }

      updateConfig(parsed as Partial<Config>)
      showToast({ variant: "success", title: "Settings import requested" })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Failed to import settings",
        description: error instanceof Error ? error.message : "Invalid settings file",
      })
    } finally {
      input.value = ""
    }
  }

  const getStatusColor = () => {
    switch (props.connectionState) {
      case "connected":
        return "var(--vscode-testing-iconPassed, #89d185)"
      case "connecting":
      case "reconnecting":
        return "var(--vscode-testing-iconQueued, #cca700)"
      case "disconnected":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
      case "error":
        return "var(--vscode-testing-iconFailed, #f14c4c)"
    }
  }

  const getStatusText = () => {
    switch (props.connectionState) {
      case "connected":
        return language.t("settings.aboutKiloCode.status.connected")
      case "connecting":
        return language.t("settings.aboutKiloCode.status.connecting")
      case "reconnecting":
        return language.t("settings.aboutKiloCode.status.reconnecting")
      case "disconnected":
        return language.t("settings.aboutKiloCode.status.disconnected")
      case "error":
        return language.t("settings.aboutKiloCode.status.error")
    }
  }

  return (
    <div>
      <div
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "16px",
          "margin-bottom": "16px",
        }}
      >
        <h4
          style={{
            "font-size": "13px",
            "font-weight": "600",
            "margin-bottom": "12px",
            "margin-top": "0",
            color: "var(--vscode-foreground)",
          }}
        >
          {language.t("settings.aboutKiloCode.cliServer")}
        </h4>

        {/* Connection Status */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "margin-bottom": "12px",
          }}
        >
          <span
            style={{
              "font-size": "12px",
              color: "var(--vscode-descriptionForeground)",
              width: "100px",
            }}
          >
            {language.t("settings.aboutKiloCode.status.label")}
          </span>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: getStatusColor(),
                display: "inline-block",
              }}
            />
            <span
              style={{
                "font-size": "12px",
                color: "var(--vscode-foreground)",
              }}
            >
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* Port Number */}
        <div
          style={{
            display: "flex",
            "align-items": "center",
          }}
        >
          <span
            style={{
              "font-size": "12px",
              color: "var(--vscode-descriptionForeground)",
              width: "100px",
            }}
          >
            {language.t("settings.aboutKiloCode.port.label")}
          </span>
          <span
            style={{
              "font-size": "12px",
              color: "var(--vscode-foreground)",
              "font-family": "var(--vscode-editor-font-family, monospace)",
            }}
          >
            {props.port !== null ? props.port : "—"}
          </span>
        </div>
      </div>

      <div
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "16px",
        }}
      >
        <h4
          style={{
            "font-size": "13px",
            "font-weight": "600",
            "margin-bottom": "12px",
            "margin-top": "0",
            color: "var(--vscode-foreground)",
          }}
        >
          {language.t("settings.aboutKiloCode.versionInfo")}
        </h4>
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: 0,
          }}
        >
          {language.t("settings.aboutKiloCode.extensionName")}
        </p>
      </div>

      <div
        style={{
          background: "var(--vscode-editor-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "4px",
          padding: "16px",
          "margin-top": "16px",
        }}
      >
        <h4
          style={{
            "font-size": "13px",
            "font-weight": "600",
            "margin-bottom": "8px",
            "margin-top": "0",
            color: "var(--vscode-foreground)",
          }}
        >
          Settings Backup
        </h4>
        <p
          style={{
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 0 12px 0",
          }}
        >
          Export settings to JSON or import a previously exported file.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button size="small" variant="secondary" onClick={exportSettings} disabled={loading()}>
            Export JSON
          </Button>
          <Button size="small" variant="secondary" onClick={triggerImport} disabled={loading()}>
            Import JSON
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={handleImport}
        />
      </div>
    </div>
  )
}

export default AboutKiloCodeTab
