import { Log } from "../util/log"
import { Bus } from "../bus"
import { AgentState } from "./agent-state"
import { TaskState } from "./task-state"
import { WarmScorer } from "./scorer"
import { Scheduler } from "./scheduler"
import { StateStore } from "./state-store"
import { Audit } from "./audit"
import { Invariant } from "./invariant"
import { CapabilityRegistry } from "./capability-registry"
import { DispatchPolicy } from "./policy"
import { WarmEvent } from "./bus-events"

export namespace WarmSession {
  const log = Log.create({ service: "warm.session" })

  export interface WarmContext {
    enabled: boolean
    policy: DispatchPolicy.Config
    sessionID: string
    activeAgent?: AgentState.Info
    activeTask?: TaskState.Info
  }

  export function createContext(sessionID: string, policy?: Partial<DispatchPolicy.Config>): WarmContext {
    return {
      enabled: true,
      policy: DispatchPolicy.Config.parse({
        ...DispatchPolicy.defaultConfig(),
        ...policy,
      }),
      sessionID,
    }
  }

  export async function submitTask(
    ctx: WarmContext,
    input: {
      id: string
      description: string
      agentName?: string
      capabilities?: string[]
      blastRadius?: Partial<TaskState.BlastRadius>
      preconditions?: TaskState.Condition[]
      postconditions?: TaskState.Condition[]
    },
  ): Promise<{ task: TaskState.Info; dispatch: Scheduler.DispatchResult }> {
    // Create task
    const task = TaskState.create({
      id: input.id,
      sessionID: ctx.sessionID,
      intent: {
        description: input.description,
        agentName: input.agentName,
        capabilities: input.capabilities,
      },
      blastRadius: input.blastRadius,
      preconditions: input.preconditions,
      postconditions: input.postconditions,
    })

    // Persist
    await StateStore.putTask(task)
    await emitTransition("task", task.id, ctx.sessionID, "none", "pending", "created")

    // Check preconditions
    const precheck = Invariant.checkPreconditions(task)
    if (!precheck.passed) {
      const failed = TaskState.transition(task, "claimed")
      const rolledBack = TaskState.transition(failed, "rolled_back")
      await StateStore.putTask(rolledBack)
      return {
        task: rolledBack,
        dispatch: { action: "denied", reason: `Precondition failures: ${precheck.failures.join("; ")}` },
      }
    }

    // Dispatch
    const agents = await StateStore.listAgents(ctx.sessionID)
    const result = await Scheduler.dispatch(task, ctx.policy, agents)

    if (result.action === "dispatched" && result.agentID) {
      const claimed = TaskState.transition(task, "claimed")
      const withAgent = { ...claimed, assignment: { ...claimed.assignment, agentID: result.agentID } }
      await StateStore.putTask(withAgent)
      ctx.activeTask = withAgent

      // Update agent state if it exists
      const agent = await StateStore.getAgent(result.agentID)
      if (agent && agent.lifecycle === "warm") {
        const executing = AgentState.transition(agent, "executing")
        await StateStore.putAgent(executing)
        CapabilityRegistry.register(executing)
        ctx.activeAgent = executing
        await emitTransition("agent", agent.id, ctx.sessionID, "warm", "executing", "dispatched")
      }
    }

    return { task, dispatch: result }
  }

  export async function completeTask(
    ctx: WarmContext,
    filesChanged?: string[],
  ): Promise<{ passed: boolean; failures: string[] }> {
    if (!ctx.activeTask) return { passed: true, failures: [] }

    let task = ctx.activeTask

    // Transition to postchecked
    if (task.lifecycle === "executing" || task.lifecycle === "claimed") {
      task = TaskState.transition(
        task.lifecycle === "claimed" ? TaskState.transition(task, "executing") : task,
        "postchecked",
      )
    }

    // Run postcondition: files within blast radius
    if (filesChanged) {
      const check = Invariant.validateFilesWithinBlastRadius(filesChanged, task.blastRadius)
      if (!check.passed) {
        const failed = TaskState.transition(task, "failed")
        await StateStore.putTask(failed)
        await emitTransition("task", task.id, ctx.sessionID, "postchecked", "failed", "postcondition_violation")
        ctx.activeTask = failed
        return { passed: false, failures: check.violations.map((v) => `File outside blast radius: ${v}`) }
      }
    }

    // Check explicit postconditions
    const postcheck = Invariant.checkPostconditions(task)
    if (!postcheck.passed) {
      const failed = TaskState.transition(task, "failed")
      await StateStore.putTask(failed)
      ctx.activeTask = failed
      return postcheck
    }

    // Complete
    const completed = TaskState.transition(task, "completed")
    await StateStore.putTask(completed)
    await emitTransition("task", task.id, ctx.sessionID, "postchecked", "completed", "success")

    // Return agent to warm
    if (ctx.activeAgent && ctx.activeAgent.lifecycle === "executing") {
      const warm = AgentState.transition(ctx.activeAgent, "warm")
      const scored = WarmScorer.scoreAgent(warm, completed)
      const updated = { ...warm, warmness: scored.score }
      await StateStore.putAgent(updated)
      ctx.activeAgent = updated
      await emitTransition("agent", warm.id, ctx.sessionID, "executing", "warm", "task_complete")
    }

    ctx.activeTask = completed
    return { passed: true, failures: [] }
  }

  export function toolPreCheck(
    ctx: WarmContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Invariant.CheckResult {
    if (!ctx.activeTask) return { allowed: true }
    const result = Invariant.toolPreCheck(toolName, args, ctx.activeTask)
    if (!result.allowed) {
      Bus.publish(WarmEvent.InvariantViolation, {
        taskID: ctx.activeTask.id,
        toolName,
        reason: result.reason!,
      })
    }
    return result
  }

  export async function registerAgent(
    ctx: WarmContext,
    input: {
      id: string
      agentName: string
      capabilities?: string[]
      mcpServers?: string[]
    },
  ): Promise<AgentState.Info> {
    const agent = AgentState.create({
      id: input.id,
      agentName: input.agentName,
      sessionID: ctx.sessionID,
      capabilities: input.capabilities,
      mcpServers: input.mcpServers,
    })

    // Cold → Warming → Warm
    const warming = AgentState.transition(agent, "warming")
    const warm = AgentState.transition(warming, "warm")
    await StateStore.putAgent(warm)
    CapabilityRegistry.register(warm)
    ctx.activeAgent = warm

    await emitTransition("agent", warm.id, ctx.sessionID, "cold", "warm", "registered")
    return warm
  }

  /**
   * Create a default task from a CLI message with reasonable blast-radius defaults.
   * Used when --warm is passed to `run` command.
   */
  export async function createDefaultTask(
    ctx: WarmContext,
    input: {
      message: string
      workingDirectory: string
    },
  ): Promise<TaskState.Info> {
    const taskID = `warm_task_${Date.now()}`

    const task = TaskState.create({
      id: taskID,
      sessionID: ctx.sessionID,
      intent: {
        description: input.message.slice(0, 200),
        agentName: ctx.activeAgent?.agentName,
      },
      blastRadius: {
        paths: [`${input.workingDirectory}/**`],
        operations: ["read", "write"],
        reversible: true,
      },
    })

    await StateStore.putTask(task)
    await emitTransition("task", task.id, ctx.sessionID, "none", "pending", "created")

    // Claim and execute
    const claimed = TaskState.transition(task, "claimed")
    const executing = TaskState.transition(claimed, "executing")
    await StateStore.putTask(executing)
    await emitTransition("task", task.id, ctx.sessionID, "pending", "executing", "auto_dispatch")

    ctx.activeTask = executing
    return executing
  }

  /**
   * Create a sub-task with a narrower blast-radius, scoped within the parent task.
   * Used when an orchestrator spawns a sub-agent via the Task tool.
   *
   * If no explicit scope is provided, attempts to infer scope from the message.
   * The child scope is validated to be within the parent's blast-radius.
   */
  export async function createSubTask(
    ctx: WarmContext,
    input: {
      message: string
      parentTask: TaskState.Info
      blastRadius?: Partial<TaskState.BlastRadius>
    },
  ): Promise<{ task: TaskState.Info; narrowed: boolean }> {
    const taskID = `warm_subtask_${Date.now()}`

    // Infer scope from message if no explicit blast-radius given
    const inferredPaths = input.blastRadius?.paths
      ?? Invariant.inferScopeFromMessage(input.message, input.parentTask.blastRadius.paths)

    const childScope: Partial<TaskState.BlastRadius> = {
      paths: inferredPaths,
      operations: input.blastRadius?.operations ?? input.parentTask.blastRadius.operations,
      mcpTools: input.blastRadius?.mcpTools ?? input.parentTask.blastRadius.mcpTools,
      reversible: input.blastRadius?.reversible ?? input.parentTask.blastRadius.reversible,
    }

    // Validate child scope is within parent
    const validation = Invariant.validateChildScope(input.parentTask.blastRadius, childScope)
    if (!validation.allowed) {
      log.warn("sub-task scope exceeds parent", {
        reason: validation.reason,
        parentPaths: input.parentTask.blastRadius.paths,
        childPaths: childScope.paths,
      })
      // Fall back to parent scope
      childScope.paths = input.parentTask.blastRadius.paths
      childScope.operations = input.parentTask.blastRadius.operations
    }

    const narrowed = validation.allowed
      && JSON.stringify(childScope.paths) !== JSON.stringify(input.parentTask.blastRadius.paths)

    const task = TaskState.create({
      id: taskID,
      sessionID: ctx.sessionID,
      parentTaskID: input.parentTask.id,
      intent: {
        description: input.message.slice(0, 200),
        agentName: ctx.activeAgent?.agentName,
      },
      blastRadius: childScope,
    })

    await StateStore.putTask(task)
    await emitTransition("task", task.id, ctx.sessionID, "none", "pending", "sub_task_created")

    // Audit the scope narrowing
    await Audit.append(ctx.sessionID, {
      type: "invariant_check",
      id: `audit_scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskID: task.id,
      phase: "precondition",
      check: "scope_narrowing",
      passed: true,
      error: narrowed
        ? `Narrowed: ${input.parentTask.blastRadius.paths.join(",")} → ${childScope.paths!.join(",")}`
        : `Inherited parent scope: ${childScope.paths!.join(",")}`,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))

    // Claim and execute
    const claimed = TaskState.transition(task, "claimed")
    const executing = TaskState.transition(claimed, "executing")
    await StateStore.putTask(executing)
    await emitTransition("task", task.id, ctx.sessionID, "pending", "executing", "sub_task_dispatch")

    log.info("sub-task created", {
      taskID: task.id,
      parentTaskID: input.parentTask.id,
      narrowed,
      scope: childScope.paths,
    })

    return { task: executing, narrowed }
  }

  async function emitTransition(
    entityType: "agent" | "task",
    entityID: string,
    sessionID: string,
    from: string,
    to: string,
    trigger: string,
  ): Promise<void> {
    await Audit.append(sessionID, {
      type: "state_transition",
      id: `audit_transition_${Date.now()}`,
      entityType,
      entityID,
      from,
      to,
      trigger,
      timestamp: Date.now(),
    }).catch((e) => log.warn("audit write failed", { error: e }))
  }
}
