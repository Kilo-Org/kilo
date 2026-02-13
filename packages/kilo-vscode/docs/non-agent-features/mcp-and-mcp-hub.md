# MCP (Model Context Protocol) + MCP Hub

- **What it is**: A protocol for connecting external tool/resource servers, plus a hub that manages MCP connections.

## Capabilities

- Multiple transports (local stdio, remote HTTP/SSE).
- OAuth support for remote servers.
- Allowlisting/disablement of tools.
- Auto-reconnect and error history.

## Docs references

- [`apps/kilocode-docs/pages/automate/mcp/overview.md`](../../apps/kilocode-docs/pages/automate/mcp/overview.md)

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Prefer Kilo CLI server MCP endpoints for MCP lifecycle, tool routing, and execution.
  - Keep VS Code UI and approval/consent surfaces in the extension host.
- **Reimplementation required?**: No.

## Primary implementation anchors

MCP is managed by the CLI backend, not local extension services. The extension interacts with MCP via HTTP client methods in [`http-client.ts`](../../src/services/cli-backend/http-client.ts): `getMcpStatus`, `addMcpServer`, `connectMcpServer`, `disconnectMcpServer`. The [`BrowserAutomationService`](../../src/services/browser-automation/browser-automation-service.ts) uses these methods to register Playwright as an MCP server.
