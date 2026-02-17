# Search & repo scanning infrastructure

- **What it is**: High-performance repo scanning and search utilities used across multiple features.

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Delegate grep/glob/repo scanning to Kilo CLI server endpoints.
  - Keep VS Code UX (search UI, previews, navigation) in the extension host.
- **Reimplementation required?**: No.

## Primary implementation anchors

- [`src/services/ripgrep/`](../../src/services/ripgrep/)
- [`src/services/search/`](../../src/services/search/)
- [`src/services/glob/`](../../src/services/glob/)
- [`src/services/roo-config/`](../../src/services/roo-config/)
