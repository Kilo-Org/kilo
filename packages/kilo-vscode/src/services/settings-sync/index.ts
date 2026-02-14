import type * as vscode from "vscode"

export const SETTINGS_SYNC_KEYS = {
  settingsActiveTab: "settings.activeTab",
  lastProviderAuth: "providers.lastAuthProvider",
} as const

const DEFAULT_ACTIVE_TAB = "providers"

const ALLOWED_SETTINGS_TABS = new Set([
  "providers",
  "agentBehaviour",
  "autoApprove",
  "browser",
  "checkpoints",
  "display",
  "autocomplete",
  "notifications",
  "context",
  "terminal",
  "prompts",
  "experimental",
  "language",
  "aboutKiloCode",
])

export function initializeSettingsSync(context: vscode.ExtensionContext): void {
  context.globalState.setKeysForSync(Object.values(SETTINGS_SYNC_KEYS))
}

export function readSettingsActiveTab(context: vscode.ExtensionContext): string {
  const value = context.globalState.get<string>(SETTINGS_SYNC_KEYS.settingsActiveTab, DEFAULT_ACTIVE_TAB)
  if (typeof value !== "string" || !ALLOWED_SETTINGS_TABS.has(value)) {
    return DEFAULT_ACTIVE_TAB
  }
  return value
}

export async function writeSettingsActiveTab(context: vscode.ExtensionContext, tab: unknown): Promise<void> {
  if (typeof tab !== "string" || !ALLOWED_SETTINGS_TABS.has(tab)) {
    return
  }
  await context.globalState.update(SETTINGS_SYNC_KEYS.settingsActiveTab, tab)
}

export async function writeLastProviderAuth(context: vscode.ExtensionContext, providerId: unknown): Promise<void> {
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return
  }
  await context.globalState.update(SETTINGS_SYNC_KEYS.lastProviderAuth, providerId.trim())
}
