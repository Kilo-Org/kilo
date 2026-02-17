# 7.2 `/event` scoping (directory vs session) and client-side filtering

**What we can confirm from OpenCode code**

- The server selects an **instance** based on `?directory=` (or `x-opencode-directory` header), defaulting to [`process.cwd()`](../../kilo/packages/opencode/src/server/server.ts:126). All subsequent routes (including `/event` and `/session/*`) run inside that instance context [`Instance.provide()`](../../kilo/packages/opencode/src/project/instance.ts:18).
- `/event` subscribes to **all** bus events for that instance; it is not session-scoped, so clients must filter by `properties.sessionID` where applicable [`Bus.subscribeAll()`](../../kilo/packages/opencode/src/bus/index.ts:85).
- `/global/event` is the cross-instance stream that includes `directory` so a client can multiplex multiple workspaces in one connection if needed [`../../kilo/packages/opencode/src/server/routes/global.ts`](../../../kilo/packages/opencode/src/server/routes/global.ts:39).

**What remains unknown (needs live SSE capture)**

- Whether any session-related event variants omit `sessionID` in `properties` in practice (the schemas suggest most session-level events include it, but this should be validated empirically).

**Actionable conclusion**: for a Kilo adapter, prefer **one `/event` subscription per workspace instance**, and then filter events by `properties.sessionID` for the active chat.
