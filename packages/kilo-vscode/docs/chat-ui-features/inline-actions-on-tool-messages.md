# Inline Actions on Tool Messages

Inline affordances on tool messages to navigate, inspect, and track progress.

## Status

🔨 Partial

## Location

- Various tool message components

## Interactions

- **FastApplyResult Display**: Shows results of fast-apply operations
- **Jump to File**: Opens files directly from file operation messages
- **External Link Icons**: Navigate to related files/resources
- **Progress Indicators**: Real-time status for long-running operations

## Current Progress

- Tool rows already show status/progress states via kilo-ui renderers
- Read/write/edit/list/apply_patch tool rows now expose inline "Open file" actions in the webview
- Tool rows with file metadata now expose inline "Copy path" actions
- Tool rows with before/after metadata now expose inline "Open Diff" actions (native VS Code diff preview)
- Multi-file tool metadata now surfaces an inline `+N more` hint for additional file targets
- Resource/link actions were expanded beyond file tools: tool wrappers now extract URL/resource metadata and expose inline `Open Link` / `Copy Link` actions.
- Added wrapper coverage for web/resource-oriented tools (`webfetch`, `websearch`, `codesearch`, `fetch`, `search`, `mcp`) where renderers are available.

## Remaining Gaps

- Parity polish for richer external-link/file-operation affordances and deeper progress/status visualization across all tool families

## Suggested migration

**Reimplement?** Partial.

- Inline actions are mostly presentation-layer, but they depend on tool/result metadata being present in the message stream.
- With Kilo CLI owning orchestration, ensure the adapter:
  - preserves tool-call identifiers and status transitions (start/progress/finish) so existing progress indicators continue to work,
  - preserves file/diff references so jump-to-file and diff UIs remain functional.
- Kilo CLI UI reference: tool-part wrappers and permission prompts live in [`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/message-part.tsx:1), which is a good reference for the minimal metadata needed to support inline actions.
