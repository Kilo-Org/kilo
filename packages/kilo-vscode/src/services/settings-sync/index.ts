import type * as vscode from "vscode"

export const SETTINGS_SYNC_KEYS = {
  settingsActiveTab: "settings.activeTab",
  lastProviderAuth: "providers.lastAuthProvider",
  globalRulesToggles: "globalRulesToggles",
  globalWorkflowToggles: "globalWorkflowToggles",
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

const LEGACY_SYNC_KEY_ALIASES: Record<keyof typeof SETTINGS_SYNC_KEYS, readonly string[]> = {
  settingsActiveTab: ["kilo-code.settings.activeTab", "kilo-code.new.settings.activeTab"],
  lastProviderAuth: ["kilo-code.providers.lastAuthProvider", "kilo-code.new.providers.lastAuthProvider"],
  globalRulesToggles: ["kilo-code.globalRulesToggles"],
  globalWorkflowToggles: ["kilo-code.globalWorkflowToggles"],
}

function sessionHistoryCacheKey(workspaceDir: string): string {
  const encoded = Buffer.from(workspaceDir).toString("base64url")
  return `kilo-code.new.session-history-cache.v1.${encoded}`
}

function agentManagerStateKey(workspaceDir: string): string {
  return `kilo.agentManager.state.${encodeURIComponent(workspaceDir)}`
}

function collectDynamicSyncKeys(workspaceDirs: readonly string[] = []): string[] {
  return workspaceDirs.flatMap((workspaceDir) => {
    return [sessionHistoryCacheKey(workspaceDir), agentManagerStateKey(workspaceDir)]
  })
}

function getSyncKeysForRegistration(workspaceDirs: readonly string[] = []): string[] {
  return [...Object.values(SETTINGS_SYNC_KEYS), ...collectDynamicSyncKeys(workspaceDirs)]
}

async function migrateLegacySyncKeys(context: vscode.ExtensionContext): Promise<void> {
  const targetEntries = Object.entries(SETTINGS_SYNC_KEYS) as Array<[keyof typeof SETTINGS_SYNC_KEYS, string]>
  for (const [logicalKey, targetKey] of targetEntries) {
    const existing = context.globalState.get<unknown>(targetKey)
    if (existing !== undefined) {
      continue
    }

    for (const legacyKey of LEGACY_SYNC_KEY_ALIASES[logicalKey]) {
      const legacyValue = context.globalState.get<unknown>(legacyKey)
      if (legacyValue !== undefined) {
        await context.globalState.update(targetKey, legacyValue)
        break
      }
    }
  }
}

export function initializeSettingsSync(context: vscode.ExtensionContext, workspaceDirs: readonly string[] = []): void {
  context.globalState.setKeysForSync(getSyncKeysForRegistration(workspaceDirs))
  void migrateLegacySyncKeys(context)
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

export function readSettingsSyncDiagnostics(
  context: vscode.ExtensionContext,
  workspaceDirs: readonly string[] = [],
): { keys: string[]; values: Record<string, unknown> } {
  const keys = getSyncKeysForRegistration(workspaceDirs)
  const values: Record<string, unknown> = {}

  for (const key of keys) {
    const value = context.globalState.get<unknown>(key)
    if (value !== undefined) {
      values[key] = value
    }
  }

  return { keys, values }
}
