import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { HttpClient } from "../../src/services/cli-backend/http-client"

const ORIGINAL_FETCH = globalThis.fetch

describe("HttpClient timeouts", () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("throws connect timeout error when fetch never connects", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted")
          ;(err as { name: string }).name = "AbortError"
          reject(err)
        })
      })) as typeof fetch

    const client = new HttpClient({ baseUrl: "http://127.0.0.1:1111", password: "pw" })

    await expect(
      (client as any).request("GET", "/session", undefined, {
        connectTimeoutMs: 5,
        requestTimeoutMs: 50,
      }),
    ).rejects.toThrow("connect timeout")
  })

  it("throws request timeout error when body read hangs", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted")
              ;(err as { name: string }).name = "AbortError"
              reject(err)
            })
          }),
      } as Response
    }) as typeof fetch

    const client = new HttpClient({ baseUrl: "http://127.0.0.1:1111", password: "pw" })

    await expect(
      (client as any).request("GET", "/session", undefined, {
        connectTimeoutMs: 50,
        requestTimeoutMs: 5,
      }),
    ).rejects.toThrow("request timeout")
  })
})
