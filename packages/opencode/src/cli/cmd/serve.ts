import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Instance } from "../../project/instance" // kilocode_change
import path from "path"

export const ServeCommand = cmd({
  command: "serve [project]",
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("project", {
      type: "string",
      describe: "path to start kilo server in", // kilocode_change
    }),
  describe: "starts a headless kilo server", // kilocode_change
  handler: async (args) => {
    if (args.project) {
      const cwd = path.resolve(args.project)
      try {
        process.chdir(cwd)
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error"
        console.error(`Failed to change directory to ${cwd}: ${message}`)
        process.exitCode = 1
        return
      }
    }

    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`kilo server listening on http://${server.hostname}:${server.port}`) // kilocode_change
    // kilocode_change start - graceful signal shutdown
    const abort = new AbortController()
    const shutdown = async () => {
      try {
        await Instance.disposeAll()
        await server.stop(true)
      } finally {
        abort.abort()
      }
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
    process.on("SIGHUP", shutdown)
    await new Promise((resolve) => abort.signal.addEventListener("abort", resolve))
    // kilocode_change end
  },
})
