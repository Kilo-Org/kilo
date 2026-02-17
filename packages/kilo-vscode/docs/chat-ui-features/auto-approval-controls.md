# Auto-Approval Controls

Interactive UI for configuring and toggling auto-approval.

## Location

The old `AutoApproveDropdown.tsx` and `AutoApproveMenu.tsx` components don't exist in the new extension. [`AutoApproveTab.tsx`](../../webview-ui/src/components/settings/AutoApproveTab.tsx) exists in settings but is currently a stub. Auto-approval configuration needs to be built as a new feature.

## Interactions

- Auto-approval toggle to enable/disable
- Scope selectors to configure which actions auto-approve
- Timeout configuration for auto-approval delays

## Suggested migration

**Reimplement?** Partial.

- Kilo CLI’s permission system supports “remember/always allow” patterns; Kilo’s auto-approve controls should map onto Kilo CLI permission replies (e.g. “allow once” vs “allow always”) plus Kilo CLI-side permission configuration.
- The Kilo UI can remain, but the extension host needs a translation layer that:
  - updates Kilo CLI permission config (if supported) or
  - chooses `remember` appropriately when replying to permission prompts.
- Kilo CLI reference: “autoaccept edits” exists in the app command set (see `command.permissions.autoaccept.*` labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilo/blob/main/packages/app/src/i18n/en.ts:1)).
