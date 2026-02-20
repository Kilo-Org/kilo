import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { WindowsRegistry } from "../../windows-context-menu/registry"

// kilocode_change - Windows-specific CLI commands

const InstallContextMenuCommand = cmd({
  command: "install-context-menu",
  describe: "add 'Open Kilo CLI Here' to Windows Explorer right-click menu",
  handler: async () => {
    if (process.platform !== "win32") {
      prompts.log.warn("Context menu integration is only available on Windows.")
      return
    }

    UI.empty()
    prompts.intro("Install Explorer Context Menu")

    const already = await WindowsRegistry.isInstalled()
    if (already) {
      prompts.log.info("Context menu is already installed.")
      prompts.outro("Nothing to do")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Registering context menu entries...")

    const results = await WindowsRegistry.install(process.execPath)
    const failed = results.filter((r) => !r.success)

    if (failed.length === 0) {
      spinner.stop("Installed successfully")
      UI.empty()
      prompts.log.success("Right-click any folder in Explorer to see 'Open Kilo CLI Here'")
      prompts.log.info("Entries registered:")
      prompts.log.info("  - Folder background (right-click empty space)")
      prompts.log.info("  - Folder (right-click a folder)")
      prompts.log.info("  - Drive (right-click a drive)")
    } else {
      spinner.stop("Some entries failed", 1)
      for (const f of failed) {
        prompts.log.error(`  ${f.target}: ${f.error}`)
      }
    }

    prompts.outro("Done")
  },
})

const RemoveContextMenuCommand = cmd({
  command: "remove-context-menu",
  describe: "remove 'Open Kilo CLI Here' from Windows Explorer right-click menu",
  handler: async () => {
    if (process.platform !== "win32") {
      prompts.log.warn("Context menu integration is only available on Windows.")
      return
    }

    UI.empty()
    prompts.intro("Remove Explorer Context Menu")

    const installed = await WindowsRegistry.isInstalled()
    if (!installed) {
      prompts.log.info("Context menu is not currently installed.")
      prompts.outro("Nothing to do")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Removing context menu entries...")

    const results = await WindowsRegistry.uninstall()
    const failed = results.filter((r) => !r.success)

    if (failed.length === 0) {
      spinner.stop("Removed successfully")
      prompts.log.success("Explorer context menu entries have been removed.")
    } else {
      spinner.stop("Some entries failed to remove", 1)
      for (const f of failed) {
        prompts.log.error(`  ${f.target}: ${f.error}`)
      }
    }

    prompts.outro("Done")
  },
})

export const WindowsCommand = cmd({
  command: "windows",
  describe: "Windows-specific integrations",
  builder: (yargs) =>
    yargs
      .command(InstallContextMenuCommand)
      .command(RemoveContextMenuCommand)
      .demandCommand(),
  async handler() {},
})
