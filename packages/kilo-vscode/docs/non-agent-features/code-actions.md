# Code Actions

- **What it is**: Integrates into VS Code Code Actions UI (lightbulb/context menu) to trigger AI actions like explain/fix/improve, or add selection to context.

## Notable characteristics

- Can run inside current task or spawn a new task.
- Prompt templates configurable.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/code-actions.md`](../../apps/kilocode-docs/pages/code-with-ai/features/code-actions.md)

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep code actions in the VS Code extension host (VS Code APIs, diagnostics, and editor-specific UX).
  - Reimplement any backing logic that currently depends on the core agent loop, but keep action registration and application IDE-side.
- **Reimplementation required?**: Yes.

## Primary implementation anchors (partial)

- [`src/services/ghost/GhostCodeActionProvider.ts`](../../src/services/ghost/GhostCodeActionProvider.ts)
