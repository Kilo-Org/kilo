/**
 * Config context
 * Manages backend configuration state (permissions, agents, providers, etc.)
 * and exposes an updateConfig method to apply partial updates.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "./vscode"
import type { Config, ExtensionMessage, ValidationIssue } from "../types/messages"

interface ConfigContextValue {
  config: Accessor<Config>
  loading: Accessor<boolean>
  validationErrors: Accessor<Record<string, string>>
  updateConfig: (partial: Partial<Config>) => void
}

const ConfigContext = createContext<ConfigContextValue>()

export const ConfigProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [config, setConfig] = createSignal<Config>({})
  const [loading, setLoading] = createSignal(true)
  const [validationErrors, setValidationErrors] = createSignal<Record<string, string>>({})

  const issuesToMap = (issues: ValidationIssue[]) => Object.fromEntries(issues.map((issue) => [issue.path, issue.message]))

  const firstIssueSummary = (issues: ValidationIssue[]) => {
    if (issues.length === 0) {
      return undefined
    }
    const first = issues[0]
    return `${first.path}: ${first.message}`
  }

  // Register handler immediately (not in onMount) so we never miss
  // a configLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "configLoaded") {
      setConfig(message.config)
      setLoading(false)
      setValidationErrors({})
      return
    }
    if (message.type === "configUpdated") {
      setConfig(message.config)
      setValidationErrors({})
      return
    }
    if (message.type === "configValidationError") {
      setValidationErrors(issuesToMap(message.issues))
      showToast({
        variant: "error",
        title: "Invalid configuration update",
        description: firstIssueSummary(message.issues) ?? message.message,
      })
      setLoading(true)
      vscode.postMessage({ type: "requestConfig" })
      return
    }
    if (message.type === "settingValidationError") {
      if (message.issues.length > 0) {
        setValidationErrors(issuesToMap(message.issues))
      }
      showToast({
        variant: "error",
        title: message.key ? `Invalid setting: ${message.key}` : "Invalid setting update",
        description: firstIssueSummary(message.issues) ?? message.message,
      })
      return
    }
  })

  onCleanup(unsubscribe)

  // Request config in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let retries = 0
  const maxRetries = 5
  const retryMs = 500

  vscode.postMessage({ type: "requestConfig" })

  const retryTimer = setInterval(() => {
    retries++
    if (!loading() || retries >= maxRetries) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestConfig" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  function updateConfig(partial: Partial<Config>) {
    // Optimistically update local state
    setConfig((prev) => ({ ...prev, ...partial }))
    // Send to extension for persistence
    vscode.postMessage({ type: "updateConfig", config: partial })
  }

  const value: ConfigContextValue = {
    config,
    loading,
    validationErrors,
    updateConfig,
  }

  return <ConfigContext.Provider value={value}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error("useConfig must be used within a ConfigProvider")
  }
  return context
}
