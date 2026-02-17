# Browser automation + URL ingestion

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
