# Checkpoint & Task Management

Checkpoint restore/navigation and task-level UX actions.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/TaskHeader.tsx`](../../webview-ui/src/components/chat/TaskHeader.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Interactions

- Checkpoint restore dialogs
- Checkpoint navigation menu
- "See New Changes" buttons to view git diffs for completed tasks

## Current Progress

- Task header now includes a working **See New Changes** action
- Extension host action opens Source Control and jumps to the first changed resource
- Task header now includes a **Checkpoints** action that opens a native quick-pick restore menu for session messages
- Checkpoint restore flow now includes explicit confirmation dialog before applying CLI revert semantics
- Chat message context menu now includes **Fork from message** backed by CLI session fork endpoint
- Chat message context menu includes **Open Forks** session picker (child-session navigation)
- User-message **Undo** action now uses an explicit confirmation dialog before session revert

## Remaining Gaps

- Full undo/redo parity and checkpoint-specific restore affordances

## Suggested migration

**Reimplement?** Partial.

- If “checkpoints” are implemented as Kilo-side git snapshots, they can remain a VS Code integration owned by the extension host (still valid under the new architecture).
- If you want to align with Kilo CLI-native session operations (undo/redo/fork/diff), implement adapter support that maps those Kilo CLI session controls into existing Kilo UI affordances (or add new controls).
- Kilo CLI references: session-level undo/redo/fork appear as first-class concepts in the app UI (see command labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilo/blob/main/packages/app/src/i18n/en.ts:1)) and diff rendering in [`packages/ui/src/components/session-turn.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/session-turn.tsx:1).
