import { Component, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import type { CodeIndexStatus } from "../../types/messages"

interface CodeIndexPopoverProps {
  disabled: boolean
  busy: boolean
  status: CodeIndexStatus
  t: (key: string) => string
  onRequestStatus: () => void
  onRebuild: () => void
  onClear: () => void
  onRunSemanticSearch: () => void
  onOpenSettings: () => void
}

type CodeIndexEmbedderProvider = "openai" | "ollama" | "openrouter" | "gemini" | "mistral" | "bedrock"
type CodeIndexVectorStore = "lancedb" | "qdrant"

interface CodeIndexUiConfig {
  enabled: boolean
  embedderProvider: CodeIndexEmbedderProvider
  embedderModelId: string
  vectorStoreProvider: CodeIndexVectorStore
  qdrantUrl: string
  searchMaxResults: number
  searchMinScore: number
  embeddingBatchSize: number
  scannerMaxBatchRetries: number
}

const CODE_INDEX_UI_STORAGE_KEY = "kilo.codeIndex.uiConfig.v1"
const DEFAULT_UI_CONFIG: CodeIndexUiConfig = {
  enabled: true,
  embedderProvider: "openai",
  embedderModelId: "text-embedding-3-small",
  vectorStoreProvider: "lancedb",
  qdrantUrl: "http://localhost:6333",
  searchMaxResults: 8,
  searchMinScore: 0.45,
  embeddingBatchSize: 64,
  scannerMaxBatchRetries: 2,
}

function parseFiniteNumber(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function loadUiConfig(): CodeIndexUiConfig {
  if (typeof window === "undefined") {
    return DEFAULT_UI_CONFIG
  }
  try {
    const raw = window.localStorage.getItem(CODE_INDEX_UI_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_UI_CONFIG
    }
    const parsed = JSON.parse(raw) as Partial<CodeIndexUiConfig>
    return {
      ...DEFAULT_UI_CONFIG,
      ...parsed,
    }
  } catch {
    return DEFAULT_UI_CONFIG
  }
}

function formatDate(value?: string): string {
  if (!value) {
    return "—"
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return "—"
  }
  return new Date(parsed).toLocaleString()
}

export const CodeIndexPopover: Component<CodeIndexPopoverProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [uiConfig, setUiConfig] = createSignal<CodeIndexUiConfig>(DEFAULT_UI_CONFIG)

  // TODO(backend): Replace localStorage UI state with real extension-host settings
  // once code-index config messages are available from the backend.
  onMount(() => {
    setUiConfig(loadUiConfig())
  })

  createEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    try {
      window.localStorage.setItem(CODE_INDEX_UI_STORAGE_KEY, JSON.stringify(uiConfig()))
    } catch {
      // Ignore localStorage write failures.
    }
  })

  const statusLabel = createMemo(() => {
    switch (props.status.systemStatus) {
      case "Indexed":
        return props.t("prompt.codeIndex.status.indexed")
      case "Indexing":
        return props.t("prompt.codeIndex.status.indexing")
      case "Error":
        return props.t("prompt.codeIndex.status.error")
      default:
        return props.t("prompt.codeIndex.status.standby")
    }
  })

  const statusDotClass = createMemo(() => {
    switch (props.status.systemStatus) {
      case "Indexed":
        return "is-indexed"
      case "Indexing":
        return "is-indexing"
      case "Error":
        return "is-error"
      default:
        return "is-standby"
    }
  })

  const indexedFiles = createMemo(() => {
    return Math.max(props.status.indexedFiles ?? 0, props.status.totalItems ?? 0)
  })

  const progressPercent = createMemo(() => {
    const total = props.status.totalItems ?? 0
    if (total <= 0) {
      return 0
    }
    return Math.max(0, Math.min(100, Math.round(((props.status.processedItems ?? 0) / total) * 100)))
  })

  function handleOpenChange(next: boolean) {
    if (next && (props.disabled || props.busy)) {
      setOpen(false)
      return
    }
    setOpen(next)
    if (next) {
      props.onRequestStatus()
    }
  }

  function run(action: () => void) {
    action()
    setOpen(false)
  }

  const updateUiConfig = <K extends keyof CodeIndexUiConfig>(key: K, value: CodeIndexUiConfig[K]) => {
    setUiConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Popover
      placement="top-end"
      open={open()}
      onOpenChange={handleOpenChange}
      triggerAs={Button}
      triggerProps={{
        class: "prompt-action-btn",
        variant: "ghost",
        size: "small",
        disabled: props.disabled || props.busy,
        title: props.t("prompt.action.rebuildIndex"),
        "aria-label": props.t("prompt.action.rebuildIndex"),
      }}
      title={props.t("prompt.codeIndex.title")}
      description={props.t("prompt.codeIndex.description")}
      class="prompt-code-index-popover"
      trigger={
        <span class="prompt-code-index-trigger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="8.5" ry="3" stroke="currentColor" stroke-width="1.8" />
            <path d="M3.5 5v5c0 1.66 3.81 3 8.5 3s8.5-1.34 8.5-3V5" stroke="currentColor" stroke-width="1.8" />
            <path d="M3.5 10v5c0 1.66 3.81 3 8.5 3s8.5-1.34 8.5-3v-5" stroke="currentColor" stroke-width="1.8" />
            <path d="M3.5 15v4c0 1.66 3.81 3 8.5 3s8.5-1.34 8.5-3v-4" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <span class={`prompt-code-index-trigger-dot ${statusDotClass()}`} aria-hidden="true" />
        </span>
      }
    >
      <div class="prompt-code-index-section-title">{props.t("prompt.codeIndex.section.status")}</div>
      <div class="prompt-code-index-status">
        <span class={`prompt-code-index-status-dot ${statusDotClass()}`} />
        <span class="prompt-code-index-status-label">{statusLabel()}</span>
        <Show when={props.status.systemStatus === "Indexing" && progressPercent() > 0}>
          <span class="prompt-code-index-status-progress">{progressPercent()}%</span>
        </Show>
      </div>
      <Show when={props.status.message}>
        <div class="prompt-code-index-message">{props.status.message}</div>
      </Show>
      <Show when={props.status.systemStatus === "Indexing"}>
        <div class="prompt-code-index-progress">
          <div
            class={`prompt-code-index-progress-indicator${progressPercent() <= 0 ? " indeterminate" : ""}`}
            style={progressPercent() > 0 ? { width: `${progressPercent()}%` } : undefined}
          />
        </div>
      </Show>
      <div class="prompt-code-index-details">
        <span>{props.t("prompt.codeIndex.meta.files")}: {indexedFiles().toLocaleString()}</span>
        <span>{props.t("prompt.codeIndex.meta.lastIndexed")}: {formatDate(props.status.createdAt)}</span>
      </div>

      <details class="prompt-code-index-controls" open>
        <summary>Setup</summary>
        <div class="prompt-code-index-controls-grid">
          <label class="prompt-code-index-control-inline">
            <input
              type="checkbox"
              checked={uiConfig().enabled}
              onChange={(event) => updateUiConfig("enabled", event.currentTarget.checked)}
            />
            <span>Enable code index</span>
          </label>

          <label class="prompt-code-index-control">
            <span>Embedder provider</span>
            <select
              value={uiConfig().embedderProvider}
              onChange={(event) => updateUiConfig("embedderProvider", event.currentTarget.value as CodeIndexEmbedderProvider)}
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
              <option value="openrouter">OpenRouter</option>
              <option value="gemini">Gemini</option>
              <option value="mistral">Mistral</option>
              <option value="bedrock">Bedrock</option>
            </select>
          </label>

          <label class="prompt-code-index-control">
            <span>Embedding model</span>
            <input
              type="text"
              value={uiConfig().embedderModelId}
              onInput={(event) => updateUiConfig("embedderModelId", event.currentTarget.value)}
              placeholder="Model ID"
            />
          </label>

          <label class="prompt-code-index-control">
            <span>Vector store</span>
            <select
              value={uiConfig().vectorStoreProvider}
              onChange={(event) => updateUiConfig("vectorStoreProvider", event.currentTarget.value as CodeIndexVectorStore)}
            >
              <option value="lancedb">LanceDB</option>
              <option value="qdrant">Qdrant</option>
            </select>
          </label>

          <Show when={uiConfig().vectorStoreProvider === "qdrant"}>
            <label class="prompt-code-index-control">
              <span>Qdrant URL</span>
              <input
                type="url"
                value={uiConfig().qdrantUrl}
                onInput={(event) => updateUiConfig("qdrantUrl", event.currentTarget.value)}
                placeholder="http://localhost:6333"
              />
            </label>
          </Show>
        </div>
      </details>

      <details class="prompt-code-index-controls">
        <summary>Advanced</summary>
        <div class="prompt-code-index-controls-grid">
          <label class="prompt-code-index-control">
            <span>Search max results</span>
            <input
              type="number"
              min="1"
              max="50"
              value={String(uiConfig().searchMaxResults)}
              onInput={(event) =>
                updateUiConfig(
                  "searchMaxResults",
                  Math.max(1, Math.min(50, Math.round(parseFiniteNumber(event.currentTarget.value, uiConfig().searchMaxResults)))),
                )
              }
            />
          </label>
          <label class="prompt-code-index-control">
            <span>Search min score</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={String(uiConfig().searchMinScore)}
              onInput={(event) =>
                updateUiConfig(
                  "searchMinScore",
                  Math.max(0, Math.min(1, parseFiniteNumber(event.currentTarget.value, uiConfig().searchMinScore))),
                )
              }
            />
          </label>
          <label class="prompt-code-index-control">
            <span>Embedding batch size</span>
            <input
              type="number"
              min="1"
              max="512"
              value={String(uiConfig().embeddingBatchSize)}
              onInput={(event) =>
                updateUiConfig(
                  "embeddingBatchSize",
                  Math.max(1, Math.min(512, Math.round(parseFiniteNumber(event.currentTarget.value, uiConfig().embeddingBatchSize)))),
                )
              }
            />
          </label>
          <label class="prompt-code-index-control">
            <span>Scanner max retries</span>
            <input
              type="number"
              min="0"
              max="20"
              value={String(uiConfig().scannerMaxBatchRetries)}
              onInput={(event) =>
                updateUiConfig(
                  "scannerMaxBatchRetries",
                  Math.max(0, Math.min(20, Math.round(parseFiniteNumber(event.currentTarget.value, uiConfig().scannerMaxBatchRetries)))),
                )
              }
            />
          </label>
        </div>
      </details>

      <div class="prompt-code-index-actions">
        <Button variant="primary" size="small" onClick={() => run(props.onRebuild)} disabled={props.status.systemStatus === "Indexing"}>
          {props.t("prompt.codeIndex.action.rebuild")}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => run(props.onClear)}
          disabled={props.status.systemStatus !== "Indexed" && props.status.systemStatus !== "Error"}
        >
          {props.t("prompt.codeIndex.action.clear")}
        </Button>
        <Button variant="ghost" size="small" onClick={() => run(props.onRunSemanticSearch)}>
          {props.t("prompt.codeIndex.action.search")}
        </Button>
        <Button variant="ghost" size="small" onClick={() => run(props.onOpenSettings)}>
          {props.t("prompt.codeIndex.action.settings")}
        </Button>
      </div>
    </Popover>
  )
}
