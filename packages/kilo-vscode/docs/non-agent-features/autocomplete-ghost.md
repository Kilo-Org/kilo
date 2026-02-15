# Autocomplete (aka Ghost)

- **What it is**: Inline in-editor suggestions (including multi-line completions) plus chat-input autocomplete.

## Status

🔨 Partial

## Current progress

- Extension-host autocomplete service manager is wired and lifecycle-managed.
- Inline completion provider registration is active for file editors.
- Fill-in-the-middle completion flow exists in the transplanted autocomplete runtime.
- Manual suggestion generation command exists (`kilo-code.new.autocomplete.generateSuggestions`).
- Chat textarea autocomplete request/accept flow is wired through webview ↔ extension messages.
- Related status bar/snooze plumbing is present in the autocomplete service layer.

## Notable characteristics

- Auto-trigger and manual trigger.
- Completion strategies optimized for fill-in-the-middle.
- Context tracking (visible/recent code) and UX/telemetry/caching around completions.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/autocomplete/index.md`](../../apps/kilocode-docs/pages/code-with-ai/features/autocomplete/index.md)

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep autocomplete (Ghost) in the VS Code extension host; it is tightly coupled to editor UX (inline completions) and local context tracking.
  - If Kilo CLI server needs to contribute in the future, add explicit completion endpoints, but keep triggering/rendering IDE-side.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

- [`src/services/autocomplete/`](../../src/services/autocomplete/)
- [`src/services/autocomplete/classic-auto-complete/`](../../src/services/autocomplete/classic-auto-complete/)
- [`src/services/autocomplete/chat-autocomplete/`](../../src/services/autocomplete/chat-autocomplete/)
- [`src/services/autocomplete/context/`](../../src/services/autocomplete/context/)

## Remaining gaps

- Legacy parity hardening for ranking/quality across language edge cases.
- UX/compatibility validation against conflicting extensions and multi-workspace setups.
- Consolidated telemetry/observability parity once extension-wide telemetry pipeline is finalized.
