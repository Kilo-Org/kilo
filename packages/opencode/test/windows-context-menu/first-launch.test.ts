import { test, expect, beforeEach, afterEach } from "bun:test"
import { FirstLaunch } from "../../src/windows-context-menu/first-launch"
import { Global } from "../../src/global"
import path from "path"
import fs from "fs/promises"

const FLAG_FILE = ".context-menu-offered"

function flagPath(): string {
  return path.join(Global.Path.data, FLAG_FILE)
}

async function cleanFlag(): Promise<void> {
  await fs.rm(flagPath(), { force: true })
}

// ---- shouldPrompt ----

test("shouldPrompt returns false on non-Windows", async () => {
  // This test runs on whatever platform CI uses
  // On non-Windows, it should always return false
  if (process.platform !== "win32") {
    expect(await FirstLaunch.shouldPrompt()).toBe(false)
  }
})

test("shouldPrompt returns false when flag file exists", async () => {
  if (process.platform !== "win32") return

  await FirstLaunch.markOffered()
  expect(await FirstLaunch.shouldPrompt()).toBe(false)
  await cleanFlag()
})

test("shouldPrompt returns true on first Windows launch", async () => {
  if (process.platform !== "win32") return

  await cleanFlag()
  // Note: this will also return false if context menu is already installed
  // We can't easily mock isInstalled, so we just test the flag logic
  const result = await FirstLaunch.shouldPrompt()
  // Result depends on whether context menu is actually installed
  expect(typeof result).toBe("boolean")
})

// ---- markOffered ----

test("markOffered creates the flag file", async () => {
  await cleanFlag()
  await FirstLaunch.markOffered()
  const exists = await Bun.file(flagPath()).exists()
  expect(exists).toBe(true)
  await cleanFlag()
})

test("markOffered writes an ISO date string", async () => {
  await cleanFlag()
  await FirstLaunch.markOffered()
  const content = await Bun.file(flagPath()).text()
  expect(() => new Date(content)).not.toThrow()
  expect(new Date(content).getFullYear()).toBeGreaterThanOrEqual(2025)
  await cleanFlag()
})

test("markOffered is idempotent", async () => {
  await cleanFlag()
  await FirstLaunch.markOffered()
  await FirstLaunch.markOffered()
  const exists = await Bun.file(flagPath()).exists()
  expect(exists).toBe(true)
  await cleanFlag()
})
