# Integrations (for example GitHub connectivity)

- **What it is**: Connecting external systems (notably GitHub) to enable higher-level workflows.

## Docs references

- [`apps/kilocode-docs/pages/automate/integrations.md`](../../apps/kilocode-docs/pages/automate/integrations.md)

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Use Kilo CLI's plugin system where it covers the integration (non-IDE-specific).
  - Keep IDE-specific integrations (VS Code APIs, UI hooks) in the extension and decide per integration.
- **Reimplementation required?**: Partial.
