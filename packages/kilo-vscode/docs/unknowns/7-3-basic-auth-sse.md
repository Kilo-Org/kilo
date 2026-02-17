# 7.3 Basic auth behavior for SSE endpoints

**What we can confirm from OpenCode code**

- Basic auth is applied globally when [`Flag.OPENCODE_SERVER_PASSWORD`](../../kilo/packages/opencode/src/server/server.ts:81) is set, before routing; this should cover `/event` and `/global/event` as well as all JSON endpoints [`basicAuth()`](../../kilo/packages/opencode/src/server/server.ts:84).
- OpenCode’s generated JS SDK uses `fetch`-based SSE (ReadableStream parsing) rather than browser `EventSource`, so it can attach Authorization headers during SSE subscription [`../../kilo/packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts`](../../../kilo/packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts:105).

**What remains unknown (needs live SSE capture)**

- Whether the server sends a helpful JSON error body on 401/403 for SSE connections (SDK currently throws on `!response.ok`).

**Actionable conclusion**: implement SSE via `fetch` (not `EventSource`) so Basic auth headers can be included reliably.
