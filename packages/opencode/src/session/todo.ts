import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Storage } from "../storage/storage"

export namespace Todo {
  export const Status = z.enum(["pending", "in_progress", "completed", "cancelled"]).meta({ ref: "TodoStatus" })
  export type Status = z.infer<typeof Status>

  export const Priority = z.enum(["high", "medium", "low"]).meta({ ref: "TodoPriority" })
  export type Priority = z.infer<typeof Priority>

  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: Status.describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: Priority.describe("Priority level of the task: high, medium, low"),
      id: z.string().describe("Unique identifier for the todo item"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      content: z.string().trim().min(1),
      status: Status.optional().default("pending"),
      priority: Priority.optional().default("medium"),
    })
    .meta({ ref: "TodoCreateInput" })
  export type CreateInput = z.infer<typeof CreateInput>

  export const UpdateInput = z
    .object({
      content: z.string().trim().min(1).optional(),
      status: Status.optional(),
      priority: Priority.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field must be provided",
    })
    .meta({ ref: "TodoUpdateInput" })
  export type UpdateInput = z.infer<typeof UpdateInput>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  function randomTodoId(): string {
    const randomUUID = globalThis.crypto?.randomUUID
    return typeof randomUUID === "function"
      ? randomUUID.call(globalThis.crypto)
      : `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  export async function update(input: { sessionID: string; todos: Info[] }) {
    await Storage.write(["todo", input.sessionID], input.todos)
    Bus.publish(Event.Updated, input)
  }

  export async function create(input: { sessionID: string; todo: CreateInput }) {
    const todos = await get(input.sessionID)
    const created: Info = {
      id: randomTodoId(),
      content: input.todo.content,
      status: input.todo.status,
      priority: input.todo.priority,
    }
    const next = [...todos, created]
    await update({ sessionID: input.sessionID, todos: next })
    return created
  }

  export async function patch(input: { sessionID: string; todoID: string; changes: UpdateInput }): Promise<Info | null> {
    const todos = await get(input.sessionID)
    const index = todos.findIndex((todo) => todo.id === input.todoID)
    if (index === -1) {
      return null
    }
    const next = todos.slice()
    next[index] = {
      ...next[index],
      ...input.changes,
    }
    await update({ sessionID: input.sessionID, todos: next })
    return next[index]
  }

  export async function remove(input: { sessionID: string; todoID: string }) {
    const todos = await get(input.sessionID)
    const next = todos.filter((todo) => todo.id !== input.todoID)
    if (next.length === todos.length) {
      return false
    }
    await update({ sessionID: input.sessionID, todos: next })
    return true
  }

  export async function get(sessionID: string) {
    return Storage.read<Info[]>(["todo", sessionID])
      .then((x) => x || [])
      .catch(() => [])
  }
}
