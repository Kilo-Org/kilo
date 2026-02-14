# Code Block Interactions

Interactive functionality for rendered code blocks (copying, expanding, scroll behavior).

## Status

🔨 Partial

## Location

Code blocks are rendered via kilo-ui's `<KiloMessage>` component with shiki syntax highlighting. There is no standalone `CodeBlock.tsx` in the new extension — code block rendering is handled by kilo-ui's markdown pipeline via `<MarkedProvider>`.

- [`packages/ui/src/components/markdown.tsx`](../../../ui/src/components/markdown.tsx:1)
- [`packages/ui/src/components/markdown.css`](../../../ui/src/components/markdown.css:1)

## Interactions

- Copy button with visual feedback (checkmark icon)
- Expand/collapse for long code blocks (500px threshold)
- Sticky button positioning during scroll
- Inertial scroll chaining between code block and container
- Auto-hide buttons during text selection

## Current Progress

- Copy button with copied-state feedback is available on markdown code blocks
- Long code blocks now support expand/collapse controls with a 500px collapsed threshold
- Collapsed long blocks show a bottom fade affordance and inline expand action

## Remaining Gaps

- Deeper sticky-button behavior parity during complex scroll/selection interactions
- Inertial scroll chaining refinements between nested code blocks and parent container
