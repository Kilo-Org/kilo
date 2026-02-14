# Mermaid Diagram Features

Interactive actions around Mermaid diagram rendering, error handling, and AI-assisted fixes.

## Location

- [`webview-ui/src/components/common/MermaidBlock.tsx`](../../webview-ui/src/components/common/MermaidBlock.tsx:1)
- [`webview-ui/src/components/common/MermaidButton.tsx`](../../webview-ui/src/components/common/MermaidButton.tsx:1)
- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx:1)

## Interactions

- **"Fix with AI" button** - Auto-fixes mermaid syntax errors using AI (`MermaidSyntaxFixer`)
- Copy button for diagram code
- Click to open rendered diagram as PNG in editor
- Error expansion with original code display
- Loading states during processing ("Fixing syntax...", "Loading...")
- Shows both fixed and original versions when syntax fix is applied

## Suggested migration

**Reimplement?** Mostly no for rendering; **yes/adapter work** for "Fix with AI".

- Mermaid rendering/copy/open-PNG is a webview concern; keep the existing UI.
- The **"Fix with AI"** action currently relies on Kilo-side AI plumbing. With the agent runtime moving to Kilo CLI per [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1), you likely need to re-route this button to:
  - either a dedicated Kilo CLI prompt/tool that returns corrected Mermaid source, or
  - a small Kilo-side helper that asks Kilo CLI to fix the snippet (so the button remains functional without the legacy Kilo orchestration loop).
- Kilo CLI UI doesn’t appear to ship an equivalent Mermaid renderer/fixer (only a Mermaid file icon is present in [`packages/ui/src/components/file-icons/types.ts`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/file-icons/types.ts:1)).

## Current Progress

- Assistant markdown is now scanned for fenced Mermaid blocks in chat rows
- Added quick actions to:
  - open Mermaid blocks in VS Code markdown preview
  - copy Mermaid source code from the first block

## Remaining Gaps

- No inline rendered Mermaid canvas in the webview
- No "Fix with AI" mermaid syntax repair flow
- No export/open-as-PNG integration
