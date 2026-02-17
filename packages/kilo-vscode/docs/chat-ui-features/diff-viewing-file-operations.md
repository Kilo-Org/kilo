# Diff Viewing & File Operations

Interactive diff viewing, navigation, and batch approvals for file changes.

## Location

- [`webview-ui/src/components/common/CodeAccordian.tsx`](../../webview-ui/src/components/common/CodeAccordian.tsx:1)
- [`webview-ui/src/components/common/DiffView.tsx`](../../webview-ui/src/components/common/DiffView.tsx:1)

## Interactions

- Expand/collapse individual file diffs
- Diff statistics display (+added/-removed line counts)
- Jump to file in editor button (external link icon)
- Syntax-highlighted diffs with color-coded additions/removals
- Batch diff approval interface (`BatchDiffApproval.tsx`)
- Progress status indicators for tool execution

## Suggested migration

**Reimplement?** No for UI, but **yes/adapter work** to source diffs from Kilo CLI.

- Kilo CLI has first-class diff support (e.g. `GET /session/:id/diff` as referenced in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1)).
- Implement mapping from Kilo CLI diff payloads/events into the existing Kilo diff message format so [`webview-ui/src/components/common/DiffView.tsx`](../../webview-ui/src/components/common/DiffView.tsx:1) can continue to render.
- Kilo CLI UI reference: diff presentation exists in [`packages/ui/src/components/session-turn.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/session-turn.tsx:1) and diff rendering components ([`packages/ui/src/components/diff.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/diff.tsx:1)).
- “Jump to file in editor” remains extension-host responsibility.
