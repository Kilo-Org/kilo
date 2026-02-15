# Browser automation + URL ingestion

## Status

✅ Done

- **What it is**:
  - Browser control for deterministic actions and screenshots.
  - URL-to-markdown extraction for ingesting web content.

## Docs references

- [`apps/kilocode-docs/pages/code-with-ai/features/browser-use.md`](../../apps/kilocode-docs/pages/code-with-ai/features/browser-use.md)

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Move URL ingestion / content fetching to Kilo CLI server (web fetch) where possible.
  - Keep browser automation in the extension host until Kilo CLI gains full automation primitives (or add a new server feature).
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/browser-automation/`](../../src/services/browser-automation/)
- [`src/extension.ts`](../../src/extension.ts)
- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx)

## Current Progress

- Browser automation lifecycle is integrated through extension-host Playwright MCP registration and Browser settings UI controls
- Added command palette URL ingestion flow (`kilo-code.new.ingestUrlToChat`) that fetches `http/https` content, extracts readable text, and prefills chat context
- Browser-linked screenshots/images surfaced from tool messages now support in-chat preview via the shared image viewer
