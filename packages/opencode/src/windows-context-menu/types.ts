import z from "zod"

// kilocode_change - Windows Explorer context menu types

export namespace ContextMenu {
  export const RegistryTarget = z.enum(["background", "folder", "drive"])
  export type RegistryTarget = z.infer<typeof RegistryTarget>

  export const RegistryCommand = z.object({
    target: RegistryTarget,
    args: z.array(z.string()),
    description: z.string(),
  })
  export type RegistryCommand = z.infer<typeof RegistryCommand>

  export const InstallResult = z.object({
    target: RegistryTarget,
    success: z.boolean(),
    error: z.string().optional(),
  })
  export type InstallResult = z.infer<typeof InstallResult>

  export const REGISTRY_KEYS: Record<RegistryTarget, string> = {
    background: "HKCU\\Software\\Classes\\Directory\\Background\\shell\\KiloCLI",
    folder: "HKCU\\Software\\Classes\\Directory\\shell\\KiloCLI",
    drive: "HKCU\\Software\\Classes\\Drive\\shell\\KiloCLI",
  }

  export const LABEL = "Open Kilo CLI Here"
}
