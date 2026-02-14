import { describe, expect, it } from "bun:test"
import { SSEClient } from "../../src/services/cli-backend/sse-client"

class FakeEventSource {
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  closed = false

  close() {
    this.closed = true
  }

  emitOpen() {
    this.onopen?.({})
  }

  emitError() {
    this.onerror?.({})
  }
}

describe("SSEClient reconnect behavior", () => {
  it("reconnects with backoff after a connected stream errors", async () => {
    const instances: FakeEventSource[] = []
    const states: string[] = []

    const client = new SSEClient(
      { baseUrl: "http://127.0.0.1:1111", password: "pw" },
      {
        createEventSource: () => {
          const next = new FakeEventSource()
          instances.push(next)
          return next
        },
        initialReconnectDelayMs: 5,
        maxReconnectDelayMs: 20,
      },
    )

    client.onStateChange((state) => states.push(state))
    client.connect("/tmp/ws")

    expect(states).toEqual(["connecting"])
    expect(instances.length).toBe(1)

    instances[0].emitOpen()
    expect(states.at(-1)).toBe("connected")

    instances[0].emitError()
    expect(states.at(-1)).toBe("reconnecting")

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(instances.length).toBe(2)
    instances[1].emitOpen()
    expect(states.at(-1)).toBe("connected")
  })

  it("does not reconnect when initial connection fails before open", async () => {
    const instances: FakeEventSource[] = []
    const states: string[] = []

    const client = new SSEClient(
      { baseUrl: "http://127.0.0.1:1111", password: "pw" },
      {
        createEventSource: () => {
          const next = new FakeEventSource()
          instances.push(next)
          return next
        },
        initialReconnectDelayMs: 5,
      },
    )

    client.onStateChange((state) => states.push(state))
    client.connect("/tmp/ws")
    instances[0].emitError()

    expect(states).toContain("disconnected")
    expect(states).not.toContain("reconnecting")

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(instances.length).toBe(1)
  })
})
