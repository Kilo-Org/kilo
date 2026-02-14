/**
 * PromptInput component
 * Text input with send/abort buttons and ghost-text autocomplete for the chat interface
 */

import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { useProvider } from "../../context/provider"
import { useConfig } from "../../context/config"
import { ModelSelector } from "./ModelSelector"
import { ModeSwitcher } from "./ModeSwitcher"
import { ImageViewer } from "../common/ImageViewer"
import type { FileAttachment } from "../../types/messages"

const AUTOCOMPLETE_DEBOUNCE_MS = 500
const MIN_TEXT_LENGTH = 3
const FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT = "kilo:followup-autoapprove-pause"

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
  let textareaRef: HTMLTextAreaElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let requestCounter = 0

  const isBusy = () => session.status() === "busy"
  const isDisabled = () => !server.isConnected()
  const hasAttachments = () => attachments().length > 0
  const canSend = () => (text().trim().length > 0 || hasAttachments()) && !isBusy() && !isDisabled()

  const availableVariants = createMemo(() => {
    const selected = session.selected()
    const model = provider.findModel(selected)
    if (!model?.variants) return []
    return Object.keys(model.variants).filter((name) => name && name !== "default")
  })

  const activeVariant = createMemo(() => {
    const variants = availableVariants()
    if (variants.length === 0) return undefined
    const configured = config().agent?.[session.selectedAgent()]?.variant
    return configured && variants.includes(configured) ? configured : undefined
  })

  const thinkingLabel = createMemo(() => {
    const variant = activeVariant()
    return variant ? `Thinking: ${variant}` : "Thinking: off"
  })

  const setFollowUpAutoApprovePaused = (paused: boolean) => {
    window.dispatchEvent(new CustomEvent(FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT, { detail: { paused } }))
  }

  const cycleThinkingVariant = () => {
    if (isDisabled() || isBusy()) return

    const variants = availableVariants()
    if (variants.length === 0) return

    const sequence: Array<string | undefined> = [undefined, ...variants]
    const current = activeVariant()
    const index = sequence.findIndex((item) => item === current)
    const next = sequence[(index + 1) % sequence.length]

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
    }
  })

  onCleanup(() => {
    unsubscribe()
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  })

  const prefillListener = (event: Event) => {
    const custom = event as CustomEvent<{ text?: string }>
    const textValue = custom.detail?.text
    if (typeof textValue !== "string" || textValue.length === 0) {
      return
    }
    setText(textValue)
    setGhostText("")
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

  const handleSend = () => {
    const message = text().trim()
    if ((!message && !hasAttachments()) || isBusy() || isDisabled()) return

    const sel = session.selected()
    session.sendMessage(message, sel?.providerID, sel?.modelID, attachments())
    setText("")
    setGhostText("")
    setAttachments([])
    setFollowUpAutoApprovePaused(false)

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = "auto"
    }
  }

  const handleAttachFiles = () => {
    if (isBusy() || isDisabled()) return
    vscode.postMessage({ type: "selectFiles" })
  }

  const handleRemoveAttachment = (url: string) => {
    setAttachments((prev) => prev.filter((file) => file.url !== url))
  }

  const handleOpenAttachment = (url: string) => {
    vscode.postMessage({ type: "openFileAttachment", url })
  }

  const handleCopyAttachmentPath = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast({ variant: "success", title: "Attachment path copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy attachment path" })
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
          title: "Failed to paste attachment",
        })
      }
    })()
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
                  <span class="prompt-attachment-name">{file.name ?? language.t("common.attachment")}</span>
                  <button
                    type="button"
                    class="prompt-attachment-remove"
                    onClick={() => handleRemoveAttachment(file.url)}
                    aria-label={language.t("prompt.attachment.remove")}
                    title={language.t("prompt.attachment.remove")}
                  >
                    ×
                  </button>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content>
                    <ContextMenu.Item onSelect={() => handleOpenAttachment(file.url)}>
                      <ContextMenu.ItemLabel>{language.t("command.file.open")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => void handleCopyAttachmentPath(file.url)}>
                      <ContextMenu.ItemLabel>{language.t("session.header.open.copyPath")}</ContextMenu.ItemLabel>
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
        </div>
        <div class="prompt-input-actions">
          <Show
            when={isBusy()}
            fallback={
              <>
                <Tooltip value={language.t("prompt.action.attachFile")} placement="top">
                  <Button
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
                <Tooltip value={language.t("prompt.action.send")} placement="top">
                  <Button
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
              </>
            }
          >
            <Tooltip value={language.t("prompt.action.stop")} placement="top">
              <Button variant="ghost" size="small" onClick={handleAbort} aria-label={language.t("prompt.action.stop")}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
              </Button>
            </Tooltip>
          </Show>
        </div>
      </div>
      <div class="prompt-input-hint">
        <ModeSwitcher />
        <ModelSelector />
        <Show when={availableVariants().length > 0}>
          <Tooltip value={language.t("command.model.variant.cycle.description")} placement="top">
            <Button
              variant="ghost"
              size="small"
              class="prompt-thinking-toggle"
              onClick={cycleThinkingVariant}
              disabled={isDisabled() || isBusy()}
            >
              {thinkingLabel()}
            </Button>
          </Tooltip>
        </Show>
        <Show when={!isDisabled()}>
          <span>{language.t("prompt.hint.sendShortcut")}</span>
        </Show>
      </div>
      <ImageViewer
        file={viewerFile()}
        onClose={() => setViewerFile(null)}
        onOpenFile={handleOpenAttachment}
        onCopyPath={handleCopyAttachmentPath}
      />
    </div>
  )
}
