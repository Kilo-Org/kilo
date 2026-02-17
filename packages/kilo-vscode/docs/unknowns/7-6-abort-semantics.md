# 7.6 Abort semantics scope (`POST /session/:id/abort`)

**What we can confirm from OpenCode code**

- `POST /session/:sessionID/abort` calls [`SessionPrompt.cancel()`](../../kilo/packages/opencode/src/session/prompt.ts:244) [`SessionRoutes()`](../../kilo/packages/opencode/src/server/routes/session.ts:22).
- [`SessionPrompt.cancel()`](../../kilo/packages/opencode/src/session/prompt.ts:244) aborts the per-session `AbortController`, rejects any waiters, clears in-memory state, and sets the session status to idle. This indicates abort cancels the **current run**, not the entire session history.

**What remains unknown (needs live SSE capture)**

- Whether abort always results in a predictable terminal event (e.g. `message.updated` with `MessageAbortedError`) in addition to halting token deltas.

**Actionable conclusion**: map Kilo “Stop” to `POST /session/:id/abort`, and treat it as “cancel current generation/tool execution” rather than “delete/restart session”.
