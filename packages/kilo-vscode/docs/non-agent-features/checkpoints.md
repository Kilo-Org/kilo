# Checkpoints (shadow versioning, workspace time travel)

- **What it is**: Task-scoped snapshots stored in a shadow git repository, with UI to diff/restore.

## Capabilities

- Per-task checkpoint history.
- Restore files only vs restore files + task state.
- Safety checks to avoid problematic paths/nested repos.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/checkpoints.md`](../../apps/kilocode-docs/pages/code-with-ai/features/checkpoints.md)

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Evaluate whether Kilo CLI snapshots/revert semantics map to Kilo checkpoints (per-task, excludes, UX expectations).
  - If they map, delegate snapshot creation/storage/revert to Kilo CLI; otherwise keep the existing Kilo checkpoint service.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/checkpoints/`](../../src/services/checkpoints/)
