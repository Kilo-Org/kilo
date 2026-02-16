import { Component, createSignal, createMemo, createEffect, Switch, Match, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { Toast } from "@kilocode/kilo-ui/toast"
import Settings from "./components/Settings"
import ProfileView from "./components/ProfileView"
import LoadingPanel from "./components/LoadingPanel"
import ErrorPanel from "./components/ErrorPanel"
import MarketplaceView from "./components/MarketplaceView"
import { VSCodeProvider, useVSCode } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider, useLanguage } from "./context/language"
import { ChatView } from "./components/chat"
import SessionList from "./components/history/SessionList"
import type {
  Message as SDKMessage,
  Part as SDKPart,
  Session as SDKSession,
  SessionStatus as SDKSessionStatus,
  PermissionRequest as SDKPermissionRequest,
  QuestionRequest as SDKQuestionRequest,
} from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings"
type MarketplaceTabType = "mcp" | "mode" | "skill"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "profile", "settings"])
const VALID_MARKETPLACE_TABS = new Set<MarketplaceTabType>(["mcp", "mode", "skill"])

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 */
const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()

  const toEpoch = (value: string): number => {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : Date.now()
  }

  const toSDKSessionStatus = (status: "idle" | "busy" | "retry"): SDKSessionStatus => {
    if (status === "idle") {
      return { type: "idle" }
    }
    // Current webview session status is simplified and does not carry retry metadata.
    return { type: "busy" }
  }

  const data = createMemo(() => {
    const sessions = session.sessions()
    const currentId = session.currentSessionID()
    const sessionIds = [...new Set([...sessions.map((s) => s.id), ...(currentId ? [currentId] : [])])]

    const messageEntries: Array<[string, SDKMessage[]]> = sessionIds.map((sessionID) => [
      sessionID,
      session.getSessionMessages(sessionID) as unknown as SDKMessage[],
    ])

    const partEntries: Array<[string, SDKPart[]]> = messageEntries
      .flatMap(([, messages]) => messages)
      .map((msg) => [msg.id, session.getParts(msg.id) as unknown as SDKPart[]] as [string, SDKPart[]])
      .filter(([, parts]) => parts.length > 0)

    const permissionsBySession: Record<string, SDKPermissionRequest[]> = {}
    for (const permission of session.permissions()) {
      const list = permissionsBySession[permission.sessionID] ?? []
      list.push(permission as unknown as SDKPermissionRequest)
      permissionsBySession[permission.sessionID] = list
    }

    const questionsBySession: Record<string, SDKQuestionRequest[]> = {}
    for (const question of session.questions()) {
      const list = questionsBySession[question.sessionID] ?? []
      list.push(question as unknown as SDKQuestionRequest)
      questionsBySession[question.sessionID] = list
    }

    const sdkSessions: SDKSession[] = sessions.map((s) => ({
      id: s.id,
      slug: s.id,
      projectID: "vscode",
      directory: "",
      title: s.title ?? "Untitled",
      version: "0",
      time: {
        created: toEpoch(s.createdAt),
        updated: toEpoch(s.updatedAt),
      },
      summary: s.summary,
    }))

    return {
      session: sdkSessions,
      session_status: currentId ? { [currentId]: toSDKSessionStatus(session.status()) } : ({} as Record<string, SDKSessionStatus>),
      session_diff: {},
      message: Object.fromEntries(messageEntries),
      part: Object.fromEntries(partEntries),
      permission: permissionsBySession,
      question: questionsBySession,
    }
  })

  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) => {
    session.respondToPermission(input.permissionID, input.response)
  }

  const replyQuestion = (input: { requestID: string; answers: string[][] }) => {
    session.replyToQuestion(input.requestID, input.answers)
  }

  const rejectQuestion = (input: { requestID: string }) => {
    session.rejectQuestion(input.requestID)
  }

  return (
    <DataProvider
      data={data()}
      directory=""
      onPermissionRespond={respond}
      onQuestionReply={replyQuestion}
      onQuestionReject={rejectQuestion}
      onNavigateToSession={(sessionID) => session.selectSession(sessionID)}
      onSyncSession={(sessionID) => session.syncSession(sessionID)}
    >
      {props.children}
    </DataProvider>
  )
}

/**
 * Wraps children in LanguageProvider, passing server-side language info.
 * Must be below ServerProvider in the hierarchy.
 */
const LanguageBridge: Component<{ children: any }> = (props) => {
  const server = useServer()
  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      {props.children}
    </LanguageProvider>
  )
}

// Inner app component that uses the contexts
const AppContent: Component = () => {
  const [currentView, setCurrentView] = createSignal<ViewType>("newTask")
  const [marketplaceTab, setMarketplaceTab] = createSignal<MarketplaceTabType>("mcp")
  const vscode = useVSCode()
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const handleViewAction = (action: string, values?: unknown) => {
    switch (action) {
      case "plusButtonClicked":
        session.clearCurrentSession()
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
        if (values && typeof values === "object") {
          const tab = (values as { marketplaceTab?: unknown }).marketplaceTab
          if (typeof tab === "string" && VALID_MARKETPLACE_TABS.has(tab as MarketplaceTabType)) {
            setMarketplaceTab(tab as MarketplaceTabType)
          }
        }
        setCurrentView("marketplace")
        break
      case "historyButtonClicked":
        setCurrentView("history")
        break
      case "profileButtonClicked":
        setCurrentView("profile")
        break
      case "settingsButtonClicked":
        setCurrentView("settings")
        break
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "action" && message.action) {
        console.log("[Kilo New] App: 🎬 action:", message.action)
        handleViewAction(message.action, message.values)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[Kilo New] App: 🧭 navigate:", message.view)
        setCurrentView(message.view as ViewType)
      }
      if (message?.type === "openSession" && typeof message.sessionID === "string") {
        session.selectSession(message.sessionID)
        setCurrentView("newTask")
      }
      if (message?.type === "prefillPrompt" && typeof message.text === "string") {
        window.dispatchEvent(new CustomEvent("kilo:prompt-prefill", { detail: { text: message.text } }))
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  createEffect(() => {
    if (currentView() !== "marketplace") {
      return
    }

    vscode.postMessage({
      type: "telemetryEvent",
      event: "Marketplace Tab Viewed",
      properties: {
        source: "sidebar",
      },
    })
  })

  const handleSelectSession = (id: string) => {
    session.selectSession(id)
    setCurrentView("newTask")
  }

  return (
    <div class="container">
      <Switch fallback={<ChatView />}>
        <Match when={currentView() === "newTask"}>
          <Switch fallback={<LoadingPanel message={language.t("connection.state.connecting")} />}>
            <Match when={server.connectionState() === "connected"}>
              <ChatView onSelectSession={handleSelectSession} />
            </Match>
            <Match when={server.connectionState() === "connecting"}>
              <LoadingPanel
                message={
                  server.serverInfo() ? language.t("connection.state.connecting") : language.t("connection.state.initializing")
                }
              />
            </Match>
            <Match when={server.connectionState() === "reconnecting"}>
              <LoadingPanel message={language.t("connection.state.reconnecting")} />
            </Match>
            <Match when={server.connectionState() === "error"}>
              <ErrorPanel message={server.error()} onRetry={server.retryConnection} />
            </Match>
            <Match when={server.connectionState() === "disconnected"}>
              <ErrorPanel message={language.t("connection.state.disconnected")} onRetry={server.retryConnection} />
            </Match>
          </Switch>
        </Match>
        <Match when={currentView() === "marketplace"}>
          <MarketplaceView initialTab={marketplaceTab()} />
        </Match>
        <Match when={currentView() === "history"}>
          <Switch fallback={<LoadingPanel message={language.t("connection.state.connecting")} />}>
            <Match when={server.connectionState() === "connected"}>
              <SessionList onSelectSession={handleSelectSession} />
            </Match>
            <Match when={server.connectionState() === "connecting"}>
              <LoadingPanel message={language.t("connection.state.connecting")} />
            </Match>
            <Match when={server.connectionState() === "reconnecting"}>
              <LoadingPanel message={language.t("connection.state.reconnecting")} />
            </Match>
            <Match when={server.connectionState() === "error"}>
              <ErrorPanel message={server.error()} onRetry={server.retryConnection} />
            </Match>
            <Match when={server.connectionState() === "disconnected"}>
              <ErrorPanel message={language.t("connection.state.disconnected")} onRetry={server.retryConnection} />
            </Match>
          </Switch>
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
            onDone={() => setCurrentView("newTask")}
          />
        </Match>
        <Match when={currentView() === "settings"}>
          <Settings onBack={() => setCurrentView("newTask")} />
        </Match>
      </Switch>
    </div>
  )
}

// Main App component with context providers
const App: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <ProviderProvider>
                  <ConfigProvider>
                    <SessionProvider>
                      <DataBridge>
                        <AppContent />
                      </DataBridge>
                    </SessionProvider>
                  </ConfigProvider>
                </ProviderProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}

export default App
