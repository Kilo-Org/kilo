import { describe, expect, it } from "bun:test"
import { parseAllowedOpenExternalUrl } from "../../src/utils/open-external"

describe("parseAllowedOpenExternalUrl", () => {
  it("accepts https urls", () => {
    expect(parseAllowedOpenExternalUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1")
  })

  it("accepts vscode urls", () => {
    expect(parseAllowedOpenExternalUrl("vscode://file/c:/tmp/foo.ts")).toBe("vscode://file/c:/tmp/foo.ts")
  })

  it("rejects unsupported schemes", () => {
    expect(parseAllowedOpenExternalUrl("javascript:alert(1)")).toBeNull()
    expect(parseAllowedOpenExternalUrl("file:///tmp/a.txt")).toBeNull()
  })

  it("rejects invalid payloads", () => {
    expect(parseAllowedOpenExternalUrl("")).toBeNull()
    expect(parseAllowedOpenExternalUrl("not-a-url")).toBeNull()
    expect(parseAllowedOpenExternalUrl(undefined)).toBeNull()
    expect(parseAllowedOpenExternalUrl(42)).toBeNull()
  })
})
