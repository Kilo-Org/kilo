# Git commit message generation

- **What it is**: Generates commit messages from git context (commonly staged changes; some implementations also consider selected files).

## Notable characteristics

- VS Code Source Control integration (fills commit message box).
- Filtering for lockfiles/build noise.
- Regeneration support to avoid repeating similar messages.
- Adapter support for JetBrains.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/git-commit-generation.md`](../../apps/kilocode-docs/pages/code-with-ai/features/git-commit-generation.md)

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep commit message generation in the VS Code extension host (Git integration, UX, and local repo context).
  - Reimplement any agent-loop dependencies as needed, but do not block on server support.
- **Reimplementation required?**: Yes.

## Primary implementation anchors

- [`src/services/commit-message/`](../../src/services/commit-message/)
