/**
 * PromptInput component
 * Text input with send/abort buttons and ghost-text autocomplete for the chat interface
 */

import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Popover } from "@kilocode/kilo-ui/popover"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useProvider } from "../../context/provider"
import { useConfig } from "../../context/config"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"
import { CodeIndexPopover } from "./CodeIndexPopover"
import { ImageViewer } from "../common/ImageViewer"
import type { CodeIndexStatus, FileAttachment, SlashCommandInfo } from "../../types/messages"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3
const FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT = "kilo:followup-autoapprove-pause"

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Failed to read file"))
    }
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsDataURL(file)
  })
}

function formatVariantLabel(key: string, metadata: Record<string, unknown> | undefined): string {
  if (metadata) {
    const direct =
      (typeof metadata.label === "string" && metadata.label.trim()) ||
      (typeof metadata.name === "string" && metadata.name.trim()) ||
      (typeof metadata.title === "string" && metadata.title.trim()) ||
      (typeof metadata.displayName === "string" && metadata.displayName.trim())
    if (direct) {
      return direct
    }
  }

  return key
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function attachmentToMarkdown(file: FileAttachment): string {
  const label = (file.name ?? "attachment").replace(/\]/g, "\\]")
  if (file.mime.startsWith("image/")) {
    return `![${label}](${file.url})`
  }
  return `[${label}](${file.url})`
}

export const PromptInput: Component = () => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()
  const provider = useProvider()
  const { config, updateConfig } = useConfig()

  const [text, setText] = createSignal("")
  const [ghostText, setGhostText] = createSignal("")
  const [attachments, setAttachments] = createSignal<FileAttachment[]>([])
  const [viewerFile, setViewerFile] = createSignal<FileAttachment | null>(null)
  const [slashCommands, setSlashCommands] = createSignal<SlashCommandInfo[]>([])
  const [slashCommandsRequested, setSlashCommandsRequested] = createSignal(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = createSignal(0)
  const [isRecordingVoice, setIsRecordingVoice] = createSignal(false)
  const [isEnhancingPrompt, setIsEnhancingPrompt] = createSignal(false)
  const [pendingAutoSend, setPendingAutoSend] = createSignal(false)
  const [thinkingOpen, setThinkingOpen] = createSignal(false)
  const [codeIndexStatus, setCodeIndexStatus] = createSignal<CodeIndexStatus>({
    systemStatus: "Standby",
    processedItems: 0,
    totalItems: 0,
    currentItemUnit: "files",
    indexedFiles: 0,
  })
  let textareaRef: HTMLTextAreaElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let speechRecognition: SpeechRecognitionLike | undefined
  let requestCounter = 0

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const isSpeechSupported = () => {
    if (typeof window === "undefined") {
      return false
    }
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  }
  const hasAttachments = () => attachments().length > 0
  const canSend = () => (text().trim().length > 0 || hasAttachments()) && !isBusy() && !isDisabled()
  const slashQuery = createMemo(() => {
    const value = text()
    const match = value.match(/^\/([^\s]*)$/)
    if (!match) {
      return null
    }
    return match[1].toLowerCase()
  })
  const slashSuggestions = createMemo(() => {
    const query = slashQuery()
    if (query === null) {
      return []
    }
    const normalizedQuery = query.trim()
    const items = slashCommands()
      .filter((command) => {
        if (!normalizedQuery) {
          return true
        }
        const nameMatch = command.name.toLowerCase().includes(normalizedQuery)
        const descriptionMatch = command.description?.toLowerCase().includes(normalizedQuery) ?? false
        return nameMatch || descriptionMatch
      })
      .sort((left, right) => {
        const leftStarts = normalizedQuery ? left.name.toLowerCase().startsWith(normalizedQuery) : false
        const rightStarts = normalizedQuery ? right.name.toLowerCase().startsWith(normalizedQuery) : false
        if (leftStarts !== rightStarts) {
          return leftStarts ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
    return items
  })
  const slashPickerOpen = createMemo(() => slashQuery() !== null && !isBusy() && !isDisabled())

  createEffect(() => {
    if (!slashPickerOpen() || slashCommandsRequested()) {
      return
    }
    setSlashCommandsRequested(true)
    vscode.postMessage({ type: "requestSlashCommands" })
  })

  createEffect(() => {
    slashQuery()
    setSlashSelectedIndex(0)
  })

  createEffect(() => {
    const maxIndex = slashSuggestions().length - 1
    if (maxIndex < 0) {
      setSlashSelectedIndex(0)
      return
    }
    if (slashSelectedIndex() > maxIndex) {
      setSlashSelectedIndex(maxIndex)
    }
  })

  createEffect(() => {
    if ((isBusy() || isDisabled()) && isRecordingVoice()) {
      stopVoiceInput()
    }
  })

  createEffect(() => {
    if (!isDisabled()) {
      vscode.postMessage({ type: "requestCodeIndexStatus" })
    }
  })

  const variantOptions = createMemo(() => {
    const selected = session.selected()
    const model = provider.findModel(selected)
    if (!model?.variants) return []
    return Object.entries(model.variants)
      .filter(([name]) => name && name !== "default")
      .map(([name, metadata]) => ({
        key: name,
        label: formatVariantLabel(name, metadata),
      }))
  })

  const activeVariant = createMemo(() => {
    const variants = variantOptions()
    if (variants.length === 0) return undefined
    const configured = config().agent?.[session.selectedAgent()]?.variant
    return configured && variants.some((variant) => variant.key === configured) ? configured : undefined
  })

  const activeVariantLabel = createMemo(() => {
    const active = activeVariant()
    if (!active) {
      return undefined
    }
    return variantOptions().find((variant) => variant.key === active)?.label
  })

  const thinkingLabel = createMemo(() => {
    const variant = activeVariantLabel()
    return variant ? language.t("prompt.thinking.label", { variant }) : language.t("prompt.thinking.off")
  })

  const setFollowUpAutoApprovePaused = (paused: boolean) => {
    window.dispatchEvent(new CustomEvent(FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT, { detail: { paused } }))
  }

  const setThinkingVariant = (next: string | undefined) => {
    const selectedAgent = session.selectedAgent()
    const nextAgents = { ...(config().agent ?? {}) }
    const nextAgentConfig = { ...(nextAgents[selectedAgent] ?? {}) }

    if (next) {
      nextAgentConfig.variant = next
    } else {
      delete nextAgentConfig.variant
    }

    if (Object.keys(nextAgentConfig).length === 0) {
      delete nextAgents[selectedAgent]
    } else {
      nextAgents[selectedAgent] = nextAgentConfig
    }

    updateConfig({ agent: nextAgents })
    setThinkingOpen(false)
  }

  const getLastUserMessageText = () => {
    const messages = session.messages()
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role !== "user") {
        continue
      }
      const content = message.content?.trim()
      if (content) {
        return content
      }
    }
    return ""
  }

  // Listen for chat completion results from the extension
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "chatCompletionResult") {
      const result = message as { type: "chatCompletionResult"; text: string; requestId: string }
      // Only apply if the requestId matches the latest request
      const expectedId = `chat-ac-${requestCounter}`
      if (result.requestId === expectedId && result.text) {
        setGhostText(result.text)
      }
      return
    }

    if (message.type === "filesSelected") {
      const incoming = Array.isArray(message.files) ? message.files : []
      if (incoming.length === 0) return
      setAttachments((prev) => {
        const existing = new Set(prev.map((file) => file.url))
        const merged = [...prev]
        for (const file of incoming) {
          if (!existing.has(file.url)) {
            existing.add(file.url)
            merged.push(file)
          }
        }
        return merged
      })
      return
    }

    if (message.type === "slashCommandsLoaded") {
      const commands = Array.isArray(message.commands) ? message.commands : []
      setSlashCommands(commands)
      setSlashCommandsRequested(true)
      return
    }

    if (message.type === "enhancedPrompt") {
      setIsEnhancingPrompt(false)
      const next = typeof message.text === "string" ? message.text.trim() : ""
      if (!next) {
        showToast({ variant: "error", title: language.t("prompt.toast.enhancePromptFailed") })
        return
      }

      setText(next)
      setGhostText("")
      setFollowUpAutoApprovePaused(next.length > 0)
      requestAnimationFrame(() => {
        if (!textareaRef) return
        textareaRef.value = next
        adjustHeight()
        textareaRef.focus()
        textareaRef.setSelectionRange(next.length, next.length)
      })
      return
    }

    if (message.type === "configLoaded" || message.type === "configUpdated") {
      setSlashCommands([])
      setSlashCommandsRequested(false)
      return
    }

    if (message.type === "codeIndexStatusLoaded") {
      setCodeIndexStatus(message.status)
    }
  })

  onCleanup(() => {
    unsubscribe()
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    speechRecognition?.stop()
    speechRecognition = undefined
  })

  const prefillListener = (event: Event) => {
    const custom = event as CustomEvent<{
      text?: string
      files?: FileAttachment[]
      providerID?: string
      modelID?: string
      agent?: string
      autoSend?: boolean
    }>
    const textValue = custom.detail?.text
    if (typeof textValue !== "string") {
      return
    }
    setText(textValue)
    setGhostText("")
    const incomingFiles = Array.isArray(custom.detail?.files) ? custom.detail!.files : undefined
    if (incomingFiles) {
      setAttachments(incomingFiles)
    }
    if (custom.detail?.providerID && custom.detail?.modelID) {
      session.selectModel(custom.detail.providerID, custom.detail.modelID)
    }
    if (typeof custom.detail?.agent === "string" && custom.detail.agent.trim().length > 0) {
      session.selectAgent(custom.detail.agent.trim())
    }
    setPendingAutoSend(!!custom.detail?.autoSend)
    requestAnimationFrame(() => {
      if (!textareaRef) return
      textareaRef.value = textValue
      adjustHeight()
      textareaRef.focus()
      const end = textValue.length
      textareaRef.setSelectionRange(end, end)
    })
  }

  window.addEventListener("kilo:prompt-prefill", prefillListener as EventListener)

  onCleanup(() => {
    window.removeEventListener("kilo:prompt-prefill", prefillListener as EventListener)
  })

  // Request autocomplete from the extension
  const requestAutocomplete = (currentText: string) => {
    if (currentText.length < MIN_TEXT_LENGTH || isDisabled()) {
      setGhostText("")
      return
    }

    requestCounter++
    const requestId = `chat-ac-${requestCounter}`

    vscode.postMessage({
      type: "requestChatCompletion",
      text: currentText,
      requestId,
    })
  }

  // Accept the ghost text suggestion
  const acceptSuggestion = () => {
    const suggestion = ghostText()
    if (!suggestion) return

    const newText = text() + suggestion
    setText(newText)
    setGhostText("")

    // Notify extension of acceptance for telemetry
    vscode.postMessage({
      type: "chatCompletionAccepted",
      suggestionLength: suggestion.length,
    })

    // Update textarea
    if (textareaRef) {
      textareaRef.value = newText
      adjustHeight()
    }
  }

  // Dismiss the ghost text
  const dismissSuggestion = () => {
    setGhostText("")
  }

  // Auto-resize textarea
  const adjustHeight = () => {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`
  }

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLTextAreaElement
    setText(target.value)
    setFollowUpAutoApprovePaused(target.value.trim().length > 0)
    adjustHeight()

    // Clear existing ghost text on new input
    setGhostText("")

    // Debounce autocomplete request
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      requestAutocomplete(target.value)
    }, AUTOCOMPLETE_DEBOUNCE_MS)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const suggestions = slashSuggestions()
    if (slashPickerOpen() && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % suggestions.length)
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
        return
      }

      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault()
        const selected = suggestions[Math.min(slashSelectedIndex(), suggestions.length - 1)]
        if (selected) {
          applySlashSuggestion(selected.name)
        }
        return
      }
    }

    // Tab or ArrowRight to accept ghost text
    if ((e.key === "Tab" || e.key === "ArrowRight") && ghostText()) {
      e.preventDefault()
      acceptSuggestion()
      return
    }

    // Escape to dismiss ghost text
    if (e.key === "Escape" && ghostText()) {
      e.preventDefault()
      dismissSuggestion()
      return
    }

    // Up-arrow on empty input restores the previous user prompt
    if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && text().length === 0) {
      const previous = getLastUserMessageText()
      if (previous) {
        e.preventDefault()
        setText(previous)
        setGhostText("")
        requestAnimationFrame(() => {
          if (!textareaRef) return
          textareaRef.value = previous
          adjustHeight()
          const end = previous.length
          textareaRef.setSelectionRange(end, end)
        })
      }
      return
    }

    // Enter to send (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      dismissSuggestion()
      handleSend()
    }
  }

  const applySlashSuggestion = (name: string) => {
    const next = `/${name} `
    setText(next)
    setGhostText("")
    setFollowUpAutoApprovePaused(next.trim().length > 0)

    requestAnimationFrame(() => {
      if (!textareaRef) return
      textareaRef.value = next
      adjustHeight()
      textareaRef.focus()
      const end = next.length
      textareaRef.setSelectionRange(end, end)
    })
  }

  const slashBadgeLabel = (source?: SlashCommandInfo["source"]) => {
    switch (source) {
      case "skill":
        return language.t("prompt.slash.badge.skill")
      case "mcp":
        return language.t("prompt.slash.badge.mcp")
      default:
        return language.t("prompt.slash.badge.custom")
    }
  }

  const handleSend = () => {
    const message = text().trim()
    if ((!message && !hasAttachments()) || isBusy() || isDisabled()) return

    if (isRecordingVoice()) {
      stopVoiceInput()
    }

    const sel = session.selected()
    session.sendMessage(message, sel?.providerID, sel?.modelID, attachments())
    setText("")
    setGhostText("")
    setAttachments([])
    setIsEnhancingPrompt(false)
    setPendingAutoSend(false)
    setFollowUpAutoApprovePaused(false)

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = "auto"
    }
  }

  createEffect(() => {
    if (!pendingAutoSend()) {
      return
    }
    if (isBusy() || isDisabled()) {
      return
    }
    if (!canSend()) {
      return
    }
    handleSend()
  })

  const handleAttachFiles = () => {
    if (isBusy() || isDisabled()) return
    vscode.postMessage({ type: "selectFiles" })
  }

  const handleEnhancePrompt = () => {
    if (isBusy() || isDisabled() || isEnhancingPrompt()) {
      return
    }

    const trimmed = text().trim()
    if (!trimmed) {
      const suggestion = language.t("prompt.enhance.description")
      setText(suggestion)
      setGhostText("")
      setFollowUpAutoApprovePaused(suggestion.trim().length > 0)
      requestAnimationFrame(() => {
        if (!textareaRef) return
        textareaRef.value = suggestion
        adjustHeight()
        textareaRef.focus()
        textareaRef.setSelectionRange(suggestion.length, suggestion.length)
      })
      return
    }

    setIsEnhancingPrompt(true)
    vscode.postMessage({ type: "enhancePrompt", text: trimmed })
  }

  const handleRebuildCodeIndex = () => {
    if (isDisabled() || isBusy()) return
    setCodeIndexStatus((prev) => ({
      ...prev,
      systemStatus: "Indexing",
      message: undefined,
    }))
    vscode.postMessage({ type: "rebuildCodeIndex" })
    setTimeout(() => vscode.postMessage({ type: "requestCodeIndexStatus" }), 250)
  }

  const handleClearCodeIndex = () => {
    if (isDisabled() || isBusy()) return
    vscode.postMessage({ type: "clearCodeIndex" })
    setTimeout(() => vscode.postMessage({ type: "requestCodeIndexStatus" }), 250)
  }

  const handleRunSemanticSearch = () => {
    if (isDisabled() || isBusy()) return
    vscode.postMessage({ type: "runSemanticSearch" })
  }

  const handleOpenCodeIndexSettings = () => {
    window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
  }

  const handleOpenRules = () => {
    // TODO(backend): Deep-link directly to rules subtab once sidebar navigation supports subtab routing.
    window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
  }

  const handleOpenFeedback = () => {
    // TODO(backend): Replace with native feedback options menu when extension message exists.
    vscode.postMessage({
      type: "openExternal",
      url: "https://github.com/Kilo-Org/kilocode/issues/new/choose",
    })
  }

  const handleRemoveAttachment = (url: string) => {
    setAttachments((prev) => prev.filter((file) => file.url !== url))
  }

  const handleOpenAttachment = (url: string) => {
    vscode.postMessage({ type: "openFileAttachment", url })
  }

  const handleSaveAttachment = (file: FileAttachment) => {
    vscode.postMessage({ type: "saveFileAttachment", url: file.url, name: file.name, mime: file.mime })
  }

  const handleCopyAttachmentPath = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast({ variant: "success", title: language.t("prompt.toast.attachmentPathCopied") })
    } catch {
      showToast({ variant: "error", title: language.t("prompt.toast.attachmentPathCopyFailed") })
    }
  }

  const handleCopyAttachmentMarkdown = async (file: FileAttachment) => {
    try {
      await navigator.clipboard.writeText(attachmentToMarkdown(file))
      showToast({ variant: "success", title: language.t("prompt.toast.markdownCopied") })
    } catch {
      showToast({ variant: "error", title: language.t("prompt.toast.markdownCopyFailed") })
    }
  }

  const handlePreviewAttachment = (file: FileAttachment) => {
    if (file.mime.startsWith("image/") && (file.previewUrl || file.url)) {
      setViewerFile(file)
      return
    }
    handleOpenAttachment(file.url)
  }

  const handlePaste = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    const pastedFiles = Array.from(e.clipboardData.items)
      .map((item) => (item.kind === "file" ? item.getAsFile() : null))
      .filter((file): file is File => file !== null)
    if (pastedFiles.length === 0) return

    const supported = pastedFiles.filter((file) => file.type.startsWith("image/") || file.type === "application/pdf")
    if (supported.length === 0) {
      e.preventDefault()
      showToast({
        variant: "default",
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
      return
    }

    e.preventDefault()
    void (async () => {
      try {
        const files = await Promise.all(
          supported.map(async (file) => ({
            mime: file.type || "application/octet-stream",
            name: file.name || undefined,
            dataUrl: await readFileAsDataUrl(file),
          })),
        )
        vscode.postMessage({ type: "pasteAttachments", files })
      } catch {
        showToast({
          variant: "error",
          title: language.t("prompt.toast.pasteAttachmentFailed"),
        })
      }
    })()
  }

  function stopVoiceInput() {
    if (!speechRecognition) {
      setIsRecordingVoice(false)
      return
    }
    speechRecognition.stop()
    speechRecognition = undefined
    setIsRecordingVoice(false)
  }

  function startVoiceInput() {
    if (isBusy() || isDisabled()) return
    if (!isSpeechSupported()) {
      showToast({
        variant: "error",
        title: language.t("prompt.voice.unsupported"),
      })
      return
    }

    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
    const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Recognition) {
      showToast({
        variant: "error",
        title: language.t("prompt.voice.unsupported"),
      })
      return
    }

    const recognition = new Recognition()
    const baseText = text().trim()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || "en-US"
    recognition.onresult = (event) => {
      const segments: string[] = []
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.trim()
        if (transcript) {
          segments.push(transcript)
        }
      }
      const spoken = segments.join(" ").trim()
      const nextText = [baseText, spoken].filter(Boolean).join(baseText && spoken ? " " : "")
      setText(nextText)
      setFollowUpAutoApprovePaused(nextText.trim().length > 0)
      setGhostText("")
      requestAnimationFrame(() => {
        if (!textareaRef) return
        textareaRef.value = nextText
        adjustHeight()
        const end = nextText.length
        textareaRef.setSelectionRange(end, end)
      })
    }

    recognition.onerror = () => {
      showToast({
        variant: "error",
        title: language.t("prompt.voice.failed"),
      })
      stopVoiceInput()
    }

    recognition.onend = () => {
      setIsRecordingVoice(false)
      speechRecognition = undefined
    }

    speechRecognition = recognition
    setIsRecordingVoice(true)
    recognition.start()
  }

  function toggleVoiceInput() {
    if (isRecordingVoice()) {
      stopVoiceInput()
      return
    }
    startVoiceInput()
  }

  const handleAbort = () => {
    session.abort()
  }

  return (
    <div class="prompt-input-container">
      <Show when={attachments().length > 0}>
        <div class="prompt-attachments" aria-label={language.t("common.attachment")}>
          <For each={attachments()}>
            {(file) => (
              <ContextMenu>
                <ContextMenu.Trigger as="div" class="prompt-attachment">
                  <Tooltip value={file.name ?? language.t("common.attachment")} placement="top">
                    <button
                      type="button"
                      class="prompt-attachment-preview"
                      onClick={() => handlePreviewAttachment(file)}
                      title={file.name ?? file.url}
                    >
                      <Show
                        when={file.mime.startsWith("image/") && file.previewUrl}
                        fallback={
                          <span class="prompt-attachment-icon">{file.mime === "application/pdf" ? "PDF" : "FILE"}</span>
                        }
                      >
                        <img src={file.previewUrl!} alt={file.name ?? language.t("common.attachment")} />
                      </Show>
                    </button>
                  </Tooltip>
                  <span class="prompt-attachment-name">{file.name ?? language.t("common.attachment")}</span>
                  <Tooltip value={language.t("prompt.attachment.remove")} placement="top">
                    <button
                      type="button"
                      class="prompt-attachment-remove"
                      onClick={() => handleRemoveAttachment(file.url)}
                      aria-label={language.t("prompt.attachment.remove")}
                      title={language.t("prompt.attachment.remove")}
                    >
                      ×
                    </button>
                  </Tooltip>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content>
                    <ContextMenu.Item onSelect={() => handleOpenAttachment(file.url)}>
                      <ContextMenu.ItemLabel>{language.t("command.file.open")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => handleSaveAttachment(file)}>
                      <ContextMenu.ItemLabel>{language.t("common.save")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => void handleCopyAttachmentPath(file.url)}>
                      <ContextMenu.ItemLabel>{language.t("session.header.open.copyPath")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => void handleCopyAttachmentMarkdown(file)}>
                      <ContextMenu.ItemLabel>{language.t("prompt.attachment.copyMarkdown")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onSelect={() => handleRemoveAttachment(file.url)}>
                      <ContextMenu.ItemLabel>{language.t("prompt.attachment.remove")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu>
            )}
          </For>
        </div>
      </Show>
      <div class="prompt-input-shell">
        <div class="prompt-input-wrapper">
          <div class="prompt-input-ghost-wrapper">
            <textarea
              ref={textareaRef}
              class="prompt-input"
              placeholder={
                isDisabled() ? language.t("prompt.placeholder.connecting") : language.t("prompt.placeholder.default")
              }
              value={text()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => setFollowUpAutoApprovePaused(true)}
              onBlur={() => setFollowUpAutoApprovePaused(text().trim().length > 0)}
              disabled={isDisabled()}
              rows={1}
            />
            <Show when={ghostText()}>
              <div class="prompt-input-ghost-overlay" aria-hidden="true">
                <span class="prompt-input-ghost-text-hidden">{text()}</span>
                <span class="prompt-input-ghost-text">{ghostText()}</span>
              </div>
            </Show>
            <Show when={slashPickerOpen()}>
              <div class="prompt-slash-popover" role="listbox" aria-label={language.t("prompt.popover.slashAria")}>
                <Show
                  when={slashSuggestions().length > 0}
                  fallback={<div class="prompt-slash-empty">{language.t("prompt.popover.emptyCommands")}</div>}
                >
                  <For each={slashSuggestions()}>
                    {(command, index) => (
                      <button
                        type="button"
                        class={`prompt-slash-item${index() === slashSelectedIndex() ? " is-active" : ""}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setSlashSelectedIndex(index())}
                        onClick={() => applySlashSuggestion(command.name)}
                        role="option"
                        aria-selected={index() === slashSelectedIndex()}
                      >
                        <span class="prompt-slash-item-main">
                          <span class="prompt-slash-item-label">/{command.name}</span>
                          <Show when={command.description}>
                            <span class="prompt-slash-item-description">{command.description}</span>
                          </Show>
                        </span>
                        <span class="prompt-slash-item-badge">{slashBadgeLabel(command.source)}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
          <div class="prompt-input-bottom-fade" aria-hidden="true" />
          <div class="prompt-input-mode-anchor">
            <ModeSwitcher />
          </div>
          <div class="prompt-input-enhance">
            <Tooltip value={language.t("prompt.action.enhance")} placement="top">
              <Button
                class="prompt-action-btn"
                variant="ghost"
                size="small"
                onClick={handleEnhancePrompt}
                disabled={isDisabled() || isBusy() || isEnhancingPrompt()}
                aria-label={language.t("prompt.action.enhance")}
              >
                <Icon name="models" size="small" class={isEnhancingPrompt() ? "prompt-enhance-icon-spinning" : undefined} />
              </Button>
            </Tooltip>
          </div>
          <div class="prompt-input-actions">
            <CodeIndexPopover
              disabled={isDisabled()}
              busy={isBusy()}
              status={codeIndexStatus()}
              t={language.t}
              onRequestStatus={() => vscode.postMessage({ type: "requestCodeIndexStatus" })}
              onRebuild={handleRebuildCodeIndex}
              onClear={handleClearCodeIndex}
              onRunSemanticSearch={handleRunSemanticSearch}
              onOpenSettings={handleOpenCodeIndexSettings}
            />
            <Show
              when={isBusy()}
              fallback={
                <>
                  <Tooltip value={language.t("prompt.action.attachFile")} placement="top">
                    <Button
                      class="prompt-action-btn"
                      variant="ghost"
                      size="small"
                      onClick={handleAttachFiles}
                      disabled={isDisabled()}
                      aria-label={language.t("prompt.action.attachFile")}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M9.5 2.5C7.84 2.5 6.5 3.84 6.5 5.5V11C6.5 11.83 7.17 12.5 8 12.5C8.83 12.5 9.5 11.83 9.5 11V5.5H11V11C11 12.66 9.66 14 8 14C6.34 14 5 12.66 5 11V5.5C5 3.01 7.01 1 9.5 1C11.99 1 14 3.01 14 5.5V10.5C14 13.54 11.54 16 8.5 16H8V14.5H8.5C10.71 14.5 12.5 12.71 12.5 10.5V5.5C12.5 3.84 11.16 2.5 9.5 2.5Z" />
                      </svg>
                    </Button>
                  </Tooltip>
                  <Tooltip
                    value={isRecordingVoice() ? language.t("prompt.action.voiceStop") : language.t("prompt.action.voiceStart")}
                    placement="top"
                  >
                    <Button
                      class="prompt-action-btn"
                      variant={isRecordingVoice() ? "primary" : "ghost"}
                      size="small"
                      onClick={toggleVoiceInput}
                      disabled={isDisabled() || isBusy() || (!isSpeechSupported() && !isRecordingVoice())}
                      aria-label={isRecordingVoice() ? language.t("prompt.action.voiceStop") : language.t("prompt.action.voiceStart")}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5Zm0 10a4.5 4.5 0 0 0 4.5-4.5H14A6 6 0 0 1 8.75 13v1.5h-1.5V13A6 6 0 0 1 2 7h1.5A4.5 4.5 0 0 0 8 11.5Z" />
                      </svg>
                    </Button>
                  </Tooltip>
                  <Show when={text().trim().length > 0 || hasAttachments()}>
                    <Tooltip value={language.t("prompt.action.send")} placement="top">
                      <Button
                        class="prompt-action-btn prompt-action-btn-send"
                        variant="primary"
                        size="small"
                        onClick={handleSend}
                        disabled={!canSend()}
                        aria-label={language.t("prompt.action.send")}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M1.5 1.5L14.5 8L1.5 14.5V9L10 8L1.5 7V1.5Z" />
                        </svg>
                      </Button>
                    </Tooltip>
                  </Show>
                </>
              }
            >
              <Tooltip value={language.t("prompt.action.stop")} placement="top">
                <Button
                  class="prompt-action-btn"
                  variant="ghost"
                  size="small"
                  onClick={handleAbort}
                  aria-label={language.t("prompt.action.stop")}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="1" />
                  </svg>
                </Button>
              </Tooltip>
            </Show>
          </div>
        </div>
      </div>
      <div class="prompt-input-footer">
        <div class="prompt-input-controls">
          <ModelSelector />
          <Show when={variantOptions().length > 0}>
            <Popover
              placement="top-start"
              open={thinkingOpen()}
              onOpenChange={setThinkingOpen}
              triggerAs={Button}
              triggerProps={{
                variant: "ghost",
                size: "small",
                class: "prompt-thinking-toggle",
                disabled: isDisabled() || isBusy(),
              }}
              trigger={
                <>
                  <span>{thinkingLabel()}</span>
                  <svg
                    class="prompt-thinking-toggle-chevron"
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 4l4 5H4l4-5z" />
                  </svg>
                </>
              }
              class="prompt-thinking-popover"
            >
              <div class="prompt-thinking-list" role="listbox" aria-label={language.t("prompt.popover.thinkingAria")}>
                <button
                  type="button"
                  class={`prompt-thinking-item${!activeVariant() ? " selected" : ""}`}
                  onClick={() => setThinkingVariant(undefined)}
                  role="option"
                  aria-selected={!activeVariant()}
                >
                  {language.t("prompt.thinking.off")}
                </button>
                <For each={variantOptions()}>
                  {(variant) => (
                    <button
                      type="button"
                      class={`prompt-thinking-item${activeVariant() === variant.key ? " selected" : ""}`}
                      onClick={() => setThinkingVariant(variant.key)}
                      role="option"
                      aria-selected={activeVariant() === variant.key}
                    >
                      {variant.label}
                    </button>
                  )}
                </For>
              </div>
            </Popover>
          </Show>
        </div>
        <Show when={!isDisabled()}>
          <span class="prompt-input-shortcut">{language.t("prompt.hint.sendShortcut")}</span>
        </Show>
      </div>
      <div class="prompt-input-meta-controls">
        <Tooltip value={language.t("prompt.meta.rules")} placement="top">
          <Button
            class="prompt-meta-btn"
            variant="ghost"
            size="small"
            onClick={handleOpenRules}
            aria-label={language.t("prompt.meta.rules")}
          >
            <span class="codicon codicon-book" aria-hidden="true" />
          </Button>
        </Tooltip>
        <Tooltip value={language.t("prompt.meta.feedback")} placement="top">
          <Button
            class="prompt-meta-btn"
            variant="ghost"
            size="small"
            onClick={handleOpenFeedback}
            aria-label={language.t("prompt.meta.feedback")}
          >
            <span class="codicon codicon-feedback" aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      <ImageViewer
        file={viewerFile()}
        onClose={() => setViewerFile(null)}
        onOpenFile={handleOpenAttachment}
        onCopyPath={handleCopyAttachmentPath}
        onSaveFile={handleSaveAttachment}
      />
    </div>
  )
}
