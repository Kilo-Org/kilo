# Deploy & Secure surfaces (navigation implies)

- **What it is**: Product areas hinted by docs navigation (deploy workflows, managed indexing, security reviews).

## Docs references

- [`apps/kilocode-docs/lib/nav/deploy-secure.ts`](../../apps/kilocode-docs/lib/nav/deploy-secure.ts)

## Suggested migration

- **Kilo CLI availability**: Not present.
- **Migration recommendation**:
  - Keep deploy/security approval and policy UX in the VS Code extension host.
  - Add server-side policy surfaces only if/when Kilo CLI needs centralized enforcement beyond basic permissions.
- **Reimplementation required?**: Yes.
