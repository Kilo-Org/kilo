import { test, expect } from "bun:test"
import { PathGuard } from "../../src/governance/path-guard"

const PROJECT = "/projects/myapp"

// ---- System paths ----

test("blocks write to /etc/passwd", () => {
  const r = PathGuard.checkWritePath("/etc/passwd", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("system_path_write")
})

test("blocks write to /usr/local/bin/script", () => {
  const r = PathGuard.checkWritePath("/usr/local/bin/script.sh", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to /boot/grub/grub.cfg", () => {
  const r = PathGuard.checkWritePath("/boot/grub/grub.cfg", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to /bin/sh", () => {
  const r = PathGuard.checkWritePath("/bin/sh", PROJECT)
  expect(r.allowed).toBe(false)
})

// ---- Credential files ----

test("blocks write to .env", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/.env", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].category).toBe("credential_exposure")
})

test("blocks write to .env.production", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/.env.production", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to id_rsa", () => {
  const r = PathGuard.checkWritePath("/home/user/.ssh/id_rsa", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts.some((v) => v.category === "credential_exposure")).toBe(true)
})

test("blocks write to credentials.json", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/credentials.json", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to secrets.yaml", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/secrets.yaml", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to private.pem", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/private.pem", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to .htpasswd", () => {
  const r = PathGuard.checkWritePath("/var/www/.htpasswd", PROJECT)
  expect(r.allowed).toBe(false)
})

// ---- Credential directories ----

test("blocks write to .ssh/config", () => {
  const r = PathGuard.checkWritePath("/home/user/.ssh/config", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts.some((v) => v.pattern === "credential_directory")).toBe(true)
})

test("blocks write to .aws/credentials", () => {
  const r = PathGuard.checkWritePath("/home/user/.aws/credentials", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to .gnupg/pubring.kbx", () => {
  const r = PathGuard.checkWritePath("/home/user/.gnupg/pubring.kbx", PROJECT)
  expect(r.allowed).toBe(false)
})

test("blocks write to .kube/config", () => {
  const r = PathGuard.checkWritePath("/home/user/.kube/config", PROJECT)
  expect(r.allowed).toBe(false)
})

// ---- Safe paths ----

test("allows write to project src file", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/src/index.ts", PROJECT)
  expect(r.allowed).toBe(true)
  expect(r.verdicts.length).toBe(0)
})

test("allows write to project config file", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/tsconfig.json", PROJECT)
  expect(r.allowed).toBe(true)
})

test("allows write to README", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/README.md", PROJECT)
  expect(r.allowed).toBe(true)
})

test("allows write to test file", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/test/auth.test.ts", PROJECT)
  expect(r.allowed).toBe(true)
})

test("allows write to package.json", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/package.json", PROJECT)
  expect(r.allowed).toBe(true)
})

// ---- Rejection message quality ----

test("rejection includes suggestion", () => {
  const r = PathGuard.checkWritePath("/etc/nginx/nginx.conf", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].suggestion).toBeDefined()
})

test("credential file rejection includes suggestion", () => {
  const r = PathGuard.checkWritePath("/projects/myapp/.env", PROJECT)
  expect(r.allowed).toBe(false)
  expect(r.verdicts[0].suggestion).toContain("environment variables")
})
