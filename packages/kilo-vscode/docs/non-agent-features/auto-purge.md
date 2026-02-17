# Auto-purge (task storage cleanup)

- **What it is**: Scheduled cleanup of old task/history storage to prevent uncontrolled disk growth.

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Decide storage ownership (server vs extension) and implement purge accordingly.
  - Until server-side storage is authoritative, keep purge logic in the extension host.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

- [`src/services/auto-purge/`](../../src/services/auto-purge/)
