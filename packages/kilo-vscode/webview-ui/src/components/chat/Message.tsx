/**
 * Message component
 * Uses kilo-ui's Message component from @kilocode/kilo-ui/message-part
 * which handles all part types: text (Markdown), tool (BasicTool + per-tool renderers),
 * reasoning, and more — matching the desktop app's rendering.
 *
 * The DataProvider bridge in App.tsx provides the session store data in the
 * format that these components expect.
 */

import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Message as KiloMessage, ToolRegistry, type ToolProps } from "@kilocode/kilo-ui/message-part"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { showToast } from "@kilocode/kilo-ui/toast"
import { diffLines } from "diff"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import { ImageViewer } from "../common/ImageViewer"
import type { FileAttachment, Message as MessageType } from "../../types/messages"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"

interface MessageProps {
  message: MessageType
}

interface DiffTarget {
  path?: string
  before: string
  after: string
}

interface ImagePart {
  type: "file"
  id: string
  mime: string
  url: string
  originalUrl?: string
  filename?: string
}

interface InlineDiffPreview {
  path?: string
  additions: number
  deletions: number
  text: string
  truncated: boolean
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "")
}

function extractMermaidBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const pattern = /```mermaid\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(markdown)) !== null) {
    const code = match[1]?.trim()
    if (code) {
      blocks.push(code)
    }
  }
  return blocks
}

function getExitCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function getDurationMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return undefined
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return `${minutes}m ${remaining}s`
}

function splitShellCommands(command: string): string[] {
  const chunks: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    const next = command[i + 1]

    if (!quote && (char === "'" || char === '"')) {
      quote = char
      current += char
      continue
    }
    if (quote && char === quote) {
      quote = null
      current += char
      continue
    }

    if (!quote) {
      if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
        if (current.trim()) {
          chunks.push(current.trim())
        }
        current = ""
        i++
        continue
      }
      if (char === "|" || char === ";") {
        if (current.trim()) {
          chunks.push(current.trim())
        }
        current = ""
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (!quote && (char === "'" || char === '"')) {
      quote = char
      continue
    }
    if (quote && char === quote) {
      quote = null
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function extractPatternsFromCommand(command: string): string[] {
  if (!command.trim()) {
    return []
  }

  const patterns = new Set<string>()
  const commands = splitShellCommands(command)
  const breakingToken = /^-|[\\/:.~]/

  for (const candidate of commands) {
    const tokens = tokenizeCommand(candidate)
    if (tokens.length === 0) {
      continue
    }

    patterns.add(tokens.join(" "))
    patterns.add(tokens[0])

    const maxDepth = Math.min(tokens.length, 3)
    for (let i = 1; i < maxDepth; i++) {
      if (breakingToken.test(tokens[i])) {
        break
      }
      patterns.add(tokens.slice(0, i + 1).join(" "))
    }
  }

  return Array.from(patterns).sort((a, b) => a.length - b.length || a.localeCompare(b))
}

function buildInlineDiffPreview(target: DiffTarget): InlineDiffPreview {
  const MAX_LINES = 160
  const chunks = diffLines(target.before, target.after)
  const lines: string[] = []
  let additions = 0
  let deletions = 0
  let truncated = false

  const append = (prefix: string, value: string) => {
    const split = value.split("\n")
    if (split.length > 0 && split[split.length - 1] === "") {
      split.pop()
    }
    for (const line of split) {
      if (lines.length >= MAX_LINES) {
        truncated = true
        return
      }
      lines.push(`${prefix}${line}`)
    }
  }

  for (const chunk of chunks) {
    if (chunk.added) {
      additions += (chunk.count ?? 0) || chunk.value.split("\n").filter((line) => line.length > 0).length
      append("+", chunk.value)
      continue
    }
    if (chunk.removed) {
      deletions += (chunk.count ?? 0) || chunk.value.split("\n").filter((line) => line.length > 0).length
      append("-", chunk.value)
      continue
    }
    append(" ", chunk.value)
  }

  return {
    path: target.path,
    additions,
    deletions,
    text: lines.join("\n"),
    truncated,
  }
}

function getToolFilePaths(props: ToolProps): string[] {
  const values = new Set<string>()

  const addPath = (value: unknown) => {
    if (typeof value !== "string") {
      return
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }
    values.add(trimmed)
  }

  addPath(props.input?.filePath)
  addPath(props.input?.path)

  const filediff = props.metadata?.filediff
  if (filediff && typeof filediff === "object") {
    addPath((filediff as { path?: unknown; file?: unknown }).path)
    addPath((filediff as { path?: unknown; file?: unknown }).file)
  }

  const metadataFiles = props.metadata?.files
  if (Array.isArray(metadataFiles)) {
    for (const file of metadataFiles) {
      if (!file || typeof file !== "object") {
        continue
      }
      addPath((file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).filePath)
      addPath((file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).path)
      addPath((file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).relativePath)
    }
  }

  return Array.from(values)
}

function getToolDiffTargets(props: ToolProps): DiffTarget[] {
  const targets: DiffTarget[] = []

  const addTarget = (path: unknown, before: unknown, after: unknown) => {
    if (typeof before !== "string" || typeof after !== "string") {
      return
    }
    if (before === after) {
      return
    }
    targets.push({
      path: typeof path === "string" && path.trim().length > 0 ? path : undefined,
      before,
      after,
    })
  }

  if (props.tool === "edit") {
    const filediff = props.metadata?.filediff as
      | { path?: unknown; file?: unknown; before?: unknown; after?: unknown }
      | undefined
    addTarget(
      filediff?.path ?? filediff?.file ?? props.input?.filePath,
      filediff?.before ?? props.input?.oldString ?? "",
      filediff?.after ?? props.input?.newString ?? "",
    )
    return targets
  }

  if (props.tool === "fast_edit_file") {
    const filediff = props.metadata?.filediff as
      | { path?: unknown; file?: unknown; before?: unknown; after?: unknown }
      | undefined
    addTarget(
      filediff?.path ?? filediff?.file ?? props.input?.filePath,
      filediff?.before ?? props.input?.oldString ?? "",
      filediff?.after ?? props.input?.newString ?? "",
    )
    return targets
  }

  if (props.tool === "write") {
    const filediff = props.metadata?.filediff as
      | { path?: unknown; file?: unknown; before?: unknown; after?: unknown }
      | undefined
    addTarget(
      filediff?.path ?? filediff?.file ?? props.input?.filePath,
      filediff?.before ?? "",
      filediff?.after ?? props.input?.content ?? "",
    )
    return targets
  }

  if (props.tool === "apply_patch") {
    const metadataFiles = props.metadata?.files
    if (Array.isArray(metadataFiles)) {
      for (const file of metadataFiles) {
        if (!file || typeof file !== "object") {
          continue
        }
        addTarget(
          (file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).filePath ??
            (file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).path ??
            (file as { filePath?: unknown; path?: unknown; relativePath?: unknown }).relativePath,
          (file as { before?: unknown }).before ?? "",
          (file as { after?: unknown }).after ?? "",
        )
      }
    }
  }

  return targets
}

function normalizeResourceLink(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  if (trimmed.startsWith("file://")) {
    return trimmed
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "vscode:") {
      return parsed.toString()
    }
  } catch {
    return undefined
  }
  return undefined
}

function addResourceLink(values: Set<string>, value: unknown) {
  if (typeof value !== "string") {
    return
  }
  const normalized = normalizeResourceLink(value)
  if (normalized) {
    values.add(normalized)
  }
}

function extractLinksFromText(text: string, values: Set<string>) {
  const pattern = /(?:https?:\/\/|file:\/\/|vscode:\/\/)[^\s"'`<>]+/gi
  const matches = text.match(pattern) ?? []
  for (const match of matches) {
    addResourceLink(values, match)
  }
}

function getToolResourceLinks(props: ToolProps): string[] {
  const values = new Set<string>()

  const input = props.input ?? {}
  const metadata = props.metadata ?? {}

  const directCandidates = [
    input.url,
    input.uri,
    input.href,
    input.link,
    input.endpoint,
    input.resource,
    metadata.url,
    metadata.uri,
    metadata.href,
    metadata.link,
    metadata.endpoint,
    metadata.resource,
    metadata.source,
    metadata.target,
  ]

  for (const candidate of directCandidates) {
    addResourceLink(values, candidate)
  }

  const groupedCandidates = [input.urls, input.links, input.resources, metadata.urls, metadata.links, metadata.resources]
  for (const candidate of groupedCandidates) {
    if (!Array.isArray(candidate)) {
      continue
    }
    for (const item of candidate) {
      if (typeof item === "string") {
        addResourceLink(values, item)
      } else if (item && typeof item === "object") {
        addResourceLink(values, (item as { url?: unknown }).url)
        addResourceLink(values, (item as { uri?: unknown }).uri)
        addResourceLink(values, (item as { href?: unknown }).href)
      }
    }
  }

  const metadataFiles = metadata.files
  if (Array.isArray(metadataFiles)) {
    for (const file of metadataFiles) {
      if (!file || typeof file !== "object") {
        continue
      }
      addResourceLink(values, (file as { url?: unknown }).url)
      addResourceLink(values, (file as { uri?: unknown }).uri)
      addResourceLink(values, (file as { href?: unknown }).href)
    }
  }

  if (typeof props.output === "string") {
    extractLinksFromText(props.output.slice(0, 4000), values)
  } else if (typeof metadata.output === "string") {
    extractLinksFromText(metadata.output.slice(0, 4000), values)
  }

  return Array.from(values).slice(0, 8)
}

const BashTool: Component<ToolProps> = (props) => {
  const session = useSession()
  const server = useServer()
  const language = useLanguage()
  const vscode = useVSCode()

  const isRunning = () => props.status === "running" || props.status === "pending"
  const exitCode = () => getExitCode(props.metadata?.exit)

  const status = createMemo(() => {
    if (isRunning()) return { state: "running", label: "Running" }
    if (props.status === "error") return { state: "failure", label: "Failed" }
    if (props.status === "completed") {
      const code = exitCode()
      if (code === undefined) return { state: "success", label: "Succeeded" }
      return code === 0 ? { state: "success", label: "Succeeded" } : { state: "failure", label: `Failed (${code})` }
    }
    return { state: "unknown", label: "Unknown" }
  })

  const command = () => {
    const raw = props.input.command ?? props.metadata.command
    return typeof raw === "string" ? raw : ""
  }

  const output = () => {
    const raw = props.output ?? props.metadata.output
    return typeof raw === "string" ? stripAnsi(raw) : ""
  }

  const cwd = () => {
    const raw = props.input.cwd ?? props.metadata.cwd ?? props.metadata.directory
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined
  }
  const durationMs = () =>
    getDurationMs(props.metadata.durationMs ?? props.metadata.duration ?? props.metadata.elapsedMs ?? props.metadata.timeMs)

  const markdown = () => {
    const body = output()
    if (!body) {
      return `\`\`\`command\n$ ${command()}\n\`\`\``
    }
    return `\`\`\`command\n$ ${command()}\n\n${body}\n\`\`\``
  }

  const transcript = createMemo(() => {
    const commandLine = command().trim() ? `$ ${command().trim()}` : "$ (command unavailable)"
    const body = output().trim()
    return body.length > 0 ? `${commandLine}\n\n${body}` : commandLine
  })

  const openTranscript = () => {
    vscode.postMessage({ type: "openMarkdownPreview", text: `\`\`\`shell\n${transcript()}\n\`\`\`` })
  }

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(output())
      showToast({ variant: "success", title: "Command output copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy command output" })
    }
  }

  const commandPatterns = createMemo(() => extractPatternsFromCommand(command()))

  const saveCommandRules = (allowed: string[], denied: string[]) => {
    vscode.postMessage({ type: "updateSetting", key: "allowedCommands", value: allowed })
    vscode.postMessage({ type: "updateSetting", key: "deniedCommands", value: denied })
  }

  const setPatternDecision = (pattern: string, decision: "allow" | "deny" | "clear") => {
    const allowed = server.allowedCommands().filter((entry) => entry !== pattern)
    const denied = server.deniedCommands().filter((entry) => entry !== pattern)

    if (decision === "allow") {
      allowed.push(pattern)
    }
    if (decision === "deny") {
      denied.push(pattern)
    }

    saveCommandRules(allowed, denied)
  }

  return (
    <BasicTool
      {...props}
      icon="console"
      forceOpen={props.forceOpen || isRunning()}
      defaultOpen={props.defaultOpen ?? isRunning()}
      trigger={{
        title: "Shell",
        subtitle:
          typeof props.input.description === "string"
            ? props.input.description
            : typeof props.metadata.description === "string"
              ? props.metadata.description
              : undefined,
        action: (
          <div class="command-tool-actions">
            <span class="command-tool-status" data-state={status().state}>
              <span class="command-tool-status-dot" />
              <span>{status().label}</span>
            </span>
            <Show when={isRunning()}>
              <Tooltip value={language.t("prompt.action.stop")} placement="top">
                <Button variant="ghost" size="small" onClick={() => session.abort()}>
                  {language.t("prompt.action.stop")}
                </Button>
              </Tooltip>
            </Show>
            <Tooltip value="Open in terminal" placement="top">
              <Button
                variant="ghost"
                size="small"
                onClick={() =>
                  vscode.postMessage({
                    type: "openTerminal",
                    cwd: cwd(),
                    command: command() || undefined,
                  })
                }
              >
                Terminal
              </Button>
            </Tooltip>
            <Tooltip value="Open command transcript" placement="top">
              <Button variant="ghost" size="small" onClick={openTranscript}>
                Transcript
              </Button>
            </Tooltip>
            <Tooltip value="Copy command output" placement="top">
              <Button variant="ghost" size="small" onClick={() => void copyOutput()}>
                Copy Output
              </Button>
            </Tooltip>
          </div>
        ),
      }}
    >
      <Show when={cwd() || (exitCode() !== undefined && !isRunning()) || durationMs() !== undefined}>
        <div class="command-tool-meta-row">
          <Show when={cwd()}>
            <span class="command-tool-meta-chip">cwd: {cwd()}</span>
          </Show>
          <Show when={exitCode() !== undefined && !isRunning()}>
            <span class="command-tool-meta-chip">exit: {exitCode()}</span>
          </Show>
          <Show when={durationMs() !== undefined}>
            <span class="command-tool-meta-chip">duration: {formatDuration(durationMs()!)}</span>
          </Show>
        </div>
      </Show>
      <Show when={commandPatterns().length > 0}>
        <div class="command-tool-patterns">
          <span class="command-tool-patterns-label">Command patterns</span>
          <For each={commandPatterns().slice(0, 8)}>
            {(pattern) => {
              const isAllowed = () => server.allowedCommands().includes(pattern)
              const isDenied = () => server.deniedCommands().includes(pattern)
              return (
                <div class="command-tool-pattern-row">
                  <span class="command-tool-pattern-value" title={pattern}>
                    {pattern}
                  </span>
                  <div class="command-tool-pattern-actions">
                    <Button
                      variant="ghost"
                      size="small"
                      data-state={isAllowed() ? "active" : "idle"}
                      onClick={() => setPatternDecision(pattern, isAllowed() ? "clear" : "allow")}
                    >
                      Allow
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      data-state={isDenied() ? "active" : "idle"}
                      onClick={() => setPatternDecision(pattern, isDenied() ? "clear" : "deny")}
                    >
                      Deny
                    </Button>
                  </div>
                </div>
              )
            }}
          </For>
          <Show when={commandPatterns().length > 8}>
            <span class="command-tool-pattern-more">+{commandPatterns().length - 8} more patterns</span>
          </Show>
        </div>
      </Show>
      <div data-component="tool-output" data-scrollable>
        <Markdown text={markdown()} />
      </div>
    </BasicTool>
  )
}

ToolRegistry.register({
  name: "bash",
  render: BashTool,
})

function registerOpenFileInlineAction(toolName: string) {
  const baseRender = ToolRegistry.render(toolName)
  if (!baseRender) {
    return
  }

  const WrappedTool: Component<ToolProps> = (props) => {
    const language = useLanguage()
    const vscode = useVSCode()
    const [showInlineDiff, setShowInlineDiff] = createSignal(false)
    const filePaths = createMemo(() => getToolFilePaths(props))
    const diffTargets = createMemo(() => getToolDiffTargets(props))
    const diffPreviews = createMemo(() => diffTargets().map((target) => buildInlineDiffPreview(target)))
    const aggregateDiffStats = createMemo(() =>
      diffPreviews().reduce(
        (acc, preview) => ({ additions: acc.additions + preview.additions, deletions: acc.deletions + preview.deletions }),
        { additions: 0, deletions: 0 },
      ),
    )
    const resourceLinks = createMemo(() => getToolResourceLinks(props))
    const primaryPath = createMemo(() => filePaths()[0])
    const primaryResource = createMemo(() => resourceLinks()[0])

    const openFile = () => {
      const path = primaryPath()
      if (!path) {
        return
      }
      vscode.postMessage({ type: "openFilePath", path })
    }

    const copyPath = async () => {
      const path = primaryPath()
      if (!path) {
        return
      }
      try {
        await navigator.clipboard.writeText(path)
        showToast({ variant: "success", title: "Path copied" })
      } catch {
        showToast({ variant: "error", title: "Failed to copy path" })
      }
    }

    const openDiff = () => {
      const target = diffTargets()[0]
      if (!target) {
        return
      }
      vscode.postMessage({
        type: "openDiffPreview",
        path: target.path,
        before: target.before,
        after: target.after,
      })
    }

    const openBatchDiffReview = () => {
      const targets = diffTargets()
      if (targets.length === 0) {
        return
      }
      vscode.postMessage({
        type: "openBatchDiffPreview",
        diffs: targets.map((target) => ({
          path: target.path,
          before: target.before,
          after: target.after,
        })),
      })
    }

    const openResource = () => {
      const target = primaryResource()
      if (!target) {
        return
      }
      if (target.startsWith("file://")) {
        vscode.postMessage({ type: "openFilePath", path: target })
        return
      }
      vscode.postMessage({ type: "openExternal", url: target })
    }

    const copyResource = async () => {
      const target = primaryResource()
      if (!target) {
        return
      }
      try {
        await navigator.clipboard.writeText(target)
        showToast({ variant: "success", title: "Link copied" })
      } catch {
        showToast({ variant: "error", title: "Failed to copy link" })
      }
    }

    return (
      <div class="tool-inline-actions-container">
        <Show when={primaryPath() || diffTargets().length > 0 || primaryResource()}>
          <div class="tool-inline-actions">
            <Show when={primaryPath()}>
              <Tooltip value={language.t("command.file.open")} placement="top">
                <Button variant="ghost" size="small" onClick={openFile} aria-label={language.t("command.file.open")}>
                  {language.t("command.file.open")}
                </Button>
              </Tooltip>
              <Tooltip value={language.t("session.header.open.copyPath")} placement="top">
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => void copyPath()}
                  aria-label={language.t("session.header.open.copyPath")}
                >
                  {language.t("session.header.open.copyPath")}
                </Button>
              </Tooltip>
            </Show>
            <Show when={diffTargets().length > 0}>
              <Tooltip value="Open Diff" placement="top">
                <Button variant="ghost" size="small" onClick={openDiff} aria-label="Open Diff">
                  Open Diff
                </Button>
              </Tooltip>
              <Show when={diffTargets().length > 1}>
                <Tooltip value="Review all changed files" placement="top">
                  <Button variant="ghost" size="small" onClick={openBatchDiffReview} aria-label="Review changed files">
                    Review Files
                  </Button>
                </Tooltip>
              </Show>
              <Tooltip value={showInlineDiff() ? "Hide inline diff" : "Show inline diff"} placement="top">
                <Button variant="ghost" size="small" onClick={() => setShowInlineDiff((prev) => !prev)}>
                  {showInlineDiff() ? "Hide Diff" : "Show Diff"}
                </Button>
              </Tooltip>
              <span class="tool-inline-actions-meta">
                +{aggregateDiffStats().additions} -{aggregateDiffStats().deletions}
              </span>
            </Show>
            <Show when={primaryResource()}>
              <Tooltip value="Open linked resource" placement="top">
                <Button variant="ghost" size="small" onClick={openResource} aria-label="Open linked resource">
                  Open Link
                </Button>
              </Tooltip>
              <Tooltip value="Copy linked resource" placement="top">
                <Button variant="ghost" size="small" onClick={() => void copyResource()} aria-label="Copy linked resource">
                  Copy Link
                </Button>
              </Tooltip>
              <Show when={resourceLinks().length > 1}>
                <span class="tool-inline-actions-meta">+{resourceLinks().length - 1} links</span>
              </Show>
            </Show>
            <Show when={filePaths().length > 1}>
              <span class="tool-inline-actions-meta">+{filePaths().length - 1} more</span>
            </Show>
          </div>
        </Show>
        <Show when={showInlineDiff() && diffPreviews().length > 0}>
          <div class="tool-inline-diff-panel">
            <For each={diffPreviews().slice(0, 3)}>
              {(preview) => (
                <div class="tool-inline-diff-file">
                  <div class="tool-inline-diff-header">
                    <span class="tool-inline-diff-path" title={preview.path ?? "Modified file"}>
                      {preview.path ?? "Modified file"}
                    </span>
                    <span class="tool-inline-diff-stats">
                      +{preview.additions} -{preview.deletions}
                    </span>
                  </div>
                  <div class="tool-inline-diff-code">
                    <Markdown
                      text={
                        preview.text && preview.text.trim().length > 0
                          ? `\`\`\`diff\n${preview.text}\n\`\`\``
                          : "No inline diff preview available."
                      }
                    />
                  </div>
                  <Show when={preview.truncated}>
                    <div class="tool-inline-diff-truncated">Diff preview truncated. Use Open Diff for full context.</div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={diffPreviews().length > 3}>
              <div class="tool-inline-diff-truncated">+{diffPreviews().length - 3} more modified files</div>
            </Show>
          </div>
        </Show>
        <Dynamic
          component={baseRender}
          input={props.input}
          tool={props.tool}
          metadata={props.metadata}
          output={props.output}
          status={props.status}
          hideDetails={props.hideDetails}
          forceOpen={props.forceOpen}
          locked={props.locked}
          defaultOpen={props.defaultOpen}
        />
      </div>
    )
  }

  ToolRegistry.register({
    name: toolName,
    render: WrappedTool,
  })
}

registerOpenFileInlineAction("read")
registerOpenFileInlineAction("write")
registerOpenFileInlineAction("edit")
registerOpenFileInlineAction("fast_edit_file")
registerOpenFileInlineAction("list")
registerOpenFileInlineAction("apply_patch")
registerOpenFileInlineAction("webfetch")
registerOpenFileInlineAction("websearch")
registerOpenFileInlineAction("codesearch")
registerOpenFileInlineAction("fetch")
registerOpenFileInlineAction("search")
registerOpenFileInlineAction("mcp")

export const Message: Component<MessageProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const dialog = useDialog()
  const messageTime = createMemo(() => {
    const created = new Date(props.message.createdAt)
    if (Number.isNaN(created.getTime())) {
      return ""
    }
    return created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  })
  const parts = () => session.getParts(props.message.id) as unknown as SDKPart[]
  const [viewerFile, setViewerFile] = createSignal<FileAttachment | null>(null)
  const imageParts = createMemo<ImagePart[]>(() =>
    (parts() as unknown as ImagePart[]).filter(
      (part): part is ImagePart =>
        part.type === "file" && typeof part.mime === "string" && part.mime.startsWith("image/"),
    ),
  )
  const openImageAttachment = (part: ImagePart) => {
    const originalUrl = part.originalUrl ?? part.url
    if (originalUrl.startsWith("file://")) {
      vscode.postMessage({ type: "openFileAttachment", url: originalUrl })
      return
    }
    if (originalUrl.startsWith("https://")) {
      vscode.postMessage({ type: "openExternal", url: originalUrl })
    }
  }

  const copyImagePath = async (part: ImagePart) => {
    try {
      await navigator.clipboard.writeText(part.originalUrl ?? part.url)
      showToast({ variant: "success", title: "Path copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy path" })
    }
  }

  const saveImageAttachment = (part: ImagePart) => {
    vscode.postMessage({
      type: "saveFileAttachment",
      url: part.originalUrl ?? part.url,
      name: part.filename,
      mime: part.mime,
    })
  }

  const previewImage = (part: ImagePart) => {
    setViewerFile({
      mime: part.mime,
      url: part.originalUrl ?? part.url,
      previewUrl: part.url,
      name: part.filename,
    })
  }

  const userMessageText = createMemo(() => {
    if (props.message.role !== "user") {
      return ""
    }
    return props.message.content?.trim() ?? ""
  })

  const previewMarkdown = createMemo(() => {
    if (props.message.role !== "assistant") {
      return userMessageText()
    }

    const textParts = (parts() as Array<{ type?: string; text?: string }>)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text?.trim())
      .filter((text): text is string => !!text)

    if (textParts.length > 0) {
      return textParts.join("\n\n")
    }

    const content = props.message.content?.trim()
    return content ?? ""
  })
  const mermaidBlocks = createMemo(() => extractMermaidBlocks(previewMarkdown()))
  const [isEditingUserMessage, setIsEditingUserMessage] = createSignal(false)
  const [editingText, setEditingText] = createSignal("")

  const openMermaidPreview = () => {
    if (mermaidBlocks().length === 0) {
      return
    }
    const markdown = mermaidBlocks()
      .map((block) => `\`\`\`mermaid\n${block}\n\`\`\``)
      .join("\n\n")
    vscode.postMessage({ type: "openMarkdownPreview", text: markdown })
  }

  const copyMermaidCode = async () => {
    if (mermaidBlocks().length === 0) {
      return
    }
    try {
      await navigator.clipboard.writeText(mermaidBlocks()[0])
      showToast({ variant: "success", title: "Mermaid code copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy Mermaid code" })
    }
  }

  const copyMessage = async () => {
    const text = props.message.role === "assistant" ? previewMarkdown() : userMessageText()
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      showToast({ variant: "success", title: "Message copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy message" })
    }
  }

  const startInlineEdit = () => {
    if (props.message.role !== "user") {
      return
    }
    const value = userMessageText()
    setEditingText(value)
    setIsEditingUserMessage(true)
  }

  const cancelInlineEdit = () => {
    setIsEditingUserMessage(false)
  }

  const applyInlineEdit = () => {
    const nextValue = editingText().trim()
    const currentValue = userMessageText().trim()
    if (!nextValue || nextValue === currentValue) {
      setIsEditingUserMessage(false)
      return
    }
    session.revertMessage(props.message.id)
    window.dispatchEvent(new CustomEvent("kilo:prompt-prefill", { detail: { text: nextValue } }))
    setIsEditingUserMessage(false)
    showToast({
      variant: "default",
      title: "Message moved to composer",
      description: "Review and resend the edited prompt.",
    })
  }

  const confirmDeleteFromHere = () => {
    dialog.show(() => (
      <Dialog title="Delete from this message?" fit>
        <div class="dialog-confirm-body">
          <span>Remove this message and all following conversation turns?</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.revertMessage(props.message.id)
                setIsEditingUserMessage(false)
                dialog.close()
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  const confirmRevertMessage = () => {
    dialog.show(() => (
      <Dialog title="Undo message?" fit>
        <div class="dialog-confirm-body">
          <span>Revert the session to this message and remove later messages?</span>
          <div class="dialog-confirm-actions">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                session.revertMessage(props.message.id)
                dialog.close()
              }}
            >
              {language.t("command.session.undo")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <Show when={parts().length > 0 || props.message.content}>
      <ContextMenu>
        <ContextMenu.Trigger as="div" class="message-block">
          <Show when={messageTime() || previewMarkdown().length > 0}>
            <div class="message-actions">
              <Show when={messageTime()}>
                <span class="message-timestamp" title={new Date(props.message.createdAt).toLocaleString()}>
                  {messageTime()}
                </span>
              </Show>
              <Show when={props.message.role === "user"}>
                <Tooltip value="Edit message" placement="top">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={startInlineEdit}
                    aria-label="Edit message"
                    disabled={isEditingUserMessage()}
                  >
                    Edit
                  </Button>
                </Tooltip>
                <Tooltip value="Delete from this message" placement="top">
                  <Button variant="ghost" size="small" onClick={confirmDeleteFromHere} aria-label="Delete from this message">
                    Delete
                  </Button>
                </Tooltip>
              </Show>
              <Show when={previewMarkdown().length > 0}>
                <Tooltip value="Open markdown preview in VS Code" placement="top">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => vscode.postMessage({ type: "openMarkdownPreview", text: previewMarkdown() })}
                    aria-label="Open markdown preview in VS Code"
                  >
                    Preview
                  </Button>
                </Tooltip>
              </Show>
              <Show when={mermaidBlocks().length > 0}>
                <Tooltip value="Open Mermaid preview in VS Code" placement="top">
                  <Button variant="ghost" size="small" onClick={openMermaidPreview} aria-label="Open Mermaid preview">
                    Mermaid
                  </Button>
                </Tooltip>
              </Show>
            </div>
          </Show>
          <Show
            when={props.message.role === "user" && isEditingUserMessage()}
            fallback={<KiloMessage message={props.message as unknown as SDKMessage} parts={parts()} />}
          >
            <div class="message-inline-editor">
              <textarea
                class="message-inline-editor-input"
                value={editingText()}
                onInput={(event) => setEditingText((event.target as HTMLTextAreaElement).value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    cancelInlineEdit()
                    return
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault()
                    applyInlineEdit()
                  }
                }}
                rows={4}
                spellcheck={false}
              />
              <div class="message-inline-editor-actions">
                <Button variant="ghost" size="small" onClick={cancelInlineEdit}>
                  {language.t("common.cancel")}
                </Button>
                <Button variant="secondary" size="small" onClick={confirmDeleteFromHere}>
                  Delete
                </Button>
                <Button variant="primary" size="small" onClick={applyInlineEdit} disabled={editingText().trim().length === 0}>
                  Save
                </Button>
              </div>
            </div>
          </Show>
          <Show when={imageParts().length > 0}>
            <div class="message-image-gallery">
              <For each={imageParts()}>
                {(part) => (
                  <ContextMenu>
                    <ContextMenu.Trigger as="button" class="message-image-thumb" onClick={() => previewImage(part)}>
                      <img src={part.url} alt={part.filename ?? "Image attachment"} loading="lazy" />
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content>
                        <ContextMenu.Item onSelect={() => previewImage(part)}>
                          <ContextMenu.ItemLabel>Preview</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => openImageAttachment(part)}>
                          <ContextMenu.ItemLabel>{language.t("command.file.open")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => saveImageAttachment(part)}>
                          <ContextMenu.ItemLabel>{language.t("common.save")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Item onSelect={() => void copyImagePath(part)}>
                          <ContextMenu.ItemLabel>{language.t("session.header.open.copyPath")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu>
                )}
              </For>
            </div>
          </Show>
          <ImageViewer
            file={viewerFile()}
            onClose={() => setViewerFile(null)}
            onOpenFile={(url) => openImageAttachment({ type: "file", id: "", mime: "image/*", url })}
            onCopyPath={async (url) => copyImagePath({ type: "file", id: "", mime: "image/*", url })}
            onSaveFile={(file) =>
              saveImageAttachment({ type: "file", id: "", mime: file.mime, url: file.url, filename: file.name })
            }
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => void copyMessage()}>
              <ContextMenu.ItemLabel>{language.t("common.copy")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => session.forkSession(props.message.id)}>
              <ContextMenu.ItemLabel>{language.t("command.session.fork")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => session.openForkSessionPicker()}>
              <ContextMenu.ItemLabel>Open Forks</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <Show when={props.message.role === "user"}>
              <ContextMenu.Item onSelect={startInlineEdit}>
                <ContextMenu.ItemLabel>Edit message</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={confirmDeleteFromHere}>
                <ContextMenu.ItemLabel>Delete from here</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => confirmRevertMessage()}>
                <ContextMenu.ItemLabel>{language.t("command.session.undo")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </Show>
            <Show when={previewMarkdown().length > 0}>
              <ContextMenu.Separator />
              <ContextMenu.Item
                onSelect={() => vscode.postMessage({ type: "openMarkdownPreview", text: previewMarkdown() })}
              >
                <ContextMenu.ItemLabel>Open Markdown Preview</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </Show>
            <Show when={mermaidBlocks().length > 0}>
              <ContextMenu.Item onSelect={openMermaidPreview}>
                <ContextMenu.ItemLabel>Open Mermaid Preview</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={() => void copyMermaidCode()}>
                <ContextMenu.ItemLabel>Copy Mermaid Code</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  )
}
