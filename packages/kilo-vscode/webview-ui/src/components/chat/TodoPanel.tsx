import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

function statusLabel(status: "pending" | "in_progress" | "completed" | "cancelled", t: (key: string) => string): string {
  switch (status) {
    case "in_progress":
      return t("todo.status.inProgress")
    case "completed":
      return t("todo.status.completed")
    case "cancelled":
      return "Cancelled"
    default:
      return t("todo.status.pending")
  }
}

export const TodoPanel: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const [showCompleted, setShowCompleted] = createSignal(false)
  const [newTodoText, setNewTodoText] = createSignal("")
  const [editingTodoID, setEditingTodoID] = createSignal<string | null>(null)
  const [editingText, setEditingText] = createSignal("")
  const [pendingDeleteTodoID, setPendingDeleteTodoID] = createSignal<string | null>(null)

  const todos = createMemo(() => session.todos())
  const total = createMemo(() => todos().length)
  const completed = createMemo(() => todos().filter((item) => item.status === "completed").length)
  const progress = createMemo(() => {
    if (total() === 0) return 0
    return Math.round((completed() / total()) * 100)
  })
  const visibleTodos = createMemo(() =>
    showCompleted() ? todos() : todos().filter((item) => item.status !== "completed" && item.status !== "cancelled"),
  )
  const hiddenCompleted = createMemo(() => {
    if (showCompleted()) {
      return 0
    }
    return todos().filter((x) => x.status === "completed" || x.status === "cancelled").length
  })
  const copyTodo = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      showToast({ variant: "success", title: "Todo copied" })
    } catch {
      showToast({ variant: "error", title: "Failed to copy todo" })
    }
  }

  const addTodo = () => {
    const content = newTodoText().trim()
    if (!content) {
      return
    }
    session.createTodo(content, "pending")
    setNewTodoText("")
  }

  const startEdit = (todoID: string, content: string) => {
    setEditingTodoID(todoID)
    setEditingText(content)
  }

  const saveEdit = (todoID: string) => {
    const content = editingText().trim()
    if (!content) {
      return
    }
    session.updateTodo(todoID, { content })
    setEditingTodoID(null)
    setEditingText("")
  }

  const updateTodoStatus = (todoID: string, status: "pending" | "in_progress" | "completed" | "cancelled") => {
    session.updateTodo(todoID, { status })
  }

  const requestDeleteTodo = (todoID: string) => {
    setPendingDeleteTodoID(todoID)
  }

  const cancelDeleteTodo = () => {
    setPendingDeleteTodoID(null)
  }

  const confirmDeleteTodo = (todoID: string) => {
    session.deleteTodo(todoID)
    setPendingDeleteTodoID(null)
  }

  return (
    <Show when={session.currentSessionID()}>
      <div class="todo-panel">
        <div class="todo-panel-header">
          <span class="todo-panel-title">{language.t("todo.title")}</span>
          <span class="todo-panel-progress-text">
            {language.t("todo.progress", { completed: completed(), total: total(), percent: progress() })}
          </span>
        </div>

        <div
          class="todo-panel-progress-bar"
          role="progressbar"
          aria-valuenow={progress()}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div class="todo-panel-progress-fill" style={{ width: `${progress()}%` }} />
        </div>

        <div class="todo-panel-create">
          <input
            type="text"
            class="todo-panel-input"
            value={newTodoText()}
            onInput={(event) => setNewTodoText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addTodo()
              }
            }}
            placeholder="Add a todo item..."
          />
          <Button size="small" variant="secondary" onClick={addTodo} disabled={newTodoText().trim().length === 0}>
            Add
          </Button>
        </div>

        <ul class="todo-panel-list">
          <For each={visibleTodos()}>
            {(item) => (
              <ContextMenu>
                <ContextMenu.Trigger as="li" class="todo-panel-item">
                  <span class="todo-panel-status" data-status={item.status}>
                    {statusLabel(item.status, language.t)}
                  </span>
                  <Show
                    when={editingTodoID() === item.id}
                    fallback={
                      <>
                        <span
                          class="todo-panel-content"
                          data-status={item.status}
                          onDblClick={() => startEdit(item.id, item.content)}
                        >
                          {item.content}
                        </span>
                        <div class="todo-panel-item-controls">
                          <select
                            class="todo-panel-status-select"
                            value={item.status}
                            onChange={(event) =>
                              updateTodoStatus(
                                item.id,
                                event.currentTarget.value as "pending" | "in_progress" | "completed" | "cancelled",
                              )
                            }
                            aria-label={`Set status for todo ${item.content}`}
                          >
                            <option value="pending">{language.t("todo.status.pending")}</option>
                            <option value="in_progress">{language.t("todo.status.inProgress")}</option>
                            <option value="completed">{language.t("todo.status.completed")}</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <Button size="small" variant="ghost" onClick={() => startEdit(item.id, item.content)}>
                            Edit
                          </Button>
                          <Show
                            when={pendingDeleteTodoID() === item.id}
                            fallback={
                              <Button size="small" variant="ghost" onClick={() => requestDeleteTodo(item.id)}>
                                Delete
                              </Button>
                            }
                          >
                            <div class="todo-panel-delete-confirm">
                              <Button size="small" variant="ghost" onClick={() => confirmDeleteTodo(item.id)}>
                                Confirm
                              </Button>
                              <Button size="small" variant="ghost" onClick={cancelDeleteTodo}>
                                Cancel
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </>
                    }
                  >
                    <div class="todo-panel-edit-row">
                      <input
                        type="text"
                        class="todo-panel-input"
                        value={editingText()}
                        onInput={(event) => setEditingText(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            saveEdit(item.id)
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            setEditingTodoID(null)
                            setEditingText("")
                          }
                        }}
                      />
                      <Button size="small" variant="ghost" onClick={() => saveEdit(item.id)}>
                        Save
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => {
                          setEditingTodoID(null)
                          setEditingText("")
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Show>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content>
                    <ContextMenu.Item onSelect={() => void copyTodo(item.content)}>
                      <ContextMenu.ItemLabel>{language.t("common.copy")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onSelect={() => session.updateTodo(item.id, { status: "pending" })}>
                      <ContextMenu.ItemLabel>{language.t("todo.status.pending")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => session.updateTodo(item.id, { status: "in_progress" })}>
                      <ContextMenu.ItemLabel>{language.t("todo.status.inProgress")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => session.updateTodo(item.id, { status: "completed" })}>
                      <ContextMenu.ItemLabel>{language.t("todo.status.completed")}</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => session.updateTodo(item.id, { status: "cancelled" })}>
                      <ContextMenu.ItemLabel>Cancelled</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onSelect={() => startEdit(item.id, item.content)}>
                      <ContextMenu.ItemLabel>Edit</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                    <ContextMenu.Item onSelect={() => requestDeleteTodo(item.id)}>
                      <ContextMenu.ItemLabel>Delete</ContextMenu.ItemLabel>
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu>
            )}
          </For>
        </ul>

        <Show when={completed() > 0}>
          <Tooltip
            value={
              showCompleted()
                ? language.t("todo.completed.hide")
                : language.t("todo.completed.show", { count: hiddenCompleted() || completed() })
            }
            placement="top"
          >
            <button class="todo-panel-toggle" onClick={() => setShowCompleted((prev) => !prev)}>
              {showCompleted()
                ? language.t("todo.completed.hide")
                : language.t("todo.completed.show", { count: hiddenCompleted() || completed() })}
            </button>
          </Tooltip>
        </Show>
      </div>
    </Show>
  )
}
