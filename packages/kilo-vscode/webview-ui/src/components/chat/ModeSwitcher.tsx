import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { AgentInfo } from "../../types/messages"

export const ModeSwitcher: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [search, setSearch] = createSignal("")

  const available = createMemo(() => session.agents())
  const hasAgents = createMemo(() => available().length > 0)

  const sortedAgents = createMemo<AgentInfo[]>(() => {
    const agents = [...available()]
    const rank = (mode: AgentInfo["mode"]) => {
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
      const haystack = `${agent.name} ${agent.description ?? ""}`.toLowerCase()
      return haystack.includes(query)
    })
  })

  const selectedAgent = createMemo(() => {
    const name = session.selectedAgent()
    return available().find((agent) => agent.name === name)
  })

  function codiconForAgent(agent: Pick<AgentInfo, "mode" | "iconName" | "name">): string {
    const raw = agent.iconName?.trim() ?? ""
    if (raw.includes("codicon-")) {
      const className = raw.split(/\s+/).find((token) => token.startsWith("codicon-"))
      if (className) {
        return className
      }
    }

    const byName = agent.name.toLowerCase()
    if (byName.includes("ask")) return "codicon-question"
    if (byName.includes("debug")) return "codicon-bug"
    if (byName.includes("review")) return "codicon-git-compare"
    if (byName.includes("architect")) return "codicon-type-hierarchy-sub"
    if (byName.includes("orchestr")) return "codicon-run-all"

    if (agent.mode === "all") return "codicon-organization"
    return "codicon-code"
  }

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

  function clearSearch() {
    setSearch("")
  }

  function openEdit() {
    window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
    setSearch("")
    setOpen(false)
  }

  const triggerLabel = () => {
    const name = session.selectedAgent()
    const agent = selectedAgent()
    if (agent) {
      return agent.name
    }
    return name || language.t("mode.default")
  }

  const triggerCodicon = createMemo(() => codiconForAgent(selectedAgent() ?? { name: "code", mode: "primary" }))

  return (
    <Show when={hasAgents()}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={toggleOpen}
        class="mode-switcher-popover-shell"
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small", title: triggerLabel(), class: "mode-switcher-trigger" }}
        trigger={
          <>
            <span class="mode-switcher-trigger-chevron" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4l4 5H4l4-5z" />
              </svg>
            </span>
            <span class={`mode-switcher-trigger-codicon codicon ${triggerCodicon()}`} aria-hidden="true" />
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
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
            <Show when={search().length > 0}>
              <button type="button" class="mode-switcher-search-clear" onClick={clearSearch} aria-label={language.t("common.close")}>
                <span class="codicon codicon-close" aria-hidden="true" />
              </button>
            </Show>
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
                      <span class={`mode-switcher-item-icon codicon ${codiconForAgent(agent)}`} aria-hidden="true" />
                      <div class="mode-switcher-item-main">
                        <div class="mode-switcher-item-name">{agent.name}</div>
                        <Show when={agent.description}>
                          <div class="mode-switcher-item-desc">{agent.description}</div>
                        </Show>
                      </div>
                      <Show when={agent.name === session.selectedAgent()}>
                        <span class="mode-switcher-item-check codicon codicon-check" aria-hidden="true" />
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
            <div class="mode-switcher-separator" role="separator" />
            <button type="button" class="mode-switcher-action" onClick={openEdit}>
              {language.t("common.edit")}
            </button>
          </div>
        </div>
      </Popover>
    </Show>
  )
}
