import path from "path"
import * as prompts from "@clack/prompts"
import { Global } from "../global"
import { WindowsRegistry } from "./registry"

// kilocode_change - First-launch context menu prompt for Windows

const FLAG_FILE = ".context-menu-offered"

export namespace FirstLaunch {
  function flagPath(): string {
    return path.join(Global.Path.data, FLAG_FILE)
  }

  export async function shouldPrompt(): Promise<boolean> {
    if (process.platform !== "win32") return false

    const offered = await Bun.file(flagPath()).exists()
    if (offered) return false

    const installed = await WindowsRegistry.isInstalled()
    if (installed) {
      await markOffered()
      return false
    }

    return true
  }

  export async function markOffered(): Promise<void> {
    await Bun.write(flagPath(), new Date().toISOString())
  }

  export async function prompt(): Promise<void> {
    const confirm = await prompts.confirm({
      message: "Add Kilo to your Windows Explorer right-click menu?",
      initialValue: true,
    })

    if (prompts.isCancel(confirm) || !confirm) {
      await markOffered()
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Installing context menu entries...")

    const results = await WindowsRegistry.install(process.execPath)
    const failed = results.filter((r) => !r.success)

    if (failed.length === 0) {
      spinner.stop("Context menu installed — right-click any folder in Explorer!")
    } else {
      spinner.stop("Some entries failed to install", 1)
      for (const f of failed) {
        prompts.log.warn(`  ${f.target}: ${f.error}`)
      }
    }

    await markOffered()
  }
}
