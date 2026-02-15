import fs from "node:fs/promises"
import path from "node:path"

const planPath = path.join(process.cwd(), "docs", "opencode-migration-plan.md")
const blockers = [
  /^- \[ \]/gm,
  /\|\s*🔨\s*Partial\b/g,
  /\|\s*❌\s*Not started\b/gi,
]

async function main() {
  const content = await fs.readFile(planPath, "utf8")
  const matches = blockers.flatMap((pattern) => content.match(pattern) ?? [])

  if (matches.length > 0) {
    console.error(
      `[migration-plan-check] Found ${matches.length} incomplete marker(s) in ${path.relative(process.cwd(), planPath)}.`,
    )
    process.exit(1)
  }

  console.log("[migration-plan-check] Migration plan is fully complete (no partial/not-started markers found).")
}

main().catch((error) => {
  console.error("[migration-plan-check] failed:", error)
  process.exit(1)
})
