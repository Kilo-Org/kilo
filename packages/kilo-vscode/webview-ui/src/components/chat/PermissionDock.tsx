import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"

function readPatterns(request: PermissionRequest): string[] {
  const explicit = Array.isArray(request.patterns) ? request.patterns.filter((entry) => typeof entry === "string") : []
  if (explicit.length > 0) {
    return [...new Set(explicit)]
  }

  const metadata = request.args ?? {}
  const keys = ["path", "paths", "file", "files", "filepath", "pattern", "patterns", "glob", "directory", "command"]
  const collected: string[] = []

  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === "string" && value.trim().length > 0) {
      collected.push(value.trim())
      continue
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          collected.push(entry.trim())
        }
      }
    }
  }

  return [...new Set(collected)]
}

export const PermissionDock: Component<{ requests: PermissionRequest[] }> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const [activeIndex, setActiveIndex] = createSignal(0)

  createEffect(() => {
    const length = props.requests.length
    if (length === 0) {
      setActiveIndex(0)
      return
    }
    if (activeIndex() >= length) {
      setActiveIndex(length - 1)
    }
  })

  const activeRequest = createMemo(() => {
    if (props.requests.length === 0) {
      return undefined
    }
    const index = Math.min(Math.max(activeIndex(), 0), props.requests.length - 1)
    return props.requests[index]
  })

  const permission = createMemo(() => (activeRequest()?.permission || activeRequest()?.toolName || "").trim())
  const patterns = createMemo(() => (activeRequest() ? readPatterns(activeRequest()!) : []))

  const subtitle = createMemo(() => {
    const value = permission()
    if (!value) {
      return language.t("notification.permission.title")
    }

    if (value === "doom_loop") {
      return language.t("settings.permissions.tool.doom_loop.title")
    }

    const translated = language.t(`settings.permissions.tool.${value}.title`)
    return translated === `settings.permissions.tool.${value}.title` ? value : translated
  })

  const respondCurrent = (response: "once" | "always" | "reject") => {
    const request = activeRequest()
    if (!request) {
      return
    }
    session.respondToPermission(request.id, response)
  }

  const respondAll = (response: "once" | "always" | "reject") => {
    const ids = props.requests.map((request) => request.id)
    if (ids.length === 0) {
      return
    }
    session.respondToPermissions(ids, response)
  }

  const canStepBack = createMemo(() => activeIndex() > 0)
  const canStepForward = createMemo(() => activeIndex() < props.requests.length - 1)

  return (
    <div data-component="tool-part-wrapper" data-permission="true">
      <BasicTool
        icon="checklist"
        locked
        defaultOpen
        trigger={{
          title: language.t("notification.permission.title"),
          subtitle: subtitle(),
        }}
      >
        <Show when={props.requests.length > 1}>
          <div class="tool-inline-actions">
            <span class="tool-inline-meta">
              Request {activeIndex() + 1} of {props.requests.length}
            </span>
            <Button variant="ghost" size="small" onClick={() => canStepBack() && setActiveIndex((index) => index - 1)}>
              Previous
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => canStepForward() && setActiveIndex((index) => index + 1)}
            >
              Next
            </Button>
          </div>
        </Show>
        <Show when={patterns().length > 0}>
          <div class="tool-inline-actions">
            <For each={patterns().slice(0, 12)}>{(pattern) => <code class="tool-inline-path">{pattern}</code>}</For>
          </div>
        </Show>
        <Show when={permission() === "doom_loop"}>
          <div class="tool-inline-meta">{language.t("settings.permissions.tool.doom_loop.description")}</div>
        </Show>
      </BasicTool>
      <div data-component="permission-prompt">
        <div data-slot="permission-actions">
          <Button variant="ghost" size="small" onClick={() => respondCurrent("reject")}>
            {language.t("ui.permission.deny")}
          </Button>
          <Button variant="secondary" size="small" onClick={() => respondCurrent("always")}>
            {language.t("ui.permission.allowAlways")}
          </Button>
          <Button variant="primary" size="small" onClick={() => respondCurrent("once")}>
            {language.t("ui.permission.allowOnce")}
          </Button>
        </div>
        <Show when={props.requests.length > 1}>
          <div data-slot="permission-actions">
            <Button variant="ghost" size="small" onClick={() => respondAll("reject")}>
              Deny all ({props.requests.length})
            </Button>
            <Button variant="secondary" size="small" onClick={() => respondAll("always")}>
              Allow all always
            </Button>
            <Button variant="primary" size="small" onClick={() => respondAll("once")}>
              Allow all once
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}
