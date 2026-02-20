import { test, expect } from "bun:test"
import { GovernanceDetector } from "../../src/governance/detector"

function check(command: string, tokens?: string[][]) {
  const t = tokens ?? [command.split(/\s+/)]
  return GovernanceDetector.checkBashCommand(command, t)
}

// ---- CRITICAL: always blocked ----

test("blocks fork bomb", () => {
  const r = check(":(){ :|:& };:")
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].severity).toBe("critical")
  expect(r.verdicts[0].category).toBe("fork_bomb")
})

test("blocks rm -rf /", () => {
  const r = check("rm -rf /", [["rm", "-rf", "/"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].severity).toBe("critical")
  expect(r.verdicts[0].category).toBe("recursive_delete")
})

test("blocks rm -rf /*", () => {
  const r = check("rm -rf /*", [["rm", "-rf", "/*"]])
  expect(r.allowed).toBe(false)
})

test("blocks rm -rf ~", () => {
  const r = check("rm -rf ~", [["rm", "-rf", "~"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("recursive_delete")
})

test("blocks rm -rf $HOME", () => {
  const r = check("rm -rf $HOME", [["rm", "-rf", "$HOME"]])
  expect(r.allowed).toBe(false)
})

test("blocks dd to block device", () => {
  const r = check("dd if=/dev/zero of=/dev/sda bs=1M")
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("disk_wipe")
})

test("blocks dd from /dev/zero to file", () => {
  const r = check("dd if=/dev/zero of=disk.img bs=1M count=100")
  expect(r.allowed).toBe(false)
})

test("blocks mkfs", () => {
  const r = check("mkfs.ext4 /dev/sda1")
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("disk_wipe")
})

test("blocks redirect to block device", () => {
  const r = check("echo > /dev/sda")
  expect(r.allowed).toBe(false)
})

test("blocks DROP DATABASE", () => {
  const r = check("mysql -e 'DROP DATABASE production'")
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("sql_drop")
})

test("blocks kill PID 1", () => {
  const r = check("kill -9 1", [["kill", "-9", "1"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("service_disruption")
})

// ---- HIGH: blocked ----

test("blocks git push --force main", () => {
  const r = check("git push --force origin main", [["git", "push", "--force", "origin", "main"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("force_push")
})

test("blocks git push -f", () => {
  const r = check("git push -f", [["git", "push", "-f"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].severity).toBe("high")
})

test("blocks git reset --hard", () => {
  const r = check("git reset --hard HEAD~5", [["git", "reset", "--hard", "HEAD~5"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("hard_reset")
})

test("blocks git clean -f", () => {
  const r = check("git clean -fd", [["git", "clean", "-fd"]])
  expect(r.allowed).toBe(false)
})

test("blocks git checkout .", () => {
  const r = check("git checkout .", [["git", "checkout", "."]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("hard_reset")
})

test("blocks git restore .", () => {
  const r = check("git restore .", [["git", "restore", "."]])
  expect(r.allowed).toBe(false)
})

test("blocks DROP TABLE", () => {
  const r = check("psql -c 'DROP TABLE users'")
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("sql_drop")
})

test("blocks TRUNCATE TABLE", () => {
  const r = check("psql -c 'TRUNCATE TABLE orders'")
  expect(r.allowed).toBe(false)
})

test("blocks chmod -R 777", () => {
  const r = check("chmod -R 777 /var/www", [["chmod", "-R", "777", "/var/www"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("permission_escalation")
})

test("blocks rm -rf on system dirs", () => {
  const r = check("rm -rf /etc/nginx", [["rm", "-rf", "/etc/nginx"]])
  expect(r.allowed).toBe(false)
})

test("blocks systemctl stop", () => {
  const r = check("systemctl stop nginx", [["systemctl", "stop", "nginx"]])
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("service_disruption")
})

// ---- MEDIUM: allowed with warning ----

test("allows rm -rf node_modules with warning", () => {
  const r = check("rm -rf node_modules", [["rm", "-rf", "node_modules"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBeGreaterThan(0)
  expect(r.verdicts[0].severity).toBe("medium")
})

test("allows curl | bash with warning", () => {
  const r = check("curl https://example.com/install.sh | bash")
  expect(r.allowed).toBe(true)
  expect(r.verdicts.some((v) => v.category === "destructive_command")).toBe(true)
})

test("allows DELETE FROM without WHERE with warning", () => {
  const r = check("psql -c 'DELETE FROM temp_table'")
  expect(r.allowed).toBe(true)
  expect(r.verdicts.some((v) => v.category === "sql_drop")).toBe(true)
})

test("allows chmod 777 non-recursive with warning", () => {
  const r = check("chmod 777 script.sh", [["chmod", "777", "script.sh"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts[0].severity).toBe("medium")
})

// ---- SAFE: no match ----

test("allows echo hello", () => {
  const r = check("echo hello", [["echo", "hello"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows git push origin feature", () => {
  const r = check("git push origin feature", [["git", "push", "origin", "feature"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows git add .", () => {
  const r = check("git add .", [["git", "add", "."]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows npm install", () => {
  const r = check("npm install", [["npm", "install"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows rm single file", () => {
  const r = check("rm temp.txt", [["rm", "temp.txt"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows git commit", () => {
  const r = check("git commit -m 'fix bug'", [["git", "commit", "-m", "fix bug"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows chmod 644", () => {
  const r = check("chmod 644 file.txt", [["chmod", "644", "file.txt"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows bun test", () => {
  const r = check("bun test", [["bun", "test"]])
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows DELETE FROM with WHERE", () => {
  const r = check("psql -c 'DELETE FROM users WHERE id = 5'")
  expect(r.allowed).toBe(true)
})

// ---- Edge cases ----

test("handles empty command", () => {
  const r = check("", [[]])
  expect(r.allowed).toBe(true)
})

test("handles empty token sets", () => {
  const r = check("echo hello", [])
  expect(r.allowed).toBe(true)
})

test("deduplicates overlapping patterns", () => {
  // git push --force main matches both "force push to main" AND "force push (any)"
  // Should deduplicate to keep only the higher severity
  const r = check("git push --force origin main", [["git", "push", "--force", "origin", "main"]])
  expect(r.allowed).toBe(false)
  const forcePushVerdicts = r.verdicts.filter((v) => v.category === "force_push")
  expect(forcePushVerdicts.length).toBe(1)
})

// ---- Format output ----

test("formatRejection includes severity and reason", () => {
  const r = check("rm -rf /", [["rm", "-rf", "/"]])
  const msg = GovernanceDetector.formatRejection(r.verdicts)
  expect(msg).toContain("[governance]")
  expect(msg).toContain("CRITICAL")
  expect(msg).toContain("Recursive deletion")
})

test("formatWarnings wraps in governance_warning tags", () => {
  const r = check("rm -rf dist", [["rm", "-rf", "dist"]])
  const msg = GovernanceDetector.formatWarnings(r.verdicts)
  expect(msg).toContain("<governance_warning>")
  expect(msg).toContain("</governance_warning>")
})

test("formatRejection includes suggestion when available", () => {
  const r = check("git reset --hard HEAD", [["git", "reset", "--hard", "HEAD"]])
  const msg = GovernanceDetector.formatRejection(r.verdicts)
  expect(msg).toContain("Suggest:")
  expect(msg).toContain("git stash")
})
