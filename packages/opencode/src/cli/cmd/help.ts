// kilocode_change - new file

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Installation } from "../../installation"
import { EOL } from "os"

type Option = {
  name: string
  alias?: string
  type: string
  describe: string
}

type Subcommand = {
  usage: string
  describe: string
  options?: Option[]
  subcommands?: Subcommand[]
}

type Command = {
  usage: string
  describe: string
  internal?: boolean
  options?: Option[]
  subcommands?: Subcommand[]
}

const NETWORK_OPTIONS: Option[] = [
  { name: "--port", type: "number", describe: "port for the server" },
  { name: "--hostname", type: "string", describe: "hostname for the server" },
  { name: "--mdns", type: "boolean", describe: "enable mDNS broadcasting" },
  { name: "--mdns-domain", type: "string", describe: "mDNS domain name" },
  { name: "--cors", type: "string", describe: "CORS origin" },
]

const GLOBAL_OPTIONS: Option[] = [
  { name: "--help", alias: "-h", type: "boolean", describe: "show help" },
  { name: "--version", alias: "-v", type: "boolean", describe: "show version number" },
  { name: "--print-logs", type: "boolean", describe: "print logs to stderr" },
  { name: "--log-level", type: "string", describe: "log level (DEBUG, INFO, WARN, ERROR)" },
]

function registry(): Command[] {
  return [
    {
      usage: "kilo",
      describe: "start kilo tui",
      options: [
        { name: "--model", alias: "-m", type: "string", describe: "model to use in the format of provider/model" },
        { name: "--continue", alias: "-c", type: "boolean", describe: "continue the last session" },
        { name: "--session", alias: "-s", type: "string", describe: "session id to continue" },
        { name: "--fork", type: "boolean", describe: "fork the session before continuing" },
        { name: "--prompt", type: "string", describe: "initial prompt to send" },
        { name: "--agent", type: "string", describe: "agent to use" },
        ...NETWORK_OPTIONS,
      ],
    },
    {
      usage: "kilo run [message..]",
      describe: "run kilo with a message",
      options: [
        { name: "--command", type: "string", describe: "the command to run, use message for args" },
        { name: "--continue", alias: "-c", type: "boolean", describe: "continue the last session" },
        { name: "--session", alias: "-s", type: "string", describe: "session id to continue" },
        { name: "--fork", type: "boolean", describe: "fork the session before continuing" },
        { name: "--share", type: "boolean", describe: "share the session" },
        { name: "--model", alias: "-m", type: "string", describe: "model to use in the format of provider/model" },
        { name: "--agent", type: "string", describe: "agent to use" },
        { name: "--format", type: "string", describe: "format: default (formatted) or json (raw JSON events)" },
        { name: "--file", alias: "-f", type: "string[]", describe: "file(s) to attach to message" },
        { name: "--title", type: "string", describe: "title for the session" },
        { name: "--attach", type: "string", describe: "attach to a running server" },
        { name: "--port", type: "number", describe: "port for the local server" },
        { name: "--variant", type: "string", describe: "model variant (e.g., high, max, minimal)" },
        { name: "--thinking", type: "boolean", describe: "show thinking blocks" },
        { name: "--auto", type: "boolean", describe: "auto-approve all permissions" },
      ],
    },
    {
      usage: "kilo auth",
      describe: "manage credentials",
      subcommands: [
        { usage: "kilo auth login [url]", describe: "log in to a provider" },
        { usage: "kilo auth logout", describe: "log out from a configured provider" },
        { usage: "kilo auth list", describe: "list providers" },
      ],
    },
    {
      usage: "kilo agent",
      describe: "manage agents",
      subcommands: [
        { usage: "kilo agent create", describe: "create a new agent" },
        { usage: "kilo agent list", describe: "list available agents" },
      ],
    },
    {
      usage: "kilo mcp",
      describe: "manage MCP (Model Context Protocol) servers",
      subcommands: [
        { usage: "kilo mcp add", describe: "add an MCP server" },
        { usage: "kilo mcp list", describe: "list configured MCP servers" },
        {
          usage: "kilo mcp auth [name]",
          describe: "manage MCP server authentication",
          subcommands: [{ usage: "kilo mcp auth list", describe: "list MCP auth tokens" }],
        },
        { usage: "kilo mcp logout [name]", describe: "remove MCP server authentication" },
        { usage: "kilo mcp debug <name>", describe: "debug an MCP server" },
      ],
    },
    {
      usage: "kilo models [provider]",
      describe: "list all available models",
      options: [
        { name: "--verbose", type: "boolean", describe: "show detailed model information" },
        { name: "--refresh", type: "boolean", describe: "refresh model list from remote" },
      ],
    },
    {
      usage: "kilo session",
      describe: "manage sessions",
      subcommands: [
        {
          usage: "kilo session list",
          describe: "list sessions",
          options: [
            { name: "--max-count", alias: "-n", type: "number", describe: "maximum number of sessions to show" },
            { name: "--format", type: "string", describe: "output format" },
          ],
        },
      ],
    },
    {
      usage: "kilo stats",
      describe: "show token usage and cost statistics",
      options: [
        { name: "--days", type: "number", describe: "show stats for the last N days" },
        { name: "--tools", type: "number", describe: "number of tools to show" },
        { name: "--models", type: "boolean|number", describe: "show model statistics (flag for all, or N for top N)" },
        { name: "--project", type: "string", describe: "filter by project" },
      ],
    },
    {
      usage: "kilo export [sessionID]",
      describe: "export session data as JSON",
    },
    {
      usage: "kilo import <file>",
      describe: "import session data from JSON file or URL",
    },
    {
      usage: "kilo pr <number>",
      describe: "fetch and checkout a GitHub PR branch, then run kilo",
    },
    {
      usage: "kilo serve",
      describe: "starts a headless kilo server",
      options: [...NETWORK_OPTIONS],
    },
    {
      usage: "kilo web",
      describe: "start kilo server and open web interface",
      options: [...NETWORK_OPTIONS],
    },
    {
      usage: "kilo attach <url>",
      describe: "attach to a running kilo server",
      options: [
        { name: "--dir", type: "string", describe: "working directory" },
        { name: "--session", alias: "-s", type: "string", describe: "session id" },
        { name: "--password", alias: "-p", type: "string", describe: "server password" },
      ],
    },
    {
      usage: "kilo upgrade [target]",
      describe: "upgrade kilo to the latest or a specific version",
      options: [{ name: "--method", alias: "-m", type: "string", describe: "installation method to use" }],
    },
    {
      usage: "kilo uninstall",
      describe: "uninstall kilo and remove all related files",
      options: [
        { name: "--keep-config", alias: "-c", type: "boolean", describe: "keep configuration files" },
        { name: "--keep-data", alias: "-d", type: "boolean", describe: "keep data files" },
        { name: "--dry-run", type: "boolean", describe: "show what would be removed" },
        { name: "--force", alias: "-f", type: "boolean", describe: "skip confirmation prompt" },
      ],
    },
    {
      usage: "kilo completion",
      describe: "generate shell completion script",
    },
    {
      usage: "kilo acp",
      describe: "start ACP (Agent Client Protocol) server",
      options: [{ name: "--cwd", type: "string", describe: "working directory" }, ...NETWORK_OPTIONS],
    },
    {
      usage: "kilo generate",
      describe: "generate OpenAPI specs",
      internal: true,
    },
    {
      usage: "kilo debug",
      describe: "debugging and troubleshooting tools",
      internal: true,
      subcommands: [
        { usage: "kilo debug config", describe: "show resolved configuration" },
        {
          usage: "kilo debug lsp",
          describe: "language server protocol tools",
          subcommands: [
            { usage: "kilo debug lsp diagnostics <file>", describe: "show diagnostics for a file" },
            { usage: "kilo debug lsp symbols <query>", describe: "search workspace symbols" },
            { usage: "kilo debug lsp document-symbols <uri>", describe: "show document symbols" },
          ],
        },
        {
          usage: "kilo debug rg",
          describe: "ripgrep tools",
          subcommands: [
            { usage: "kilo debug rg tree", describe: "show file tree" },
            { usage: "kilo debug rg files", describe: "list files" },
            { usage: "kilo debug rg search <pattern>", describe: "search for a pattern" },
          ],
        },
        {
          usage: "kilo debug file",
          describe: "file tools",
          subcommands: [
            { usage: "kilo debug file search <query>", describe: "search for files" },
            { usage: "kilo debug file read <path>", describe: "read a file" },
            { usage: "kilo debug file status", describe: "show file status" },
            { usage: "kilo debug file list <path>", describe: "list directory contents" },
            { usage: "kilo debug file tree [dir]", describe: "show file tree" },
          ],
        },
        { usage: "kilo debug scrap", describe: "run scrap code" },
        { usage: "kilo debug skill", describe: "debug skills" },
        {
          usage: "kilo debug snapshot",
          describe: "snapshot tools",
          subcommands: [
            { usage: "kilo debug snapshot track", describe: "track file changes" },
            { usage: "kilo debug snapshot patch <hash>", describe: "apply a snapshot patch" },
            { usage: "kilo debug snapshot diff <hash>", describe: "show snapshot diff" },
          ],
        },
        { usage: "kilo debug agent <name>", describe: "debug an agent" },
        { usage: "kilo debug paths", describe: "show resolved paths" },
        { usage: "kilo debug wait", describe: "wait for input" },
      ],
    },
  ]
}

function formatMarkdown(commands: Command[]): string {
  const lines: string[] = []
  const version = Installation.VERSION

  lines.push(`# Kilo CLI Reference`)
  lines.push("")
  lines.push(`> Version: ${version}`)
  lines.push("")
  lines.push("## Global Options")
  lines.push("")
  lines.push("| Option | Alias | Description |")
  lines.push("|--------|-------|-------------|")
  for (const opt of GLOBAL_OPTIONS) {
    lines.push(`| \`${opt.name}\` | ${opt.alias ? `\`${opt.alias}\`` : ""} | ${opt.describe} |`)
  }
  lines.push("")
  lines.push("## Commands")

  function renderCommand(command: Command | Subcommand, depth: number) {
    const prefix = "#".repeat(Math.min(depth + 2, 6))
    const tag = "internal" in command && command.internal ? " [internal]" : ""
    lines.push("")
    lines.push(`${prefix} \`${command.usage}\`${tag}`)
    lines.push("")
    lines.push(command.describe)

    if (command.options && command.options.length > 0) {
      lines.push("")
      lines.push("**Options:**")
      lines.push("")
      lines.push("| Option | Alias | Type | Description |")
      lines.push("|--------|-------|------|-------------|")
      for (const opt of command.options) {
        lines.push(`| \`${opt.name}\` | ${opt.alias ? `\`${opt.alias}\`` : ""} | \`${opt.type}\` | ${opt.describe} |`)
      }
    }

    if (command.subcommands) {
      for (const sub of command.subcommands) {
        renderCommand(sub, depth + 1)
      }
    }
  }

  for (const command of commands) {
    lines.push("")
    lines.push("---")
    renderCommand(command, 1)
  }

  return lines.join(EOL)
}

function formatText(commands: Command[]): string {
  const lines: string[] = []
  const version = Installation.VERSION

  lines.push(`Kilo CLI Reference (v${version})`)
  lines.push("")
  lines.push("GLOBAL OPTIONS")
  for (const opt of GLOBAL_OPTIONS) {
    const alias = opt.alias ? `, ${opt.alias}` : ""
    lines.push(`  ${(opt.name + alias).padEnd(22)}${opt.describe}`)
  }

  lines.push("")
  lines.push("COMMANDS")

  function renderCommand(command: Command | Subcommand, indent: number) {
    const pad = " ".repeat(indent)
    const tag = "internal" in command && command.internal ? " [internal]" : ""
    lines.push("")
    lines.push(`${pad}${command.usage}${tag}`)
    lines.push(`${pad}  ${command.describe}`)

    if (command.options && command.options.length > 0) {
      lines.push("")
      lines.push(`${pad}  Options:`)
      for (const opt of command.options) {
        const alias = opt.alias ? `, ${opt.alias}` : ""
        lines.push(`${pad}    ${(opt.name + alias).padEnd(22)}${opt.describe}`)
      }
    }

    if (command.subcommands) {
      for (const sub of command.subcommands) {
        renderCommand(sub, indent + 2)
      }
    }
  }

  for (const command of commands) {
    renderCommand(command, 2)
  }

  return lines.join(EOL)
}

function findCommand(commands: Command[], name: string): Command | undefined {
  for (const command of commands) {
    const parts = command.usage.split(" ")
    if (parts[1] === name) return command
    if (parts.length === 1 && parts[0] === name) return command
  }
  return undefined
}

export const HelpCommand = cmd({
  command: "help [command]",
  describe: "show CLI reference",
  builder: (yargs: Argv) =>
    yargs
      .positional("command", {
        describe: "command name to show help for",
        type: "string",
      })
      .option("all", {
        describe: "show full CLI reference",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["markdown", "text"],
        default: "markdown",
      }),
  handler: (args) => {
    const commands = registry()
    const format = args.format === "text" ? formatText : formatMarkdown

    if (args.all) {
      process.stdout.write(format(commands) + EOL)
      return
    }

    if (args.command) {
      const found = findCommand(commands, args.command)
      if (!found) {
        process.stdout.write(`Unknown command: ${args.command}${EOL}`)
        process.stdout.write(`Run "kilo help --all" to see all commands.${EOL}`)
        process.exitCode = 1
        return
      }
      process.stdout.write(format([found]) + EOL)
      return
    }

    process.stdout.write(
      [
        `Kilo CLI (v${Installation.VERSION})`,
        "",
        "Usage:",
        "  kilo help --all              show full CLI reference",
        "  kilo help --all --format text show as plain text",
        "  kilo help <command>          show help for a command",
        "",
        "Examples:",
        "  kilo help run",
        "  kilo help auth",
        "  kilo help --all > REFERENCE.md",
        "",
      ].join(EOL) + EOL,
    )
  },
})
