import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "bun:test"

const chatCssPath = path.join(process.cwd(), "webview-ui", "src", "styles", "chat.css")

describe("webview theme contract", () => {
  it("uses VS Code theme variables for core text/background surfaces", async () => {
    const css = await fs.readFile(chatCssPath, "utf8")

    expect(css).toContain("var(--vscode-foreground)")
    expect(css).toContain("var(--vscode-editor-background)")
    expect(css).toContain("var(--vscode-input-background)")
    expect(css).toContain("var(--vscode-input-foreground)")
  })

  it("includes explicit forced-colors handling for high-contrast environments", async () => {
    const css = await fs.readFile(chatCssPath, "utf8")
    expect(css).toContain("@media (forced-colors: active)")
  })
})
