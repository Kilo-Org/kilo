/**
 * SessionList component
 * Displays session history with filtering, sorting, and selection-mode actions.
 */

import { Component, Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { InlineInput } from "@kilocode/kilo-ui/inline-input"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { SessionInfo, Message } from "../../types/messages"

const DATE_GROUP_KEYS = ["time.today", "time.yesterday", "time.thisWeek", "time.thisMonth", "time.older"] as const
type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"
const PAGE_SIZE = 25

const SORT_OPTIONS: SortOption[] = ["newest", "oldest", "mostExpensive", "mostTokens", "mostRelevant"]
const FAVORITES_STORAGE_KEY = "kilo.history.favorites.v1"

interface SessionStats {
  cost: number
  tokens: number
  model: string
  durationMs: number
  hasChanges: boolean
}

function dateGroupKey(iso: string): (typeof DATE_GROUP_KEYS)[number] {
  const now = new Date()
  const then = new Date(iso)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)

  if (then >= today) return DATE_GROUP_KEYS[0]
  if (then >= yesterday) return DATE_GROUP_KEYS[1]
  if (then >= weekAgo) return DATE_GROUP_KEYS[2]
  if (then >= monthAgo) return DATE_GROUP_KEYS[3]
  return DATE_GROUP_KEYS[4]
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60

  if (hours > 0) {
    return `${hours}h ${remMinutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(4)}`
}

function formatDiffSummary(additions: number, deletions: number): string {
  return `+${additions.toLocaleString()} / -${deletions.toLocaleString()}`
}

function extractMessageTokens(messages: Message[]): number {
  let total = 0
  for (const message of messages) {
    if (message.role !== "assistant" || !message.tokens) {
      continue
    }
    total +=
      message.tokens.input +
      message.tokens.output +
      (message.tokens.reasoning ?? 0) +
      (message.tokens.cache?.read ?? 0) +
      (message.tokens.cache?.write ?? 0)
  }
  return total
}

function buildRelevanceScore(sessionInfo: SessionInfo, stats: SessionStats, query: string): number {
  const title = (sessionInfo.title || "").toLowerCase()
  const model = stats.model.toLowerCase()
  const id = sessionInfo.id.toLowerCase()
  let score = 0

  if (title === query) score += 1200
  if (title.startsWith(query)) score += 600
  if (title.includes(query)) score += 350
  if (model.includes(query)) score += 120
  if (id.includes(query)) score += 80

  score += Math.min(stats.tokens / 1000, 40)

  return score
}

interface SessionListProps {
  onSelectSession: (id: string) => void
  onBack?: () => void
}

const SessionList: Component<SessionListProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const dialog = useDialog()

  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal("")
  const [searchQuery, setSearchQuery] = createSignal("")
  const [sortOption, setSortOption] = createSignal<SortOption>("newest")
  const [lastNonRelevantSort, setLastNonRelevantSort] = createSignal<Exclude<SortOption, "mostRelevant">>("newest")
  const [showFilters, setShowFilters] = createSignal(false)
  const [showChangedOnly, setShowChangedOnly] = createSignal(false)
  const [workspaceScope, setWorkspaceScope] = createSignal<"current" | "all">("current")
  const [showFavoritesOnly, setShowFavoritesOnly] = createSignal(false)
  const [favoriteSessionIds, setFavoriteSessionIds] = createSignal<string[]>([])
  const [selectionMode, setSelectionMode] = createSignal(false)
  const [selectedSessionIds, setSelectedSessionIds] = createSignal<string[]>([])
  const [pageIndex, setPageIndex] = createSignal(0)

  onMount(() => {
    console.log("[Kilo New] SessionList mounted, loading sessions")
    session.loadSessions()
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setFavoriteSessionIds(parsed.filter((value): value is string => typeof value === "string"))
      }
    } catch {
      // Ignore malformed localStorage values.
    }
  })

  createEffect(() => {
    const query = searchQuery().trim()
    const currentSort = sortOption()

    if (query.length > 0 && currentSort !== "mostRelevant") {
      setLastNonRelevantSort(currentSort as Exclude<SortOption, "mostRelevant">)
      setSortOption("mostRelevant")
      return
    }

    if (query.length === 0 && currentSort === "mostRelevant") {
      setSortOption(lastNonRelevantSort())
    }
  })

  createEffect(() => {
    const validIds = new Set(session.sessions().map((item) => item.id))
    setSelectedSessionIds((previous) => previous.filter((id) => validIds.has(id)))
    setFavoriteSessionIds((previous) => previous.filter((id) => validIds.has(id)))
  })

  createEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteSessionIds()))
    } catch {
      // Ignore localStorage write errors.
    }
  })

  createEffect(() => {
    searchQuery()
    sortOption()
    showChangedOnly()
    workspaceScope()
    showFavoritesOnly()
    setPageIndex(0)
  })

  const historyStatus = createMemo(() => {
    if (session.sessionsLoading()) {
      return language.t("session.history.status.refreshing")
    }

    if (session.sessionsLoadError()) {
      return language.t("session.history.status.error", { error: session.sessionsLoadError() ?? "" })
    }

    if (session.sessionsLoadedAt()) {
      return language.t("session.history.status.syncedAt", {
        time: new Date(session.sessionsLoadedAt()!).toLocaleTimeString(),
      })
    }

    return language.t("session.history.status.sourceBackend")
  })

  const emptyHistoryMessage = createMemo(() => {
    if (session.sessionsLoadedAt()) {
      return language.t("session.history.empty.fromCli")
    }
    return language.t("session.empty")
  })

  const sessionStats = createMemo(() => {
    const map = new Map<string, SessionStats>()
    for (const item of session.sessions()) {
      const metadata = session.getSessionMetadata(item.id)
      const messages = session.getSessionMessages(item.id)
      const tokenCount = extractMessageTokens(messages)
      const summary = item.summary
      map.set(item.id, {
        cost: metadata?.cost ?? item.metadata?.cost ?? 0,
        tokens: tokenCount > 0 ? tokenCount : item.metadata?.messageCount ?? messages.length,
        model: metadata?.model ?? item.metadata?.model ?? "",
        durationMs: metadata?.durationMs ?? 0,
        hasChanges:
          (summary?.files ?? 0) > 0 || (summary?.additions ?? 0) > 0 || (summary?.deletions ?? 0) > 0,
      })
    }
    return map
  })

  const filteredSessions = createMemo(() => {
    const query = searchQuery().trim().toLowerCase()
    const stats = sessionStats()
    const currentSort = sortOption()
    let items = session.sessions()

    if (showChangedOnly()) {
      items = items.filter((item) => stats.get(item.id)?.hasChanges)
    }

    if (showFavoritesOnly()) {
      const favorites = new Set(favoriteSessionIds())
      items = items.filter((item) => favorites.has(item.id))
    }

    if (query.length > 0) {
      items = items.filter((item) => {
        const model = stats.get(item.id)?.model.toLowerCase() ?? ""
        const title = (item.title || "").toLowerCase()
        const id = item.id.toLowerCase()
        return title.includes(query) || model.includes(query) || id.includes(query)
      })
    }

    return [...items].sort((a, b) => {
      const aStats = stats.get(a.id)
      const bStats = stats.get(b.id)
      const updatedDelta = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      const fallback = updatedDelta !== 0 ? updatedDelta : a.id.localeCompare(b.id)

      if (!aStats || !bStats) {
        return fallback
      }

      if (currentSort === "oldest") {
        const delta = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        return delta !== 0 ? delta : a.id.localeCompare(b.id)
      }

      if (currentSort === "mostExpensive") {
        const delta = bStats.cost - aStats.cost
        return delta !== 0 ? delta : fallback
      }

      if (currentSort === "mostTokens") {
        const delta = bStats.tokens - aStats.tokens
        return delta !== 0 ? delta : fallback
      }

      if (currentSort === "mostRelevant" && query.length > 0) {
        const delta = buildRelevanceScore(b, bStats, query) - buildRelevanceScore(a, aStats, query)
        return delta !== 0 ? delta : fallback
      }

      return fallback
    })
  })

  const shouldGroupByDate = createMemo(() => sortOption() === "newest" || sortOption() === "oldest")

  const totalItems = createMemo(() => filteredSessions().length)
  const pageCount = createMemo(() => Math.max(1, Math.ceil(totalItems() / PAGE_SIZE)))

  createEffect(() => {
    const maxIndex = Math.max(0, pageCount() - 1)
    if (pageIndex() > maxIndex) {
      setPageIndex(maxIndex)
    }
  })

  const pagedSessions = createMemo(() => {
    const start = pageIndex() * PAGE_SIZE
    return filteredSessions().slice(start, start + PAGE_SIZE)
  })

  const selectedSet = createMemo(() => new Set(selectedSessionIds()))
  const favoritesSet = createMemo(() => new Set(favoriteSessionIds()))
  const selectedCount = createMemo(() => selectedSessionIds().length)

  const allVisibleSelected = createMemo(() => {
    const visible = pagedSessions()
    if (visible.length === 0) {
      return false
    }
    const selected = selectedSet()
    return visible.every((item) => selected.has(item.id))
  })

  const visibleSelectedCount = createMemo(() => {
    const selected = selectedSet()
    return pagedSessions().reduce((count, item) => (selected.has(item.id) ? count + 1 : count), 0)
  })

  const currentSession = (): SessionInfo | undefined => {
    const id = session.currentSessionID()
    return session.sessions().find((item) => item.id === id)
  }

  const sortOptions = createMemo(() =>
    (searchQuery().trim().length > 0 ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option !== "mostRelevant")).map(
      (option) => ({
        value: option,
        label: language.t(`session.history.sort.${option}`),
      }),
    ),
  )

  const currentSortOption = createMemo(
    () => sortOptions().find((option) => option.value === sortOption()) ?? sortOptions()[0],
  )

  const copySessionId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      showToast({ variant: "success", title: language.t("session.history.toast.copyId.success") })
    } catch {
      showToast({ variant: "error", title: language.t("session.history.toast.copyId.failed") })
    }
  }

  const toggleSessionSelection = (sessionID: string) => {
    setSelectedSessionIds((previous) =>
      previous.includes(sessionID) ? previous.filter((id) => id !== sessionID) : [...previous, sessionID],
    )
  }

  const toggleFavorite = (sessionID: string) => {
    setFavoriteSessionIds((previous) =>
      previous.includes(sessionID) ? previous.filter((id) => id !== sessionID) : [...previous, sessionID],
    )
  }

  const clearSelection = () => {
    setSelectedSessionIds([])
  }

  const toggleSelectionMode = () => {
    if (selectionMode()) {
      clearSelection()
    }
    setSelectionMode((value) => !value)
  }

  const toggleSelectAllVisible = () => {
    const visibleIds = pagedSessions().map((item) => item.id)
    if (visibleIds.length === 0) {
      return
    }
    if (allVisibleSelected()) {
      setSelectedSessionIds((previous) => previous.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedSessionIds((previous) => Array.from(new Set([...previous, ...visibleIds])))
  }

  function startRename(item: SessionInfo) {
    setRenamingId(item.id)
    setRenameValue(item.title || "")
  }

  function saveRename() {
    const id = renamingId()
    const title = renameValue().trim()
    if (!id || !title) {
      cancelRename()
      return
    }
    const existing = session.sessions().find((item) => item.id === id)
    if (!existing || title !== (existing.title || "")) {
      session.renameSession(id, title)
    }
    setRenamingId(null)
    setRenameValue("")
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue("")
  }

  function confirmDelete(item: SessionInfo) {
    dialog.show(() => (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("session.delete.confirm", { name: item.title || language.t("session.untitled") })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.deleteSession(item.id)
                dialog.close()
              }}
            >
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  function confirmBatchDelete() {
    const ids = selectedSessionIds()
    if (ids.length === 0) {
      return
    }

    dialog.show(() => (
      <Dialog title={language.t("session.history.deleteSelected.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("session.history.deleteSelected.confirm", { count: ids.length })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                for (const id of ids) {
                  session.deleteSession(id)
                }
                clearSelection()
                dialog.close()
              }}
            >
              {language.t("common.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  function wrapItem(item: SessionInfo, node: JSX.Element): JSX.Element {
    if (selectionMode()) {
      return node
    }

    return (
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          {node}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => props.onSelectSession(item.id)}>
              <ContextMenu.ItemLabel title={language.t("session.history.context.resume")}>
                {language.t("session.history.context.resume")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => void copySessionId(item.id)}>
              <ContextMenu.ItemLabel title={language.t("session.history.context.copyId")}>
                {language.t("session.history.context.copyId")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => toggleFavorite(item.id)}>
              <ContextMenu.ItemLabel title={language.t("session.history.filters.favoritesOnly")}>
                {favoritesSet().has(item.id)
                  ? language.t("session.history.favorites.remove")
                  : language.t("session.history.favorites.add")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => startRename(item)}>
              <ContextMenu.ItemLabel title={language.t("common.rename")}>{language.t("common.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => confirmDelete(item)}>
              <ContextMenu.ItemLabel title={language.t("common.delete")}>{language.t("common.delete")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    )
  }

  return (
    <div class="session-list">
      <div class="session-history-header">
        <div class="session-history-header-main">
          <Show when={props.onBack}>
            <Button
              size="small"
              variant="ghost"
              class="session-history-back-button"
              onClick={() => props.onBack?.()}
              aria-label={language.t("common.goBack")}
              title={language.t("common.goBack")}
            >
              <Icon name="arrow-left" />
            </Button>
          </Show>
          <h2 class="session-history-header-title">{language.t("session.history.title")}</h2>
        </div>
        <div class="session-history-header-actions">
          <span class="session-history-status-text">{historyStatus()}</span>
          <Tooltip value={language.t("common.refresh")} placement="top">
            <Button
              size="small"
              variant="ghost"
              onClick={() => session.loadSessions()}
              disabled={session.sessionsLoading()}
            >
              {language.t("common.refresh")}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div class="session-history-controls">
        <TextField
          value={searchQuery()}
          onChange={setSearchQuery}
          placeholder={language.t("session.search.placeholder")}
          style={{ width: "100%" }}
        />
        <div class="session-history-control-actions">
          <Button size="small" variant={showFilters() ? "primary" : "secondary"} onClick={() => setShowFilters((v) => !v)}>
            <span class="session-history-control-icon" aria-hidden="true">
              ⌕
            </span>
            {language.t("session.history.controls.filters")}
            <span class={`session-history-control-caret${showFilters() ? " is-open" : ""}`} aria-hidden="true">
              ▾
            </span>
          </Button>
          <Button size="small" variant={selectionMode() ? "primary" : "secondary"} onClick={toggleSelectionMode}>
            <span class="session-history-control-icon" aria-hidden="true">
              {selectionMode() ? "✓" : "☰"}
            </span>
            {selectionMode() ? language.t("common.done") : language.t("session.history.controls.select")}
          </Button>
        </div>
      </div>

      <Show when={showFilters()}>
        <div class="session-history-filters">
          <div class="session-history-filter-row">
            <span class="session-history-filter-label">{language.t("session.history.filters.workspace")}</span>
            <div class="session-history-filter-chip-row">
              <Button
                size="small"
                variant={workspaceScope() === "current" ? "primary" : "secondary"}
                onClick={() => setWorkspaceScope("current")}
              >
                {language.t("session.history.filters.workspace.current")}
              </Button>
              <Button
                size="small"
                variant={workspaceScope() === "all" ? "primary" : "secondary"}
                onClick={() => setWorkspaceScope("all")}
              >
                {language.t("session.history.filters.workspace.all")}
              </Button>
            </div>
          </div>
          <div class="session-history-filter-row">
            <span class="session-history-filter-label">{language.t("session.history.filters.sort")}</span>
            <Select
              options={sortOptions()}
              current={currentSortOption()}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => {
                if (!option) return
                if (option.value !== "mostRelevant") {
                  setLastNonRelevantSort(option.value)
                }
                setSortOption(option.value)
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </div>
          <div class="session-history-filter-chip-row">
            <Button
              size="small"
              variant={showFavoritesOnly() ? "primary" : "secondary"}
              onClick={() => setShowFavoritesOnly((value) => !value)}
            >
              {language.t("session.history.filters.favoritesOnly")}
            </Button>
          </div>
          <Button size="small" variant={showChangedOnly() ? "primary" : "secondary"} onClick={() => setShowChangedOnly((v) => !v)}>
            {showChangedOnly()
              ? language.t("session.history.filters.showingChanged")
              : language.t("session.history.filters.changedOnly")}
          </Button>
        </div>
      </Show>

      <Show when={selectionMode()}>
        <div class="session-history-selection-bar">
          <div class="session-history-selection-summary">
            <Button size="small" variant="ghost" class="session-history-select-visible-btn" onClick={toggleSelectAllVisible}>
              <span
                class={`session-history-visible-checkbox${allVisibleSelected() ? " is-checked" : ""}`}
                aria-hidden="true"
              >
                {allVisibleSelected() ? "✓" : ""}
              </span>
              {allVisibleSelected()
                ? language.t("session.history.selection.deselectVisible")
                : language.t("session.history.selection.selectVisible")}
            </Button>
            <span>
              {language.t("session.history.selection.summary", {
                selected: selectedCount(),
                visibleSelected: visibleSelectedCount(),
                visible: pagedSessions().length,
              })}
            </span>
          </div>
          <div class="session-history-selection-actions">
            <Button size="small" variant="ghost" onClick={clearSelection} disabled={selectedCount() === 0}>
              {language.t("session.history.selection.clear")}
            </Button>
            <Button size="small" variant="primary" onClick={confirmBatchDelete} disabled={selectedCount() === 0}>
              {language.t("common.delete")}
            </Button>
          </div>
        </div>
      </Show>

      <div class="session-history-list-region">
        <List<SessionInfo>
          class="session-history-list"
          items={pagedSessions()}
          key={(item) => item.id}
          current={selectionMode() ? undefined : currentSession()}
          onSelect={(item) => {
            if (!item || renamingId() === item.id) {
              return
            }
            if (selectionMode()) {
              toggleSessionSelection(item.id)
              return
            }
            props.onSelectSession(item.id)
          }}
          emptyMessage={emptyHistoryMessage()}
          groupBy={(item) => (shouldGroupByDate() ? language.t(dateGroupKey(item.updatedAt)) : "")}
          sortGroupsBy={(a, b) => {
            if (!shouldGroupByDate()) {
              return 0
            }
            const rank = Object.fromEntries(DATE_GROUP_KEYS.map((key, index) => [language.t(key), index]))
            if (sortOption() === "oldest") {
              return (rank[b.category] ?? 99) - (rank[a.category] ?? 99)
            }
            return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
          }}
          itemWrapper={wrapItem}
        >
          {(item) => (
            <Show
              when={renamingId() === item.id}
              fallback={
                <>
                  <div class="session-list-item-main">
                    <Show when={selectionMode()}>
                      <span class={`session-list-select-pill${selectedSet().has(item.id) ? " selected" : ""}`} aria-hidden="true">
                        {selectedSet().has(item.id) ? "✓" : ""}
                      </span>
                    </Show>
                    <span data-slot="list-item-title" title={item.title || language.t("session.untitled")}>
                      {item.title || language.t("session.untitled")}
                    </span>
                    <span data-slot="list-item-description" title={new Date(item.updatedAt).toLocaleString()}>
                      {formatRelativeDate(item.updatedAt)}
                    </span>
                  </div>
                  <div class="session-list-item-meta">
                    <button
                      type="button"
                      class={`session-favorite-btn${favoritesSet().has(item.id) ? " is-active" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleFavorite(item.id)
                      }}
                      aria-label={
                        favoritesSet().has(item.id)
                          ? language.t("session.history.favorites.remove")
                          : language.t("session.history.favorites.mark")
                      }
                      title={
                        favoritesSet().has(item.id)
                          ? language.t("session.history.favorites.remove")
                          : language.t("session.history.favorites.mark")
                      }
                    >
                      {favoritesSet().has(item.id) ? "★" : "☆"}
                    </button>
                    <span class="session-meta-pill" title={language.t("session.history.meta.duration")}>
                      {formatDuration(sessionStats().get(item.id)?.durationMs ?? 0)}
                    </span>
                    <Show when={sessionStats().get(item.id)?.cost}>
                      {(cost) => (
                        <span class="session-meta-pill" title={language.t("session.history.meta.cost")}>
                          {formatCost(cost())}
                        </span>
                      )}
                    </Show>
                    <Show when={sessionStats().get(item.id)?.model}>
                      {(model) => (
                        <span class="session-meta-pill" title={model()}>
                          {model()}
                        </span>
                      )}
                    </Show>
                    <Show when={item.summary}>
                      {(summary) => (
                        <>
                          <Show when={summary().files > 0}>
                            <span class="session-meta-pill" title={language.t("session.history.meta.changedFiles")}>
                              {language.t("session.history.meta.filesCount", { count: summary().files })}
                            </span>
                          </Show>
                          <Show when={summary().additions > 0 || summary().deletions > 0}>
                            <span class="session-meta-pill" title={language.t("session.history.meta.lineChanges")}>
                              {formatDiffSummary(summary().additions, summary().deletions)}
                            </span>
                          </Show>
                        </>
                      )}
                    </Show>
                  </div>
                </>
              }
            >
              <InlineInput
                ref={(el) => requestAnimationFrame(() => el?.focus())}
                value={renameValue()}
                onInput={(event) => setRenameValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === "Enter") {
                    event.preventDefault()
                    saveRename()
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    cancelRename()
                  }
                }}
                onBlur={() => saveRename()}
                style={{ width: "100%" }}
              />
            </Show>
          )}
        </List>
      </div>

      <div class="session-history-pagination">
        <span class="session-history-pagination-label">
          {language.t("session.history.pagination.page", { page: pageIndex() + 1, count: pageCount() })}
        </span>
        <div class="session-history-pagination-actions">
          <Button
            size="small"
            variant="secondary"
            class="session-history-pagination-button"
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
            disabled={pageCount() <= 1 || pageIndex() <= 0}
            aria-label={language.t("session.history.pagination.previous")}
            title={language.t("session.history.pagination.previous")}
          >
            <span class="session-history-pagination-icon" aria-hidden="true">
              ‹
            </span>
          </Button>
          <Button
            size="small"
            variant="secondary"
            class="session-history-pagination-button"
            onClick={() => setPageIndex((index) => Math.min(pageCount() - 1, index + 1))}
            disabled={pageCount() <= 1 || pageIndex() >= pageCount() - 1}
            aria-label={language.t("session.history.pagination.next")}
            title={language.t("session.history.pagination.next")}
          >
            <span class="session-history-pagination-icon" aria-hidden="true">
              ›
            </span>
          </Button>
        </div>
      </div>

      <Show when={selectionMode() && selectedCount() > 0}>
        <div class="session-history-selection-footer">
          <span class="session-history-selection-footer-count">
            {language.t("session.history.selection.summary", {
              selected: selectedCount(),
              visibleSelected: visibleSelectedCount(),
              visible: pagedSessions().length,
            })}
          </span>
          <div class="session-history-selection-footer-actions">
            <Button size="small" variant="secondary" onClick={clearSelection}>
              <span aria-hidden="true">×</span>
              {language.t("session.history.selection.clear")}
            </Button>
            <Button size="small" variant="primary" onClick={confirmBatchDelete}>
              <span aria-hidden="true">⌫</span>
              {language.t("common.delete")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default SessionList
