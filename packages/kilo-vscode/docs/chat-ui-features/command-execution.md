# Command Execution

Interactive terminal output rendering and approval controls for executed commands.

## Location

Command execution rendering is now handled by kilo-ui's `<KiloMessage>` component which includes per-tool renderers including `BasicTool`. There is no standalone command execution component — tool messages are rendered through the unified message pipeline.

## Interactions

- Expand/collapse terminal output (chevron down icon)
- Abort button to kill running processes (shows PID)
- Exit status indicator - color-coded dot (green=success, red=failure) with tooltip
- Command pattern selector:
  - Allow/deny command patterns
  - Updates auto-approval settings
- Real-time output streaming - shows live command output as it executes
- Syntax highlighting for shell commands

## Suggested migration

**Reimplement?** Partial.

- With Kilo CLI executing tools server-side, “abort” should map to Kilo CLI’s session abort semantics (see Phase 2 in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1)) rather than killing a local PID.
- If Kilo CLI does not expose the underlying process PID, the UI may need to degrade gracefully (hide PID, keep “Abort current run”).
- Kilo CLI UI reference: command/tool output is rendered as markdown/code in [`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/message-part.tsx:1).
- Streaming output should be sourced from Kilo CLI SSE events (adapter work), but the webview rendering can remain.
