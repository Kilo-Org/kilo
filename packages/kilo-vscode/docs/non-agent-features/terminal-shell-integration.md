# Terminal / shell integration

- **What it is**: Execute terminal commands and capture output without manual copy/paste, tracking exit codes and working directory changes.

## Docs references

- [`apps/kilocode-docs/pages/automate/extending/shell-integration.md`](../../apps/kilocode-docs/pages/automate/extending/shell-integration.md)

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Delegate command execution and PTY/shell management to Kilo CLI server endpoints.
  - Keep VS Code terminal UX (presentation, streaming, approvals) in the extension as an adapter.
- **Reimplementation required?**: Partial.

## Implementation notes

- Some shell integration may live outside `src/services` (for example in tool implementations), but is a foundational automation substrate.
