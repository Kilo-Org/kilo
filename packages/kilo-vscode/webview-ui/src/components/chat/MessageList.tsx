/**
 * MessageList component
 * Scrollable list of messages with auto-scroll behavior.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createSignal, createEffect, createMemo, onCleanup, JSX } from "solid-js"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { formatRelativeDate } from "../../utils/date"
import { Message } from "./Message"

const KiloLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const iconFile = isLight ? "kilo-light.svg" : "kilo-dark.svg"

  return (
    <div class="kilo-logo">
      <img src={`${iconsBaseUri}/${iconFile}`} alt="Kilo Code" />
    </div>
  )
}

interface MessageListProps {
  onSelectSession?: (id: string) => void
}

export const MessageList: Component<MessageListProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()

  let containerRef: HTMLDivElement | undefined
  const [isAtBottom, setIsAtBottom] = createSignal(true)
  const [showScrollButton, setShowScrollButton] = createSignal(false)

  // Check if scrolled to bottom
  const checkScrollPosition = () => {
    if (!containerRef) return

    const threshold = 50 // pixels from bottom
    const atBottom = containerRef.scrollHeight - containerRef.scrollTop - containerRef.clientHeight < threshold
    setIsAtBottom(atBottom)
    setShowScrollButton(!atBottom)
  }

  // Scroll to bottom
  const scrollToBottom = () => {
    if (!containerRef) return
    containerRef.scrollTo({
      top: containerRef.scrollHeight,
      behavior: "smooth",
    })
  }

  // Auto-scroll when new messages arrive (if already at bottom)
  createEffect(() => {
    const msgs = session.messages()
    if (msgs.length > 0 && isAtBottom()) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (containerRef) {
          containerRef.scrollTop = containerRef.scrollHeight
        }
      })
    }
  })

  // Set up scroll listener
  createEffect(() => {
    if (!containerRef) return

    containerRef.addEventListener("scroll", checkScrollPosition)
    onCleanup(() => {
      containerRef?.removeEventListener("scroll", checkScrollPosition)
    })
  })

  // Load sessions once connected so the recent list is available immediately.
  // Uses createEffect instead of onMount so it retries when connection state changes.
  // The flag prevents redundant loads (e.g. after deleting all sessions).
  let loaded = false
  createEffect(() => {
    if (!loaded && server.isConnected() && session.sessions().length === 0) {
      loaded = true
      session.loadSessions()
    }
  })

  const messages = () => session.messages()
  const isEmpty = () => messages().length === 0 && !session.loading()

  // Most recently active sessions for quick resume from the welcome state.
  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6),
  )

  const starterPrompts = createMemo(() => [
    language.t("home.quickStart.prompt1"),
    language.t("home.quickStart.prompt2"),
    language.t("home.quickStart.prompt3"),
  ])

  const prefillPrompt = (text: string) => {
    window.dispatchEvent(new CustomEvent("kilo:prompt-prefill", { detail: { text } }))
  }

  const openDocs = () => {
    vscode.postMessage({ type: "openExternal", url: "https://docs.kilocode.ai" })
  }

  return (
    <div class="message-list-container">
      <div ref={containerRef} class="message-list" role="log" aria-live="polite">
        <Show when={isEmpty()}>
          <div class="message-list-empty">
            <div class="home-empty-shell">
              <KiloLogo />
              <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
              <button class="home-docs-link" onClick={openDocs} aria-label={language.t("home.quickStart.docs")}>
                {language.t("home.quickStart.docs")}
              </button>

              <section class="home-getting-started">
                <h3>{language.t("sidebar.gettingStarted.title")}</h3>
                <p>{language.t("sidebar.gettingStarted.line1")}</p>
                <p>{language.t("sidebar.gettingStarted.line2")}</p>
              </section>

              <section class="home-quickstart">
                <h3>{language.t("home.quickStart.title")}</h3>
                <div class="home-quickstart-list">
                  <For each={starterPrompts()}>
                    {(prompt) => (
                      <button class="home-quickstart-item" onClick={() => prefillPrompt(prompt)} aria-label={prompt}>
                        <span class="home-quickstart-text">{prompt}</span>
                        <span class="home-quickstart-arrow">→</span>
                      </button>
                    )}
                  </For>
                </div>
              </section>

              <Show when={recent().length > 0 && props.onSelectSession}>
                <section class="recent-sessions">
                  <span class="recent-sessions-label">{language.t("sidebar.project.recentSessions")}</span>
                  <For each={recent()}>
                    {(s) => (
                      <Tooltip value={s.title || language.t("session.untitled")} placement="top">
                        <button
                          class="recent-session-item"
                          onClick={() => props.onSelectSession?.(s.id)}
                          aria-label={s.title || language.t("session.untitled")}
                          title={s.title || language.t("session.untitled")}
                        >
                          <span class="recent-session-title">{s.title || language.t("session.untitled")}</span>
                          <span class="recent-session-date">{formatRelativeDate(s.updatedAt)}</span>
                        </button>
                      </Tooltip>
                    )}
                  </For>
                </section>
              </Show>
            </div>
          </div>
        </Show>
        <For each={messages()}>{(message) => <Message message={message} />}</For>
      </div>

      <Show when={showScrollButton()}>
        <Tooltip value={language.t("session.messages.scrollToBottom")} placement="top">
          <button
            class="scroll-to-bottom-button"
            onClick={scrollToBottom}
            aria-label={language.t("session.messages.scrollToBottom")}
          >
            ↓
          </button>
        </Tooltip>
      </Show>
    </div>
  )
}
