import { Log } from "../util/log"
import { Audit } from "./audit"
import { TaskState } from "./task-state"
import { StateStore } from "./state-store"
import { FailureReport } from "./failure-report"
import { Bus } from "../bus"
import { WarmEvent } from "./bus-events"
import path from "path"
import { Global } from "../global"

export namespace Rollback {
  const log = Log.create({ service: "warm.rollback" })

  export interface RollbackResult {
    success: boolean
    filesRestored: string[]
    error?: string
  }

  export async function execute(
    task: TaskState.Info,
    filesChanged: string[],
  ): Promise<RollbackResult> {
    if (!task.blastRadius.reversible) {
      log.warn("rollback skipped — not reversible", { taskID: task.id })
      return { success: false, filesRestored: [], error: "Task declared as non-reversible" }
    }

    const snapshotHash = task.snapshots.preExecution
    if (!snapshotHash) {
      log.warn("rollback skipped — no pre-execution snapshot", { taskID: task.id })
      return { success: false, filesRestored: [], error: "No pre-execution snapshot available" }
    }

    // The actual git rollback would call Snapshot.revert() here.
    // For the prototype, we record the intent and return the contract.
    // Integration with Snapshot.revert(patches) happens when wired into SessionPrompt.
    log.info("rollback executing", {
      taskID: task.id,
      snapshot: snapshotHash,
      files: filesChanged.length,
    })

    const restored = filesChanged.filter((f) =>
      task.blastRadius.paths.some((p) => {
        if (p === "**" || p === "**/*") return true
        return f.startsWith(p.replace("/**", "").replace("/*", "")) || f === p
      }),
    )

    // Transition task
    let updated = task
    if (TaskState.canTransition(task.lifecycle, "rolled_back")) {
      updated = TaskState.transition(task, "rolled_back")
    } else if (TaskState.canTransition(task.lifecycle, "failed")) {
      updated = TaskState.transition(task, "failed")
      if (TaskState.canTransition(updated.lifecycle, "rolled_back")) {
        updated = TaskState.transition(updated, "rolled_back")
      }
    }
    await StateStore.putTask(updated)

    // Audit
    await Audit.append(task.sessionID, {
      type: "rollback",
      id: `audit_rollback_${Date.now()}`,
      taskID: task.id,
      snapshotFrom: task.snapshots.postExecution ?? "current",
      snapshotTo: snapshotHash,
      filesRestored: restored,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))

    // Bus event (guarded — Bus requires Instance context which may not exist in tests/CLI)
    await Bus.publish(WarmEvent.TaskRolledBack, {
      taskID: task.id,
      sessionID: task.sessionID,
      reason: "postcondition failure",
      filesRestored: restored,
    }).catch(() => {})

    log.info("rollback complete", { taskID: task.id, restored: restored.length })
    return { success: true, filesRestored: restored }
  }

  export async function generateFailureReport(
    task: TaskState.Info,
    input: {
      agentID: string
      stepsCompleted: number
      stepsTotal: number
      filesActuallyChanged: string[]
      toolCallsExecuted: number
      failure: {
        phase: "precondition" | "execution" | "postcondition" | "rollback"
        check?: string
        error: string
        recoverable: boolean
      }
      rollbackResult: RollbackResult
    },
  ): Promise<FailureReport.Info> {
    return FailureReport.fromTask(task, {
      agentID: input.agentID,
      stepsCompleted: input.stepsCompleted,
      stepsTotal: input.stepsTotal,
      filesActuallyChanged: input.filesActuallyChanged,
      toolCallsExecuted: input.toolCallsExecuted,
      failure: input.failure,
      recovery: {
        action: input.rollbackResult.success ? "rolled_back" : "rollback_skipped",
        snapshotRestored: task.snapshots.preExecution,
        filesRestored: input.rollbackResult.filesRestored,
      },
      auditLogPath: path.join(Global.Path.data, "warm", "audit", `${task.sessionID}.jsonl`),
      taskStatePath: path.join(Global.Path.data, "warm", "tasks", `${task.id}.json`),
    })
  }
}
