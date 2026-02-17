# Autocomplete (aka Ghost)

- **What it is**: Inline in-editor suggestions (including multi-line completions) plus chat-input autocomplete.

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

- [`src/services/ghost/`](../../src/services/ghost/)
- [`src/services/ghost/classic-auto-complete/`](../../src/services/ghost/classic-auto-complete/)
- [`src/services/ghost/chat-autocomplete/`](../../src/services/ghost/chat-autocomplete/)
- [`src/services/ghost/context/`](../../src/services/ghost/context/)
