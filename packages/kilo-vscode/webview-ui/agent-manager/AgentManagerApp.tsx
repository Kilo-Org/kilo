// Agent Manager root component

import { Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import type {
  ExtensionMessage,
  AgentManagerSessionMetaMessage,
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

  const sorted = createMemo(() =>
    [...session.sessions()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  )

  const navigate = (direction: "up" | "down") => {
    const list = sorted()
    if (list.length === 0) return
    const current = session.currentSessionID()
    const idx = current ? list.findIndex((s) => s.id === current) : -1
    const next = direction === "up" ? idx - 1 : idx + 1
    if (next < 0 || next >= list.length) return
    session.selectSession(list[next]!.id)
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
      unsub()
    })
  })

  // Reset mode when session is cleared
  createEffect(() => {
    if (!session.currentSessionID()) worktreeMode.setMode("local")
  })

  const getMeta = (sessionId: string): WorktreeMeta | undefined => sessionMeta()[sessionId]

  return (
    <div class="am-layout">
      <div class="am-sidebar">
        <div class="am-sidebar-header">AGENT MANAGER</div>
        <Button variant="primary" size="large" onClick={() => session.clearCurrentSession()}>
          + New Agent
        </Button>
        <div class="am-sessions-header">SESSIONS</div>
        <div class="am-list">
          <For each={sorted()}>
            {(s) => {
              const meta = () => getMeta(s.id)
              return (
                <button
                  class={`am-item ${s.id === session.currentSessionID() ? "am-item-active" : ""}`}
                  onClick={() => session.selectSession(s.id)}
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
        <ChatView onSelectSession={(id) => session.selectSession(id)} />
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
