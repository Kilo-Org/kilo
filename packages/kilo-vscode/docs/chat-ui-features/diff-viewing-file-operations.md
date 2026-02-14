# Diff Viewing & File Operations

Interactive diff viewing and file navigation actions for tool-generated file changes.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Current Progress

- Tool rows already expose file actions (`Open file`, `Copy path`)
- Added `Open Diff` inline action for tool outputs that include before/after content (`edit`, `write`, `apply_patch`)
- `Open Diff` routes through extension host and opens native VS Code side-by-side diff preview (`vscode.diff`)

## Remaining Gaps

- Inline diff rendering directly in chat rows
- Rich file-change statistics UI (+/- line summaries) at chat level
- Batch approval/review workflow parity for multi-file operations
- Broader syntax-highlighted diff visualization in webview itself

## Suggested migration

**Reimplement?** Partial.

- Keep native VS Code diff opening in extension host for editor-quality review.
- Add richer in-webview diff summaries/rendering where parity expects chat-native review flows.
