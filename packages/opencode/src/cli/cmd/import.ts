import type { Argv } from "yargs"
import { Session } from "../../session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import { EOL } from "os"

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or app.kilo.ai share URL", // kilocode_change
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData:
        | {
            info: Session.Info
            messages: Array<{
              info: any
              parts: any[]
            }>
          }
        | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        // kilocode_change start
        const url = (() => {
          try {
            return new URL(args.file)
          } catch {
            return undefined
          }
        })()

        if (!url || url.hostname !== "app.kilo.ai") {
          process.stdout.write(`Invalid URL format. Expected: https://app.kilo.ai/s/<id>`)
          process.stdout.write(EOL)
          return
        }

        const parts = url.pathname.split("/").filter(Boolean)
        const id = parts.length >= 2 && parts[0] === "s" ? parts[1] : undefined
        if (!id) {
          process.stdout.write(`Invalid URL format. Expected: https://app.kilo.ai/s/<id>`)
          process.stdout.write(EOL)
          return
        }

        const response = await fetch(`https://ingest.kilosessions.ai/session/${encodeURIComponent(id)}`)

        if (!response.ok) {
          process.stdout.write(`Failed to fetch share data: ${response.statusText}`)
          process.stdout.write(EOL)
          return
        }

        const data = await response.json()

        if (!data.info || !data.messages || !Array.isArray(data.messages)) {
          process.stdout.write(`Share not found: ${id}`)
          process.stdout.write(EOL)
          return
        }

        exportData = data
        // kilocode_change end
      } else {
        const file = Bun.file(args.file)
        exportData = await file.json().catch(() => {})
        if (!exportData) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        return
      }

      await Storage.write(["session", Instance.project.id, exportData.info.id], exportData.info)

      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      process.stdout.write(`Imported session: ${exportData.info.id}`)
      process.stdout.write(EOL)
    })
  },
})
