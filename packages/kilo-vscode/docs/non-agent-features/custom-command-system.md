# Custom command system

- **What it is**: Built-in + user-defined + project-defined reusable commands (often surfaced as slash commands).

## Capabilities

- Project overrides global overrides built-in.
- YAML frontmatter metadata.
- Symlink-aware command discovery.

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Prefer Kilo CLI's custom command system for definition and execution.
  - Keep VS Code UI entry points (command palette, menus) in the extension host as an adapter.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/command/`](../../src/services/command/)
