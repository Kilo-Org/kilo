# Settings Sync integration

- **What it is**: Registers an allowlist of extension state/settings for VS Code settings sync.
- **Status**: 🔨 Partial

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

## Remaining Gaps

- Only a small subset of extension-host UI state is synced today.
- No migration/import of legacy state keys.
- No explicit sync diagnostics UI for users.
