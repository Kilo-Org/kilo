# Authentication / organization / enterprise enforcement

- **What it is**: Cloud auth and organization-aware behavior.

## Capabilities

- Device-code style auth.
- Org feature flags.
- MDM policy enforcement.

## Suggested migration

- **Kilo CLI availability**: Partial.
- **Migration recommendation**:
  - Split responsibilities: Kilo CLI handles its own auth/session for server APIs.
  - The VS Code extension remains responsible for org/MDM enforcement and for supplying/mediating credentials as needed.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

Auth is handled via [`DeviceAuthCard.tsx`](../../webview-ui/src/components/DeviceAuthCard.tsx) for the device auth flow and [`ProfileView.tsx`](../../webview-ui/src/components/ProfileView.tsx) for login state display. The CLI backend manages the actual auth tokens. The old `src/services/kilocode/` and `src/services/mdm/` directories don't exist in the new extension.
