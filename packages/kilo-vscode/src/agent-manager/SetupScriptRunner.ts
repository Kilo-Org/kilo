/**
 * SetupScriptRunner - Executes worktree setup scripts
 *
 * Runs setup scripts in VS Code integrated terminal before agent starts.
 * Script output is visible to the user in the terminal.
 * Waits for the script to complete (terminal close) before resolving.
 */

import * as vscode from "vscode"
import * as path from "node:path"
import { SetupScriptService } from "./SetupScriptService"

export interface SetupScriptEnvironment {
  /** Absolute path to the worktree directory */
  worktreePath: string
  /** Absolute path to the main repository */
  repoPath: string
}

export class SetupScriptRunner {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly service: SetupScriptService,
  ) {}

  /**
   * Execute setup script in a worktree if script exists.
   * Waits for the script to finish (terminal closes) before resolving.
   *
   * @returns true if script was executed, false if skipped (no script configured)
   */
  async runIfConfigured(env: SetupScriptEnvironment): Promise<boolean> {
    if (!this.service.hasScript()) {
      this.log("No setup script configured, skipping")
      return false
    }

    const script = this.service.getScriptPath()
    this.log(`Running setup script: ${script}`)

    try {
      await this.executeInTerminal(script, env)
      this.log("Setup script completed")
      return true
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.log(`Setup script execution failed: ${msg}`)
      return true // Script was attempted
    }
  }

  /** Execute the setup script in a VS Code terminal and wait for it to finish. */
  private executeInTerminal(script: string, env: SetupScriptEnvironment): Promise<void> {
    return new Promise((resolve) => {
      const shell = process.platform === "win32" ? undefined : process.env.SHELL
      const name = shell ? path.basename(shell) : undefined
      const args = process.platform === "win32" ? undefined : name === "zsh" ? ["-l", "-i"] : ["-l"]

      const terminal = vscode.window.createTerminal({
        name: "Worktree Setup",
        cwd: env.worktreePath,
        shellPath: shell,
        shellArgs: args,
        env: {
          WORKTREE_PATH: env.worktreePath,
          REPO_PATH: env.repoPath,
        },
        iconPath: new vscode.ThemeIcon("gear"),
      })

      // Listen for this terminal closing to know the script finished
      const listener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== terminal) return
        listener.dispose()
        resolve()
      })

      const command = this.buildCommand(script, env)
      terminal.show(true) // true = preserve focus on editor
      terminal.sendText(command)
      this.log("Setup script started in terminal, waiting for completion...")
    })
  }

  /** Build the shell command. Appends exit so the terminal closes when the script finishes. */
  private buildCommand(script: string, env: SetupScriptEnvironment): string {
    if (process.platform === "win32") {
      return [`set "WORKTREE_PATH=${env.worktreePath}"`, `set "REPO_PATH=${env.repoPath}"`, `"${script}"`, "exit"].join(
        " && ",
      )
    }
    return [
      `export WORKTREE_PATH="${env.worktreePath}"`,
      `export REPO_PATH="${env.repoPath}"`,
      `sh "${script}"`,
      "exit",
    ].join(" && ")
  }

  private log(message: string): void {
    this.output.appendLine(`[SetupScriptRunner] ${message}`)
  }
}
