# Follow-Up Questions

Suggested replies presented as interactive chips/buttons.

## Location

- [`webview-ui/src/components/chat/FollowUpSuggest.tsx`](../../webview-ui/src/components/chat/FollowUpSuggest.tsx:1)

## Interactions

- Click to submit suggested response
- Shift-click or dedicated button to copy suggestion to chat input
- Mode indicators for suggestions that switch modes
- Auto-approval countdown timer (default 60s) for automatic selection
- Timer cancellation on user interaction (pausing input or selecting suggestion)

## Suggested migration

**Reimplement?** Likely yes (feature may not exist in Kilo CLI).

- This feature requires explicit “suggestions” data. Kilo CLI’s core API/events focus on sessions/messages/permissions; follow-up suggestion generation is not obviously part of that contract.
- Options:
  - Keep the current Kilo-side follow-up suggestion generation (if it’s already Kilo-generated), or
  - Add an adapter step that asks Kilo CLI for suggested follow-ups after a turn completes (and then surfaces them to the webview).
- Treat this as **non-blocking** for Phase 2 MVP in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1) unless UX parity requires it immediately.
