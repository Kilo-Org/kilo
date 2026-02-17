# Image Handling

Interactive image viewing and management for both full-size viewer and thumbnail strip.

## Location

- [`webview-ui/src/components/common/ImageViewer.tsx`](../../webview-ui/src/components/common/ImageViewer.tsx:1)
- [`webview-ui/src/components/chat/Thumbnails.tsx`](../../webview-ui/src/components/chat/Thumbnails.tsx:1)

## Image Viewer

### Interactions

- Click to open in VS Code editor
- Full-screen zoom modal with:
  - Zoom in/out controls with continuous zoom levels
  - Mouse wheel zoom support
  - Drag to pan when zoomed
  - Zoom percentage indicator
- Copy image path to clipboard
- Save image as file via VS Code API
- Hover-activated action buttons

## Thumbnails

### Interactions

- Click to view full image in VS Code
- Hover delete button (when in edit mode)
- 34x34px previews with rounded corners

## Suggested migration

**Reimplement?** Mostly no (UI), but **adapter work** for attachment plumbing.

- Keep the current Kilo webview image viewer UX.
- Ensure the Kilo CLI→Kilo adapter emits image/attachment metadata in a shape that the existing thumbnail + viewer components can render.
- Kilo CLI UI already has an image preview modal pattern ([`packages/ui/src/components/image-preview.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/image-preview.tsx:1)) and attachments rendering in message parts ([`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/message-part.tsx:1)); this is a useful reference for the required attachment data.
- VS Code-specific actions (open in editor, save via VS Code API) remain Kilo responsibilities per [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
