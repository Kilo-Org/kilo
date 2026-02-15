# Custom command system

- **What it is**: Built-in + user-defined + project-defined reusable commands (often surfaced as slash commands).
- **Status**: ✅ Done

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
- [`src/extension.ts`](../../src/extension.ts)
- [`webview-ui/src/components/chat/PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx)

## Current Progress

- Slash picker in chat discovers CLI `/command` definitions with keyboard navigation and source badges
- Command palette entry point opens slash picker directly
- Added project/global command-authoring flows:
  - `Create Project Slash Command`
  - `Create Global Slash Command`
- Authoring commands scaffold frontmatter-based command files and open them for editing
