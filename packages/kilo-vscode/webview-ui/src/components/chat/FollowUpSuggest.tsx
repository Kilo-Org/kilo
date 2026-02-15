import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import type { FollowUpSuggestion } from "../../types/messages"

const AUTO_APPROVE_SECONDS = 60
const FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT = "kilo:followup-autoapprove-pause"

const BASE_SUGGESTIONS: FollowUpSuggestion[] = [
  { id: "summarize", text: "Summarize the last response in 3 bullet points." },
  { id: "tests", text: "What should I test next to validate these changes?" },
  { id: "next", text: "What is the next highest-impact step?" },
]

function prefillPrompt(text: string): void {
  window.dispatchEvent(new CustomEvent("kilo:prompt-prefill", { detail: { text } }))
}

function resolveMode(candidates: string[], availableAgents: Set<string>): string | undefined {
  return candidates.find((name) => availableAgents.has(name))
}

export const FollowUpSuggest: Component = () => {
  const session = useSession()
  const [secondsLeft, setSecondsLeft] = createSignal<number | null>(null)
  const [cancelledMessageID, setCancelledMessageID] = createSignal<string | null>(null)

  const lastAssistantMessage = createMemo(() => {
    if (session.status() !== "idle") return undefined
    const messages = session.messages()
    if (messages.length === 0) return undefined
    const last = messages[messages.length - 1]
    return last.role === "assistant" ? last : undefined
  })

  const shouldShow = createMemo(() => {
    return !!lastAssistantMessage()
  })

  const suggestions = createMemo(() => {
    const generated = session.followUpSuggestions()
    if (generated.length > 0) {
      return generated
    }

    const last = lastAssistantMessage()
    if (!last) {
      return BASE_SUGGESTIONS
    }

    const availableAgents = new Set(session.agents().map((agent) => agent.name))
    const lower = (last.content ?? "").toLowerCase()
    if (lower.includes("error") || lower.includes("failed")) {
      return [
        {
          id: "debug",
          text: "Can you diagnose the likely root cause of the failure?",
          mode: resolveMode(["debug", "troubleshoot"], availableAgents),
        },
        {
          id: "fix",
          text: "Propose a minimal fix and explain why it works.",
          mode: resolveMode(["debug", "code"], availableAgents),
        },
        { id: "verify", text: "How should I verify the fix safely?" },
      ]
    }

    if (lower.includes("```") || lower.includes("diff")) {
      return [
        {
          id: "walkthrough",
          text: "Walk me through the code changes step by step.",
          mode: resolveMode(["review", "architect"], availableAgents),
        },
        { id: "tests", text: "What tests should I run for these changes?" },
        {
          id: "risks",
          text: "What risks or regressions should I watch for?",
          mode: resolveMode(["review", "code"], availableAgents),
        },
      ]
    }

    return BASE_SUGGESTIONS
  })

  function cancelAutoApprove() {
    const messageID = lastAssistantMessage()?.id
    if (!messageID) return
    setCancelledMessageID(messageID)
    setSecondsLeft(null)
  }

  const sendSuggestion = (suggestion: FollowUpSuggestion) => {
    if (suggestion.mode && suggestion.mode !== session.selectedAgent()) {
      session.selectAgent(suggestion.mode)
    }
    const sel = session.selected()
    session.sendMessage(suggestion.text, sel?.providerID, sel?.modelID)
  }

  const sendSuggestionNow = (suggestion: FollowUpSuggestion) => {
    cancelAutoApprove()
    sendSuggestion(suggestion)
  }

  const draftSuggestion = (suggestion: FollowUpSuggestion) => {
    cancelAutoApprove()
    prefillPrompt(suggestion.text)
  }

  const copySuggestion = async (suggestion: FollowUpSuggestion) => {
    try {
      await navigator.clipboard.writeText(suggestion.text)
      showToast({ variant: "success", title: "Suggestion copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy suggestion" })
    }
  }

  const onSuggestionClick = (suggestion: FollowUpSuggestion, event: MouseEvent) => {
    cancelAutoApprove()
    if (event.shiftKey) {
      prefillPrompt(suggestion.text)
      return
    }
    sendSuggestionNow(suggestion)
  }

  const autoApprovePauseListener = (event: Event) => {
    const custom = event as CustomEvent<{ paused?: boolean }>
    if (custom.detail?.paused) {
      cancelAutoApprove()
    }
  }

  window.addEventListener(FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT, autoApprovePauseListener as EventListener)
  onCleanup(() => {
    window.removeEventListener(FOLLOW_UP_AUTO_APPROVE_PAUSE_EVENT, autoApprovePauseListener as EventListener)
  })

  createEffect(() => {
    const messageID = lastAssistantMessage()?.id
    if (!messageID) {
      setCancelledMessageID(null)
      return
    }

    const cancelled = cancelledMessageID()
    if (cancelled && cancelled !== messageID) {
      setCancelledMessageID(null)
    }
  })

  createEffect(() => {
    const assistant = lastAssistantMessage()
    const items = suggestions()

    if (!assistant || session.status() !== "idle" || items.length === 0 || cancelledMessageID() === assistant.id) {
      setSecondsLeft(null)
      return
    }

    let remaining = AUTO_APPROVE_SECONDS
    setSecondsLeft(remaining)

    const timer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(timer)
        cancelAutoApprove()
        sendSuggestion(items[0])
        return
      }
      setSecondsLeft(remaining)
    }, 1000)

    return () => clearInterval(timer)
  })

  return (
    <Show when={shouldShow()}>
      <div class="follow-up-suggest" aria-label="Follow-up suggestions">
        <For each={suggestions()}>
          {(item, index) => {
            const isAutoApproveItem = () => index() === 0 && secondsLeft() !== null

            return (
              <div class="follow-up-suggest-item">
                <ContextMenu>
                  <ContextMenu.Trigger
                    as="button"
                    type="button"
                    class="follow-up-suggest-chip"
                    onClick={(event: MouseEvent) => onSuggestionClick(item, event)}
                    title="Click to send, Shift+Click to draft"
                  >
                    <span class="follow-up-suggest-chip-text">{item.text}</span>
                    <Show when={item.mode}>{(mode) => <span class="follow-up-suggest-mode">→ {mode()}</span>}</Show>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content>
                      <ContextMenu.Item onSelect={() => sendSuggestionNow(item)}>
                        <ContextMenu.ItemLabel>Send now</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                      <ContextMenu.Item onSelect={() => draftSuggestion(item)}>
                        <ContextMenu.ItemLabel>Draft in input</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                      <ContextMenu.Item onSelect={() => void copySuggestion(item)}>
                        <ContextMenu.ItemLabel>Copy suggestion</ContextMenu.ItemLabel>
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu>
                <Tooltip value="Draft suggestion into prompt input" placement="top">
                  <Button size="small" variant="ghost" onClick={() => draftSuggestion(item)}>
                    Edit
                  </Button>
                </Tooltip>
                <Show when={isAutoApproveItem()}>
                  <span class="follow-up-suggest-countdown">Auto-select in {secondsLeft()}s</span>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
