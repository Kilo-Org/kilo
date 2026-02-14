import { Component, createSignal, createMemo, Switch, Match, onMount, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { Toast } from "@kilocode/kilo-ui/toast"
import Settings from "./components/Settings"
import ProfileView from "./components/ProfileView"
import LoadingPanel from "./components/LoadingPanel"
import ErrorPanel from "./components/ErrorPanel"
import { VSCodeProvider } from "./context/vscode"
import { ServerProvider, useServer } from "./context/server"
import { ProviderProvider } from "./context/provider"
import { ConfigProvider } from "./context/config"
import { SessionProvider, useSession } from "./context/session"
import { LanguageProvider, useLanguage } from "./context/language"
import { ChatView } from "./components/chat"
import SessionList from "./components/history/SessionList"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"
import "./styles/chat.css"

type ViewType = "newTask" | "marketplace" | "history" | "profile" | "settings"
const VALID_VIEWS = new Set<string>(["newTask", "marketplace", "history", "profile", "settings"])

const DummyView: Component<{ title: string }> = (props) => {
  return (
    <div
      style={{
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
        height: "100%",
        "min-height": "200px",
        "font-size": "24px",
        color: "var(--vscode-foreground)",
      }}
    >
      <h1>{props.title}</h1>
    </div>
  )
}

/**
 * Bridge our session store to the DataProvider's expected Data shape.
 */
const DataBridge: Component<{ children: any }> = (props) => {
  const session = useSession()

  const data = createMemo(() => {
    const sessions = session.sessions()
    const currentId = session.currentSessionID()
    const sessionIds = [...new Set([...sessions.map((s) => s.id), ...(currentId ? [currentId] : [])])]

    const messageEntries = sessionIds.map((sessionID) => [
      sessionID,
      session.getSessionMessages(sessionID) as unknown as SDKMessage[],
    ])

    const partEntries = messageEntries
      .flatMap(([, messages]) => messages)
      .map((msg) => [msg.id, session.getParts(msg.id) as unknown as SDKPart[]] as const)
      .filter(([, parts]) => parts.length > 0)

    const permissionsBySession: Record<string, any[]> = {}
    for (const permission of session.permissions()) {
      const list = permissionsBySession[permission.sessionID] ?? []
      list.push(permission as any)
      permissionsBySession[permission.sessionID] = list
    }

    const questionsBySession: Record<string, any[]> = {}
    for (const question of session.questions()) {
      const list = questionsBySession[question.sessionID] ?? []
      list.push(question as any)
      questionsBySession[question.sessionID] = list
    }

    return {
      session: sessions.map((s) => ({ ...s, id: s.id, role: "user" as const })),
      session_status: currentId ? { [currentId]: { type: session.status() } } : ({} as Record<string, any>),
      session_diff: {} as Record<string, any[]>,
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
  const session = useSession()
  const server = useServer()
  const language = useLanguage()

  const handleViewAction = (action: string) => {
    switch (action) {
      case "plusButtonClicked":
        session.clearCurrentSession()
        setCurrentView("newTask")
        break
      case "marketplaceButtonClicked":
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
        handleViewAction(message.action)
      }
      if (message?.type === "navigate" && message.view && VALID_VIEWS.has(message.view)) {
        console.log("[Kilo New] App: 🧭 navigate:", message.view)
        setCurrentView(message.view as ViewType)
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
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
          <DummyView title="Marketplace" />
        </Match>
        <Match when={currentView() === "history"}>
          <SessionList onSelectSession={handleSelectSession} />
        </Match>
        <Match when={currentView() === "profile"}>
          <ProfileView
            profileData={server.profileData()}
            deviceAuth={server.deviceAuth()}
            onLogin={server.startLogin}
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
