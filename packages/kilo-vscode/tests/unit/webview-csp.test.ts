import { describe, expect, it } from "bun:test"
import { buildWebviewCsp } from "../../src/utils/webview-csp"

describe("buildWebviewCsp", () => {
  it("includes strict defaults and nonce-scoped scripts", () => {
    const csp = buildWebviewCsp({ cspSource: "vscode-webview://abc", nonce: "nonce123" })

    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'nonce-nonce123' 'wasm-unsafe-eval'")
    expect(csp).toContain("connect-src vscode-webview://abc")
  })

  it("does not allow arbitrary https image loading", () => {
    const csp = buildWebviewCsp({ cspSource: "vscode-webview://abc", nonce: "nonce123" })

    expect(csp).toContain("img-src vscode-webview://abc data: blob:")
    expect(csp).not.toContain("https:")
  })
})
