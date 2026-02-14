# Image Handling

Interactive image attachment/viewing behavior across prompt input and chat surfaces.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/chat/PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx:1)
- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1)

## Current Progress

- Prompt input supports attaching images/PDFs through file picker
- Attachment chips render image thumbnails when previewable
- Attachment chips expose open/copy/remove actions (button + context menu)
- Clipboard paste now supports image/PDF files and adds them as attachments
- Extension host persists pasted attachments and returns them via the same `filesSelected` pipeline
- Prompt attachments now support an in-webview image preview modal with zoom controls, drag-to-pan while zoomed, and quick open/copy actions
- Chat rows now render inline image thumbnails for image file parts with context actions (preview/open/copy path)

## Remaining Gaps

- Save/export affordances and richer image-specific action set

## Suggested migration

**Reimplement?** Mostly no (UI), but **adapter work** for attachment plumbing.

- Keep the current Kilo webview image viewer UX.
- Ensure the Kilo CLI→Kilo adapter emits image/attachment metadata in a shape that the existing thumbnail + viewer components can render.
- Kilo CLI UI already has an image preview modal pattern ([`packages/ui/src/components/image-preview.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/image-preview.tsx:1)) and attachments rendering in message parts ([`packages/ui/src/components/message-part.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/message-part.tsx:1)); this is a useful reference for the required attachment data.
- VS Code-specific actions (open in editor, save via VS Code API) remain Kilo responsibilities per [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
