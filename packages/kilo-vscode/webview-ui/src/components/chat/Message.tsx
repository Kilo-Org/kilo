/**
 * Message component
 * Uses kilo-ui's Message component from @kilocode/kilo-ui/message-part
 * which handles all part types: text (Markdown), tool (BasicTool + per-tool renderers),
 * reasoning, and more — matching the desktop app's rendering.
 *
 * The DataProvider bridge in App.tsx provides the session store data in the
 * format that these components expect.
 */

import { Component, Show, createMemo } from "solid-js"
import { Message as KiloMessage, ToolRegistry, type ToolProps } from "@kilocode/kilo-ui/message-part"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { Message as MessageType } from "../../types/messages"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"

interface MessageProps {
  message: MessageType
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "")
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

export const Message: Component<MessageProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const vscode = useVSCode()
  const parts = () => session.getParts(props.message.id) as unknown as SDKPart[]
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

  return (
    <Show when={parts().length > 0 || props.message.content}>
      <ContextMenu>
        <ContextMenu.Trigger as="div" class="message-block">
          <Show when={previewMarkdown().length > 0}>
            <div class="message-actions">
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
            </div>
          </Show>
          <KiloMessage message={props.message as unknown as SDKMessage} parts={parts()} />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => void copyMessage()}>
              <ContextMenu.ItemLabel>{language.t("common.copy")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <Show when={previewMarkdown().length > 0}>
              <ContextMenu.Separator />
              <ContextMenu.Item
                onSelect={() => vscode.postMessage({ type: "openMarkdownPreview", text: previewMarkdown() })}
              >
                <ContextMenu.ItemLabel>Open Markdown Preview</ContextMenu.ItemLabel>
              </ContextMenu.Item>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  )
}
