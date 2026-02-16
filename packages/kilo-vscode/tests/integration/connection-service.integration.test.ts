import { describe, expect, it } from "bun:test"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEEvent } from "../../src/services/cli-backend/types"

class FakeServerManager {
  getServerCalls = 0
  disposed = false

  async getServer(): Promise<{ port: number; password: string; username: string }> {
    this.getServerCalls += 1
    return { port: 19001, password: "pw", username: "kilo" }
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeSSEClient {
  private eventListeners: Array<(event: SSEEvent) => void> = []
  private errorListeners: Array<(error: Error) => void> = []
  private stateListeners: Array<(state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error") => void> =
    []

  disposed = false
  connectedWorkspaceDir: string | null = null

  onEvent(listener: (event: SSEEvent) => void): void {
    this.eventListeners.push(listener)
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }

  onStateChange(listener: (state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error") => void): void {
    this.stateListeners.push(listener)
  }

  connect(workspaceDir: string): void {
    this.connectedWorkspaceDir = workspaceDir
  }

  emitState(state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error"): void {
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  emitEvent(event: SSEEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error)
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

describe("KiloConnectionService integration behavior", () => {
  it("handles server lifecycle and deduplicates concurrent connect calls", async () => {
    const serverManager = new FakeServerManager()
    const sseClient = new FakeSSEClient()
    const fakeHttpClient = { marker: "http-client" } as const
    const states: string[] = []

    const service = new KiloConnectionService({ extensionPath: "/tmp/ext" } as never, {
      createServerManager: () => serverManager,
      createSseClient: () => sseClient,
      createHttpClient: () => fakeHttpClient as never,
    })
    service.onStateChange((state) => states.push(state))

    const firstConnect = service.connect("/tmp/workspace")
    const secondConnect = service.connect("/tmp/workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(serverManager.getServerCalls).toBe(1)
    expect(states.at(-1)).toBe("connecting")
    expect(sseClient.connectedWorkspaceDir).toBe("/tmp/workspace")

    sseClient.emitState("connected")
    await Promise.all([firstConnect, secondConnect])

    expect(states.at(-1)).toBe("connected")
    expect(service.getHttpClient()).toBe(fakeHttpClient)

    service.dispose()
    expect(serverManager.disposed).toBe(true)
    expect(sseClient.disposed).toBe(true)
  })

  it("routes SSE events and resolves session scope for message/permission/session flows", async () => {
    const serverManager = new FakeServerManager()
    const sseClient = new FakeSSEClient()
    const seenEvents: SSEEvent[] = []

    const service = new KiloConnectionService({ extensionPath: "/tmp/ext" } as never, {
      createServerManager: () => serverManager,
      createSseClient: () => sseClient,
      createHttpClient: () => ({}) as never,
    })
    service.onEvent((event) => seenEvents.push(event))

    const connectPromise = service.connect("/tmp/workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))
    sseClient.emitState("connected")
    await connectPromise

    const sessionCreated = {
      type: "session.created",
      properties: {
        info: {
          id: "session-1",
          title: "Session 1",
          directory: "/tmp/workspace",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as SSEEvent
    expect(service.resolveEventSessionId(sessionCreated)).toBe("session-1")

    const messageUpdated = {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as SSEEvent
    sseClient.emitEvent(messageUpdated)
    expect(seenEvents).toContain(messageUpdated)
    expect(service.resolveEventSessionId(messageUpdated)).toBe("session-1")

    const messagePartUpdated = {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: "part-1",
          text: "hello",
          messageID: "message-1",
        },
      },
    } as SSEEvent
    expect(service.resolveEventSessionId(messagePartUpdated)).toBe("session-1")

    const permissionAsked = {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "session-1",
        permission: "execute",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
    } as SSEEvent
    expect(service.resolveEventSessionId(permissionAsked)).toBe("session-1")

    const permissionReplied = {
      type: "permission.replied",
      properties: { sessionID: "session-1", requestID: "perm-1", reply: "once" },
    } as SSEEvent
    expect(service.resolveEventSessionId(permissionReplied)).toBe("session-1")

    const questionAsked = {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [{ question: "Proceed?", header: "Confirm", options: [{ label: "Yes", description: "run" }] }],
      },
    } as SSEEvent
    expect(service.resolveEventSessionId(questionAsked)).toBe("session-1")

    service.dispose()
  })
})
