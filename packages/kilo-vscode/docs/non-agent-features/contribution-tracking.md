# Contribution tracking (AI attribution)

- **What it is**: Tracks AI-assisted modifications for organizational reporting.

## Notable characteristics

- Formatting-aware diffing.
- Line hashing/fingerprinting.
- Token/JWT handling for attribution APIs.

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep contribution tracking in the VS Code extension host.
  - If required later, add server-side storage/aggregation, but assume extension ownership for now.
- **Reimplementation required?**: Yes.

## Current progress

- Added extension-host contribution tracking that records tool-based file edits and line-change stats from SSE tool updates.
- Added command palette actions to view and clear per-workspace contribution reports.
- Remaining work includes line-level fingerprinting, cloud attribution APIs, and organization-level reporting surfaces.

## Primary implementation anchors

- [`src/services/contribution-tracking/`](../../src/services/contribution-tracking/)
