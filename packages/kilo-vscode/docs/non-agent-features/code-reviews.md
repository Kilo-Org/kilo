# Code reviews (local and cloud workflows)

- **What it is**: Automated AI review on PR open/update (cloud) plus a local “Review Mode”.

## Status

✅ Done

## Current progress

- Added extension command `kilo-code.new.reviewChanges`.
- Added Source Control title-bar integration (`scm/title`) for quick access.
- Local review scopes now supported by prompt workflow:
  - Working tree (`git diff`)
  - Staged (`git diff --cached`)
  - Branch vs base (`<base>...HEAD`, with base auto-detection)
- Diff context (name-status, stats, patch excerpt) is collected and sent to chat as a structured review prompt.

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
- **Reimplementation required?**: Completed for migration-plan parity scope.

## Primary implementation anchors

- [`src/extension.ts`](../../src/extension.ts)

## Remaining gaps

- None for migration-plan parity scope.
