# 7.1 SSE event names & payloads (streaming, tools, permissions, completion)

**What we can confirm from OpenCode code**

- `/event` streams **instance-scoped** bus events as JSON objects shaped like `{ "type": string, "properties": object }`, and it sends a `server.connected` event immediately plus a `server.heartbeat` every 30s (WKWebView keepalive) [`Server.App()`](../../kilo/packages/opencode/src/server/server.ts:58) [`stream.writeSSE()`](../../kilo/packages/opencode/src/server/server.ts:493).
- `/global/event` streams **cross-instance** events shaped like `{ directory: string, payload: { type, properties } }` (note: the initial `server.connected` payload currently does not include `directory`, even though the OpenAPI schema claims one) [`packages/opencode/src/server/routes/global.ts`](../../kilo/packages/opencode/src/server/routes/global.ts:39).
- The SDK-side SSE client parses standard SSE framing (`data:`, optional `event:`, `id:`, `retry:`), but OpenCode’s server uses [`stream.writeSSE()`](../../kilo/packages/opencode/src/server/server.ts:493) without setting an `event` name, so `event:` is expected to be absent/undefined in practice [`createSseClient()`](../../kilo/packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts:78).
- OpenCode’s event type universe is generated from [`BusEvent.payloads()`](../../kilo/packages/opencode/src/bus/bus-event.ts:21) (OpenAPI lists a large union including `message.updated`, `message.part.updated`, `permission.asked`, `permission.replied`, `session.*`, `project.updated`, etc.) [`packages/sdk/openapi.json`](../../kilo/packages/sdk/openapi.json:8215).
- **Token streaming / incremental deltas** appear to be modeled as `message.part.updated` with an optional `delta` alongside a full `part` object [`MessageV2.Event.PartUpdated`](../../kilo/packages/opencode/src/session/message-v2.ts:413) [`Session.updatePart()`](../../kilo/packages/opencode/src/session/index.ts:411).
- **Tool lifecycle** is represented as `tool` parts (`pending | running | completed | error`) surfaced via the same event type [`MessageV2.ToolPart`](../../kilo/packages/opencode/src/session/message-v2.ts:289).
- **Permission prompts** are emitted as `permission.asked` and answered via `permission.replied` [`PermissionNext.Event.Asked`](../../kilo/packages/opencode/src/permission/next.ts:96) [`PermissionNext.Event.Replied`](../../kilo/packages/opencode/src/permission/next.ts:98).

**What remains unknown (needs live SSE capture)**

- Exact cadence and ordering during a run (e.g., whether `delta` is token-level vs chunk-level, and how it interleaves with `message.updated`).
- Whether tool calls emit a predictable “start” marker vs only part state transitions.

**Actionable conclusion**: treat `/event` as a stream of **typed JSON payloads** where “event name” is the `type` field inside the JSON, and implement rendering based on `message.part.updated` + `delta` rather than expecting separate “token” events.
