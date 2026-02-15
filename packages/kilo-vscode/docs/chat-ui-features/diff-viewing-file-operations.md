# Diff Viewing & File Operations

Interactive diff viewing and file navigation actions for tool-generated file changes.

## Status

✅ Done (P0 scope)

## Location

- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Current Progress

- Tool rows already expose file actions (`Open file`, `Copy path`)
- Added `Open Diff` inline action for tool outputs that include before/after content (`edit`, `write`, `apply_patch`)
- `Open Diff` routes through extension host and opens native VS Code side-by-side diff preview (`vscode.diff`)
- Added inline diff previews in chat rows with per-file truncation handling
- Added chat-level and per-file +/- line statistics for tool diff outputs
- Added batch review workflow for multi-file edits (`Review Files` quick-pick + `Open All Diffs`)
- Inline diff previews now render as syntax-highlighted `diff` markdown blocks

## Suggested migration

**Reimplement?** Partial.

- Keep native VS Code diff opening in extension host for editor-quality review.
- Add richer in-webview diff summaries/rendering where parity expects chat-native review flows.
