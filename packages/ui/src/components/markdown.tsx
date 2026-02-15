import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import { checksum } from "@opencode-ai/util/encode"
import { ComponentProps, createEffect, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}
const CODE_COLLAPSE_THRESHOLD_PX = 500

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

type CopyLabels = {
  copy: string
  copied: string
}

type CodeLabels = CopyLabels & {
  expand: string
  collapse: string
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("title", labels.copy)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function createExpandButton(labels: CodeLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-slot", "markdown-expand-button")
  button.setAttribute("aria-label", labels.expand)
  button.setAttribute("title", labels.expand)
  button.textContent = labels.expand
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copied)
    button.setAttribute("title", labels.copied)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copy)
  button.setAttribute("title", labels.copy)
}

function setExpandState(wrapper: HTMLDivElement, button: HTMLButtonElement, labels: CodeLabels, expanded: boolean) {
  wrapper.setAttribute("data-expanded", expanded ? "true" : "false")
  const label = expanded ? labels.collapse : labels.expand
  button.setAttribute("aria-label", label)
  button.setAttribute("title", label)
  button.textContent = label
}

function setupCodeInteractions(root: HTMLDivElement, labels: CodeLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
  const touchButtonTimeouts = new Map<HTMLDivElement, ReturnType<typeof setTimeout>>()
  const touchStartYByPre = new WeakMap<HTMLPreElement, number>()
  const wrappers = new Set<HTMLDivElement>()

  const updateLabel = (button: HTMLButtonElement) => {
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const ensureWrapper = (block: HTMLPreElement) => {
    const parent = block.parentElement
    if (!parent) return null
    const wrapped = parent.getAttribute("data-component") === "markdown-code"
    if (wrapped) {
      const existing = parent as HTMLDivElement
      wrappers.add(existing)
      return existing
    }
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    wrapper.appendChild(createExpandButton(labels))
    wrappers.add(wrapper)
    return wrapper
  }

  const configureExpansion = (wrapper: HTMLDivElement) => {
    const pre = wrapper.querySelector("pre")
    const expandButton = wrapper.querySelector('[data-slot="markdown-expand-button"]')
    if (!(pre instanceof HTMLPreElement) || !(expandButton instanceof HTMLButtonElement)) {
      return
    }

    const canExpand = pre.scrollHeight > CODE_COLLAPSE_THRESHOLD_PX
    wrapper.setAttribute("data-can-expand", canExpand ? "true" : "false")

    if (!canExpand) {
      wrapper.removeAttribute("data-expanded")
      expandButton.setAttribute("aria-label", labels.expand)
      expandButton.setAttribute("title", labels.expand)
      expandButton.textContent = labels.expand
      return
    }

    const current = wrapper.getAttribute("data-expanded")
    const expanded = current === "true"
    setExpandState(wrapper, expandButton, labels, expanded)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const expandButton = target.closest('[data-slot="markdown-expand-button"]')
    if (expandButton instanceof HTMLButtonElement) {
      const wrapper = expandButton.closest('[data-component="markdown-code"]')
      if (!(wrapper instanceof HTMLDivElement)) return
      if (wrapper.getAttribute("data-can-expand") !== "true") return
      const expanded = wrapper.getAttribute("data-expanded") === "true"
      setExpandState(wrapper, expandButton, labels, !expanded)
      return
    }

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    const clipboard = navigator?.clipboard
    if (!clipboard) return
    await clipboard.writeText(content)
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const getScrollablePreFromTarget = (target: EventTarget | null): HTMLPreElement | null => {
    if (!(target instanceof Element)) {
      return null
    }
    const pre = target.closest('[data-component="markdown-code"] pre')
    if (!(pre instanceof HTMLPreElement)) {
      return null
    }
    if (pre.scrollHeight <= pre.clientHeight) {
      return null
    }
    return pre
  }

  const markTouchActive = (wrapper: HTMLDivElement) => {
    wrapper.setAttribute("data-touch-active", "true")
    const existing = touchButtonTimeouts.get(wrapper)
    if (existing) {
      clearTimeout(existing)
    }
    const timeout = setTimeout(() => {
      wrapper.removeAttribute("data-touch-active")
      touchButtonTimeouts.delete(wrapper)
    }, 2200)
    touchButtonTimeouts.set(wrapper, timeout)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) {
      return
    }
    const wrapper = event.target.closest('[data-component="markdown-code"]')
    if (wrapper instanceof HTMLDivElement) {
      markTouchActive(wrapper)
    }
  }

  const handleWheel = (event: WheelEvent) => {
    const pre = getScrollablePreFromTarget(event.target)
    if (!pre) {
      return
    }

    const atTop = pre.scrollTop <= 0
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 1
    if ((event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom)) {
      // Keep nested code-block scrolling isolated from the parent scroll container.
      event.stopPropagation()
    }
  }

  const handleTouchStart = (event: TouchEvent) => {
    const pre = getScrollablePreFromTarget(event.target)
    if (!pre) {
      return
    }
    const touch = event.touches[0]
    if (touch) {
      touchStartYByPre.set(pre, touch.clientY)
    }
  }

  const handleTouchMove = (event: TouchEvent) => {
    const pre = getScrollablePreFromTarget(event.target)
    if (!pre) {
      return
    }
    const touch = event.touches[0]
    if (!touch) {
      return
    }

    const lastY = touchStartYByPre.get(pre)
    touchStartYByPre.set(pre, touch.clientY)
    if (lastY === undefined) {
      return
    }

    const deltaY = lastY - touch.clientY
    const atTop = pre.scrollTop <= 0
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 1
    if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
      // Mirror wheel behavior for touch scroll chaining.
      event.stopPropagation()
    }
  }

  const updateSelectionState = () => {
    const selection = document.getSelection()
    const hasSelection = !!selection && !selection.isCollapsed && selection.rangeCount > 0
    if (!hasSelection) {
      for (const wrapper of wrappers) {
        wrapper.removeAttribute("data-selecting")
      }
      return
    }

    const anchorNode = selection?.anchorNode ?? null
    for (const wrapper of wrappers) {
      const containsSelection = !!anchorNode && wrapper.contains(anchorNode)
      if (containsSelection) {
        wrapper.setAttribute("data-selecting", "true")
      } else {
        wrapper.removeAttribute("data-selecting")
      }
    }
  }

  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    const wrapper = ensureWrapper(block)
    if (wrapper) {
      configureExpansion(wrapper)
    }
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)
  root.addEventListener("pointerdown", handlePointerDown)
  root.addEventListener("wheel", handleWheel, { passive: true })
  root.addEventListener("touchstart", handleTouchStart, { passive: true })
  root.addEventListener("touchmove", handleTouchMove, { passive: true })
  document.addEventListener("selectionchange", updateSelectionState)

  return () => {
    root.removeEventListener("click", handleClick)
    root.removeEventListener("pointerdown", handlePointerDown)
    root.removeEventListener("wheel", handleWheel)
    root.removeEventListener("touchstart", handleTouchStart)
    root.removeEventListener("touchmove", handleTouchMove)
    document.removeEventListener("selectionchange", updateSelectionState)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
    for (const timeout of touchButtonTimeouts.values()) {
      clearTimeout(timeout)
    }
    for (const wrapper of wrappers) {
      wrapper.removeAttribute("data-touch-active")
    }
  }
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "class", "classList"])
  const marked = useMarked()
  const i18n = useI18n()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const [html] = createResource(
    () => local.text,
    async (markdown) => {
      if (isServer) return ""

      const hash = checksum(markdown)
      const key = local.cacheKey ?? hash

      if (key && hash) {
        const cached = cache.get(key)
        if (cached && cached.hash === hash) {
          touch(key, cached)
          return cached.html
        }
      }

      const next = await marked.parse(markdown)
      const safe = sanitize(next)
      if (key && hash) touch(key, { hash, html: safe })
      return safe
    },
    { initialValue: "" },
  )

  let copySetupTimer: ReturnType<typeof setTimeout> | undefined
  let copyCleanup: (() => void) | undefined

  createEffect(() => {
    const container = root()
    const content = html()
    if (!container) return
    if (isServer) return

    if (!content) {
      container.innerHTML = ""
      return
    }

    const temp = document.createElement("div")
    temp.innerHTML = content

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.isEqualNode(toEl)) return false
        if (fromEl.getAttribute("data-component") === "markdown-code") {
          const fromPre = fromEl.querySelector("pre")
          const toPre = toEl.querySelector("pre")
          if (fromPre && toPre && !fromPre.isEqualNode(toPre)) {
            morphdom(fromPre, toPre)
          }
          return false
        }
        return true
      },
      onBeforeNodeDiscarded: (node) => {
        if (node instanceof Element) {
          if (node.getAttribute("data-slot") === "markdown-copy-button") return false
          if (node.getAttribute("data-component") === "markdown-code") return false
        }
        return true
      },
    })

    if (copySetupTimer) clearTimeout(copySetupTimer)
    copySetupTimer = setTimeout(() => {
      if (copyCleanup) copyCleanup()
      copyCleanup = setupCodeInteractions(container, {
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
        expand: i18n.t("ui.message.expand"),
        collapse: i18n.t("ui.message.collapse"),
      })
    }, 150)
  })

  onCleanup(() => {
    if (copySetupTimer) clearTimeout(copySetupTimer)
    if (copyCleanup) copyCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
