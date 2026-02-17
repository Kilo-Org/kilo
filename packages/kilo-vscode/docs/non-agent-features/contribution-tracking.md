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

## Primary implementation anchors

- [`src/services/contribution-tracking/`](../../src/services/contribution-tracking/)
