import { Component, Show, createEffect, createSignal, onCleanup } from "solid-js"
import mermaid from "mermaid"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"

interface MermaidBlockProps {
  code: string
  index: number
  onFixWithAI?: (code: string, error?: string) => void
}

let mermaidInitialized = false

function ensureMermaidInitialized() {
  if (mermaidInitialized) {
    return
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "dark",
    suppressErrorRendering: true,
  })
  mermaidInitialized = true
}

function applyDeterministicFixes(code: string): string {
  return code.replace(/--&gt;/g, "-->").replace(/^```mermaid\s*/i, "").replace(/```$/i, "").trim()
}

async function svgToPngDataUrl(svgMarkup: string): Promise<string> {
  const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" })
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Failed to load rendered Mermaid SVG"))
      image.src = objectUrl
    })

    const width = Math.max(1, Math.ceil(image.naturalWidth || 1200))
    const height = Math.max(1, Math.ceil(image.naturalHeight || 800))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("Canvas context unavailable")
    }

    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL("image/png")
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export const MermaidBlock: Component<MermaidBlockProps> = (props) => {
  const vscode = useVSCode()

  const [effectiveCode, setEffectiveCode] = createSignal(applyDeterministicFixes(props.code))
  const [svgMarkup, setSvgMarkup] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [showCode, setShowCode] = createSignal(false)

  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    setEffectiveCode(applyDeterministicFixes(props.code))
  })

  createEffect(() => {
    const code = effectiveCode().trim()
    if (!code) {
      setSvgMarkup("")
      setError("No Mermaid content")
      return
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      setLoading(true)
      setError(null)
      ensureMermaidInitialized()
      void mermaid
        .parse(code)
        .then(() => mermaid.render(`kilo-mermaid-${Date.now()}-${props.index}`, code))
        .then((result) => {
          setSvgMarkup(result.svg)
          setError(null)
        })
        .catch((renderError) => {
          setSvgMarkup("")
          setError(renderError instanceof Error ? renderError.message : "Failed to render Mermaid diagram")
        })
        .finally(() => {
          setLoading(false)
        })
    }, 250)
  })

  onCleanup(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  })

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(effectiveCode())
      showToast({ variant: "success", title: "Mermaid code copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy Mermaid code" })
    }
  }

  const openPng = async () => {
    if (!svgMarkup()) {
      return
    }
    try {
      const pngDataUrl = await svgToPngDataUrl(svgMarkup())
      vscode.postMessage({ type: "openImage", text: pngDataUrl })
    } catch (openError) {
      showToast({
        variant: "error",
        title: openError instanceof Error ? openError.message : "Failed to open Mermaid PNG",
      })
    }
  }

  const savePng = async () => {
    if (!svgMarkup()) {
      return
    }
    try {
      const pngDataUrl = await svgToPngDataUrl(svgMarkup())
      vscode.postMessage({
        type: "saveFileAttachment",
        url: pngDataUrl,
        name: `mermaid-diagram-${props.index + 1}.png`,
        mime: "image/png",
      })
    } catch (saveError) {
      showToast({
        variant: "error",
        title: saveError instanceof Error ? saveError.message : "Failed to export Mermaid PNG",
      })
    }
  }

  const requestAiFix = () => {
    props.onFixWithAI?.(effectiveCode(), error() ?? undefined)
  }

  return (
    <div class="message-mermaid-block">
      <div class="message-mermaid-toolbar">
        <span class="message-mermaid-title">Mermaid Diagram</span>
        <div class="message-mermaid-actions">
          <Tooltip value={showCode() ? "Hide Mermaid code" : "Show Mermaid code"} placement="top">
            <Button variant="ghost" size="small" onClick={() => setShowCode((prev) => !prev)}>
              {showCode() ? "Hide Code" : "View Code"}
            </Button>
          </Tooltip>
          <Tooltip value="Copy Mermaid code" placement="top">
            <Button variant="ghost" size="small" onClick={() => void copyCode()}>
              Copy
            </Button>
          </Tooltip>
          <Tooltip value="Open rendered diagram as PNG" placement="top">
            <Button variant="ghost" size="small" onClick={() => void openPng()} disabled={!svgMarkup()}>
              Open PNG
            </Button>
          </Tooltip>
          <Tooltip value="Export diagram as PNG" placement="top">
            <Button variant="ghost" size="small" onClick={() => void savePng()} disabled={!svgMarkup()}>
              Export PNG
            </Button>
          </Tooltip>
          <Show when={error()}>
            <Tooltip value="Ask AI to fix Mermaid syntax" placement="top">
              <Button variant="ghost" size="small" onClick={requestAiFix}>
                Fix with AI
              </Button>
            </Tooltip>
          </Show>
        </div>
      </div>
      <Show when={loading()}>
        <div class="message-mermaid-status">Rendering Mermaid diagram…</div>
      </Show>
      <Show when={error()}>
        {(message) => <div class="message-mermaid-error">{message()}</div>}
      </Show>
      <Show when={svgMarkup()}>
        <div class="message-mermaid-canvas" innerHTML={svgMarkup()} />
      </Show>
      <Show when={showCode()}>
        <pre class="message-mermaid-code">
          <code>{effectiveCode()}</code>
        </pre>
      </Show>
    </div>
  )
}
