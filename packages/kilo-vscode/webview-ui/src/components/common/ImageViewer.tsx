import { Component, Show, createEffect, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import type { FileAttachment } from "../../types/messages"
import { useLanguage } from "../../context/language"

interface ImageViewerProps {
  file: FileAttachment | null
  onClose: () => void
  onOpenFile: (url: string) => void
  onCopyPath: (url: string) => void | Promise<void>
  onSaveFile: (file: FileAttachment) => void
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
  const language = useLanguage()
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)
  const [dragAnchor, setDragAnchor] = createSignal({ x: 0, y: 0 })

  createEffect(() => {
    if (props.file) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setDragging(false)
      return
    }
    setDragging(false)
  })

  const updateZoom = (delta: number) => {
    setZoom((prev) => {
      const next = clampZoom(prev + delta)
      if (next <= 1) {
        setPan({ x: 0, y: 0 })
      }
      return next
    })
  }

  const handleWheel = (event: WheelEvent) => {
    if (!props.file) return
    event.preventDefault()
    updateZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  const startPan = (event: MouseEvent) => {
    if (!props.file || zoom() <= 1) return
    event.preventDefault()
    const current = pan()
    setDragAnchor({ x: event.clientX - current.x, y: event.clientY - current.y })
    setDragging(true)
  }

  const onPanMove = (event: MouseEvent) => {
    if (!dragging()) return
    const anchor = dragAnchor()
    setPan({
      x: event.clientX - anchor.x,
      y: event.clientY - anchor.y,
    })
  }

  const stopPan = () => {
    if (dragging()) {
      setDragging(false)
    }
  }

  createEffect(() => {
    if (!dragging()) return

    window.addEventListener("mousemove", onPanMove)
    window.addEventListener("mouseup", stopPan)

    return () => {
      window.removeEventListener("mousemove", onPanMove)
      window.removeEventListener("mouseup", stopPan)
    }
  })

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
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  setZoom(1)
                  setPan({ x: 0, y: 0 })
                }}
              >
                Reset
              </Button>
              <div class="image-viewer-toolbar-spacer" />
              <span class="image-viewer-pan-hint">Drag to pan when zoomed</span>
              <Button size="small" variant="ghost" onClick={() => void props.onCopyPath(file().url)}>
                {language.t("session.header.open.copyPath")}
              </Button>
              <Button size="small" variant="ghost" onClick={() => props.onSaveFile(file())}>
                {language.t("common.save")}
              </Button>
              <Button size="small" variant="secondary" onClick={() => props.onOpenFile(file().url)}>
                {language.t("command.file.open")}
              </Button>
            </div>
            <div class="image-viewer-canvas" onWheel={handleWheel} onMouseDown={startPan}>
              <img
                src={file().previewUrl ?? file().url}
                alt={file().name ?? "Image attachment"}
                draggable={false}
                style={{
                  transform: `translate(${pan().x}px, ${pan().y}px) scale(${zoom()})`,
                  cursor: zoom() > 1 ? (dragging() ? "grabbing" : "grab") : "zoom-in",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
