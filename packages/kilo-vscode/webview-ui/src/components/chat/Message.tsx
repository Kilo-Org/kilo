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
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
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
    const filediff = props.metadata?.filediff as { path?: unknown; file?: unknown; before?: unknown; after?: unknown } | undefined
    addTarget(
      filediff?.path ?? filediff?.file ?? props.input?.filePath,
      filediff?.before ?? props.input?.oldString ?? "",
      filediff?.after ?? props.input?.newString ?? "",
    )
    return targets
  }

  if (props.tool === "write") {
    const filediff = props.metadata?.filediff as { path?: unknown; file?: unknown; before?: unknown; after?: unknown } | undefined
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

const BashTool: Component<ToolProps> = (props) => {
  const session = useSession()
  const language = useLanguage()

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

  const markdown = () => {
    const body = output()
    if (!body) {
      return `\`\`\`command\n$ ${command()}\n\`\`\``
    }
    return `\`\`\`command\n$ ${command()}\n\n${body}\n\`\`\``
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
          </div>
        ),
      }}
    >
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
    const filePaths = createMemo(() => getToolFilePaths(props))
    const diffTargets = createMemo(() => getToolDiffTargets(props))
    const primaryPath = createMemo(() => filePaths()[0])

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

    return (
      <div class="tool-inline-actions-container">
        <Show when={primaryPath() || diffTargets().length > 0}>
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
            </Show>
            <Show when={filePaths().length > 1}>
              <span class="tool-inline-actions-meta">+{filePaths().length - 1} more</span>
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
registerOpenFileInlineAction("list")
registerOpenFileInlineAction("apply_patch")

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
      (part): part is ImagePart => part.type === "file" && typeof part.mime === "string" && part.mime.startsWith("image/"),
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

  const previewImage = (part: ImagePart) => {
    setViewerFile({
      mime: part.mime,
      url: part.originalUrl ?? part.url,
      previewUrl: part.url,
      name: part.filename,
    })
  }

  const previewMarkdown = createMemo(() => {
    if (props.message.role !== "assistant") {
      return ""
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

  const openMermaidPreview = () => {
    if (mermaidBlocks().length === 0) {
      return
    }
    const markdown = mermaidBlocks().map((block) => `\`\`\`mermaid\n${block}\n\`\`\``).join("\n\n")
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
    const text = previewMarkdown()
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
          <KiloMessage message={props.message as unknown as SDKMessage} parts={parts()} />
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
