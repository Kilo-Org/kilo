# Code reviews (local and cloud workflows)

- **What it is**: Automated AI review on PR open/update (cloud) plus a local “Review Mode”.

## Review scopes (service scan)

- Uncommitted (working tree).
- Branch vs base branch (main/master/develop detection).

## Docs references

- [`apps/kilocode-docs/pages/automate/code-reviews.md`](../../apps/kilocode-docs/pages/automate/code-reviews.md)

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Keep Kilo's review-mode UX in the VS Code extension host.
  - Optionally reuse Kilo CLI review templates/prompts server-side, but avoid depending on server UI that doesn't exist.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/review/`](../../src/services/review/)
