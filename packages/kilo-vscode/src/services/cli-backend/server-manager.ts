import { spawn, ChildProcess } from "child_process"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import type * as vscode from "vscode"
import { CLI_SERVER_AUTH_USERNAME } from "./auth"
import { logger } from "../../utils/logger"

export interface ServerInstance {
  port: number
  password: string
  username: string
  process: ChildProcess
}

export class ServerManager {
  private instance: ServerInstance | null = null
  private startupPromise: Promise<ServerInstance> | null = null

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get or start the server instance
   */
  async getServer(): Promise<ServerInstance> {
    logger.debug("[Kilo New] ServerManager: getServer called")
    if (this.instance) {
      logger.debug("[Kilo New] ServerManager: returning existing instance", { port: this.instance.port })
      return this.instance
    }

    if (this.startupPromise) {
      logger.debug("[Kilo New] ServerManager: startup in progress")
      return this.startupPromise
    }

    logger.debug("[Kilo New] ServerManager: starting new server instance")
    this.startupPromise = this.startServer()
    try {
      this.instance = await this.startupPromise
      logger.debug("[Kilo New] ServerManager: server started", { port: this.instance.port })
      return this.instance
    } finally {
      this.startupPromise = null
    }
  }

  private async startServer(): Promise<ServerInstance> {
    const password = crypto.randomBytes(32).toString("hex")
    const cliPath = this.getCliPath()
    logger.debug("[Kilo New] ServerManager: resolved CLI path", cliPath)
    logger.debug("[Kilo New] ServerManager: generated auth password length", password.length)

    // Verify the CLI binary exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `CLI binary not found at expected path: ${cliPath}. Please ensure the CLI is built and bundled with the extension.`,
      )
    }

    const stat = fs.statSync(cliPath)
    logger.debug("[Kilo New] ServerManager: CLI metadata", {
      isFile: stat.isFile(),
      mode: (stat.mode & 0o777).toString(8),
    })

    return new Promise((resolve, reject) => {
      logger.debug("[Kilo New] ServerManager: spawning CLI process", { cliPath, args: ["serve", "--port", "0"] })
      const serverProcess = spawn(cliPath, ["serve", "--port", "0"], {
        env: {
          ...process.env,
          KILO_SERVER_PASSWORD: password,
          KILO_SERVER_USERNAME: CLI_SERVER_AUTH_USERNAME,
          KILO_CLIENT: "vscode",
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      logger.debug("[Kilo New] ServerManager: process spawned", { pid: serverProcess.pid })

      let resolved = false

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString()
        logger.debug("[Kilo New] ServerManager: CLI stdout", output)

        // Parse: "kilo server listening on http://127.0.0.1:12345"
        const match = output.match(/listening on http:\/\/[\w.]+:(\d+)/)
        if (match && !resolved) {
          resolved = true
          const port = parseInt(match[1], 10)
          logger.debug("[Kilo New] ServerManager: detected server port", port)
          resolve({ port, password, username: CLI_SERVER_AUTH_USERNAME, process: serverProcess })
        }
      })

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString()
        logger.warn("[Kilo New] ServerManager: CLI stderr", errorOutput)
      })

      serverProcess.on("error", (error) => {
        logger.error("[Kilo New] ServerManager: process error", error)
        if (!resolved) {
          reject(error)
        }
      })

      serverProcess.on("exit", (code) => {
        logger.debug("[Kilo New] ServerManager: process exited", { code })
        if (this.instance?.process === serverProcess) {
          this.instance = null
        }
        if (!resolved) {
          reject(new Error(`CLI process exited with code ${code} before server started`))
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          logger.error("[Kilo New] ServerManager: startup timeout (30s)")
          serverProcess.kill()
          reject(new Error("Server startup timeout"))
        }
      }, 30000)
    })
  }

  private getCliPath(): string {
    // Always use the bundled binary from the extension directory
    const cliPath = path.join(this.context.extensionPath, "bin", "kilo")
    logger.debug("[Kilo New] ServerManager: using CLI path", cliPath)
    return cliPath
  }

  dispose(): void {
    if (this.instance) {
      this.instance.process.kill("SIGTERM")
      this.instance = null
    }
  }
}
