import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "bun:test"
import { isPathInsideAnyRoot } from "../../src/utils/path-security"

describe("isPathInsideAnyRoot", () => {
  it("allows paths inside the declared root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-security-"))
    const nested = path.join(tempRoot, "a", "b", "file.txt")
    await fs.mkdir(path.dirname(nested), { recursive: true })
    await fs.writeFile(nested, "ok", "utf8")

    expect(await isPathInsideAnyRoot(nested, [tempRoot])).toBe(true)
  })

  it("rejects traversal outside the declared root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-security-"))
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-security-outside-"))
    const outsideFile = path.join(outsideRoot, "outside.txt")
    await fs.writeFile(outsideFile, "outside", "utf8")

    const traversal = path.join(tempRoot, "..", path.basename(outsideRoot), "outside.txt")
    expect(await isPathInsideAnyRoot(traversal, [tempRoot])).toBe(false)
  })

  it("rejects symlink escapes", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-security-"))
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-path-security-outside-"))
    const outsideFile = path.join(outsideRoot, "outside.txt")
    await fs.writeFile(outsideFile, "outside", "utf8")

    const symlinkPath = path.join(tempRoot, "escape-link")
    try {
      await fs.symlink(outsideRoot, symlinkPath)
    } catch (error) {
      if (process.platform === "win32") {
        // Windows CI environments may block symlink creation depending on privileges.
        return
      }
      throw error
    }
    const escapedFile = path.join(symlinkPath, "outside.txt")

    expect(await isPathInsideAnyRoot(escapedFile, [tempRoot])).toBe(false)
  })
})
