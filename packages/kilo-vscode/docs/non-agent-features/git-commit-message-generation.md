# Git commit message generation

- **What it is**: Generates commit messages from git context (commonly staged changes; some implementations also consider selected files).

## Status

✅ Done

## Current progress

- Added extension command `kilo-code.new.generateCommitMessage`.
- Added Source Control title-bar integration via `scm/title` menu.
- Command collects staged git context:
  - `git diff --cached --name-status`
  - `git diff --cached --stat`
  - staged patch excerpt (truncated)
- Command now attempts direct generation via the CLI backend and inserts the generated message into the SCM input box automatically.
- If direct generation fails, command falls back to the chat-prefill flow.
- Added regenerate flow: after insertion, users can request a new variation, and prior suggestions are fed back as "avoid" context to reduce repetitive outputs.
- Added configurable staged patch filtering via VS Code setting `kilo-code.new.git.commitMessageExcludeGlobs`.

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

- [`src/extension.ts`](../../src/extension.ts)

## Remaining gaps

- Dedicated history/iteration UI beyond the notification-based regenerate flow.
