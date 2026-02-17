// kilocode_change - new file
import { TextAttributes, InputRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { createStore } from "solid-js/store"
import { createEffect, onMount, createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { CODEBASE_SEARCH_DEFAULTS } from "@/kilocode/codebase-search/types"

export type CodebaseSearchConfig = {
  embedModel: string
  vectorDbType: "qdrant" | "lancedb"
  qdrantUrl: string
  lancedbPath: string
  similarityThreshold: number
  maxResults: number
}

export type DialogToolCodebaseSearchProps = {
  initialConfig?: Partial<CodebaseSearchConfig>
  onSave: (config: CodebaseSearchConfig) => void
  onCancel?: () => void
}

type FieldKey = "embedModel" | "vectorDbType" | "qdrantUrl" | "lancedbPath" | "similarityThreshold" | "maxResults"

export function DialogToolCodebaseSearch(props: DialogToolCodebaseSearchProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore<CodebaseSearchConfig>({
    embedModel: props.initialConfig?.embedModel ?? CODEBASE_SEARCH_DEFAULTS.defaultEmbedModel,
    vectorDbType: props.initialConfig?.vectorDbType ?? "qdrant",
    qdrantUrl: props.initialConfig?.qdrantUrl ?? CODEBASE_SEARCH_DEFAULTS.defaultQdrantUrl,
    lancedbPath: props.initialConfig?.lancedbPath ?? "",
    similarityThreshold: props.initialConfig?.similarityThreshold ?? CODEBASE_SEARCH_DEFAULTS.similarityThreshold,
    maxResults: props.initialConfig?.maxResults ?? CODEBASE_SEARCH_DEFAULTS.maxResults,
  })

  const [activeField, setActiveField] = createSignal<number>(0)

  // Track raw string values for number fields during editing
  // This prevents "0." from becoming "0" when user is still typing
  const [rawNumberValues, setRawNumberValues] = createStore<Record<string, string>>({
    similarityThreshold: String(store.similarityThreshold),
    maxResults: String(store.maxResults),
  })

  let inputs: (InputRenderable | undefined)[] = []
  let scrollboxRef: any

  dialog.setSize("large")

  const fields: { key: FieldKey; label: string; placeholder: string; type: "text" | "number" | "select" }[] = [
    { key: "embedModel", label: "Embed Model", placeholder: "e.g., codestral-embed-2505", type: "text" },
    { key: "vectorDbType", label: "Vector DB Type", placeholder: "qdrant or lancedb", type: "select" },
    { key: "qdrantUrl", label: "Qdrant URL", placeholder: "http://localhost:6333", type: "text" },
    {
      key: "lancedbPath",
      label: "LanceDB Vector Store Path",
      placeholder: "Custom vector store path (optional)",
      type: "text",
    },
    { key: "similarityThreshold", label: "Similarity Threshold", placeholder: "0.0 - 1.0", type: "number" },
    { key: "maxResults", label: "Max Results", placeholder: "1 - 100", type: "number" },
  ]

  // Get visible fields based on current config
  const visibleFields = () => {
    const result: typeof fields = []
    for (const field of fields) {
      // Only show Qdrant URL if vectorDbType is qdrant
      if (field.key === "qdrantUrl" && store.vectorDbType !== "qdrant") continue
      // Only show LanceDB path if vectorDbType is lancedb
      if (field.key === "lancedbPath" && store.vectorDbType !== "lancedb") continue
      result.push(field)
    }
    return result
  }

  onMount(() => {
    setTimeout(() => {
      const visible = visibleFields()
      const input = inputs[0]
      if (input && !input.isDestroyed && visible.length > 0) {
        input.focus()
      }
    }, 1)
  })

  createEffect(() => {
    const idx = activeField()
    const visible = visibleFields()
    if (idx >= 0 && idx < visible.length) {
      const field = visible[idx]
      const actualIdx = fields.findIndex((f) => f.key === field.key)
      const input = inputs[actualIdx]
      if (input && !input.isDestroyed) {
        input.focus()
      }
    }
  })

  // Commit all input values to store before saving
  function commitAllValues() {
    for (const field of fields) {
      if (field.key === "vectorDbType") continue

      if (field.type === "number") {
        // Use raw number value for parsing
        const rawValue = rawNumberValues[field.key]
        if (rawValue !== undefined) {
          const val = parseFloat(rawValue)
          if (!isNaN(val)) {
            setStore(field.key, val)
          }
        }
      } else {
        const actualIdx = fields.findIndex((f) => f.key === field.key)
        const input = inputs[actualIdx]
        if (input && !input.isDestroyed) {
          setStore(field.key, input.value)
        }
      }
    }
  }

  useKeyboard((evt) => {
    const visible = visibleFields()
    const currentField = visible[activeField()]

    // Enter on select field toggles the value
    if (evt.name === "return" && currentField?.key === "vectorDbType") {
      evt.preventDefault()
      toggleVectorDb()
      return
    }

    // Enter on any other field saves the form
    if (evt.name === "return") {
      evt.preventDefault()
      commitAllValues()
      handleSave()
      return
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const direction = evt.shift ? -1 : 1
      let next = activeField() + direction
      if (next < 0) next = visible.length - 1
      if (next >= visible.length) next = 0
      setActiveField(next)
    }

    if (evt.name === "up") {
      evt.preventDefault()
      const next = activeField() - 1
      if (next >= 0) setActiveField(next)
    }

    if (evt.name === "down") {
      evt.preventDefault()
      const next = activeField() + 1
      if (next < visible.length) setActiveField(next)
    }

    // Space on select field toggles the value
    if (evt.name === "space" && currentField?.key === "vectorDbType") {
      evt.preventDefault()
      toggleVectorDb()
      return
    }

    if (evt.name === "escape") {
      props.onCancel?.()
      dialog.clear()
    }
  })

  function handleSave() {
    props.onSave(store)
    dialog.clear()
  }

  function toggleVectorDb() {
    setStore("vectorDbType", store.vectorDbType === "qdrant" ? "lancedb" : "qdrant")
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Codebase Search Configuration
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>Configure semantic code search settings</text>
      </box>

      <scrollbox ref={scrollboxRef} maxHeight={12} scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" gap={1}>
          {visibleFields().map((field, idx) => {
            const actualIdx = fields.findIndex((f) => f.key === field.key)
            const isActive = activeField() === idx
            return (
              <box flexDirection="row" gap={1} alignItems="flex-end">
                <text fg={isActive ? theme.text : theme.textMuted} width={18} flexShrink={0}>
                  {field.label}:
                </text>
                <Show
                  when={field.type === "select"}
                  fallback={
                    <input
                      ref={(r) => {
                        inputs[actualIdx] = r
                      }}
                      focusedBackgroundColor={theme.backgroundPanel}
                      cursorColor={theme.primary}
                      focusedTextColor={theme.text}
                      textColor={theme.text}
                      onInput={(e) => {
                        if (field.type === "number") {
                          // Store raw string value to preserve "0." while typing
                          setRawNumberValues(field.key, e)
                          // Also parse and store numeric value if valid
                          const val = parseFloat(e)
                          if (!isNaN(val)) {
                            setStore(field.key, val)
                          }
                        } else {
                          setStore(field.key, e)
                        }
                      }}
                      value={
                        field.type === "number"
                          ? (rawNumberValues[field.key] ?? String(store[field.key as keyof CodebaseSearchConfig]))
                          : (store[field.key as keyof CodebaseSearchConfig] as string)
                      }
                      placeholder={field.placeholder}
                      flexGrow={1}
                      maxWidth={70}
                    />
                  }
                >
                  <box backgroundColor={isActive ? theme.primary : undefined} onMouseUp={() => toggleVectorDb()}>
                    <text fg={isActive ? theme.selectedListItemText : theme.text}>
                      {store.vectorDbType.toUpperCase()}
                    </text>
                  </box>
                  <text fg={theme.textMuted}> (enter to toggle)</text>
                </Show>
              </box>
            )
          })}
        </box>
      </scrollbox>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1} paddingTop={1} gap={2}>
        <text fg={theme.textMuted}>tab/↑↓</text>
        <text fg={theme.textMuted}>navigate</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.textMuted}>space</text>
        <text fg={theme.textMuted}>toggle</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.textMuted}>enter</text>
        <text fg={theme.textMuted}>save</text>
      </box>
    </box>
  )
}
