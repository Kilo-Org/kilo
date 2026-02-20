import { describe, expect, it } from "bun:test"
import { removeSessionPermissions, upsertPermission } from "../../webview-ui/src/context/permission-queue"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

const permission = (input: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: input.id ?? "perm-1",
  sessionID: input.sessionID ?? "session-1",
  toolName: input.toolName ?? "read",
  patterns: input.patterns ?? ["/tmp/*"],
  args: input.args ?? {},
  message: input.message,
  tool: input.tool,
})

describe("permission queue", () => {
  it("appends a new permission id", () => {
    const result = upsertPermission([], permission({ id: "perm-1" }))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("perm-1")
  })

  it("updates an existing permission id instead of duplicating", () => {
    const existing = permission({ id: "perm-1", toolName: "read", patterns: ["a"] })
    const incoming = permission({ id: "perm-1", toolName: "write", patterns: ["b"] })

    const result = upsertPermission([existing], incoming)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(incoming)
  })

  it("keeps other permission entries when updating one id", () => {
    const first = permission({ id: "perm-1", sessionID: "session-1" })
    const second = permission({ id: "perm-2", sessionID: "session-2" })
    const incoming = permission({ id: "perm-1", toolName: "edit" })

    const result = upsertPermission([first, second], incoming)

    expect(result).toHaveLength(2)
    expect(result.find((item) => item.id === "perm-1")).toEqual(incoming)
    expect(result.find((item) => item.id === "perm-2")).toEqual(second)
  })

  it("removes only permissions from the deleted session", () => {
    const first = permission({ id: "perm-1", sessionID: "session-1" })
    const second = permission({ id: "perm-2", sessionID: "session-2" })
    const third = permission({ id: "perm-3", sessionID: "session-1" })

    const result = removeSessionPermissions([first, second, third], "session-1")

    expect(result).toEqual([second])
  })
})
