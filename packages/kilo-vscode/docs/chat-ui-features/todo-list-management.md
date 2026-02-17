# Todo List Management

Interactive editing for todo lists surfaced by the agent/tool messages.

## Location

Todo list data flows through the SSE pipeline: `todo.updated` events are handled by KiloProvider → webview message → session store with `todos()` accessor. No rendering UI component exists yet. The old `UpdateTodoListToolBlock.tsx` is not present in the new extension.

## Interactions

- Edit/Done mode toggle button
- Inline editing of todo items
- Status dropdown to change status (Not Started → In Progress → Completed)
- Add new todo items with Enter key support
- Delete individual todos with confirmation dialog
- Color-coded status indicators
- Auto-save - changes immediately notify parent component

## Suggested migration

**Reimplement?** Likely yes (Kilo-specific tool/UI).

- This is driven by a Kilo tool message (`UpdateTodoListToolBlock`). Unless Kilo CLI provides an equivalent “todo list” tool/event, you will need to:
  - either keep a Kilo-side todo-state feature (maintained by the extension host and surfaced to the webview), or
  - add an Kilo CLI tool/plugin that emits todo-list state changes as events.
- Recommended: treat as optional until Phase 3+ in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1), unless todo tracking is considered core UX.
