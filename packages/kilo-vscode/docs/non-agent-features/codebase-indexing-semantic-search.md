# Codebase indexing & semantic search (Code Index)

- **What it is**: Vector-based indexing and semantic search over the repository.

## Capabilities

- Local indexing (embeddings + local/remote vector DB).
- Managed indexing (cloud).
- Incremental updates via file watchers and hashing.
- Multiple embedding providers and storage backends.

## Docs references

- [`apps/kilocode-docs/pages/customize/context/codebase-indexing.md`](../../apps/kilocode-docs/pages/customize/context/codebase-indexing.md)

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Use Kilo CLI server grep/glob/search endpoints for basic repo scanning.
  - Keep Kilo code-index + semantic search locally for now, or plan a server-side semantic indexing equivalent.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/code-index/`](../../src/services/code-index/)
