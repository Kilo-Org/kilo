# File Permission Dialogs

Batch approval UI for file read operations.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/PermissionDock.tsx`](../../webview-ui/src/components/chat/PermissionDock.tsx:1)
- [`webview-ui/src/components/chat/ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx:1)
- [`webview-ui/src/context/session.tsx`](../../webview-ui/src/context/session.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Interactions

- Batch file read approval interface
- Per-file permission management
- Approve/deny multiple file read requests

## Current Progress

- Permission prompts now render inline in the prompt dock area (not a modal dialog), matching the app pattern.
- Pending permissions naturally block prompt input because they are part of the chat dock's `blocked` flow.
- Inline prompt uses `BasicTool` + `permission-prompt` affordances with `Deny`, `Allow always`, and `Allow once` actions.
- SSE permission events now forward permission `patterns` and `always` metadata to the webview for richer context display.
- Multi-request queue UX is now available in the dock (next/previous navigation with `Request X of N` state).
- Added batch controls for pending queue (`Deny all`, `Allow all always`, `Allow all once`) while preserving per-request actions.

## Remaining Gaps

- Per-file granularity/overrides beyond the current pattern list need parity work if required by product UX.

## Suggested migration

**Reimplement?** Partial (UI can stay; semantics need remapping).

- Kilo CLI uses a permission-request queue (asked/replied) model; the extension host must translate Kilo CLI permission events into Kilo's existing approval UX per [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
- If Kilo CLI permission prompts are per-tool-call (not "batch per-file"), you may need to:
  - either keep a batch UI but respond to permissions one-by-one, or
  - simplify the UI to match Kilo CLI's permission granularity.
- Kilo CLI UI reference: permission prompt actions exist in [`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/message-part.tsx:1).
