import { Log } from "../util/log"
import { Audit } from "./audit"

export namespace Replay {
  const log = Log.create({ service: "warm.replay" })

  export interface ReplayStep {
    index: number
    entry: Audit.Entry
    type: Audit.Entry["type"]
  }

  export interface ReplayTrace {
    sessionID: string
    steps: ReplayStep[]
    dispatches: number
    transitions: number
    invariantChecks: number
    invariantFailures: number
    rollbacks: number
    mcpEvents: number
  }

  export async function buildTrace(sessionID: string): Promise<ReplayTrace> {
    const entries = await Audit.read(sessionID)
    const steps: ReplayStep[] = entries.map((entry, index) => ({
      index,
      entry,
      type: entry.type,
    }))

    return {
      sessionID,
      steps,
      dispatches: entries.filter((e) => e.type === "dispatch_decision").length,
      transitions: entries.filter((e) => e.type === "state_transition").length,
      invariantChecks: entries.filter((e) => e.type === "invariant_check").length,
      invariantFailures: entries.filter(
        (e) => e.type === "invariant_check" && !e.passed,
      ).length,
      rollbacks: entries.filter((e) => e.type === "rollback").length,
      mcpEvents: entries.filter((e) => e.type === "mcp_health").length,
    }
  }

  export interface StructuralCheck {
    passed: boolean
    errors: string[]
  }

  export function verifyDispatchDeterminism(trace: ReplayTrace): StructuralCheck {
    const errors: string[] = []
    const dispatches = trace.steps.filter((s) => s.type === "dispatch_decision")

    // Every dispatch should have a selected agent
    for (const step of dispatches) {
      const entry = step.entry as Extract<Audit.Entry, { type: "dispatch_decision" }>
      if (!entry.selected.agentID && entry.selected.reason !== "denied") {
        errors.push(`Step ${step.index}: dispatch decision has no agentID and is not denied`)
      }
    }

    return { passed: errors.length === 0, errors }
  }

  export function verifyLifecycleIntegrity(trace: ReplayTrace): StructuralCheck {
    const errors: string[] = []
    const transitions = trace.steps.filter((s) => s.type === "state_transition")

    // Track state per entity
    const entityState = new Map<string, string>()

    for (const step of transitions) {
      const entry = step.entry as Extract<Audit.Entry, { type: "state_transition" }>
      const key = `${entry.entityType}:${entry.entityID}`
      const currentState = entityState.get(key)

      if (currentState && currentState !== entry.from) {
        errors.push(
          `Step ${step.index}: ${key} expected from="${currentState}" but got from="${entry.from}"`,
        )
      }

      entityState.set(key, entry.to)
    }

    return { passed: errors.length === 0, errors }
  }

  export function verifyInvariantCoverage(trace: ReplayTrace): StructuralCheck {
    const errors: string[] = []

    // Every dispatch should eventually have at least one state_transition
    const dispatchTasks = new Set<string>()
    const transitionTasks = new Set<string>()

    for (const step of trace.steps) {
      if (step.type === "dispatch_decision") {
        const entry = step.entry as Extract<Audit.Entry, { type: "dispatch_decision" }>
        dispatchTasks.add(entry.taskID)
      }
      if (step.type === "state_transition") {
        const entry = step.entry as Extract<Audit.Entry, { type: "state_transition" }>
        if (entry.entityType === "task") {
          transitionTasks.add(entry.entityID)
        }
      }
    }

    for (const taskID of dispatchTasks) {
      if (!transitionTasks.has(taskID)) {
        errors.push(`Task ${taskID} was dispatched but has no state transitions`)
      }
    }

    return { passed: errors.length === 0, errors }
  }

  export function summary(trace: ReplayTrace): string {
    return [
      `Session: ${trace.sessionID}`,
      `Steps: ${trace.steps.length}`,
      `Dispatches: ${trace.dispatches}`,
      `Transitions: ${trace.transitions}`,
      `Invariant Checks: ${trace.invariantChecks} (${trace.invariantFailures} failed)`,
      `Rollbacks: ${trace.rollbacks}`,
      `MCP Events: ${trace.mcpEvents}`,
    ].join("\n")
  }
}
