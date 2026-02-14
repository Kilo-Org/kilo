import { Component, For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"

interface FollowUpSuggestion {
  id: string
  text: string
}

const BASE_SUGGESTIONS: FollowUpSuggestion[] = [
  { id: "summarize", text: "Summarize the last response in 3 bullet points." },
  { id: "tests", text: "What should I test next to validate these changes?" },
  { id: "next", text: "What is the next highest-impact step?" },
]

function prefillPrompt(text: string): void {
  window.dispatchEvent(new CustomEvent("kilo:prompt-prefill", { detail: { text } }))
}

export const FollowUpSuggest: Component = () => {
  const session = useSession()

  const shouldShow = createMemo(() => {
    if (session.status() !== "idle") return false
    const messages = session.messages()
    if (messages.length === 0) return false
    return messages[messages.length - 1]?.role === "assistant"
  })

  const suggestions = createMemo(() => {
    const messages = session.messages()
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") {
      return BASE_SUGGESTIONS
    }

    const lower = (last.content ?? "").toLowerCase()
    if (lower.includes("error") || lower.includes("failed")) {
      return [
        { id: "debug", text: "Can you diagnose the likely root cause of the failure?" },
        { id: "fix", text: "Propose a minimal fix and explain why it works." },
        { id: "verify", text: "How should I verify the fix safely?" },
      ]
    }

    if (lower.includes("```") || lower.includes("diff")) {
      return [
        { id: "walkthrough", text: "Walk me through the code changes step by step." },
        { id: "tests", text: "What tests should I run for these changes?" },
        { id: "risks", text: "What risks or regressions should I watch for?" },
      ]
    }

    return BASE_SUGGESTIONS
  })

  const sendSuggestion = (text: string) => {
    const sel = session.selected()
    session.sendMessage(text, sel?.providerID, sel?.modelID)
  }

  const onSuggestionClick = (suggestion: string, event: MouseEvent) => {
    if (event.shiftKey) {
      prefillPrompt(suggestion)
      return
    }
    sendSuggestion(suggestion)
  }

  return (
    <Show when={shouldShow()}>
      <div class="follow-up-suggest" aria-label="Follow-up suggestions">
        <For each={suggestions()}>
          {(item) => (
            <div class="follow-up-suggest-item">
              <button
                type="button"
                class="follow-up-suggest-chip"
                onClick={(event) => onSuggestionClick(item.text, event)}
                title="Click to send, Shift+Click to draft"
              >
                {item.text}
              </button>
              <Button size="small" variant="ghost" onClick={() => prefillPrompt(item.text)}>
                Edit
              </Button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
