# Fast edits (diff-based editing)

- **What it is**: A file-editing strategy preference to apply diffs/patches rather than rewriting full files.
- **Why it matters**: Improves speed and reduces risk of truncation/large rewrites; includes match-precision tuning.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/fast-edits.md`](../../apps/kilocode-docs/pages/code-with-ai/features/fast-edits.md)

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Prefer Kilo CLI server patch/apply tooling for generating and applying edits.
  - Keep VS Code-specific diff/preview/confirmation UX in the extension host.
- **Reimplementation required?**: Partial.

## Implementation notes

- This often spans “tooling” and edit-application code, and may not appear as a single service directory under `src/services`.
