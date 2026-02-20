import { $ } from "bun"
import { ContextMenu } from "./types"

// kilocode_change - Windows Explorer context menu registry operations

export namespace WindowsRegistry {
  export function buildInstallCommands(execPath: string): ContextMenu.RegistryCommand[] {
    const quoted = `"${execPath}"`
    const commands: ContextMenu.RegistryCommand[] = []

    for (const target of ContextMenu.RegistryTarget.options) {
      const key = ContextMenu.REGISTRY_KEYS[target]
      const commandKey = `${key}\\command`
      const arg = target === "background" ? "%V" : "%1"

      commands.push({
        target,
        args: ["reg", "add", key, "/ve", "/d", ContextMenu.LABEL, "/f"],
        description: `Set label for ${target}`,
      })
      commands.push({
        target,
        args: ["reg", "add", key, "/v", "Icon", "/d", quoted, "/f"],
        description: `Set icon for ${target}`,
      })
      commands.push({
        target,
        args: ["reg", "add", commandKey, "/ve", "/d", `${quoted} "${arg}"`, "/f"],
        description: `Set command for ${target}`,
      })
    }

    return commands
  }

  export function buildUninstallCommands(): ContextMenu.RegistryCommand[] {
    return ContextMenu.RegistryTarget.options.map((target) => ({
      target,
      args: ["reg", "delete", ContextMenu.REGISTRY_KEYS[target], "/f"],
      description: `Remove ${target} context menu entry`,
    }))
  }

  export async function install(execPath: string): Promise<ContextMenu.InstallResult[]> {
    const commands = buildInstallCommands(execPath)
    const results: ContextMenu.InstallResult[] = []

    for (const target of ContextMenu.RegistryTarget.options) {
      const targetCmds = commands.filter((c) => c.target === target)
      let failed = false
      for (const cmd of targetCmds) {
        try {
          const result = await $`${cmd.args}`.quiet().nothrow()
          if (result.exitCode !== 0) {
            results.push({ target, success: false, error: result.stderr.toString().trim() })
            failed = true
            break
          }
        } catch (e) {
          results.push({ target, success: false, error: e instanceof Error ? e.message : String(e) })
          failed = true
          break
        }
      }
      if (!failed) {
        results.push({ target, success: true })
      }
    }

    return results
  }

  export async function uninstall(): Promise<ContextMenu.InstallResult[]> {
    const commands = buildUninstallCommands()
    const results: ContextMenu.InstallResult[] = []

    for (const cmd of commands) {
      const result = await $`${cmd.args}`.quiet().nothrow()
      results.push({
        target: cmd.target,
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr.toString().trim() : undefined,
      })
    }

    return results
  }

  export async function isInstalled(): Promise<boolean> {
    const key = ContextMenu.REGISTRY_KEYS.background
    const result = await $`reg query ${key}`.quiet().nothrow()
    return result.exitCode === 0
  }
}
