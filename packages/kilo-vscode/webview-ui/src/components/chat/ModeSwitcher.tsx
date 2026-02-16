/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 */

import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

export const ModeSwitcher: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")

  const available = () => session.agents()
  const hasAgents = () => available().length > 0

  const modeLabel = (mode: string) => {
    if (mode === "primary") return language.t("mode.label.primary")
    if (mode === "all") return language.t("mode.label.general")
    return language.t("mode.label.specialist")
  }

  const sortedAgents = createMemo(() => {
    const agents = [...available()]
    const rank = (mode: string) => {
      if (mode === "primary") return 0
      if (mode === "all") return 1
      return 2
    }
    return agents.sort((left, right) => {
      const modeCmp = rank(left.mode) - rank(right.mode)
      if (modeCmp !== 0) {
        return modeCmp
      }
      return left.name.localeCompare(right.name)
    })
  })

  const filteredAgents = createMemo(() => {
    const query = search().trim().toLowerCase()
    if (!query) {
      return sortedAgents()
    }
    return sortedAgents().filter((agent) => {
      const haystack = `${agent.name} ${agent.description ?? ""} ${modeLabel(agent.mode)}`.toLowerCase()
      return haystack.includes(query)
    })
  })

  function pick(name: string) {
    session.selectAgent(name)
    setSearch("")
    setOpen(false)
  }

  function toggleOpen(next: boolean) {
    setOpen(next)
    if (!next) {
      setSearch("")
    }
  }

  function openView(action: "marketplaceButtonClicked" | "settingsButtonClicked") {
    const values = action === "marketplaceButtonClicked" ? { marketplaceTab: "mode" } : undefined
    window.postMessage({ type: "action", action, values }, "*")
    setSearch("")
    setOpen(false)
  }

  const triggerLabel = () => {
    const name = session.selectedAgent()
    const agent = available().find((a) => a.name === name)
    if (agent) {
      return agent.name
    }
    return name || language.t("mode.default")
  }

  return (
    <Show when={hasAgents()}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={toggleOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small", title: triggerLabel() }}
        trigger={
          <>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        <div class="mode-switcher-popover">
          <div class="mode-switcher-search-wrapper">
            <input
              class="mode-switcher-search"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder={language.t("mode.search.placeholder")}
              aria-label={language.t("mode.search.aria")}
            />
          </div>
          <div class="mode-switcher-list" role="listbox">
            <Show
              when={filteredAgents().length > 0}
              fallback={<div class="mode-switcher-empty">{language.t("mode.search.empty")}</div>}
            >
              <For each={filteredAgents()}>
                {(agent) => (
                  <div
                    class={`mode-switcher-item${agent.name === session.selectedAgent() ? " selected" : ""}`}
                    role="option"
                    aria-selected={agent.name === session.selectedAgent()}
                    onClick={() => pick(agent.name)}
                  >
                    <div class="mode-switcher-item-row">
                      <div class="mode-switcher-item-main">
                        <span class="mode-switcher-item-name">{agent.name}</span>
                        <Show when={agent.description}>
                          <span class="mode-switcher-item-desc">{agent.description}</span>
                        </Show>
                      </div>
                      <div class="mode-switcher-item-meta">
                        <span class="mode-switcher-item-tag">{modeLabel(agent.mode)}</span>
                        <Show when={agent.name === session.selectedAgent()}>
                          <span class="mode-switcher-item-check">✓</span>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="mode-switcher-footer">
            <Button size="small" variant="ghost" onClick={() => openView("marketplaceButtonClicked")}>
              {language.t("mode.footer.marketplace")}
            </Button>
            <Button size="small" variant="ghost" onClick={() => openView("settingsButtonClicked")}>
              {language.t("mode.footer.settings")}
            </Button>
          </div>
        </div>
      </Popover>
    </Show>
  )
}
