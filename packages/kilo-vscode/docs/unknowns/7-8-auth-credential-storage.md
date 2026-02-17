# 7.8 Provider credential storage for `PUT /auth/:providerID`

**What we can confirm from OpenCode code**

- `PUT /auth/:providerID` exists and writes an [`Auth.Info`](../../kilo/packages/opencode/src/auth/index.ts:35) discriminated union (`oauth` refresh/access/expires, `api` key, or `wellknown` key+token) via [`Auth.set()`](../../kilo/packages/opencode/src/auth/index.ts:59) [`Server.App()`](../../kilo/packages/opencode/src/server/server.ts:58).
- Credentials are stored as plaintext JSON in `${Global.Path.data}/auth.json` and chmod’d to `0600` [`Global.Path.data`](../../kilo/packages/opencode/src/global/index.ts:14) [`Auth.set()`](../../kilo/packages/opencode/src/auth/index.ts:59).

**What remains unknown (needs platform validation)**

- Whether there is any OS keychain integration (we did not find any in this repo).
- Whether chmod-based secrecy is meaningful on all target platforms (notably Windows).

**Actionable conclusion**: plan for “local plaintext secrets with best-effort file permissions”; if Kilo requires stronger secret storage semantics, we need an additional abstraction.
