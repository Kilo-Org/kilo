import EventSource from "eventsource"
import type { ServerConfig, SSEEvent } from "./types"
import { logger } from "../../utils/logger"

// Type definitions for handlers
export type SSEEventHandler = (event: SSEEvent) => void
export type SSEErrorHandler = (error: Error) => void
export type SSEStateHandler = (state: "connecting" | "connected" | "reconnecting" | "disconnected") => void

const INITIAL_RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 30_000

/**
 * SSE Client for receiving real-time events from the CLI backend.
 * Manages EventSource connection and distributes events to subscribers.
 */
export class SSEClient {
  private eventSource: EventSource | null = null
  private handlers: Set<SSEEventHandler> = new Set()
  private errorHandlers: Set<SSEErrorHandler> = new Set()
  private stateHandlers: Set<SSEStateHandler> = new Set()
  private readonly authUsername = "opencode"
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
  private shouldReconnect = false
  private directory: string | null = null
  private hasConnected = false

  constructor(private readonly config: ServerConfig) {}

  /**
   * Connect to the SSE endpoint for a specific directory.
   * @param directory - The workspace directory to subscribe to events for
   */
  connect(directory: string): void {
    logger.info("[Kilo New] SSE: 🔌 connect() called with directory:", directory)

    this.shouldReconnect = true
    this.directory = directory
    this.hasConnected = false
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
    this.clearReconnectTimeout()
    this.closeEventSource()

    // Notify connecting state
    logger.info('[Kilo New] SSE: 🔄 Setting state to "connecting"')
    this.notifyState("connecting")

    this.createEventSource()
  }

  private createEventSource(): void {
    if (!this.directory) {
      return
    }

    // Build URL with directory parameter
    const url = `${this.config.baseUrl}/event?directory=${encodeURIComponent(this.directory)}`
    logger.info("[Kilo New] SSE: 🌐 Connecting to URL:", url)

    // Create auth header
    const authHeader = `Basic ${Buffer.from(`${this.authUsername}:${this.config.password}`).toString("base64")}`
    logger.info("[Kilo New] SSE: 🔑 Auth header created", {
      username: this.authUsername,
      passwordLength: this.config.password.length,
    })

    // Create EventSource with headers
    logger.info("[Kilo New] SSE: 🎬 Creating EventSource...")
    const currentEventSource = new EventSource(url, {
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
      logger.info("[Kilo New] SSE: ✅ EventSource opened successfully")
      this.hasConnected = true
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
      this.notifyState("connected")
    }

    // Set up onmessage handler
    currentEventSource.onmessage = (messageEvent) => {
      if (this.eventSource !== currentEventSource) {
        return
      }
      logger.info("[Kilo New] SSE: 📨 Received message event:", messageEvent.data)
      try {
        const event = JSON.parse(messageEvent.data) as SSEEvent
        logger.info("[Kilo New] SSE: 📦 Parsed event type:", event.type)
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
        this.notifyError(new Error("EventSource connection error"))
        this.notifyState("disconnected")
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
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
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
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
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
