import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { HelpCommand } from "../../src/cli/cmd/help"

describe("help command", () => {
  const chunks: string[] = []
  const originalWrite = process.stdout.write

  beforeEach(() => {
    chunks.length = 0
    process.stdout.write = ((chunk: any) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
      return true
    }) as any
  })

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  function output() {
    return chunks.join("")
  }

  it("shows usage when called without args", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: undefined, all: false, format: "markdown" })
    expect(output()).toContain("kilo help --all")
    expect(output()).toContain("kilo help <command>")
  })

  it("outputs markdown reference with --all", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: undefined, all: true, format: "markdown" })
    const md = output()
    expect(md).toContain("# Kilo CLI Reference")
    expect(md).toContain("## Global Options")
    expect(md).toContain("## Commands")
    expect(md).toContain("`kilo run [message..]`")
    expect(md).toContain("`kilo auth`")
    expect(md).toContain("`kilo mcp`")
    expect(md).toContain("[internal]")
    expect(md).toContain("`kilo debug`")
  })

  it("outputs text reference with --all --format text", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: undefined, all: true, format: "text" })
    const text = output()
    expect(text).toContain("Kilo CLI Reference")
    expect(text).toContain("GLOBAL OPTIONS")
    expect(text).toContain("COMMANDS")
    expect(text).toContain("kilo run [message..]")
    expect(text).toContain("[internal]")
  })

  it("shows help for a specific command", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: "auth", all: false, format: "markdown" })
    const md = output()
    expect(md).toContain("`kilo auth`")
    expect(md).toContain("manage credentials")
    expect(md).toContain("`kilo auth login [url]`")
    expect(md).toContain("`kilo auth logout`")
    expect(md).toContain("`kilo auth list`")
  })

  it("shows error for unknown command", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: "nonexistent", all: false, format: "markdown" })
    expect(output()).toContain("Unknown command: nonexistent")
  })

  it("shows help for command with options", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: "run", all: false, format: "markdown" })
    const md = output()
    expect(md).toContain("`kilo run [message..]`")
    expect(md).toContain("--model")
    expect(md).toContain("--format")
    expect(md).toContain("--auto")
  })

  it("shows internal marker for debug command", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: "debug", all: false, format: "markdown" })
    const md = output()
    expect(md).toContain("[internal]")
    expect(md).toContain("`kilo debug`")
  })

  it("text format for specific command works", async () => {
    const handler = HelpCommand.handler as Function
    await handler({ command: "stats", all: false, format: "text" })
    const text = output()
    expect(text).toContain("kilo stats")
    expect(text).toContain("--days")
  })
})
