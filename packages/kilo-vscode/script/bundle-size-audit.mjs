import fs from "node:fs/promises"
import path from "node:path"

const MAX_WEBVIEW_JS_BYTES = 25 * 1024 * 1024
const MAX_VSIX_BYTES = 50 * 1024 * 1024

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(2)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

async function readSize(targetPath) {
  const stats = await fs.stat(targetPath)
  return stats.size
}

async function findVsix(packageRoot) {
  const entries = await fs.readdir(packageRoot, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".vsix"))
    .map((entry) => entry.name)
    .sort()
  return candidates.at(-1) ?? null
}

async function main() {
  const packageRoot = process.cwd()
  const webviewJsPath = path.join(packageRoot, "dist", "webview.js")
  const webviewCssPath = path.join(packageRoot, "dist", "webview.css")
  const vsixName = await findVsix(packageRoot)
  const vsixPath = vsixName ? path.join(packageRoot, vsixName) : null

  const webviewJsSize = await readSize(webviewJsPath)
  const webviewCssSize = await readSize(webviewCssPath)
  const vsixSize = vsixPath ? await readSize(vsixPath) : null

  console.log(`[bundle-audit] dist/webview.js: ${formatBytes(webviewJsSize)}`)
  console.log(`[bundle-audit] dist/webview.css: ${formatBytes(webviewCssSize)}`)
  if (vsixPath) {
    console.log(`[bundle-audit] ${path.basename(vsixPath)}: ${formatBytes(vsixSize)}`)
  } else {
    console.log("[bundle-audit] no .vsix artifact found in package root")
  }

  let failed = false
  if (webviewJsSize > MAX_WEBVIEW_JS_BYTES) {
    console.error(
      `[bundle-audit] webview.js exceeds threshold (${formatBytes(webviewJsSize)} > ${formatBytes(MAX_WEBVIEW_JS_BYTES)})`,
    )
    failed = true
  }
  if (vsixSize !== null && vsixSize > MAX_VSIX_BYTES) {
    console.error(
      `[bundle-audit] vsix exceeds threshold (${formatBytes(vsixSize)} > ${formatBytes(MAX_VSIX_BYTES)})`,
    )
    failed = true
  }

  if (failed) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("[bundle-audit] failed:", error)
  process.exit(1)
})
