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

## Current State

- MCP server settings UI is available in `AgentBehaviourTab`:
  - add/update/remove server config (local and remote)
  - connect/disconnect actions
  - status refresh with richer status rendering (connected/disabled/needs auth/failed)
- MCP tool allowlist/disablement is exposed via `config.tools` management in the same subtab.

## Remaining Gaps

- No per-server OAuth recovery flow UI beyond raw status/errors.
- No advanced MCP diagnostics/history panel.
- Tool policy UX is still key-based and not schema-discovered from live server tool metadata.
