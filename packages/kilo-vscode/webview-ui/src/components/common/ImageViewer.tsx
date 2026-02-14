import { Component, Show, createEffect, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import type { FileAttachment } from "../../types/messages"

interface ImageViewerProps {
  file: FileAttachment | null
  onClose: () => void
  onOpenFile: (url: string) => void
  onCopyPath: (url: string) => void | Promise<void>
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

function clampZoom(value: number): number {
  if (value < MIN_ZOOM) return MIN_ZOOM
  if (value > MAX_ZOOM) return MAX_ZOOM
  return Math.round(value * 100) / 100
}

export const ImageViewer: Component<ImageViewerProps> = (props) => {
  const [zoom, setZoom] = createSignal(1)

  createEffect(() => {
    if (props.file) {
      setZoom(1)
    }
  })

  const updateZoom = (delta: number) => {
    setZoom((prev) => clampZoom(prev + delta))
  }

  const handleWheel = (event: WheelEvent) => {
    if (!props.file) return
    event.preventDefault()
    updateZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  return (
    <Show when={props.file}>
      {(file) => (
        <div class="image-viewer-overlay" role="dialog" aria-modal="true" onClick={props.onClose}>
          <div class="image-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <div class="image-viewer-header">
              <div class="image-viewer-title" title={file().name ?? file().url}>
                {file().name ?? "Image"}
              </div>
              <button type="button" class="image-viewer-close" onClick={props.onClose} aria-label="Close image viewer">
                ×
              </button>
            </div>
            <div class="image-viewer-toolbar">
              <Button size="small" variant="secondary" onClick={() => updateZoom(-ZOOM_STEP)}>
                -
              </Button>
              <span class="image-viewer-zoom">{Math.round(zoom() * 100)}%</span>
              <Button size="small" variant="secondary" onClick={() => updateZoom(ZOOM_STEP)}>
                +
              </Button>
              <Button size="small" variant="ghost" onClick={() => setZoom(1)}>
                Reset
              </Button>
              <div class="image-viewer-toolbar-spacer" />
              <Button size="small" variant="ghost" onClick={() => void props.onCopyPath(file().url)}>
                Copy Path
              </Button>
              <Button size="small" variant="secondary" onClick={() => props.onOpenFile(file().url)}>
                Open in VS Code
              </Button>
            </div>
            <div class="image-viewer-canvas" onWheel={handleWheel}>
              <img
                src={file().previewUrl ?? file().url}
                alt={file().name ?? "Image attachment"}
                style={{ transform: `scale(${zoom()})` }}
              />
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
