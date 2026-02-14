# Todo List Management

Interactive todo tracking surfaced from CLI session state.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/TodoPanel.tsx`](../../webview-ui/src/components/chat/TodoPanel.tsx:1)
- [`webview-ui/src/context/session.tsx`](../../webview-ui/src/context/session.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Current Progress

- `todo.updated` SSE events are wired from extension host to webview store
- Todo items render in chat with status badges and progress bar
- Completed-items visibility toggle is available
- Todo rows support context-menu copy actions
- Session load now fetches `/session/{id}/todo` so historical sessions populate todo state immediately

## Remaining Gaps

- Inline edit/add/delete flows in the webview
- Write-back/update interactions for todo changes from UI to backend
- Richer management UX parity (status dropdown editing, confirmation flows)

## Suggested migration

**Reimplement?** Partial.

- Keep current event-driven todo rendering.
- Add explicit backend write API support (or tool-bridged update flow) before implementing full inline todo editing in the webview.
