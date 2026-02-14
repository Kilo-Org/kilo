import { describe, expect, it } from "bun:test"
import {
  SETTINGS_SYNC_KEYS,
  initializeSettingsSync,
  readSettingsActiveTab,
  writeLastProviderAuth,
  writeSettingsActiveTab,
} from "../../src/services/settings-sync"

function createMockContext(initialTab?: string) {
  const store = new Map<string, unknown>()
  if (initialTab) {
    store.set(SETTINGS_SYNC_KEYS.settingsActiveTab, initialTab)
  }

  const syncedKeys: string[][] = []
  const context = {
    globalState: {
      get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback),
      update: async (key: string, value: unknown) => {
        store.set(key, value)
      },
      setKeysForSync: (keys: readonly string[]) => {
        syncedKeys.push([...keys])
      },
    },
  }

  return { context: context as any, store, syncedKeys }
}

describe("settings-sync service", () => {
  it("registers globalState keys for sync", () => {
    const { context, syncedKeys } = createMockContext()
    initializeSettingsSync(context)
    expect(syncedKeys.length).toBe(1)
    expect(syncedKeys[0]).toContain(SETTINGS_SYNC_KEYS.settingsActiveTab)
    expect(syncedKeys[0]).toContain(SETTINGS_SYNC_KEYS.lastProviderAuth)
  })

  it("reads a valid settings tab from globalState", () => {
    const { context } = createMockContext("notifications")
    expect(readSettingsActiveTab(context)).toBe("notifications")
  })

  it("falls back to default tab for invalid state", () => {
    const { context } = createMockContext("invalid-tab")
    expect(readSettingsActiveTab(context)).toBe("providers")
  })

  it("writes valid settings tab and ignores invalid values", async () => {
    const { context, store } = createMockContext()
    await writeSettingsActiveTab(context, "language")
    expect(store.get(SETTINGS_SYNC_KEYS.settingsActiveTab)).toBe("language")

    await writeSettingsActiveTab(context, "bad-tab")
    expect(store.get(SETTINGS_SYNC_KEYS.settingsActiveTab)).toBe("language")
  })

  it("writes last provider auth id when valid", async () => {
    const { context, store } = createMockContext()
    await writeLastProviderAuth(context, "openai")
    expect(store.get(SETTINGS_SYNC_KEYS.lastProviderAuth)).toBe("openai")

    await writeLastProviderAuth(context, "   ")
    expect(store.get(SETTINGS_SYNC_KEYS.lastProviderAuth)).toBe("openai")
  })
})
