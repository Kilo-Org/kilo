# Settings Sync integration

- **What it is**: Registers an allowlist of extension state/settings for VS Code settings sync.
- **Status**: ✅ Done

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep Settings Sync integration in the VS Code extension host (VS Code Settings Sync APIs).
  - Optionally mirror a subset of settings into Kilo CLI config, but do not require server support.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

- [`src/services/settings-sync/`](../../src/services/settings-sync/)

## Current State

- Added `settings-sync` service in extension host and activation-time registration via `globalState.setKeysForSync(...)`.
- Settings UI active tab is persisted in extension `globalState` and synced across devices.
- Last provider auth target is persisted for synced state continuity.
- Added broader sync coverage for global rules/workflow toggles and workspace-scoped keys (session history cache + agent manager state).
- Added legacy-key migration so older stored keys are imported into the new sync namespace when needed.
- Added diagnostics command (`Show Settings Sync Diagnostics`) to inspect registered sync keys and current synced values.

## Remaining Gaps

- None for migration-plan parity scope
