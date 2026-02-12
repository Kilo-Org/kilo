/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component } from "solid-js"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionDialog } from "./PermissionDialog"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
}

export const ChatView: Component<ChatViewProps> = (props) => {
  return (
    <div class="chat-view">
      <TaskHeader />
      <div class="chat-messages">
        <MessageList onSelectSession={props.onSelectSession} />
      </div>

      <div class="chat-input">
        <PromptInput />
      </div>

      <PermissionDialog />
    </div>
  )
}
