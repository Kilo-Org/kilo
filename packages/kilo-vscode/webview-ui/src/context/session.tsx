/**
 * Session context
 * Manages session state, messages, and handles SSE events from the extension.
 * Also owns per-session model selection (provider context is catalog-only).
 */

import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  ParentComponent,
  Accessor,
  batch,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useVSCode } from "./vscode"
import { useServer } from "./server"
import { useProvider } from "./provider"
import type {
  SessionInfo,
  Message,
  Part,
  PartDelta,
  SessionStatus,
  PermissionRequest,
  QuestionRequest,
  TodoItem,
  ModelSelection,
  ContextUsage,
  AgentInfo,
  ExtensionMessage,
  FileAttachment,
} from "../types/messages"

// Store structure for messages and parts
interface SessionStore {
  sessions: Record<string, SessionInfo>
  messages: Record<string, Message[]> // sessionID -> messages
  parts: Record<string, Part[]> // messageID -> parts
  todos: Record<string, TodoItem[]> // sessionID -> todos
  modelSelections: Record<string, ModelSelection> // sessionID -> model
}

interface SessionContextValue {
  // Current session
  currentSessionID: Accessor<string | undefined>
  currentSession: Accessor<SessionInfo | undefined>
  setCurrentSessionID: (id: string | undefined) => void

  // All sessions (sorted most recent first)
  sessions: Accessor<SessionInfo[]>

  // Session status
  status: Accessor<SessionStatus>
  loading: Accessor<boolean>

  // Messages for current session
  messages: Accessor<Message[]>

  // Parts for a specific message
  getParts: (messageID: string) => Part[]

  // Todos for current session
  todos: Accessor<TodoItem[]>

  // Pending permission requests
  permissions: Accessor<PermissionRequest[]>

  // Pending question requests
  questions: Accessor<QuestionRequest[]>
  questionErrors: Accessor<Set<string>>

  // Model selection (per-session)
  selected: Accessor<ModelSelection | null>
  selectModel: (providerID: string, modelID: string) => void

  // Cost and context usage for the current session
  totalCost: Accessor<number>
  contextUsage: Accessor<ContextUsage | undefined>

  // Agent/mode selection
  agents: Accessor<AgentInfo[]>
  selectedAgent: Accessor<string>
  selectAgent: (name: string) => void

  // Actions
  sendMessage: (text: string, providerID?: string, modelID?: string, files?: FileAttachment[]) => void
  abort: () => void
  compact: () => void
  respondToPermission: (permissionId: string, response: "once" | "always" | "reject") => void
  replyToQuestion: (requestID: string, answers: string[][]) => void
  rejectQuestion: (requestID: string) => void
  createSession: () => void
  clearCurrentSession: () => void
  loadSessions: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
}

const SessionContext = createContext<SessionContextValue>()

export const SessionProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const provider = useProvider()

  // Current session ID
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()

  // Session status
  const [status, setStatus] = createSignal<SessionStatus>("idle")
  const [loading, setLoading] = createSignal(false)

  // Pending permissions
  const [permissions, setPermissions] = createSignal<PermissionRequest[]>([])

  // Pending questions
  const [questions, setQuestions] = createSignal<QuestionRequest[]>([])

  // Tracks question IDs that failed so the UI can reset sending state
  const [questionErrors, setQuestionErrors] = createSignal<Set<string>>(new Set())

  // Pending model selection for before a session exists
  const [pendingModelSelection, setPendingModelSelection] = createSignal<ModelSelection | null>(null)
  const [pendingWasUserSet, setPendingWasUserSet] = createSignal(false)

  // Agents (modes) loaded from the CLI backend
  const [agents, setAgents] = createSignal<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgent] = createSignal("code")
  const [selectedAgentName, setSelectedAgentName] = createSignal("code")

  // Store for sessions, messages, parts, todos, modelSelections
  const [store, setStore] = createStore<SessionStore>({
    sessions: {},
    messages: {},
    parts: {},
    todos: {},
    modelSelections: {},
  })

  // Keep pending selection in sync with provider default until the user
  // explicitly changes it (or a session exists).
  createEffect(() => {
    const def = provider.defaultSelection()
    if (currentSessionID()) {
      return
    }

    if (pendingWasUserSet()) {
      return
    }

    setPendingModelSelection(def)
  })

  // If we have no pending yet, initialize it from provider default.
  createEffect(() => {
    if (!pendingModelSelection()) {
      setPendingModelSelection(provider.defaultSelection())
    }
  })

  // Per-session model selection
  const selected = createMemo<ModelSelection | null>(() => {
    const sessionID = currentSessionID()
    if (sessionID) {
      return store.modelSelections[sessionID] ?? provider.defaultSelection()
    }
    return pendingModelSelection()
  })

  function selectModel(providerID: string, modelID: string) {
    const selection: ModelSelection = { providerID, modelID }
    const id = currentSessionID()
    if (id) {
      setStore("modelSelections", id, selection)
    } else {
      setPendingWasUserSet(true)
      setPendingModelSelection(selection)
    }
  }

  // Handle agentsLoaded immediately (not in onMount) so we never miss
  // the initial push that arrives before the DOM mounts. This mirrors the
  // pattern used by ProviderProvider for providersLoaded.
  const unsubAgents = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "agentsLoaded") {
      return
    }
    setAgents(message.agents)
    setDefaultAgent(message.defaultAgent)
    // Only override if the user hasn't explicitly selected an agent
    if (selectedAgentName() === "code" || !message.agents.some((a) => a.name === selectedAgentName())) {
      setSelectedAgentName(message.defaultAgent)
    }
  })

  // Request agents in case the initial push was missed.
  // Retry a few times because the extension's httpClient may
  // not be ready yet when the first request arrives.
  let agentRetries = 0
  const agentMaxRetries = 5
  const agentRetryMs = 500

  vscode.postMessage({ type: "requestAgents" })

  const agentRetryTimer = setInterval(() => {
    agentRetries++
    if (agents().length > 0 || agentRetries >= agentMaxRetries) {
      clearInterval(agentRetryTimer)
      return
    }
    vscode.postMessage({ type: "requestAgents" })
  }, agentRetryMs)

  onCleanup(() => {
    unsubAgents()
    clearInterval(agentRetryTimer)
  })

  // Handle messages from extension
  onMount(() => {
    const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
      switch (message.type) {
        case "sessionCreated":
          handleSessionCreated(message.session)
          break

        case "messagesLoaded":
          handleMessagesLoaded(message.sessionID, message.messages)
          break

        case "messageCreated":
          handleMessageCreated(message.message)
          break

        case "partUpdated":
          handlePartUpdated(message.sessionID, message.messageID, message.part, message.delta)
          break

        case "sessionStatus":
          handleSessionStatus(message.sessionID, message.status)
          break

        case "permissionRequest":
          handlePermissionRequest(message.permission)
          break

        case "todoUpdated":
          handleTodoUpdated(message.sessionID, message.items)
          break

        case "questionRequest":
          handleQuestionRequest(message.question)
          break

        case "questionResolved":
          handleQuestionResolved(message.requestID)
          break

        case "questionError":
          handleQuestionError(message.requestID)
          break

        case "sessionsLoaded":
          handleSessionsLoaded(message.sessions)
          break

        case "sessionUpdated":
          setStore("sessions", message.session.id, message.session)
          break

        case "sessionDeleted":
          handleSessionDeleted(message.sessionID)
          break

        case "error":
          setLoading(false)
          break
      }
    })

    onCleanup(unsubscribe)
  })

  // Event handlers
  function handleSessionCreated(session: SessionInfo) {
    batch(() => {
      setStore("sessions", session.id, session)
      setStore("messages", session.id, [])

      // If there's a pending model selection, assign it to this new session.
      // Guard against duplicate sessionCreated events (HTTP response + SSE)
      // which would overwrite the user's selection with the effect-restored default.
      const pending = pendingModelSelection()
      if (pending && !store.modelSelections[session.id]) {
        setStore("modelSelections", session.id, pending)
        setPendingModelSelection(null)
        setPendingWasUserSet(false)
      }

      setCurrentSessionID(session.id)
    })
  }

  function handleMessagesLoaded(sessionID: string, messages: Message[]) {
    if (sessionID === currentSessionID()) setLoading(false)
    setStore("messages", sessionID, messages)

    // Also extract parts from messages
    messages.forEach((msg) => {
      if (msg.parts && msg.parts.length > 0) {
        setStore("parts", msg.id, msg.parts)
      }
    })
  }

  function handleMessageCreated(message: Message) {
    setStore("messages", message.sessionID, (msgs = []) => {
      // Check if message already exists (update case)
      const existingIndex = msgs.findIndex((m) => m.id === message.id)
      if (existingIndex >= 0) {
        // Update existing message
        const updated = [...msgs]
        updated[existingIndex] = { ...msgs[existingIndex], ...message }
        return updated
      }
      // Add new message
      return [...msgs, message]
    })

    if (message.parts && message.parts.length > 0) {
      setStore("parts", message.id, message.parts)
    }
  }

  function handlePartUpdated(
    sessionID: string | undefined,
    messageID: string | undefined,
    part: Part,
    delta?: PartDelta,
  ) {
    // Get messageID from the part itself if not provided in the message
    const effectiveMessageID = messageID || part.messageID

    if (!effectiveMessageID) {
      console.warn("[Kilo New] Part updated without messageID:", part.id, part.type)
      return
    }

    setStore(
      "parts",
      produce((parts) => {
        if (!parts[effectiveMessageID]) {
          parts[effectiveMessageID] = []
        }

        const existingIndex = parts[effectiveMessageID].findIndex((p) => p.id === part.id)

        if (existingIndex >= 0) {
          // Update existing part
          if (
            delta?.type === "text-delta" &&
            delta.textDelta &&
            parts[effectiveMessageID][existingIndex].type === "text"
          ) {
            // Append text delta
            ;(parts[effectiveMessageID][existingIndex] as { text: string }).text += delta.textDelta
          } else {
            // Replace entire part
            parts[effectiveMessageID][existingIndex] = part
          }
        } else {
          // Add new part
          parts[effectiveMessageID].push(part)
        }
      }),
    )
  }

  function handleSessionStatus(sessionID: string, newStatus: SessionStatus) {
    if (sessionID === currentSessionID()) {
      setStatus(newStatus)
    }
  }

  function handlePermissionRequest(permission: PermissionRequest) {
    setPermissions((prev) => [...prev, permission])
  }

  function handleQuestionRequest(question: QuestionRequest) {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === question.id)
      if (idx === -1) return [...prev, question]
      const next = prev.slice()
      next[idx] = question
      return next
    })
  }

  function handleQuestionResolved(requestID: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== requestID))
    setQuestionErrors((prev) => {
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function handleQuestionError(requestID: string) {
    setQuestionErrors((prev) => new Set(prev).add(requestID))
  }

  function handleTodoUpdated(sessionID: string, items: TodoItem[]) {
    setStore("todos", sessionID, items)
  }

  function handleSessionsLoaded(loaded: SessionInfo[]) {
    batch(() => {
      for (const s of loaded) {
        setStore("sessions", s.id, s)
      }
    })
  }

  function handleSessionDeleted(sessionID: string) {
    batch(() => {
      // Collect message IDs so we can clean up their parts
      const msgs = store.messages[sessionID] ?? []
      const msgIds = msgs.map((m) => m.id)

      setStore(
        "sessions",
        produce((sessions) => {
          delete sessions[sessionID]
        }),
      )
      setStore(
        "messages",
        produce((messages) => {
          delete messages[sessionID]
        }),
      )
      setStore(
        "parts",
        produce((parts) => {
          for (const id of msgIds) {
            delete parts[id]
          }
        }),
      )
      setStore(
        "todos",
        produce((todos) => {
          delete todos[sessionID]
        }),
      )
      setStore(
        "modelSelections",
        produce((selections) => {
          delete selections[sessionID]
        }),
      )
      // Clean up pending questions/errors for the deleted session
      const deleted = questions()
        .filter((q) => q.sessionID === sessionID)
        .map((q) => q.id)
      if (deleted.length > 0) {
        setQuestions((prev) => prev.filter((q) => q.sessionID !== sessionID))
        setQuestionErrors((prev) => {
          const next = new Set(prev)
          for (const id of deleted) next.delete(id)
          if (next.size === prev.size) return prev
          return next
        })
      }
      if (currentSessionID() === sessionID) {
        setCurrentSessionID(undefined)
        setStatus("idle")
        setLoading(false)
      }
    })
  }

  // Actions
  function selectAgent(name: string) {
    setSelectedAgentName(name)
  }

  function sendMessage(text: string, providerID?: string, modelID?: string, files?: FileAttachment[]) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot send message: not connected")
      return
    }

    const agent = selectedAgentName() !== defaultAgent() ? selectedAgentName() : undefined

    vscode.postMessage({
      type: "sendMessage",
      text,
      sessionID: currentSessionID(),
      providerID,
      modelID,
      agent,
      files,
    })
  }

  function abort() {
    const sessionID = currentSessionID()
    if (!sessionID) {
      console.warn("[Kilo New] Cannot abort: no current session")
      return
    }

    vscode.postMessage({
      type: "abort",
      sessionID,
    })
  }

  function compact() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot compact: not connected")
      return
    }

    const sessionID = currentSessionID()
    if (!sessionID) {
      console.warn("[Kilo New] Cannot compact: no current session")
      return
    }

    const sel = selected()
    vscode.postMessage({
      type: "compact",
      sessionID,
      providerID: sel?.providerID,
      modelID: sel?.modelID,
    })
  }

  function respondToPermission(permissionId: string, response: "once" | "always" | "reject") {
    // Resolve sessionID from the stored permission request
    const permission = permissions().find((p) => p.id === permissionId)
    const sessionID = permission?.sessionID ?? currentSessionID() ?? ""

    vscode.postMessage({
      type: "permissionResponse",
      permissionId,
      sessionID,
      response,
    })

    // Remove from pending permissions
    setPermissions((prev) => prev.filter((p) => p.id !== permissionId))
  }

  function clearQuestionError(requestID: string) {
    setQuestionErrors((prev) => {
      if (!prev.has(requestID)) return prev
      const next = new Set(prev)
      next.delete(requestID)
      return next
    })
  }

  function replyToQuestion(requestID: string, answers: string[][]) {
    clearQuestionError(requestID)
    vscode.postMessage({
      type: "questionReply",
      requestID,
      answers,
    })
  }

  function rejectQuestion(requestID: string) {
    clearQuestionError(requestID)
    vscode.postMessage({
      type: "questionReject",
      requestID,
    })
  }

  function createSession() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot create session: not connected")
      return
    }

    // Reset pending selection to default for the new session
    setPendingModelSelection(provider.defaultSelection())
    setPendingWasUserSet(false)
    vscode.postMessage({ type: "createSession" })
  }

  function clearCurrentSession() {
    setCurrentSessionID(undefined)
    setStatus("idle")
    setLoading(false)
    setPermissions([])
    setQuestions([])
    setQuestionErrors(new Set<string>())
    setPendingModelSelection(provider.defaultSelection())
    setPendingWasUserSet(false)
    vscode.postMessage({ type: "clearSession" })
  }

  function loadSessions() {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot load sessions: not connected")
      return
    }
    vscode.postMessage({ type: "loadSessions" })
  }

  function selectSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot select session: not connected")
      return
    }
    setCurrentSessionID(id)
    setStatus("idle")
    setLoading(true)
    vscode.postMessage({ type: "loadMessages", sessionID: id })
  }

  function deleteSession(id: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot delete session: not connected")
      return
    }
    vscode.postMessage({ type: "deleteSession", sessionID: id })
  }

  function renameSession(id: string, title: string) {
    if (!server.isConnected()) {
      console.warn("[Kilo New] Cannot rename session: not connected")
      return
    }
    vscode.postMessage({ type: "renameSession", sessionID: id, title })
  }

  // Computed values
  const currentSession = () => {
    const id = currentSessionID()
    return id ? store.sessions[id] : undefined
  }

  const messages = () => {
    const id = currentSessionID()
    return id ? store.messages[id] || [] : []
  }

  const getParts = (messageID: string) => {
    return store.parts[messageID] || []
  }

  const todos = () => {
    const id = currentSessionID()
    return id ? store.todos[id] || [] : []
  }

  const sessions = createMemo(() =>
    Object.values(store.sessions).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  )

  // Total cost across all assistant messages in the current session
  const totalCost = createMemo(() => {
    return messages().reduce((sum, m) => sum + (m.role === "assistant" ? (m.cost ?? 0) : 0), 0)
  })

  // Context usage from the last assistant message that has token data
  const contextUsage = createMemo<ContextUsage | undefined>(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role !== "assistant" || !m.tokens) continue
      const total =
        m.tokens.input +
        m.tokens.output +
        (m.tokens.reasoning ?? 0) +
        (m.tokens.cache?.read ?? 0) +
        (m.tokens.cache?.write ?? 0)
      if (total === 0) continue
      const sel = selected()
      const model = sel ? provider.findModel(sel) : undefined
      const limit = model?.limit?.context ?? model?.contextLength
      const percentage = limit ? Math.round((total / limit) * 100) : null
      return { tokens: total, percentage }
    }
    return undefined
  })

  const value: SessionContextValue = {
    currentSessionID,
    currentSession,
    setCurrentSessionID,
    sessions,
    status,
    loading,
    messages,
    getParts,
    todos,
    permissions,
    questions,
    questionErrors,
    selected,
    selectModel,
    totalCost,
    contextUsage,
    agents,
    selectedAgent: selectedAgentName,
    selectAgent,
    sendMessage,
    abort,
    compact,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
    createSession,
    clearCurrentSession,
    loadSessions,
    selectSession,
    deleteSession,
    renameSession,
  }

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return context
}
