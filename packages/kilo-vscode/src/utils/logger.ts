import * as vscode from "vscode"
import { inspect } from "node:util"

type LogLevel = "debug" | "info" | "warn" | "error"

let outputChannel: vscode.OutputChannel | undefined

export function initializeLogger(channel: vscode.OutputChannel): void {
  outputChannel = channel
}

function formatArg(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  return inspect(value, { depth: 6, colors: false, compact: true, breakLength: 120 })
}

function consoleMethod(level: LogLevel): (...data: unknown[]) => void {
  switch (level) {
    case "error":
      return console.error
    case "warn":
      return console.warn
    default:
      return console.log
  }
}

function write(level: LogLevel, ...args: unknown[]): void {
  if (args.length === 0) {
    return
  }

  const timestamp = new Date().toISOString()
  const message = args.map((arg) => formatArg(arg)).join(" ")
  outputChannel?.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`)
  consoleMethod(level)(...args)
}

export const logger = {
  debug: (...args: unknown[]) => write("debug", ...args),
  info: (...args: unknown[]) => write("info", ...args),
  warn: (...args: unknown[]) => write("warn", ...args),
  error: (...args: unknown[]) => write("error", ...args),
}
