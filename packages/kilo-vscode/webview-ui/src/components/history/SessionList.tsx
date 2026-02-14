/**
 * SessionList component
 * Displays all sessions grouped by date, with context menu for rename/delete.
 * Uses kilo-ui List component for keyboard navigation and accessibility.
 */

import { Component, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { List } from "@kilocode/kilo-ui/list"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { InlineInput } from "@kilocode/kilo-ui/inline-input"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { formatRelativeDate } from "../../utils/date"
import type { SessionInfo } from "../../types/messages"

const DATE_GROUP_KEYS = ["time.today", "time.yesterday", "time.thisWeek", "time.thisMonth", "time.older"] as const

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
  return `+${additions.toLocaleString("en-US")} / -${deletions.toLocaleString("en-US")}`
}

interface SessionListProps {
  onSelectSession: (id: string) => void
}

const SessionList: Component<SessionListProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const dialog = useDialog()

  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameValue, setRenameValue] = createSignal("")

  onMount(() => {
    console.log("[Kilo New] SessionList mounted, loading sessions")
    session.loadSessions()
  })

  const historyStatus = createMemo(() => {
    if (session.sessionsLoading()) {
      return "Refreshing session history from CLI storage..."
    }

    if (session.sessionsLoadError()) {
      return `History refresh error: ${session.sessionsLoadError()}`
    }

    if (session.sessionsLoadedAt()) {
      return `History synced at ${new Date(session.sessionsLoadedAt()!).toLocaleTimeString()}`
    }

    return "Session history is sourced from the CLI backend."
  })

  const emptyHistoryMessage = createMemo(() => {
    if (session.sessionsLoadedAt()) {
      return "No sessions returned by CLI storage yet. If you expected prior history after restart, click Refresh."
    }
    return language.t("session.empty")
  })

  const copySessionId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      showToast({ variant: "success", title: "Session ID copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy session ID" })
    }
  }

  const currentSession = (): SessionInfo | undefined => {
    const id = session.currentSessionID()
    return session.sessions().find((s) => s.id === id)
  }

  function startRename(s: SessionInfo) {
    setRenamingId(s.id)
    setRenameValue(s.title || "")
  }

  function saveRename() {
    const id = renamingId()
    const title = renameValue().trim()
    if (!id || !title) {
      cancelRename()
      return
    }
    const existing = session.sessions().find((s) => s.id === id)
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

  function confirmDelete(s: SessionInfo) {
    dialog.show(() => (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="dialog-confirm-body">
          <span>{language.t("session.delete.confirm", { name: s.title || language.t("session.untitled") })}</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.deleteSession(s.id)
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

  function wrapItem(item: SessionInfo, node: JSX.Element): JSX.Element {
    return (
      <ContextMenu>
        <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
          {node}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => props.onSelectSession(item.id)}>
              <ContextMenu.ItemLabel title="Resume session">Resume</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => void copySessionId(item.id)}>
              <ContextMenu.ItemLabel title="Copy session ID">Copy Session ID</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => startRename(item)}>
              <ContextMenu.ItemLabel title="Rename session">{language.t("common.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => confirmDelete(item)}>
              <ContextMenu.ItemLabel title="Delete session">{language.t("common.delete")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    )
  }

  return (
    <div class="session-list">
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          gap: "8px",
          padding: "8px 0",
        }}
      >
        <span style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>{historyStatus()}</span>
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
      <List<SessionInfo>
        items={session.sessions()}
        key={(s) => s.id}
        filterKeys={["title"]}
        current={currentSession()}
        onSelect={(s) => {
          if (s && renamingId() !== s.id) {
            props.onSelectSession(s.id)
          }
        }}
        search={{ placeholder: language.t("session.search.placeholder"), autofocus: false }}
        emptyMessage={emptyHistoryMessage()}
        groupBy={(s) => language.t(dateGroupKey(s.updatedAt))}
        sortGroupsBy={(a, b) => {
          const rank = Object.fromEntries(DATE_GROUP_KEYS.map((k, i) => [language.t(k), i]))
          return (rank[a.category] ?? 99) - (rank[b.category] ?? 99)
        }}
        itemWrapper={wrapItem}
      >
        {(s) => (
          <Show
            when={renamingId() === s.id}
            fallback={
              <>
                <div class="session-list-item-main">
                  <span data-slot="list-item-title" title={s.title || language.t("session.untitled")}>
                    {s.title || language.t("session.untitled")}
                  </span>
                  <span data-slot="list-item-description" title={new Date(s.updatedAt).toLocaleString()}>
                    {formatRelativeDate(s.updatedAt)}
                  </span>
                </div>
                <div class="session-list-item-meta">
                  <span class="session-meta-pill" title="Session duration">
                    {formatDuration(session.getSessionMetadata(s.id)?.durationMs ?? 0)}
                  </span>
                  <Show when={session.getSessionMetadata(s.id)?.cost}>
                    {(cost) => (
                      <span class="session-meta-pill" title="Session cost">
                        {formatCost(cost())}
                      </span>
                    )}
                  </Show>
                  <Show when={session.getSessionMetadata(s.id)?.model}>
                    {(model) => (
                      <span class="session-meta-pill" title={model()}>
                        {model()}
                      </span>
                    )}
                  </Show>
                  <Show when={s.summary}>
                    {(summary) => (
                      <>
                        <Show when={summary().files > 0}>
                          <span class="session-meta-pill" title="Changed files">
                            {summary().files} files
                          </span>
                        </Show>
                        <Show when={summary().additions > 0 || summary().deletions > 0}>
                          <span class="session-meta-pill" title="Line changes">
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
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") {
                  e.preventDefault()
                  saveRename()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
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
  )
}

export default SessionList
