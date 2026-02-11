/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 */

import { Component, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"

export const ModeSwitcher: Component = () => {
  const session = useSession()
  const [open, setOpen] = createSignal(false)

  const available = () => session.agents()
  const hasAgents = () => available().length > 1

  function pick(name: string) {
    session.selectAgent(name)
    setOpen(false)
  }

  const triggerLabel = () => {
    const name = session.selectedAgent()
    const agent = available().find((a) => a.name === name)
    if (agent) {
      return agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
    }
    return name || "Code"
  }

  return (
    <Show when={hasAgents()}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={setOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small" }}
        trigger={
          <>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        <div class="mode-switcher-list" role="listbox">
          <For each={available()}>
            {(agent) => (
              <div
                class={`mode-switcher-item${agent.name === session.selectedAgent() ? " selected" : ""}`}
                role="option"
                aria-selected={agent.name === session.selectedAgent()}
                onClick={() => pick(agent.name)}
              >
                <span class="mode-switcher-item-name">{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}</span>
                <Show when={agent.description}>
                  <span class="mode-switcher-item-desc">{agent.description}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Popover>
    </Show>
  )
}
