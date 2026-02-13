# Code Block Interactions

Interactive functionality for rendered code blocks (copying, expanding, scroll behavior).

## Status

🔨 Partial

## Location

Code blocks are now rendered via kilo-ui's `<KiloMessage>` component with shiki syntax highlighting. There is no standalone `CodeBlock.tsx` in the new extension — code block rendering is handled internally by kilo-ui's markdown pipeline via `<MarkedProvider>`.

## Interactions

- Copy button with visual feedback (checkmark icon)
- Expand/collapse for long code blocks (500px threshold)
- Sticky button positioning during scroll
- Inertial scroll chaining between code block and container
- Auto-hide buttons during text selection
