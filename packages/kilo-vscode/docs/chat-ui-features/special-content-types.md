# Special Content Types

Interactive elements for specialized message content beyond plain markdown/code.

## Location

Content type rendering is now handled by kilo-ui's `<KiloMessage>` component which includes renderers for reasoning blocks, tool results, and other part types. The old standalone components (`ReasoningBlock`, `OpenMarkdownPreviewButton`, etc.) don't exist in the new extension.

## Interactions

- **OpenMarkdownPreviewButton**: Opens markdown in VS Code preview
- **ReasoningBlock**: Collapsible AI reasoning display
- **MCP Tool/Resource Rows**: Interactive MCP server tool execution
- **Error Rows**: Expandable error details with copy functionality

## Suggested migration

**Reimplement?** Mixed.

- UI components like collapsible reasoning and expandable errors can remain in the webview.
- MCP tool/resource interactions should be revalidated:
  - If the extension remains the MCP host, keep current behavior.
  - If MCP moves to Kilo CLI (`GET /mcp` / `POST /mcp` are referenced in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1)), you’ll need adapter work to map Kilo CLI MCP events/results into the existing Kilo MCP rows.
- “Open markdown preview in VS Code” is inherently a VS Code integration; keep it in the extension/webview.
