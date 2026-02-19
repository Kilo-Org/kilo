import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import { AgentState } from "./agent-state"
import { TaskState } from "./task-state"
import { Lock } from "../util/lock"

export namespace StateStore {
  const log = Log.create({ service: "warm.state-store" })

  function warmDir(): string {
    return path.join(Global.Path.data, "warm")
  }

  function agentPath(agentID: string): string {
    return path.join(warmDir(), "agents", `${agentID}.json`)
  }

  function taskPath(taskID: string): string {
    return path.join(warmDir(), "tasks", `${taskID}.json`)
  }

  function snapshotPath(agentID: string): string {
    return path.join(warmDir(), "snapshots", `${agentID}.json`)
  }

  // --- Agent State ---

  export async function getAgent(agentID: string): Promise<AgentState.Info | undefined> {
    const filePath = agentPath(agentID)
    try {
      using _ = await Lock.read(filePath)
      const data = await Bun.file(filePath).json()
      return AgentState.Info.parse(data)
    } catch {
      return undefined
    }
  }

  export async function putAgent(agent: AgentState.Info): Promise<void> {
    const filePath = agentPath(agent.id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    using _ = await Lock.write(filePath)
    await Bun.write(filePath, JSON.stringify(agent, null, 2))
    log.info("putAgent", { agentID: agent.id, lifecycle: agent.lifecycle })
  }

  export async function listAgents(sessionID?: string): Promise<AgentState.Info[]> {
    const dir = path.join(warmDir(), "agents")
    try {
      const files = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: dir, absolute: true }),
      )
      const results: AgentState.Info[] = []
      for (const file of files) {
        try {
          const data = await Bun.file(file).json()
          const agent = AgentState.Info.parse(data)
          if (!sessionID || agent.sessionID === sessionID) {
            results.push(agent)
          }
        } catch {
          log.warn("skipping corrupt agent state", { file })
        }
      }
      return results
    } catch {
      return []
    }
  }

  export async function removeAgent(agentID: string): Promise<void> {
    const filePath = agentPath(agentID)
    await fs.unlink(filePath).catch(() => {})
    log.info("removeAgent", { agentID })
  }

  // --- Task State ---

  export async function getTask(taskID: string): Promise<TaskState.Info | undefined> {
    const filePath = taskPath(taskID)
    try {
      using _ = await Lock.read(filePath)
      const data = await Bun.file(filePath).json()
      return TaskState.Info.parse(data)
    } catch {
      return undefined
    }
  }

  export async function putTask(task: TaskState.Info): Promise<void> {
    const filePath = taskPath(task.id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    using _ = await Lock.write(filePath)
    await Bun.write(filePath, JSON.stringify(task, null, 2))
    log.info("putTask", { taskID: task.id, lifecycle: task.lifecycle })
  }

  export async function listTasks(sessionID?: string): Promise<TaskState.Info[]> {
    const dir = path.join(warmDir(), "tasks")
    try {
      const files = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: dir, absolute: true }),
      )
      const results: TaskState.Info[] = []
      for (const file of files) {
        try {
          const data = await Bun.file(file).json()
          const task = TaskState.Info.parse(data)
          if (!sessionID || task.sessionID === sessionID) {
            results.push(task)
          }
        } catch {
          log.warn("skipping corrupt task state", { file })
        }
      }
      return results
    } catch {
      return []
    }
  }

  export async function scanIncomplete(): Promise<TaskState.Info[]> {
    const tasks = await listTasks()
    return tasks.filter((t) => t.lifecycle === "claimed" || t.lifecycle === "executing")
  }

  export async function removeTask(taskID: string): Promise<void> {
    const filePath = taskPath(taskID)
    await fs.unlink(filePath).catch(() => {})
    log.info("removeTask", { taskID })
  }

  // --- Warmness Snapshots ---

  export async function saveSnapshot(agentID: string, context: AgentState.Context): Promise<void> {
    const filePath = snapshotPath(agentID)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await Bun.write(filePath, JSON.stringify(context, null, 2))
    log.info("saveSnapshot", { agentID })
  }

  export async function loadSnapshot(agentID: string): Promise<AgentState.Context | undefined> {
    const filePath = snapshotPath(agentID)
    try {
      const data = await Bun.file(filePath).json()
      return AgentState.Context.parse(data)
    } catch {
      return undefined
    }
  }

  export async function removeSnapshot(agentID: string): Promise<void> {
    const filePath = snapshotPath(agentID)
    await fs.unlink(filePath).catch(() => {})
  }
}
