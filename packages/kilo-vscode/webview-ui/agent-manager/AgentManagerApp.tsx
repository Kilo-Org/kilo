// Agent Manager root component

import { Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import type {
  ExtensionMessage,
  AgentManagerSessionMetaMessage,
  AgentManagerRepoInfoMessage,
  AgentManagerWorktreeSetupMessage,
} from "../src/types/messages"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { VSCodeProvider, useVSCode } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { SessionProvider, useSession } from "../src/context/session"
import { WorktreeModeProvider, useWorktreeMode, type SessionMode } from "../src/context/worktree-mode"
import { ChatView } from "../src/components/chat"
import { LanguageBridge, DataBridge } from "../src/App"
import { formatRelativeDate } from "../src/utils/date"
import { resolveNavigation, validateLocalSession } from "./navigate"
import "./agent-manager.css"

interface WorktreeMeta {
  mode: SessionMode
  branch?: string
  path?: string
  parentBranch?: string
}

interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
}

const AgentManagerContent: Component = () => {
  const session = useSession()
  const vscode = useVSCode()
  const worktreeMode = useWorktreeMode()!

  const [sessionMeta, setSessionMeta] = createSignal<Record<string, WorktreeMeta>>({})
  const [setup, setSetup] = createSignal<SetupState>({ active: false, message: "" })
  const [repoBranch, setRepoBranch] = createSignal<string | undefined>()

  // Recover persisted local session ID from webview state
  const persisted = vscode.getState<{ localSessionID?: string }>()
  const [localSessionID, setLocalSessionID] = createSignal<string | undefined>(persisted?.localSessionID)

  // Whether the user is viewing the local workspace
  const [onLocal, setOnLocal] = createSignal(true)

  const isLocal = () => {
    const lid = localSessionID()
    const current = session.currentSessionID()
    if (onLocal() && !current) return true
    if (lid && current === lid) return true
    return false
  }

  // Sessions list excludes the local session
  const sorted = createMemo(() =>
    [...session.sessions()]
      .filter((s) => s.id !== localSessionID())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  )

  const selectLocal = () => {
    setOnLocal(true)
    // Request fresh branch info — cheap git rev-parse, ensures branch name
    // is current even if the user switched branches in an external terminal
    vscode.postMessage({ type: "agentManager.requestRepoInfo" })
    const lid = localSessionID()
    if (lid) {
      session.selectSession(lid)
    } else {
      session.clearCurrentSession()
    }
  }

  const navigate = (direction: "up" | "down") => {
    const ids = sorted().map((s) => s.id)
    const current = isLocal() ? undefined : session.currentSessionID()
    const result = resolveNavigation(direction, current, ids)
    if (result.action === "local") selectLocal()
    else if (result.action === "select") {
      setOnLocal(false)
      session.selectSession(result.id)
    }
  }

  onMount(() => {
    // Keyboard navigation for session list
    const handler = (event: MessageEvent) => {
      const msg = event.data as ExtensionMessage
      if (msg?.type !== "action") return
      if (msg.action === "sessionPrevious") navigate("up")
      else if (msg.action === "sessionNext") navigate("down")
    }
    window.addEventListener("message", handler)

    // When a session is created while the user is on local with no local
    // session yet, adopt it. The session context sets currentSessionID before
    // this listener fires, so we also re-assert onLocal to keep the sidebar
    // highlight on the local item rather than the SESSIONS list.
    const unsubCreate = vscode.onMessage((msg) => {
      if (msg.type === "sessionCreated" && onLocal() && !localSessionID()) {
        const created = msg as { type: string; session: { id: string } }
        setLocalSessionID(created.session.id)
        setOnLocal(true)
      }
    })

    // Worktree metadata and setup progress messages
    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "agentManager.sessionMeta") {
        const meta = msg as AgentManagerSessionMetaMessage
        setSessionMeta((prev) => ({
          ...prev,
          [meta.sessionId]: {
            mode: meta.mode,
            branch: meta.branch,
            path: meta.path,
            parentBranch: meta.parentBranch,
          },
        }))
      }

      if (msg.type === "agentManager.repoInfo") {
        const info = msg as AgentManagerRepoInfoMessage
        setRepoBranch(info.branch)
      }

      if (msg.type === "agentManager.worktreeSetup") {
        const ev = msg as AgentManagerWorktreeSetupMessage
        if (ev.status === "ready" || ev.status === "error") {
          const error = ev.status === "error"
          setSetup({ active: true, message: ev.message, branch: ev.branch, error })
          globalThis.setTimeout(() => setSetup({ active: false, message: "" }), error ? 3000 : 500)
        } else {
          setSetup({ active: true, message: ev.message, branch: ev.branch })
        }
      }
    })

    onCleanup(() => {
      window.removeEventListener("message", handler)
      unsubCreate()
      unsub()
    })
  })

  // Persist local session ID to webview state for recovery
  createEffect(() => {
    const lid = localSessionID()
    vscode.setState({ localSessionID: lid })
  })

  // Invalidate persisted local session ID if it no longer exists (e.g. server
  // restarted, session expired). Without this the UI would get stuck selecting a
  // ghost session on recovery.
  createEffect(() => {
    const all = session.sessions()
    if (all.length === 0) return // sessions not loaded yet
    const lid = localSessionID()
    if (!lid) return
    const valid = validateLocalSession(
      lid,
      all.map((s) => s.id),
    )
    if (!valid) {
      setLocalSessionID(undefined)
      session.clearCurrentSession()
    }
  })

  // Reset worktree mode when no session is selected
  createEffect(() => {
    if (!session.currentSessionID()) worktreeMode.setMode("local")
  })

  // If we have a persisted local session, select it on mount
  onMount(() => {
    const lid = localSessionID()
    if (lid) session.selectSession(lid)
  })

  const getMeta = (sessionId: string): WorktreeMeta | undefined => sessionMeta()[sessionId]

  return (
    <div class="am-layout">
      <div class="am-sidebar">
        <div class="am-sidebar-header">AGENT MANAGER</div>
        <Button
          variant="primary"
          size="large"
          onClick={() => {
            setOnLocal(false)
            session.clearCurrentSession()
          }}
        >
          + New Agent
        </Button>
        <button class={`am-local-item ${isLocal() ? "am-local-item-active" : ""}`} onClick={() => selectLocal()}>
          <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
            <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
            <path d="M10 13.5V16.5" stroke="currentColor" />
          </svg>
          <div class="am-local-text">
            <span class="am-local-label">local</span>
            <Show when={repoBranch()}>
              <span class="am-local-branch">{repoBranch()}</span>
            </Show>
          </div>
        </button>
        <div class="am-sessions-header">SESSIONS</div>
        <div class="am-list">
          <For each={sorted()}>
            {(s) => {
              const meta = () => getMeta(s.id)
              return (
                <button
                  class={`am-item ${!isLocal() && s.id === session.currentSessionID() ? "am-item-active" : ""}`}
                  onClick={() => {
                    setOnLocal(false)
                    session.selectSession(s.id)
                  }}
                >
                  <span class="am-item-title">
                    {s.title || "Untitled"}
                    <Show when={meta()?.mode === "worktree"}>
                      <span class="am-worktree-badge" title={meta()?.branch}>
                        <Icon name="branch" size="small" />
                        {meta()?.branch}
                      </span>
                    </Show>
                  </span>
                  <span class="am-item-time">{formatRelativeDate(s.updatedAt)}</span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
      <div class="am-detail">
        <Show when={setup().active}>
          <div class="am-setup-overlay">
            <div class="am-setup-card">
              <Icon name="branch" size="large" />
              <div class="am-setup-title">Setting up workspace</div>
              <Show when={setup().branch}>
                <div class="am-setup-branch">{setup().branch}</div>
              </Show>
              <div class="am-setup-status">
                <Show when={!setup().error} fallback={<Icon name="circle-x" size="small" />}>
                  <Spinner class="am-setup-spinner" />
                </Show>
                <span>{setup().message}</span>
              </div>
            </div>
          </div>
        </Show>
        <ChatView
          onSelectSession={(id) => {
            setOnLocal(false)
            session.selectSession(id)
          }}
        />
      </div>
    </div>
  )
}

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <SessionProvider>
                          <WorktreeModeProvider>
                            <DataBridge>
                              <AgentManagerContent />
                            </DataBridge>
                          </WorktreeModeProvider>
                        </SessionProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
