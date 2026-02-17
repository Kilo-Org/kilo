# Browser Session Controls

Interactive controls for browser automation sessions surfaced in the chat UI.

## Location

- Implied from browser session components (to be located/confirmed)

## Interactions

- Interactive controls for browser automation sessions
- Action replay and control buttons
- Screenshot viewing

## Suggested migration

**Reimplement?** Likely yes (unless Kilo CLI adds browser tooling).

- This feature appears to be Kilo-specific (browser automation tools + UI controls). Kilo CLI’s standard surface area centers on sessions/messages/tools/permissions and does not obviously include browser automation.
- If browser automation remains a required capability, plan to:
  - keep the existing Kilo browser toolchain in the extension host, or
  - implement an Kilo CLI tool/plugin that drives a browser and emits the same UI events currently expected by the webview.
- Consider deferring until after Phase 3 (permissions) in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
