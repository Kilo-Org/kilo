# 7.4 Session creation semantics (`POST /session`)

**What we can confirm from OpenCode code**

- `POST /session` exists and the request body is optional: `{ parentID?, title?, permission? }` [`SessionRoutes()`](../../kilo/packages/opencode/src/server/routes/session.ts:22).
- Session creation runs in the current instance and uses [`Instance.directory`](../../kilo/packages/opencode/src/project/instance.ts:41) plus [`Instance.project`](../../kilo/packages/opencode/src/project/instance.ts:47) to set `session.directory` + `session.projectID` [`Session.create()`](../../kilo/packages/opencode/src/session/index.ts:130).

**What remains unknown (needs live SSE capture)**

- Whether session creation triggers any immediate SSE events beyond `session.created`/`session.updated` (the event types exist, but sequencing should be validated) [`../../kilo/packages/opencode/src/session/index.ts`](../../kilo/packages/opencode/src/session/index.ts:95).

**Actionable conclusion**: Kilo should create sessions via `POST /session` and then expect session lifecycle updates via SSE (`session.created` / `session.updated`).
