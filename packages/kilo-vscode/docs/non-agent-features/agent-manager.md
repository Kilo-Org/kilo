# Agent Manager

- **What it is**: A control panel for running agents as interactive CLI processes, resumable sessions (local/cloud), approvals, cancellation, and parallel work via worktrees.

## Docs references

- [`apps/kilocode-docs/pages/automate/agent-manager.md`](../../apps/kilocode-docs/pages/automate/agent-manager.md)

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep/reimplement agent/session orchestration in the extension (spawning/managing multiple Kilo CLI servers/sessions).
  - Treat Kilo CLI as the execution backend per session, not the orchestrator.
- **Reimplementation required?**: Yes.
