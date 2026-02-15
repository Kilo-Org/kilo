# Auto-Approval Controls

Interactive UI for configuring and toggling auto-approval.

## Location

- [`webview-ui/src/components/settings/AutoApproveTab.tsx`](../../webview-ui/src/components/settings/AutoApproveTab.tsx:1)

## Status

✅ Done

## Interactions

- Auto-approval toggle to enable/disable
- Scope selectors to configure which actions auto-approve
- Timeout configuration for auto-approval delays

## Current Progress

- Auto-approval settings tab now supports per-tool permission levels (`allow` / `ask` / `deny`)
- Supports global fallback (`*`) plus tool-level overrides
- Includes quick presets (`Safe defaults`, `Full auto`, `Require prompts`)
- Added temporary edit auto-approval window controls with selectable duration and live countdown (`Start window` / `Stop`)
- Temporary window automatically restores the prior `edit` permission level when the timer expires

## Remaining Gaps

- None for migration-plan parity scope.

## Suggested migration

**Reimplement?** Completed.

- Kilo CLI’s permission system supports “remember/always allow” patterns; Kilo’s auto-approve controls should map onto Kilo CLI permission replies (e.g. “allow once” vs “allow always”) plus Kilo CLI-side permission configuration.
- The Kilo UI can remain, but the extension host needs a translation layer that:
  - updates Kilo CLI permission config (if supported) or
  - chooses `remember` appropriately when replying to permission prompts.
- Kilo CLI reference: “autoaccept edits” exists in the app command set (see `command.permissions.autoaccept.*` labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilo/blob/main/packages/app/src/i18n/en.ts:1)).
