import { test, expect } from "bun:test"
import { WindowsRegistry } from "../../src/windows-context-menu/registry"
import { ContextMenu } from "../../src/windows-context-menu/types"

// ---- buildInstallCommands ----

test("generates 9 commands (3 per target × 3 targets)", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  expect(cmds.length).toBe(9)
})

test("generates 3 commands per target", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const target of ContextMenu.RegistryTarget.options) {
    const targetCmds = cmds.filter((c) => c.target === target)
    expect(targetCmds.length).toBe(3)
  }
})

test("first command for each target sets the label", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const target of ContextMenu.RegistryTarget.options) {
    const targetCmds = cmds.filter((c) => c.target === target)
    expect(targetCmds[0].args).toContain("/ve")
    expect(targetCmds[0].args).toContain(ContextMenu.LABEL)
  }
})

test("second command for each target sets the icon", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const target of ContextMenu.RegistryTarget.options) {
    const targetCmds = cmds.filter((c) => c.target === target)
    expect(targetCmds[1].args).toContain("Icon")
    expect(targetCmds[1].args).toContain('"C:\\kilo\\kilo.exe"')
  }
})

test("third command for each target sets the shell command", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const target of ContextMenu.RegistryTarget.options) {
    const targetCmds = cmds.filter((c) => c.target === target)
    const cmdArgs = targetCmds[2].args.join(" ")
    expect(cmdArgs).toContain("\\command")
  }
})

test("background target uses %V argument", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  const bgCmds = cmds.filter((c) => c.target === "background")
  const shellCmd = bgCmds[2].args.find((a) => a.includes("%V"))
  expect(shellCmd).toBeDefined()
})

test("folder target uses %1 argument", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  const folderCmds = cmds.filter((c) => c.target === "folder")
  const shellCmd = folderCmds[2].args.find((a) => a.includes("%1"))
  expect(shellCmd).toBeDefined()
})

test("drive target uses %1 argument", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  const driveCmds = cmds.filter((c) => c.target === "drive")
  const shellCmd = driveCmds[2].args.find((a) => a.includes("%1"))
  expect(shellCmd).toBeDefined()
})

test("handles paths with spaces", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\Program Files\\Kilo\\kilo.exe")
  const bgCmds = cmds.filter((c) => c.target === "background")
  const iconCmd = bgCmds[1]
  expect(iconCmd.args).toContain('"C:\\Program Files\\Kilo\\kilo.exe"')
})

test("all commands use /f flag for force overwrite", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const cmd of cmds) {
    expect(cmd.args).toContain("/f")
  }
})

test("all commands start with reg add", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  for (const cmd of cmds) {
    expect(cmd.args[0]).toBe("reg")
    expect(cmd.args[1]).toBe("add")
  }
})

test("uses correct HKCU registry paths", () => {
  const cmds = WindowsRegistry.buildInstallCommands("C:\\kilo\\kilo.exe")
  const bgCmds = cmds.filter((c) => c.target === "background")
  expect(bgCmds[0].args[2]).toBe("HKCU\\Software\\Classes\\Directory\\Background\\shell\\KiloCLI")

  const folderCmds = cmds.filter((c) => c.target === "folder")
  expect(folderCmds[0].args[2]).toBe("HKCU\\Software\\Classes\\Directory\\shell\\KiloCLI")

  const driveCmds = cmds.filter((c) => c.target === "drive")
  expect(driveCmds[0].args[2]).toBe("HKCU\\Software\\Classes\\Drive\\shell\\KiloCLI")
})

// ---- buildUninstallCommands ----

test("generates 3 uninstall commands (one per target)", () => {
  const cmds = WindowsRegistry.buildUninstallCommands()
  expect(cmds.length).toBe(3)
})

test("uninstall commands use reg delete", () => {
  const cmds = WindowsRegistry.buildUninstallCommands()
  for (const cmd of cmds) {
    expect(cmd.args[0]).toBe("reg")
    expect(cmd.args[1]).toBe("delete")
  }
})

test("uninstall commands use /f flag", () => {
  const cmds = WindowsRegistry.buildUninstallCommands()
  for (const cmd of cmds) {
    expect(cmd.args).toContain("/f")
  }
})

test("uninstall commands target correct registry keys", () => {
  const cmds = WindowsRegistry.buildUninstallCommands()
  const keys = cmds.map((c) => c.args[2])
  expect(keys).toContain("HKCU\\Software\\Classes\\Directory\\Background\\shell\\KiloCLI")
  expect(keys).toContain("HKCU\\Software\\Classes\\Directory\\shell\\KiloCLI")
  expect(keys).toContain("HKCU\\Software\\Classes\\Drive\\shell\\KiloCLI")
})

test("each uninstall command maps to a distinct target", () => {
  const cmds = WindowsRegistry.buildUninstallCommands()
  const targets = cmds.map((c) => c.target)
  expect(new Set(targets).size).toBe(3)
  expect(targets).toContain("background")
  expect(targets).toContain("folder")
  expect(targets).toContain("drive")
})

// ---- RegistryTarget enum ----

test("RegistryTarget has exactly 3 options", () => {
  expect(ContextMenu.RegistryTarget.options.length).toBe(3)
})

test("RegistryTarget validates known values", () => {
  expect(ContextMenu.RegistryTarget.parse("background")).toBe("background")
  expect(ContextMenu.RegistryTarget.parse("folder")).toBe("folder")
  expect(ContextMenu.RegistryTarget.parse("drive")).toBe("drive")
})

test("RegistryTarget rejects unknown values", () => {
  expect(() => ContextMenu.RegistryTarget.parse("invalid")).toThrow()
})

// ---- REGISTRY_KEYS mapping ----

test("REGISTRY_KEYS maps all targets to HKCU paths", () => {
  for (const target of ContextMenu.RegistryTarget.options) {
    expect(ContextMenu.REGISTRY_KEYS[target]).toStartWith("HKCU\\")
  }
})

test("REGISTRY_KEYS all include KiloCLI", () => {
  for (const target of ContextMenu.RegistryTarget.options) {
    expect(ContextMenu.REGISTRY_KEYS[target]).toContain("KiloCLI")
  }
})

// ---- InstallResult schema ----

test("InstallResult validates success result", () => {
  const result = ContextMenu.InstallResult.parse({ target: "background", success: true })
  expect(result.success).toBe(true)
  expect(result.error).toBeUndefined()
})

test("InstallResult validates failure result with error", () => {
  const result = ContextMenu.InstallResult.parse({
    target: "folder",
    success: false,
    error: "Access denied",
  })
  expect(result.success).toBe(false)
  expect(result.error).toBe("Access denied")
})

test("InstallResult rejects invalid target", () => {
  expect(() =>
    ContextMenu.InstallResult.parse({ target: "unknown", success: true }),
  ).toThrow()
})
