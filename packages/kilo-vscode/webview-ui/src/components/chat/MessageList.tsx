/**
 * MessageList component
 * Scrollable list of messages with auto-scroll behavior.
 * Shows recent sessions in the empty state for quick resumption.
 */

import { Component, For, Show, createSignal, createEffect, createMemo, onCleanup, JSX } from "solid-js"
import { useSession } from "../../context/session"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
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

  // 3 most recently active sessions
  const recent = createMemo(() =>
    [...session.sessions()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3),
  )

  return (
    <div class="message-list-container">
      <div ref={containerRef} class="message-list" role="log" aria-live="polite">
        <Show when={isEmpty()}>
          <div class="message-list-empty">
            <KiloLogo />
            <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
            <Show when={recent().length > 0 && props.onSelectSession}>
              <div class="recent-sessions">
                <span class="recent-sessions-label">{language.t("session.recent")}</span>
                <For each={recent()}>
                  {(s) => (
                    <button class="recent-session-item" onClick={() => props.onSelectSession?.(s.id)}>
                      <span class="recent-session-title">{s.title || language.t("session.untitled")}</span>
                      <span class="recent-session-date">{formatRelativeDate(s.updatedAt)}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <For each={messages()}>{(message) => <Message message={message} />}</For>
      </div>

      <Show when={showScrollButton()}>
        <button
          class="scroll-to-bottom-button"
          onClick={scrollToBottom}
          aria-label={language.t("session.messages.scrollToBottom")}
        >
          ↓
        </button>
      </Show>
    </div>
  )
}
