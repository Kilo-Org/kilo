# 7.8 Provider credential storage for `PUT /auth/:providerID`

## VS Code extension credential threat model (Feb 2026)

- The extension host does not persist provider API keys/tokens in `globalState`, `workspaceState`, or extension settings.
- Provider credentials remain CLI-managed (`auth.json` in CLI data dir with best-effort file permissions).
- Extension-owned persisted values are limited to non-secret UX/config state (settings tab, history cache, toggles, diagnostics metadata).
- Because credentials are CLI-owned, VS Code `SecretStorage` does not currently improve storage for provider auth without introducing a duplicate credential plane.

Security posture for this rebuild:

- keep credentials single-sourced in CLI storage,
- avoid shadow copies in extension state,
- continue auditing CLI credential-at-rest strategy separately for long-term keychain integration.

**What we can confirm from OpenCode code**

- `PUT /auth/:providerID` exists and writes an [`Auth.Info`](../../kilo/packages/opencode/src/auth/index.ts:35) discriminated union (`oauth` refresh/access/expires, `api` key, or `wellknown` key+token) via [`Auth.set()`](../../kilo/packages/opencode/src/auth/index.ts:59) [`Server.App()`](../../kilo/packages/opencode/src/server/server.ts:58).
- Credentials are stored as plaintext JSON in `${Global.Path.data}/auth.json` and chmod’d to `0600` [`Global.Path.data`](../../kilo/packages/opencode/src/global/index.ts:14) [`Auth.set()`](../../kilo/packages/opencode/src/auth/index.ts:59).

**What remains unknown (needs platform validation)**

- Whether there is any OS keychain integration (we did not find any in this repo).
- Whether chmod-based secrecy is meaningful on all target platforms (notably Windows).

**Actionable conclusion**: extension-side storage is already non-secret by design; credential-at-rest hardening remains a CLI backend concern (future keychain abstraction).
