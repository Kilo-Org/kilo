# 7.5 `POST /session/:id/message` vs `POST /session/:id/prompt_async`

**What we can confirm from OpenCode code**

- `POST /session/:sessionID/message` awaits [`SessionPrompt.prompt()`](../../kilo/packages/opencode/src/session/prompt.ts:151) and returns the created assistant message JSON in the HTTP response; the server does not stream tokens over this response body (streaming happens via SSE events) [`SessionRoutes()`](../../kilo/packages/opencode/src/server/routes/session.ts:22).
- `POST /session/:sessionID/prompt_async` returns HTTP 204 immediately and kicks off [`SessionPrompt.prompt()`](../../kilo/packages/opencode/src/session/prompt.ts:151) in the background (“fire-and-forget”) [`SessionRoutes()`](../../kilo/packages/opencode/src/server/routes/session.ts:22).

**What remains unknown (needs live SSE capture)**

- Whether errors from `prompt_async` reliably surface via `session.error` / `message.updated` (the error event exists, but we did not confirm all failure paths publish it).

**Actionable conclusion**: for a UI driven entirely by SSE, prefer `prompt_async`; for a request/response flow (e.g. CLI), `message` may be simpler because it returns a final message object.
