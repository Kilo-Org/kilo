# 7.9 MCP semantics vs Kilo’s MCP hub

**What we can confirm from OpenCode code**

- OpenCode exposes MCP management endpoints (`GET/POST /mcp`, auth flows under `/mcp/:name/auth*`, connect/disconnect) [`McpRoutes`](../../kilo/packages/opencode/src/server/routes/mcp.ts:9).
- Remote MCP connections try Streamable HTTP first, then SSE transport; OAuth is supported by default for remote servers unless `oauth: false`. Unauthorized results in `needs_auth` or `needs_client_registration` statuses [`MCP.create()`](../../kilo/packages/opencode/src/mcp/index.ts:291) [`UnauthorizedError`](../../kilo/packages/opencode/src/mcp/index.ts:6).
- MCP OAuth tokens / client info / PKCE verifier / state are stored in `${Global.Path.data}/mcp-auth.json` (chmod `0600`) [`McpAuth`](../../kilo/packages/opencode/src/mcp/auth.ts:6) [`Global.Path.data`](../../kilo/packages/opencode/src/global/index.ts:14).
- MCP tools are surfaced into the AI tool registry, executed via [`Client.callTool()`](../../kilo/packages/opencode/src/mcp/index.ts:135) with timeouts and “resetTimeoutOnProgress” enabled.
- MCP “resources” can be attached to prompts as `file` parts with `source.type === "resource"`, which triggers a pre-read via [`MCP.readResource()`](../../kilo/packages/opencode/src/mcp/index.ts:675) and injects the contents into the message parts [`SessionPrompt.createUserMessage()`](../../kilo/packages/opencode/src/session/prompt.ts:822).

**What remains unknown**

- How well OpenCode’s MCP tool/permission semantics align with Kilo’s existing MCP hub and UI affordances (requires a dedicated behavior/UX comparison).

**Actionable conclusion**: OpenCode already contains an MCP layer (including OAuth + tool-list-change notifications). If we adopt OpenCode as the backend, Kilo should initially treat MCP as “owned by OpenCode” rather than trying to run two parallel MCP systems.
