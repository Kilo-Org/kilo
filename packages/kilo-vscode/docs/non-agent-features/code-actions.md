# Code Actions

- **What it is**: Integrates into VS Code Code Actions UI (lightbulb/context menu) to trigger AI actions like explain/fix/improve, or add selection to context.

## Status

✅ Done

## Current progress

- VS Code code actions are now registered for selected code in file editors:
  - `Kilo: Explain Selection`
  - `Kilo: Fix Selection`
  - `Kilo: Improve Selection`
- Matching editor context-menu commands are contributed and routed through extension commands.
- Diagnostics-aware quick fix action is now available from the lightbulb (`Kilo: Fix This Diagnostic`) and passes diagnostic context into the generated prompt.
- Prompt templates are configurable via VS Code settings:
  - `kilo-code.new.codeActions.explainTemplate`
  - `kilo-code.new.codeActions.fixTemplate`
  - `kilo-code.new.codeActions.improveTemplate`
- Actions open/focus the Kilo sidebar, navigate to chat view, and prefill a structured prompt with:
  - file path
  - selection line/column range
  - fenced code block of selected text
  - diagnostic message (for diagnostics-driven fixes)

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

- [`src/services/code-actions/KiloCodeActionProvider.ts`](../../src/services/code-actions/KiloCodeActionProvider.ts)
- [`src/extension.ts`](../../src/extension.ts)

## Remaining gaps

- Optional “apply fix directly” workflows beyond prompt-prefill handoff.
