/**
 * ChatView component
 * Main chat container that combines all chat components
 */

import { Component, Show } from "solid-js"
import { TaskHeader } from "./TaskHeader"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { QuestionDock } from "./QuestionDock"
import { useSession } from "../../context/session"

interface ChatViewProps {
  onSelectSession?: (id: string) => void
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const session = useSession()

  const id = () => session.currentSessionID()
  const sessionQuestions = () => session.questions().filter((q) => q.sessionID === id())
  const sessionPermissions = () => session.permissions().filter((p) => p.sessionID === id())

  const questionRequest = () => sessionQuestions()[0]
  const blocked = () => sessionPermissions().length > 0 || sessionQuestions().length > 0

  return (
    <div class="chat-view">
      <TaskHeader />
      <div class="chat-messages">
        <MessageList onSelectSession={props.onSelectSession} />
      </div>

      <div class="chat-input">
        <Show when={questionRequest()} keyed>
          {(req) => <QuestionDock request={req} />}
        </Show>
        <Show when={!blocked()}>
          <PromptInput />
        </Show>
      </div>
    </div>
  )
}
