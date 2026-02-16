import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../context/vscode"
import { useServer } from "../context/server"
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

const toItemLabel = (item: MarketplaceItem): string => {
  if (item.type === "skill") {
    return item.displayName || item.name
  }
  return item.name
}

const toItemCategory = (item: MarketplaceItem): string | null => {
  if (item.type !== "skill") {
    return null
  }
  return item.displayCategory || item.category || null
}

const itemFilterTags = (item: MarketplaceItem): string[] => {
  const tags = [...(item.tags ?? [])]
  const category = toItemCategory(item)
  if (category) {
    tags.push(category)
  }
  return Array.from(new Set(tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0)))
}

const MarketplaceView: Component<{ initialTab?: MarketplaceItemType }> = (props) => {
  const vscode = useVSCode()
  const server = useServer()

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

  const currentOrganizationName = createMemo(() => {
    const profile = server.profileData()
    const currentOrgId = profile?.currentOrgId
    if (!profile?.profile?.organizations?.length || !currentOrgId) {
      return null
    }
    return profile.profile.organizations.find((org) => org.id === currentOrgId)?.name ?? null
  })

  let syncedInitialTab: MarketplaceItemType | undefined
  createEffect(() => {
    const nextTab = props.initialTab
    if (!nextTab || nextTab === syncedInitialTab) {
      return
    }
    syncedInitialTab = nextTab
    setActiveTab(nextTab)
    setSelectedTags([])
  })

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

  const filteredItems = createMemo(() => {
    const query = search().trim().toLowerCase()
    const selectedTagSet = new Set(selectedTags())

    return activeItems()
      .filter((item) => {
        if (!query) {
          return true
        }
        const haystack = [
          item.name,
          toItemLabel(item),
          item.description,
          ...(itemFilterTags(item) ?? []),
          ...(item.type === "skill" ? [item.category, item.displayName, item.displayCategory] : []),
        ]
          .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          .join(" ")
          .toLowerCase()
        return haystack.includes(query)
      })
      .filter((item) => {
        if (selectedTagSet.size === 0) {
          return true
        }
        const tags = itemFilterTags(item)
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

  const organizationManagedItems = createMemo(() => {
    if (activeTab() !== "mcp") {
      return [] as MarketplaceItem[]
    }
    return filteredItems().filter((item) => item.type === "mcp" && !!item.managedByOrganization)
  })

  const catalogItems = createMemo(() => {
    if (activeTab() !== "mcp") {
      return filteredItems()
    }
    return filteredItems().filter((item) => !(item.type === "mcp" && !!item.managedByOrganization))
  })

  const hasActiveFilters = createMemo(() => {
    return (
      search().trim().length > 0 ||
      installFilter() !== "all" ||
      selectedTags().length > 0 ||
      sortBy() !== "name"
    )
  })

  const resetFilters = () => {
    setSearch("")
    setInstallFilter("all")
    setSelectedTags([])
    setSortBy("name")
  }

  const activeTabLabel = createMemo(() => TABS.find((tab) => tab.type === activeTab())?.label ?? "Marketplace")
  const activeTabIndex = createMemo(() => {
    const index = TABS.findIndex((tab) => tab.type === activeTab())
    return index >= 0 ? index : 0
  })

  const tabDescription = createMemo(() => {
    if (activeTab() === "mcp") {
      return "Browse MCP servers for tools, integrations, and workflows."
    }
    if (activeTab() === "mode") {
      return "Browse reusable agent modes and install them in one click."
    }
    return "Browse shared skills and install them locally or globally."
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
    const subject = item.type === "mode" ? "mode" : item.type === "mcp" ? "MCP server" : "skill"
    const label = toItemLabel(item)
    const confirmed = window.confirm(`Remove ${subject} "${label}" from ${target}?`)
    if (!confirmed) {
      return
    }
    setStatusMessage(null)
    setPendingActionsByItem(actionKey(item.id, target), "removing")
    vscode.postMessage({
      type: "removeMarketplaceItem",
      item,
      target,
    })
  }

  const getItemLink = (item: MarketplaceItem): string | undefined => {
    const url = item.type === "skill" ? item.githubUrl : item.type === "mcp" ? item.url : item.authorUrl
    return typeof url === "string" && url.trim().length > 0 ? url : undefined
  }

  const openItemLink = (item: MarketplaceItem) => {
    const url = getItemLink(item)
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

  const openSettings = () => {
    window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
  }

  const renderItemCard = (item: MarketplaceItem) => {
    const displayName = toItemLabel(item)
    const itemCategory = toItemCategory(item)
    const filterTags = itemFilterTags(item)
    const projectInstalled = isInstalledInTarget(item, "project")
    const globalInstalled = isInstalledInTarget(item, "global")
    const managedByOrganization = !!item.managedByOrganization
    const projectActionState = () => pendingActionsByItem[actionKey(item.id, "project")]
    const globalActionState = () => pendingActionsByItem[actionKey(item.id, "global")]
    const prerequisites = getMcpPrerequisites(item)

    return (
      <Card
        style={{
          padding: "12px",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
          "border-radius": "12px",
        }}
      >
        <div style={{ display: "flex", "justify-content": "space-between", gap: "10px", "align-items": "flex-start" }}>
          <div style={{ display: "grid", gap: "4px", flex: 1 }}>
            <div style={{ display: "flex", gap: "6px", "align-items": "center", "flex-wrap": "wrap" }}>
              <span
                style={{
                  "font-size": "10px",
                  "text-transform": "uppercase",
                  padding: "2px 6px",
                  "border-radius": "999px",
                  border: "1px solid var(--vscode-panel-border)",
                  color: "var(--vscode-descriptionForeground)",
                  "letter-spacing": "0.04em",
                }}
              >
                {item.type}
              </span>
              <Show when={item.author}>
                <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                  by {item.author}
                </span>
              </Show>
            </div>
            <div style={{ "font-size": "14px", "font-weight": 600 }}>{displayName}</div>
            <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>{item.description}</div>
            <Show when={item.authorUrl && item.type === "mode"}>
              <button
                type="button"
                onClick={() => item.authorUrl && vscode.postMessage({ type: "openExternal", url: item.authorUrl })}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--vscode-textLink-foreground, var(--vscode-textLink-activeForeground))",
                  padding: 0,
                  cursor: "pointer",
                  "text-decoration": "underline",
                  "font-size": "11px",
                  width: "fit-content",
                }}
              >
                View author profile
              </button>
            </Show>
            <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
              <Show when={itemCategory}>
                <span
                  style={{
                    "font-size": "10px",
                    "text-transform": "uppercase",
                    padding: "2px 6px",
                    "border-radius": "999px",
                    border: "1px solid var(--vscode-panel-border)",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {itemCategory}
                </span>
              </Show>
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
                  {currentOrganizationName() ? `Managed by ${currentOrganizationName()}` : "Organization managed"}
                </span>
              </Show>
            </div>
          </div>
          <Show when={!!getItemLink(item)}>
            <Button size="small" variant="ghost" onClick={() => openItemLink(item)}>
              Details
            </Button>
          </Show>
        </div>

        <Show when={filterTags.length > 0}>
          <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
            <For each={filterTags}>
              {(tag) => {
                const active = () => selectedTags().includes(tag)
                return (
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    style={{
                      "font-size": "11px",
                      color: active()
                        ? "var(--vscode-button-secondaryForeground)"
                        : "var(--vscode-descriptionForeground)",
                      border: "1px solid var(--vscode-panel-border)",
                      "border-radius": "999px",
                      padding: "2px 8px",
                      background: active()
                        ? "var(--vscode-button-secondaryBackground)"
                        : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    {tag}
                  </button>
                )
              }}
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
              aria-label={`Installation method for ${displayName}`}
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
                    aria-label={`${displayName} ${parameter.name}`}
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
              {currentOrganizationName()
                ? `This item is managed by ${currentOrganizationName()}.`
                : "This item is managed by your organization."}
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
  }

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", "min-height": "0" }}>
      <div
        style={{
          padding: "12px 12px 8px",
          display: "grid",
          gap: "10px",
          "flex-shrink": 0,
          background: "var(--vscode-editor-background)",
          "border-bottom": "1px solid var(--vscode-panel-border)",
        }}
      >
        <div style={{ display: "grid", gap: "2px" }}>
          <div style={{ "font-size": "16px", "font-weight": 600 }}>Marketplace</div>
          <div style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>{tabDescription()}</div>
        </div>

        <div style={{ display: "grid", gap: "6px" }}>
          <div style={{ display: "flex", gap: "8px", "align-items": "center", "justify-content": "space-between" }}>
            <div
              style={{
                position: "relative",
                display: "flex",
                "align-items": "center",
                gap: "0",
                "padding-bottom": "1px",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: "1px",
                  background: "var(--vscode-panel-border)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: `${activeTabIndex() * (100 / TABS.length)}%`,
                  width: `${100 / TABS.length}%`,
                  height: "2px",
                  background: "var(--vscode-button-background)",
                  transition: "left 180ms ease",
                }}
              />
              <For each={TABS}>
                {(tab) => (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.type)
                      setSelectedTags([])
                    }}
                    aria-label={tab.label}
                    style={{
                      border: "none",
                      background: "transparent",
                      color:
                        activeTab() === tab.type ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                      "font-size": "13px",
                      "font-weight": activeTab() === tab.type ? "600" : "500",
                      "font-family": "var(--vscode-font-family)",
                      padding: "8px 14px",
                      cursor: "pointer",
                      position: "relative",
                      "z-index": "1",
                      transition: "color 120ms ease",
                    }}
                  >
                    {tab.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={loading()}>
              <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>Loading...</span>
            </Show>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          "min-height": "0",
          "overflow-y": "auto",
          padding: "10px 12px 12px",
          display: "flex",
          "flex-direction": "column",
          gap: "10px",
        }}
      >
        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
          {activeTabLabel()} results: {organizationManagedItems().length + catalogItems().length}
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

        <Show when={activeTab() === "mcp" || activeTab() === "mode"}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--vscode-descriptionForeground)",
              padding: "8px 10px",
              border: "1px solid var(--vscode-panel-border)",
              "border-radius": "6px",
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              gap: "8px",
              "flex-wrap": "wrap",
            }}
          >
            <span>
              {activeTab() === "mcp"
                ? "Need advanced MCP management? Open Settings and go to Agent Behaviour."
                : "Installed modes can be managed from Settings."}
            </span>
            <Button size="small" variant="ghost" onClick={openSettings}>
              Open Settings
            </Button>
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
          <div
            role="status"
            aria-live="polite"
            style={{
              "font-size": "12px",
              color: "var(--vscode-descriptionForeground)",
              border: "1px dashed var(--vscode-panel-border)",
              "border-radius": "8px",
              padding: "10px",
              display: "grid",
              "justify-items": "center",
              gap: "6px",
              "min-height": "120px",
              "align-content": "center",
            }}
          >
            <div style={{ "font-size": "24px", opacity: 0.7 }}>↻</div>
            Loading marketplace catalog...
          </div>
        </Show>

      <Show when={!loading() && organizationManagedItems().length + catalogItems().length === 0}>
        <div
          style={{
            display: "grid",
            gap: "8px",
            "font-size": "12px",
            color: "var(--vscode-descriptionForeground)",
            border: "1px dashed var(--vscode-panel-border)",
            "border-radius": "8px",
            padding: "10px",
            "justify-items": "center",
            "min-height": "140px",
            "align-content": "center",
          }}
        >
          <div style={{ "font-size": "22px", opacity: 0.7 }}>☰</div>
          <div>No {activeTab()} items available for the current filters.</div>
          <Show when={hasActiveFilters()}>
            <div>
              <Button size="small" variant="secondary" onClick={resetFilters}>
                Clear filters
              </Button>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={!loading() && organizationManagedItems().length > 0}>
        <div style={{ display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span style={{ "font-size": "12px", opacity: 0.8 }}>🏢</span>
            <div
              style={{
                "font-size": "12px",
                "font-weight": 600,
                color: "var(--vscode-descriptionForeground)",
                "text-transform": "uppercase",
                "letter-spacing": "0.03em",
                "white-space": "nowrap",
              }}
            >
              {currentOrganizationName() ? `${currentOrganizationName()} managed MCPs` : "Organization managed MCPs"}
            </div>
            <div style={{ height: "1px", background: "var(--vscode-panel-border)", flex: 1 }} />
          </div>
          <div style={{ display: "grid", gap: "8px", "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <For each={organizationManagedItems()}>{(item) => renderItemCard(item)}</For>
          </div>
        </div>
      </Show>

      <Show when={!loading() && catalogItems().length > 0}>
        <div style={{ display: "grid", gap: "8px" }}>
          <Show when={organizationManagedItems().length > 0}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <span style={{ "font-size": "12px", opacity: 0.8 }}>🌐</span>
              <div
                style={{
                  "font-size": "12px",
                  "font-weight": 600,
                  color: "var(--vscode-descriptionForeground)",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.03em",
                  "white-space": "nowrap",
                }}
              >
                Marketplace catalog
              </div>
              <div style={{ height: "1px", background: "var(--vscode-panel-border)", flex: 1 }} />
            </div>
          </Show>
          <div style={{ display: "grid", gap: "8px", "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <For each={catalogItems()}>{(item) => renderItemCard(item)}</For>
          </div>
        </div>
      </Show>

        <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)", padding: "8px 0 2px" }}>
          Spot a Marketplace issue?{" "}
          <button
            type="button"
            onClick={() =>
              vscode.postMessage({
                type: "openExternal",
                url: "https://github.com/Kilo-Org/kilocode/issues/new?template=marketplace.yml",
              })
            }
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              color: "var(--vscode-textLink-foreground, var(--vscode-textLink-activeForeground))",
              "text-decoration": "underline",
            }}
          >
            Open issue template
          </button>
        </div>
      </div>
    </div>
  )
}

export default MarketplaceView
