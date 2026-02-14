# Message Editing & Management

Interactive editing and message management for user-authored messages.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx:1)
- [`webview-ui/src/components/chat/PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx:1)

## Interactions

- Edit user messages inline with full chat input features
- Delete user messages from conversation
- Click-to-edit on message text
- Mode selector integration during edit
- Image attachment support during edit
- Cancel/Save actions
- Optional timestamp display

## Current Progress

- Chat rows now display message timestamps from message creation time
- Up-arrow on an empty prompt restores the previous user message text
- Message context menus now include session-management actions:
  - **Fork from message** (create a new session from that point)
  - **Undo** on user messages (revert session to that message point)

## Remaining Gaps

- Inline edit and delete actions that directly modify user-authored message text
- Full in-place edit flow parity (edit controls inside the message row, attachments/mode controls) instead of session-level fork/revert actions

## Suggested migration

**Reimplement?** **Partial** (depends on who owns history).

- If Kilo CLI becomes the source of truth for session history, Kilo can’t “just edit/delete locally” anymore; it needs adapter support to express edits as Kilo CLI session operations.
- Recommended approach:
  - Keep the current UI affordances.
  - Implement edit/delete by mapping to Kilo CLI session operations (e.g. revert/undo/fork-from-message + re-run) as part of the extension-host adapter described in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
- Kilo CLI’s app UI includes session-level undo/redo/fork concepts (see command labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilo/blob/main/packages/app/src/i18n/en.ts:1)), which suggests parity exists at the session-operation layer, but not necessarily “inline edit message text”.
