import EventSource from "eventsource"
import type { ServerConfig, SSEEvent } from "./types"
import { logger } from "../../utils/logger"
import { CLI_SERVER_AUTH_USERNAME, createBasicAuthHeader } from "./auth"

// Type definitions for handlers
export type SSEEventHandler = (event: SSEEvent) => void
export type SSEErrorHandler = (error: Error) => void
export type SSEStateHandler = (state: "connecting" | "connected" | "reconnecting" | "disconnected") => void

type EventSourceLike = {
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}

interface SSEClientOptions {
  createEventSource?: (url: string, init: { headers: Record<string, string> }) => EventSourceLike
  initialReconnectDelayMs?: number
  maxReconnectDelayMs?: number
  maxInitialConnectAttempts?: number
}

const INITIAL_RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000
const MAX_INITIAL_CONNECT_ATTEMPTS = 5

/**
 * SSE Client for receiving real-time events from the CLI backend.
 * Manages EventSource connection and distributes events to subscribers.
 */
export class SSEClient {
  private eventSource: EventSourceLike | null = null
  private handlers: Set<SSEEventHandler> = new Set()
  private errorHandlers: Set<SSEErrorHandler> = new Set()
  private stateHandlers: Set<SSEStateHandler> = new Set()
  private readonly authUsername: string
  private readonly createEventSourceImpl: (url: string, init: { headers: Record<string, string> }) => EventSourceLike
  private readonly initialReconnectDelayMs: number
  private readonly maxReconnectDelayMs: number
  private readonly maxInitialConnectAttempts: number
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs: number
  private shouldReconnect = false
  private directory: string | null = null
  private hasConnected = false
  private initialConnectAttempts = 0

  constructor(
    private readonly config: ServerConfig,
    options?: SSEClientOptions,
  ) {
    this.authUsername = config.username || CLI_SERVER_AUTH_USERNAME
    this.createEventSourceImpl = options?.createEventSource ?? ((url, init) => new EventSource(url, init) as EventSourceLike)
    this.initialReconnectDelayMs = options?.initialReconnectDelayMs ?? INITIAL_RECONNECT_DELAY_MS
    this.maxReconnectDelayMs = options?.maxReconnectDelayMs ?? MAX_RECONNECT_DELAY_MS
    this.maxInitialConnectAttempts = options?.maxInitialConnectAttempts ?? MAX_INITIAL_CONNECT_ATTEMPTS
    this.reconnectDelayMs = this.initialReconnectDelayMs
  }

  /**
   * Connect to the SSE endpoint for a specific directory.
   * @param directory - The workspace directory to subscribe to events for
   */
  connect(directory: string): void {
    logger.debug("[Kilo New] SSE: 🔌 connect() called with directory:", directory)

    this.shouldReconnect = true
    this.directory = directory
    this.hasConnected = false
    this.initialConnectAttempts = 0
    this.reconnectDelayMs = this.initialReconnectDelayMs
    this.clearReconnectTimeout()
    this.closeEventSource()

    // Notify connecting state
    logger.debug('[Kilo New] SSE: 🔄 Setting state to "connecting"')
    this.notifyState("connecting")

    this.createEventSource()
  }

  private createEventSource(): void {
    if (!this.directory) {
      return
    }

    // Build URL with directory parameter
    const url = `${this.config.baseUrl}/event?directory=${encodeURIComponent(this.directory)}`
    logger.debug("[Kilo New] SSE: 🌐 Connecting to URL:", url)

    // Create auth header
    const authHeader = createBasicAuthHeader(this.authUsername, this.config.password)
    logger.debug("[Kilo New] SSE: 🔑 Auth header created", {
      username: this.authUsername,
      passwordLength: this.config.password.length,
    })

    // Create EventSource with headers
    logger.debug("[Kilo New] SSE: 🎬 Creating EventSource...")
    const currentEventSource = this.createEventSourceImpl(url, {
      headers: {
        Authorization: authHeader,
      },
    })
    this.eventSource = currentEventSource

    // Set up onopen handler
    currentEventSource.onopen = () => {
      if (this.eventSource !== currentEventSource) {
        return
      }
      logger.debug("[Kilo New] SSE: ✅ EventSource opened successfully")
      this.hasConnected = true
      this.initialConnectAttempts = 0
      this.reconnectDelayMs = this.initialReconnectDelayMs
      this.notifyState("connected")
    }

    // Set up onmessage handler
    currentEventSource.onmessage = (messageEvent) => {
      if (this.eventSource !== currentEventSource) {
        return
      }
      logger.debug("[Kilo New] SSE: 📨 Received message event:", messageEvent.data)
      try {
        const event = JSON.parse(messageEvent.data) as SSEEvent
        logger.debug("[Kilo New] SSE: 📦 Parsed event type:", event.type)
        this.notifyEvent(event)
      } catch (error) {
        logger.error("[Kilo New] SSE: ❌ Failed to parse event:", error)
        this.notifyError(error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Set up onerror handler
    currentEventSource.onerror = (errorEvent) => {
      if (this.eventSource !== currentEventSource) {
        return
      }
      logger.error("[Kilo New] SSE: ❌ EventSource error:", errorEvent)
      this.closeEventSource()

      if (!this.shouldReconnect || !this.directory) {
        this.notifyState("disconnected")
        return
      }

      // Initial connect failed before we ever established a stream.
      if (!this.hasConnected) {
        this.initialConnectAttempts += 1
        if (this.initialConnectAttempts >= this.maxInitialConnectAttempts) {
          this.notifyError(new Error("EventSource connection error"))
          this.notifyState("disconnected")
          return
        }

        this.scheduleReconnect()
        return
      }

      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return
    }

    const delayMs = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs)
    this.notifyState("reconnecting")

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      if (!this.shouldReconnect || !this.directory) {
        return
      }

      this.createEventSource()
    }, delayMs)
  }

  private clearReconnectTimeout(): void {
    if (!this.reconnectTimeout) {
      return
    }
    clearTimeout(this.reconnectTimeout)
    this.reconnectTimeout = null
  }

  private closeEventSource(): void {
    if (!this.eventSource) {
      return
    }
    this.eventSource.close()
    this.eventSource = null
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  disconnect(): void {
    this.shouldReconnect = false
    this.directory = null
    this.hasConnected = false
    this.initialConnectAttempts = 0
    this.reconnectDelayMs = this.initialReconnectDelayMs
    this.clearReconnectTimeout()
    this.closeEventSource()
    this.notifyState("disconnected")
  }

  /**
   * Subscribe to SSE events.
   * @param handler - Function to call when an event is received
   * @returns Unsubscribe function
   */
  onEvent(handler: SSEEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /**
   * Subscribe to error events.
   * @param handler - Function to call when an error occurs
   * @returns Unsubscribe function
   */
  onError(handler: SSEErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => {
      this.errorHandlers.delete(handler)
    }
  }

  /**
   * Subscribe to connection state changes.
   * @param handler - Function to call when state changes
   * @returns Unsubscribe function
   */
  onStateChange(handler: SSEStateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  /**
   * Notify all event handlers of a new event.
   */
  private notifyEvent(event: SSEEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch (error) {
        logger.error("[Kilo New] SSE: Error in event handler:", error)
      }
    }
  }

  /**
   * Notify all error handlers of an error.
   */
  private notifyError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error)
      } catch (err) {
        logger.error("[Kilo New] SSE: Error in error handler:", err)
      }
    }
  }

  /**
   * Notify all state handlers of a state change.
   */
  private notifyState(state: "connecting" | "connected" | "reconnecting" | "disconnected"): void {
    for (const handler of this.stateHandlers) {
      try {
        handler(state)
      } catch (error) {
        logger.error("[Kilo New] SSE: Error in state handler:", error)
      }
    }
  }

  /**
   * Dispose of the client, disconnecting and clearing all handlers.
   */
  dispose(): void {
    this.disconnect()
    this.handlers.clear()
    this.errorHandlers.clear()
    this.stateHandlers.clear()
  }
}
