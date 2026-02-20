import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { APICallError } from "ai"
import { ProviderError } from "../../provider/error"
import { generateText, type ModelMessage } from "ai"
import { randomUUID } from "crypto"

const HEADERS = ["Model", "Access", "Snippet", "Latency"]
const SEPARATOR_PADDING = 9 // " | " between 4 columns = 3 * 3 = 9 chars

// Detect if stderr is a TTY for conditional color output
const isTTY = process.stderr.isTTY ?? false

// Helper to conditionally apply colors only when output is to a TTY
function color(style: string): string {
  return isTTY ? style : ""
}

// Strip ANSI escape sequences and control characters for accurate width calculation
function sanitize(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "") // ANSI color codes
    .replace(/[\x00-\x1f\x7f]/g, "") // control characters (including \0, \n, etc.)
}

function truncate(text: string, maxLen: number): string {
  if (maxLen < 4) return text.substring(0, maxLen)
  return text.length > maxLen ? text.substring(0, maxLen - 3) + "..." : text
}

export function formatTable(
  rows: string[][],
  terminalWidth: number,
): { header: string; separator: string; rows: string[] } {
  // Sanitize all cell content to strip control chars and ANSI codes
  const sanitizedRows = rows.map((row) => row.map((cell) => sanitize(cell ?? "")))

  // Calculate natural width for each column based on sanitized content
  const widths = HEADERS.map((h, i) => Math.max(h.length, ...sanitizedRows.map((r) => r[i].length)))

  // Total width with separators
  const totalWidth = widths.reduce((a, b) => a + b, 0) + SEPARATOR_PADDING

  // Only shrink snippet column (index 2) if total exceeds terminal width
  // Minimum snippet width is header length (7) + 3 chars for meaningful content with "..."
  const minSnippetWidth = HEADERS[2].length + 3
  if (totalWidth > terminalWidth && widths[2] > minSnippetWidth) {
    const overflow = totalWidth - terminalWidth
    widths[2] = Math.max(minSnippetWidth, widths[2] - overflow)
  }

  const header = HEADERS.map((h, i) => h.padEnd(widths[i])).join(" | ")
  const separator = "-".repeat(header.length)

  const formattedRows = sanitizedRows.map((row) => {
    const truncatedRow = [row[0], row[1], row[2] ? truncate(row[2], widths[2]) : row[2], row[3]]
    return truncatedRow.map((c, i) => c.padEnd(widths[i])).join(" | ")
  })

  return { header, separator, rows: formattedRows }
}

export const RollCallCommand = cmd({
  command: "roll-call <filter>",
  describe: "batch-test models matching a filter for connectivity and latency",
  builder: (yargs: Argv) => {
    return yargs
      .positional("filter", {
        type: "string",
        describe: "regex to filter models by provider/modelID (required)",
        demandOption: true,
      })
      .option("prompt", {
        type: "string",
        default: "Hello",
        describe: "Prompt to send to each model",
      })
      .option("timeout", {
        type: "number",
        default: 25000,
        describe: "Timeout for each model call in milliseconds",
      })
      .option("parallel", {
        type: "number",
        default: 5,
        describe: "Number of parallel model calls",
      })
      .option("retries", {
        type: "number",
        default: 0,
        describe: "Number of additional retries for each model call",
      })
      .option("verbose", {
        type: "boolean",
        default: false,
        describe: "Show verbose output",
      })
      .option("quiet", {
        type: "boolean",
        default: false,
        describe: "Suppress non-error output",
      })
      .option("output", {
        type: "string",
        choices: ["table", "json"],
        default: "table",
        describe: "Output format",
      })
  },
  handler: async (args) => {
    await rollCallHandler(args)
  },
})

interface RollCallResult {
  model: string
  access: boolean
  snippet: string
  latency: number | null
  errorType: string | null
  errorMessage: string | null
}

export async function rollCallHandler(args: any) {
  const { prompt, timeout, filter, parallel, output, verbose, quiet } = args

  if (!quiet) {
    UI.println(
      `${color(UI.Style.TEXT_INFO)}Starting roll call for models with prompt: "${prompt}"${color(UI.Style.TEXT_NORMAL)}`,
    )
    UI.println(
      `${color(UI.Style.TEXT_INFO)}Timeout per model: ${timeout}ms, Parallel calls: ${parallel}${color(UI.Style.TEXT_NORMAL)}`,
    )
  }

  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const providers = await Provider.list()
      const modelsToTest: { providerID: string; modelID: string; model: Provider.Model }[] = []

      for (const [providerID, provider] of Object.entries(providers)) {
        for (const [modelID, model] of Object.entries(provider.models)) {
          const fullName = `${providerID}/${modelID}`
          if (filter) {
            try {
              const regex = new RegExp(filter, "i")
              if (!regex.test(fullName)) continue
            } catch (e) {
              UI.error(`Invalid filter regex: ${filter}`)
              return
            }
          }
          modelsToTest.push({ providerID, modelID, model })
        }
      }

      if (modelsToTest.length === 0) {
        if (!quiet)
          UI.println(`${color(UI.Style.TEXT_WARNING)}No models to test after filtering.${color(UI.Style.TEXT_NORMAL)}`)
        return
      }

      if (!quiet) {
        UI.println(
          `${color(UI.Style.TEXT_INFO)}Prompting ${modelsToTest.length} models...${color(UI.Style.TEXT_NORMAL)}`,
        )
      }

      const results: RollCallResult[] = []
      const queue = [...modelsToTest]
      const activePromises: Promise<void>[] = []

      const processModel = async (item: (typeof modelsToTest)[0]) => {
        const { providerID, modelID, model } = item
        const fullName = `${providerID}/${modelID}`
        const startTime = Date.now()
        let access = false
        let snippet = ""
        let latency: number | null = null
        let errorType: string | null = null
        let errorMessage: string | null = null

        try {
          const languageModel = await Provider.getLanguage(model)

          // Build provider options similar to how session/index.ts does it
          const sessionID = randomUUID()
          const baseOptions = ProviderTransform.options({ model, sessionID })
          const providerOptions = ProviderTransform.providerOptions(model, baseOptions)
          const maxTokens = ProviderTransform.maxOutputTokens(model)
          const temperature = ProviderTransform.temperature(model)
          const topP = ProviderTransform.topP(model)
          const topK = ProviderTransform.topK(model)

          const messages: ModelMessage[] = [{ role: "user", content: prompt }]
          const transformedMessages = ProviderTransform.message(messages, model, baseOptions)

          const { text } = await generateText({
            model: languageModel,
            messages: transformedMessages,
            abortSignal: AbortSignal.timeout(timeout),
            maxOutputTokens: maxTokens,
            temperature,
            topP,
            topK,
            providerOptions,
          })
          access = true
          snippet = text.replace(/\n/g, " ")
          latency = Date.now() - startTime
        } catch (e: any) {
          latency = Date.now() - startTime
          if (e instanceof APICallError) {
            const parsedError = ProviderError.parseAPICallError({
              providerID,
              error: e,
            })
            errorType = parsedError.type
            errorMessage = parsedError.message
          } else {
            errorType = "unknown"
            errorMessage = e.message || "An unknown error occurred"
          }
        }

        results.push({
          model: fullName,
          access,
          snippet,
          latency,
          errorType,
          errorMessage,
        })

        if (verbose && !quiet) {
          if (access) {
            UI.println(`${color(UI.Style.TEXT_SUCCESS)}✔${color(UI.Style.TEXT_NORMAL)} ${fullName} - ${latency}ms`)
          } else {
            UI.println(
              `${color(UI.Style.TEXT_DANGER)}✘${color(UI.Style.TEXT_NORMAL)} ${fullName} - ${errorType}: ${errorMessage}`,
            )
          }
        }
      }

      while (queue.length > 0 || activePromises.length > 0) {
        while (queue.length > 0 && activePromises.length < parallel) {
          const item = queue.shift()!
          const promise = processModel(item).finally(() => {
            const index = activePromises.indexOf(promise)
            if (index > -1) {
              activePromises.splice(index, 1)
            }
          })
          activePromises.push(promise)
        }
        if (activePromises.length > 0) {
          await Promise.race(activePromises)
        }
      }

      if (quiet) return

      if (output === "json") {
        console.log(JSON.stringify(results, null, 2))
      } else {
        const rows = results.map((r) => [
          r.model,
          r.access ? "YES" : "NO",
          r.access ? r.snippet : r.errorMessage ? `(${r.errorMessage})` : "",
          r.latency !== null ? `${r.latency}ms` : "N/A",
        ])

        const terminalWidth = parseInt(process.env.COLUMNS || "", 10) || process.stdout.columns || 80
        const table = formatTable(rows, terminalWidth)

        UI.println(table.header)
        UI.println(table.separator)
        table.rows.forEach((line, idx) => {
          const rowColor = results[idx].access ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_DANGER
          UI.println(color(rowColor) + line + color(UI.Style.TEXT_NORMAL))
        })

        const successful = results.filter((r) => r.access).length
        const failed = results.length - successful
        UI.println("")
        UI.println(
          `${color(UI.Style.TEXT_SUCCESS)}${successful} accessible${color(UI.Style.TEXT_NORMAL)}, ${color(UI.Style.TEXT_DANGER)}${failed} failed${color(UI.Style.TEXT_NORMAL)}`,
        )
      }
    },
  })
}
