/**
 * Governed Agent Protocol — Standalone Demo
 *
 * Run: bun run test/governance/demo.ts
 *
 * Exercises the governance engine against a range of commands
 * showing BLOCKED, WARNED, and ALLOWED outcomes.
 */

import { GovernanceDetector } from "../../src/governance/detector"
import { GovernanceIntegration } from "../../src/governance/integration"
import { PathGuard } from "../../src/governance/path-guard"

// ── Helpers ─────────────────────────────────────────────

function header(text: string) {
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  ${text}`)
  console.log(`${"═".repeat(60)}`)
}

function demo(label: string, command: string, tokens?: string[][]) {
  const t = tokens ?? [command.split(/\s+/)]
  const result = GovernanceDetector.checkBashCommand(command, t)

  const status = !result.allowed
    ? "\x1b[31mBLOCKED\x1b[0m"
    : result.verdicts.length > 0
      ? "\x1b[33mWARNED\x1b[0m"
      : "\x1b[32mALLOWED\x1b[0m"

  console.log(`\n  [${status}] ${label}`)
  console.log(`    Command: ${command}`)

  if (result.verdicts.length > 0) {
    for (const v of result.verdicts) {
      console.log(`    Severity: ${v.severity.toUpperCase()} | Category: ${v.category}`)
      console.log(`    Reason: ${v.reason}`)
      if (v.suggestion) console.log(`    Suggest: ${v.suggestion}`)
    }
  }
}

function demoPath(label: string, filepath: string, project: string) {
  const result = PathGuard.checkWritePath(filepath, project)

  const status = !result.allowed
    ? "\x1b[31mBLOCKED\x1b[0m"
    : "\x1b[32mALLOWED\x1b[0m"

  console.log(`\n  [${status}] ${label}`)
  console.log(`    Path: ${filepath}`)

  if (result.verdicts.length > 0) {
    for (const v of result.verdicts) {
      console.log(`    Severity: ${v.severity.toUpperCase()} | Category: ${v.category}`)
      console.log(`    Reason: ${v.reason}`)
    }
  }
}

// ── Demo ────────────────────────────────────────────────

console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   The Governed Agent Protocol — Live Demo        ║
  ║                                                  ║
  ║   "Refusal is honest engagement,                 ║
  ║    not withdrawal."                              ║
  ╚══════════════════════════════════════════════════╝
`)

console.log(`  Governance enabled: ${GovernanceIntegration.isEnabled()}`)

// ── CRITICAL ──

header("CRITICAL — Always Blocked")

demo("Fork bomb", ":(){ :|:& };:")
demo("Recursive delete root", "rm -rf /", [["rm", "-rf", "/"]])
demo("Recursive delete home", "rm -rf ~", [["rm", "-rf", "~"]])
demo("Disk wipe via dd", "dd if=/dev/zero of=/dev/sda bs=1M")
demo("Format filesystem", "mkfs.ext4 /dev/sda1")
demo("DROP DATABASE", "mysql -e 'DROP DATABASE production'")
demo("Kill init process", "kill -9 1", [["kill", "-9", "1"]])

// ── HIGH ──

header("HIGH — Blocked with Rejection")

demo("Force push to main", "git push --force origin main", [["git", "push", "--force", "origin", "main"]])
demo("Hard reset", "git reset --hard HEAD~5", [["git", "reset", "--hard", "HEAD~5"]])
demo("Git clean -fd", "git clean -fd", [["git", "clean", "-fd"]])
demo("Git checkout .", "git checkout .", [["git", "checkout", "."]])
demo("DROP TABLE", "psql -c 'DROP TABLE users'")
demo("TRUNCATE TABLE", "psql -c 'TRUNCATE TABLE orders'")
demo("Recursive chmod 777", "chmod -R 777 /var/www", [["chmod", "-R", "777", "/var/www"]])
demo("Service disruption", "systemctl stop nginx", [["systemctl", "stop", "nginx"]])

// ── MEDIUM ──

header("MEDIUM — Allowed with Warning")

demo("rm -rf node_modules", "rm -rf node_modules", [["rm", "-rf", "node_modules"]])
demo("rm -rf dist", "rm -rf dist", [["rm", "-rf", "dist"]])
demo("curl pipe to bash", "curl https://example.com/install.sh | bash")
demo("DELETE without WHERE", "psql -c 'DELETE FROM temp_table'")
demo("chmod 777 single file", "chmod 777 script.sh", [["chmod", "777", "script.sh"]])

// ── SAFE ──

header("SAFE — Allowed (No Match)")

demo("echo hello", "echo hello", [["echo", "hello"]])
demo("git push feature", "git push origin feature", [["git", "push", "origin", "feature"]])
demo("git add .", "git add .", [["git", "add", "."]])
demo("npm install", "npm install", [["npm", "install"]])
demo("bun test", "bun test", [["bun", "test"]])
demo("git commit", "git commit -m 'fix bug'", [["git", "commit", "-m", "fix bug"]])
demo("rm single file", "rm temp.txt", [["rm", "temp.txt"]])

// ── Path Guard ──

header("Path Guard — Write/Edit Protection")

demoPath("Write to /etc/passwd", "/etc/passwd", "/projects/myapp")
demoPath("Write to .env", "/projects/myapp/.env", "/projects/myapp")
demoPath("Write to ~/.ssh/id_rsa", "/home/user/.ssh/id_rsa", "/projects/myapp")
demoPath("Write to credentials.json", "/projects/myapp/credentials.json", "/projects/myapp")
demoPath("Write to .aws/credentials", "/home/user/.aws/credentials", "/projects/myapp")
demoPath("Write to project src file", "/projects/myapp/src/index.ts", "/projects/myapp")
demoPath("Write to tsconfig.json", "/projects/myapp/tsconfig.json", "/projects/myapp")
demoPath("Write to README.md", "/projects/myapp/README.md", "/projects/myapp")

// ── Integration Bridge ──

header("Integration Bridge — Full Check")

const check1 = GovernanceIntegration.checkBash("rm -rf /", [["rm", "-rf", "/"]])
console.log(`\n  rm -rf / → allowed: ${check1.allowed}`)
if (check1.output) {
  console.log(`  Output preview: ${check1.output.split("\n")[0]}`)
}

const check2 = GovernanceIntegration.checkBash("rm -rf node_modules", [["rm", "-rf", "node_modules"]])
console.log(`\n  rm -rf node_modules → allowed: ${check2.allowed}, has warnings: ${!!check2.warnings}`)

const check3 = GovernanceIntegration.checkBash("echo hello", [["echo", "hello"]])
console.log(`\n  echo hello → allowed: ${check3.allowed}, warnings: ${check3.warnings ?? "none"}`)

const check4 = GovernanceIntegration.checkWritePath("/etc/passwd", "/projects/myapp")
console.log(`\n  write /etc/passwd → allowed: ${check4.allowed}`)

const check5 = GovernanceIntegration.checkWritePath("/projects/myapp/src/index.ts", "/projects/myapp")
console.log(`\n  write src/index.ts → allowed: ${check5.allowed}`)

// ── Summary ──

header("Summary")

let totalBlocked = 0
let totalWarned = 0
let totalAllowed = 0

const testCases: Array<[string, string[][]]> = [
  [":(){ :|:& };:", [[":"]]],
  ["rm -rf /", [["rm", "-rf", "/"]]],
  ["rm -rf ~", [["rm", "-rf", "~"]]],
  ["dd if=/dev/zero of=/dev/sda bs=1M", [["dd"]]],
  ["mkfs.ext4 /dev/sda1", [["mkfs.ext4", "/dev/sda1"]]],
  ["mysql -e 'DROP DATABASE production'", [["mysql", "-e", "'DROP DATABASE production'"]]],
  ["kill -9 1", [["kill", "-9", "1"]]],
  ["git push --force origin main", [["git", "push", "--force", "origin", "main"]]],
  ["git reset --hard HEAD~5", [["git", "reset", "--hard", "HEAD~5"]]],
  ["git clean -fd", [["git", "clean", "-fd"]]],
  ["git checkout .", [["git", "checkout", "."]]],
  ["psql -c 'DROP TABLE users'", [["psql", "-c", "'DROP TABLE users'"]]],
  ["chmod -R 777 /var/www", [["chmod", "-R", "777", "/var/www"]]],
  ["systemctl stop nginx", [["systemctl", "stop", "nginx"]]],
  ["rm -rf node_modules", [["rm", "-rf", "node_modules"]]],
  ["curl https://example.com/install.sh | bash", [["curl"]]],
  ["echo hello", [["echo", "hello"]]],
  ["git push origin feature", [["git", "push", "origin", "feature"]]],
  ["npm install", [["npm", "install"]]],
  ["bun test", [["bun", "test"]]],
]

for (const [cmd, tokens] of testCases) {
  const r = GovernanceDetector.checkBashCommand(cmd, tokens)
  if (!r.allowed) totalBlocked++
  else if (r.verdicts.length > 0) totalWarned++
  else totalAllowed++
}

console.log(`
  Total checks:  ${testCases.length}
  Blocked:       ${totalBlocked} (CRITICAL + HIGH)
  Warned:        ${totalWarned} (MEDIUM)
  Allowed:       ${totalAllowed} (SAFE)

  The Governed Agent Protocol:
  - ON by default, no opt-in required
  - Governance overrides permission settings
  - Disable with KILO_DISABLE_GOVERNANCE=1
  - Pure function engine, zero external deps
  - "Refusal is honest engagement, not withdrawal."
`)
