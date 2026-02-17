/**
 * Message component
 * Uses kilo-ui's Message component from @kilocode/kilo-ui/message-part
 * which handles all part types: text (Markdown), tool (BasicTool + per-tool renderers),
 * reasoning, and more — matching the desktop app's rendering.
 *
 * The DataProvider bridge in App.tsx provides the session store data in the
 * format that these components expect.
 */

import { Component, Show } from "solid-js"
import { Message as KiloMessage } from "@kilocode/kilo-ui/message-part"
import { useSession } from "../../context/session"
import type { Message as MessageType } from "../../types/messages"
import type { Message as SDKMessage, Part as SDKPart } from "@kilocode/sdk/v2"

interface MessageProps {
  message: MessageType
}

export const Message: Component<MessageProps> = (props) => {
  const session = useSession()
  const parts = () => session.getParts(props.message.id) as unknown as SDKPart[]

  return (
    <Show when={parts().length > 0 || props.message.content}>
      <KiloMessage message={props.message as unknown as SDKMessage} parts={parts()} />
    </Show>
  )
}
