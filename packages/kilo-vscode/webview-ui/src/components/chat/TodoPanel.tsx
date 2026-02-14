import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

function statusLabel(status: "pending" | "in_progress" | "completed", t: (key: string) => string): string {
  switch (status) {
    case "in_progress":
      return t("todo.status.inProgress")
    case "completed":
      return t("todo.status.completed")
    default:
      return t("todo.status.pending")
  }
}

export const TodoPanel: Component = () => {
  const session = useSession()
  const language = useLanguage()
  const [showCompleted, setShowCompleted] = createSignal(false)

  const todos = createMemo(() => session.todos())
  const total = createMemo(() => todos().length)
  const completed = createMemo(() => todos().filter((item) => item.status === "completed").length)
  const progress = createMemo(() => {
    if (total() === 0) return 0
    return Math.round((completed() / total()) * 100)
  })
  const visibleTodos = createMemo(() => (showCompleted() ? todos() : todos().filter((item) => item.status !== "completed")))
  const hiddenCompleted = createMemo(() => Math.max(0, completed() - visibleTodos().filter((x) => x.status === "completed").length))

  return (
    <Show when={total() > 0}>
      <div class="todo-panel">
        <div class="todo-panel-header">
          <span class="todo-panel-title">{language.t("todo.title")}</span>
          <span class="todo-panel-progress-text">
            {language.t("todo.progress", { completed: completed(), total: total(), percent: progress() })}
          </span>
        </div>

        <div class="todo-panel-progress-bar" role="progressbar" aria-valuenow={progress()} aria-valuemin={0} aria-valuemax={100}>
          <div class="todo-panel-progress-fill" style={{ width: `${progress()}%` }} />
        </div>

        <ul class="todo-panel-list">
          <For each={visibleTodos()}>
            {(item) => (
              <li class="todo-panel-item">
                <span class="todo-panel-status" data-status={item.status}>
                  {statusLabel(item.status, language.t)}
                </span>
                <span class="todo-panel-content" data-status={item.status}>
                  {item.content}
                </span>
              </li>
            )}
          </For>
        </ul>

        <Show when={completed() > 0}>
          <button class="todo-panel-toggle" onClick={() => setShowCompleted((prev) => !prev)}>
            {showCompleted()
              ? language.t("todo.completed.hide")
              : language.t("todo.completed.show", { count: hiddenCompleted() || completed() })}
          </button>
        </Show>
      </div>
    </Show>
  )
}
