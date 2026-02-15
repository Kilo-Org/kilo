# Browser Session Controls

Interactive controls for browser automation sessions surfaced in the chat UI.

## Status

✅ Done

## Location

- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx:1)
- [`webview-ui/src/components/common/ImageViewer.tsx`](../../webview-ui/src/components/common/ImageViewer.tsx:1)

## Interactions

- Interactive controls for browser automation sessions
- Action replay and control buttons
- Screenshot viewing

## Current Progress

- Browser-related tool rows now expose `Replay` controls that prefill+send action replay prompts
- Linked screenshot/image resources from tool metadata/output can be previewed inline via the shared image viewer
- Existing link-open/copy actions remain available for non-image resources

## Suggested migration

**Reimplement?** Likely yes (unless Kilo CLI adds browser tooling).

- This feature appears to be Kilo-specific (browser automation tools + UI controls). Kilo CLI’s standard surface area centers on sessions/messages/tools/permissions and does not obviously include browser automation.
- If browser automation remains a required capability, plan to:
  - keep the existing Kilo browser toolchain in the extension host, or
  - implement an Kilo CLI tool/plugin that drives a browser and emits the same UI events currently expected by the webview.
- Consider deferring until after Phase 3 (permissions) in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
