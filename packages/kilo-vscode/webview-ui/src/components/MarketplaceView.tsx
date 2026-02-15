import { Component, For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../context/vscode"
import { useLanguage } from "../context/language"
import type {
  ExtensionMessage,
  MarketplaceInstalledMetadata,
  MarketplaceItem,
  MarketplaceItemType,
} from "../types/messages"

const TABS: Array<{ type: MarketplaceItemType; label: string }> = [
  { type: "mcp", label: "MCP" },
  { type: "mode", label: "Modes" },
  { type: "skill", label: "Skills" },
]

const emptyInstalled: MarketplaceInstalledMetadata = { project: {}, global: {} }

type InstallFilter = "all" | "installed" | "not_installed"
type SortBy = "name" | "installed"

type ItemActionState = "installing" | "removing"

const actionKey = (itemID: string, target: "project" | "global") => `${itemID}::${target}`

const MarketplaceView: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [activeTab, setActiveTab] = createSignal<MarketplaceItemType>("mcp")
  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [installed, setInstalled] = createSignal<MarketplaceInstalledMetadata>(emptyInstalled)
  const [search, setSearch] = createSignal("")
  const [installFilter, setInstallFilter] = createSignal<InstallFilter>("all")
  const [selectedTags, setSelectedTags] = createSignal<string[]>([])
  const [sortBy, setSortBy] = createSignal<SortBy>("name")
  const [loading, setLoading] = createSignal(false)
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null)
  const [selectedMethodByItem, setSelectedMethodByItem] = createStore<Record<string, number>>({})
  const [parameterValuesByItem, setParameterValuesByItem] = createStore<Record<string, Record<string, string>>>({})
  const [pendingActionsByItem, setPendingActionsByItem] = createStore<Record<string, ItemActionState>>({})

  const requestData = () => {
    setLoading(true)
    setStatusMessage(null)
    vscode.postMessage({ type: "requestMarketplaceData" })
  }

  onMount(() => {
    const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
      if (message.type === "marketplaceData") {
        setItems(Array.isArray(message.items) ? message.items : [])
        setInstalled(message.installedMetadata ?? emptyInstalled)
        if (message.errors?.length) {
          setStatusMessage(message.errors.join(" | "))
        } else {
          setStatusMessage(null)
        }
        setLoading(false)
        return
      }

      if (message.type === "marketplaceActionResult") {
        const itemID = typeof message.itemID === "string" ? message.itemID : undefined
        if (itemID) {
          setPendingActionsByItem(
            produce((state) => {
              delete state[actionKey(itemID, "project")]
              delete state[actionKey(itemID, "global")]
            }),
          )
        }

        if (!message.success) {
          setStatusMessage(message.error || `Failed to ${message.action} marketplace item`)
        } else {
          setStatusMessage(`Marketplace ${message.action} succeeded`)
          requestData()
        }
      }
    })

    requestData()
    return () => unsubscribe()
  })

  const isInstalledInTarget = (item: MarketplaceItem, target: "project" | "global"): boolean => {
    const map = target === "project" ? installed().project : installed().global
    return !!map[item.id]
  }

  const isActionPending = (item: MarketplaceItem, target: "project" | "global") => {
    return !!pendingActionsByItem[actionKey(item.id, target)]
  }

  const activeItems = createMemo(() => items().filter((item) => item.type === activeTab()))

  const availableTags = createMemo(() => {
    const tags = new Set<string>()
    for (const item of activeItems()) {
      for (const tag of item.tags ?? []) {
        tags.add(tag)
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b))
  })

  const filteredItems = createMemo(() => {
    const query = search().trim().toLowerCase()
    const selectedTagSet = new Set(selectedTags())

    return activeItems()
      .filter((item) => {
        if (!query) {
          return true
        }
        const haystack = [item.name, item.description, ...(item.tags ?? [])].join(" ").toLowerCase()
        return haystack.includes(query)
      })
      .filter((item) => {
        if (selectedTagSet.size === 0) {
          return true
        }
        const tags = item.tags ?? []
        return tags.some((tag) => selectedTagSet.has(tag))
      })
      .filter((item) => {
        const installedInAnyTarget = isInstalledInTarget(item, "project") || isInstalledInTarget(item, "global")
        if (installFilter() === "installed") {
          return installedInAnyTarget
        }
        if (installFilter() === "not_installed") {
          return !installedInAnyTarget
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy() === "installed") {
          const aInstalled = isInstalledInTarget(a, "project") || isInstalledInTarget(a, "global")
          const bInstalled = isInstalledInTarget(b, "project") || isInstalledInTarget(b, "global")
          if (aInstalled !== bInstalled) {
            return aInstalled ? -1 : 1
          }
        }
        return a.name.localeCompare(b.name)
      })
  })

  const validateParameters = (item: MarketplaceItem): string[] => {
    if (item.type !== "mcp") {
      return []
    }
    const values = parameterValuesByItem[item.id] ?? {}
    return getMcpParameters(item)
      .filter((parameter) => !parameter.optional)
      .filter((parameter) => !(values[parameter.key] || "").trim())
      .map((parameter) => parameter.name)
  }

  const handleInstall = (item: MarketplaceItem, target: "project" | "global") => {
    vscode.postMessage({
      type: "telemetryEvent",
      event: "Marketplace Install Button Clicked",
      properties: {
        itemId: item.id,
        itemType: item.type,
        itemName: item.name,
        target,
      },
    })

    setStatusMessage(null)

    const missingRequired = validateParameters(item)
    if (missingRequired.length > 0) {
      setStatusMessage(`Missing required fields: ${missingRequired.join(", ")}`)
      return
    }

    setPendingActionsByItem(actionKey(item.id, target), "installing")

    const selectedIndex = selectedMethodByItem[item.id] ?? 0
    const parameters = parameterValuesByItem[item.id] ?? {}
    vscode.postMessage({
      type: "installMarketplaceItem",
      item,
      target,
      selectedIndex,
      parameters,
    })
  }

  const handleRemove = (item: MarketplaceItem, target: "project" | "global") => {
    setStatusMessage(null)
    setPendingActionsByItem(actionKey(item.id, target), "removing")
    vscode.postMessage({
      type: "removeMarketplaceItem",
      item,
      target,
    })
  }

  const openItemLink = (item: MarketplaceItem) => {
    const url = item.type === "skill" ? item.githubUrl : item.type === "mcp" ? item.url : item.authorUrl
    if (!url) {
      return
    }
    vscode.postMessage({ type: "openExternal", url })
  }

  const getMcpMethods = (item: MarketplaceItem) => {
    if (item.type !== "mcp" || !Array.isArray(item.content)) {
      return []
    }
    return item.content
  }

  const getMcpParameters = (item: MarketplaceItem) => {
    if (item.type !== "mcp") {
      return []
    }
    const base = item.parameters ?? []
    const methods = getMcpMethods(item)
    const selected = methods[selectedMethodByItem[item.id] ?? 0]
    const scoped = selected?.parameters ?? []
    const all = [...base, ...scoped]
    const deduped = new Map<string, (typeof all)[number]>()
    for (const parameter of all) {
      deduped.set(parameter.key, parameter)
    }
    return [...deduped.values()]
  }

  const getMcpPrerequisites = (item: MarketplaceItem) => {
    if (item.type !== "mcp") {
      return item.prerequisites ?? []
    }

    const globalPrereqs = item.prerequisites ?? []
    if (!Array.isArray(item.content)) {
      return globalPrereqs
    }

    const selected = item.content[selectedMethodByItem[item.id] ?? 0]
    const methodPrereqs = selected?.prerequisites ?? []
    return [...new Set([...globalPrereqs, ...methodPrereqs])]
  }

  const toggleTag = (tag: string) => {
    const existing = selectedTags()
    if (existing.includes(tag)) {
      setSelectedTags(existing.filter((current) => current !== tag))
    } else {
      setSelectedTags([...existing, tag])
    }
  }

  return (
    <div style={{ padding: "12px", display: "flex", "flex-direction": "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", "align-items": "center", "justify-content": "space-between" }}>
        <div style={{ display: "flex", gap: "6px", "align-items": "center", "flex-wrap": "wrap" }}>
          <For each={TABS}>
            {(tab) => (
              <Button
                size="small"
                variant={activeTab() === tab.type ? "primary" : "ghost"}
                onClick={() => {
                  setActiveTab(tab.type)
                  setSelectedTags([])
                }}
              >
                {tab.label}
              </Button>
            )}
          </For>
        </div>
        <Tooltip value={language.t("common.refresh")} placement="top">
          <Button size="small" variant="ghost" onClick={requestData} disabled={loading()}>
            {language.t("common.refresh")}
          </Button>
        </Tooltip>
      </div>

      <input
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
        placeholder={`Search ${activeTab()} marketplace...`}
        aria-label={`Search ${activeTab()} marketplace`}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid var(--vscode-input-border)",
          "border-radius": "6px",
          background: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          outline: "none",
        }}
      />

      <div style={{ display: "grid", gap: "8px", "grid-template-columns": "1fr 1fr" }}>
        <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
          <span style={{ color: "var(--vscode-descriptionForeground)" }}>Install filter</span>
          <select
            value={installFilter()}
            onChange={(event) => setInstallFilter(event.currentTarget.value as InstallFilter)}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--vscode-input-border)",
              "border-radius": "6px",
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
            }}
          >
            <option value="all">All items</option>
            <option value="installed">Installed</option>
            <option value="not_installed">Not installed</option>
          </select>
        </label>

        <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
          <span style={{ color: "var(--vscode-descriptionForeground)" }}>Sort</span>
          <select
            value={sortBy()}
            onChange={(event) => setSortBy(event.currentTarget.value as SortBy)}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid var(--vscode-input-border)",
              "border-radius": "6px",
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
            }}
          >
            <option value="name">Name</option>
            <option value="installed">Installed first</option>
          </select>
        </label>
      </div>

      <Show when={availableTags().length > 0}>
        <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
          <For each={availableTags()}>
            {(tag) => {
              const active = () => selectedTags().includes(tag)
              return (
                <button
                  type="button"
                  onClick={() => toggleTag(tag)}
                  style={{
                    border: "1px solid var(--vscode-input-border)",
                    "border-radius": "999px",
                    padding: "3px 8px",
                    "font-size": "11px",
                    cursor: "pointer",
                    background: active() ? "var(--vscode-button-secondaryBackground)" : "transparent",
                    color: active()
                      ? "var(--vscode-button-secondaryForeground)"
                      : "var(--vscode-descriptionForeground)",
                  }}
                >
                  {tag}
                </button>
              )
            }}
          </For>
          <Show when={selectedTags().length > 0}>
            <Button size="small" variant="ghost" onClick={() => setSelectedTags([])}>
              Clear tags
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={statusMessage()}>
        {(message) => (
          <div
            role="status"
            aria-live="polite"
            style={{
              "font-size": "12px",
              color: "var(--vscode-descriptionForeground)",
              padding: "6px 8px",
              border: "1px solid var(--vscode-panel-border)",
              "border-radius": "6px",
            }}
          >
            {message()}
          </div>
        )}
      </Show>

      <Show when={loading()}>
        <div role="status" aria-live="polite" style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
          Loading marketplace catalog...
        </div>
      </Show>

      <Show when={!loading() && filteredItems().length === 0}>
        <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
          No {activeTab()} items available for the current filters.
        </div>
      </Show>

      <For each={filteredItems()}>
        {(item) => {
          const projectInstalled = isInstalledInTarget(item, "project")
          const globalInstalled = isInstalledInTarget(item, "global")
          const managedByOrganization = !!item.managedByOrganization
          const projectActionState = () => pendingActionsByItem[actionKey(item.id, "project")]
          const globalActionState = () => pendingActionsByItem[actionKey(item.id, "global")]
          const prerequisites = getMcpPrerequisites(item)
          return (
            <Card style={{ padding: "12px", display: "flex", "flex-direction": "column", gap: "8px" }}>
              <div style={{ display: "flex", "justify-content": "space-between", gap: "10px", "align-items": "flex-start" }}>
                <div style={{ display: "grid", gap: "4px", flex: 1 }}>
                  <div style={{ "font-size": "14px", "font-weight": 600 }}>{item.name}</div>
                  <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>{item.description}</div>
                  <Show when={item.author}>
                    <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Author: {item.author}</div>
                  </Show>
                  <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                    <Show when={projectInstalled}>
                      <span
                        style={{
                          "font-size": "10px",
                          "text-transform": "uppercase",
                          padding: "2px 6px",
                          "border-radius": "999px",
                          border: "1px solid var(--vscode-input-border)",
                          color: "var(--vscode-terminal-ansiGreen, #4ec9b0)",
                        }}
                      >
                        Project installed
                      </span>
                    </Show>
                    <Show when={globalInstalled}>
                      <span
                        style={{
                          "font-size": "10px",
                          "text-transform": "uppercase",
                          padding: "2px 6px",
                          "border-radius": "999px",
                          border: "1px solid var(--vscode-input-border)",
                          color: "var(--vscode-terminal-ansiGreen, #4ec9b0)",
                        }}
                      >
                        Global installed
                      </span>
                    </Show>
                    <Show when={managedByOrganization}>
                      <span
                        style={{
                          "font-size": "10px",
                          "text-transform": "uppercase",
                          padding: "2px 6px",
                          "border-radius": "999px",
                          border: "1px solid var(--vscode-input-border)",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        Organization managed
                      </span>
                    </Show>
                  </div>
                </div>
                <Show when={item.type === "skill" || item.type === "mcp" || !!item.authorUrl}>
                  <Button size="small" variant="ghost" onClick={() => openItemLink(item)}>
                    Open
                  </Button>
                </Show>
              </div>

              <Show when={(item.tags?.length ?? 0) > 0}>
                <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                  <For each={item.tags}>
                    {(tag) => (
                      <span
                        style={{
                          "font-size": "11px",
                          color: "var(--vscode-descriptionForeground)",
                          border: "1px solid var(--vscode-panel-border)",
                          "border-radius": "999px",
                          padding: "2px 8px",
                        }}
                      >
                        {tag}
                      </span>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={prerequisites.length > 0}>
                <div style={{ display: "grid", gap: "4px" }}>
                  <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Prerequisites</span>
                  <ul style={{ margin: 0, padding: "0 0 0 16px", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                    <For each={prerequisites}>{(prerequisite) => <li>{prerequisite}</li>}</For>
                  </ul>
                </div>
              </Show>

              <Show when={item.type === "mcp" && Array.isArray(item.content) && item.content.length > 0}>
                <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
                  <span style={{ color: "var(--vscode-descriptionForeground)" }}>Installation method</span>
                  <select
                    value={String(selectedMethodByItem[item.id] ?? 0)}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value)
                      setSelectedMethodByItem(item.id, Number.isFinite(next) ? next : 0)
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid var(--vscode-input-border)",
                      "border-radius": "6px",
                      background: "var(--vscode-input-background)",
                      color: "var(--vscode-input-foreground)",
                    }}
                    aria-label={`Installation method for ${item.name}`}
                  >
                    <For each={getMcpMethods(item)}>{(method, index) => <option value={String(index())}>{method.name}</option>}</For>
                  </select>
                </label>
              </Show>

              <Show when={item.type === "mcp" && getMcpParameters(item).length > 0}>
                <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                  <For each={getMcpParameters(item)}>
                    {(parameter) => (
                      <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "12px" }}>
                        <span style={{ color: "var(--vscode-descriptionForeground)" }}>
                          {parameter.name}
                          <Show when={!parameter.optional}>
                            <span style={{ color: "var(--vscode-errorForeground)" }}> *</span>
                          </Show>
                        </span>
                        <input
                          value={parameterValuesByItem[item.id]?.[parameter.key] ?? ""}
                          placeholder={parameter.placeholder || parameter.key}
                          aria-label={`${item.name} ${parameter.name}`}
                          onInput={(event) => {
                            setParameterValuesByItem(item.id, parameter.key, event.currentTarget.value)
                          }}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            border: "1px solid var(--vscode-input-border)",
                            "border-radius": "6px",
                            background: "var(--vscode-input-background)",
                            color: "var(--vscode-input-foreground)",
                          }}
                        />
                      </label>
                    )}
                  </For>
                </div>
              </Show>

              <Show
                when={!managedByOrganization}
                fallback={
                  <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
                    This item is managed by your organization.
                  </div>
                }
              >
                <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                  <Button
                    size="small"
                    variant={projectInstalled ? "ghost" : "primary"}
                    onClick={() => (projectInstalled ? handleRemove(item, "project") : handleInstall(item, "project"))}
                    disabled={isActionPending(item, "project") || isActionPending(item, "global")}
                  >
                    {projectActionState() === "installing"
                      ? "Installing..."
                      : projectActionState() === "removing"
                        ? "Removing..."
                        : projectInstalled
                          ? "Remove Project"
                          : "Install Project"}
                  </Button>
                  <Button
                    size="small"
                    variant={globalInstalled ? "ghost" : "secondary"}
                    onClick={() => (globalInstalled ? handleRemove(item, "global") : handleInstall(item, "global"))}
                    disabled={isActionPending(item, "project") || isActionPending(item, "global")}
                  >
                    {globalActionState() === "installing"
                      ? "Installing..."
                      : globalActionState() === "removing"
                        ? "Removing..."
                        : globalInstalled
                          ? "Remove Global"
                          : "Install Global"}
                  </Button>
                </div>
              </Show>
            </Card>
          )
        }}
      </For>
    </div>
  )
}

export default MarketplaceView
