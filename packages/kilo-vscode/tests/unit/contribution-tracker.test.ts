import { describe, expect, test } from "bun:test"
import type * as vscode from "vscode"
import { ContributionTracker } from "../../src/services/contributions/contribution-tracker"

function createFakeContext(): vscode.ExtensionContext {
  const state = new Map<string, unknown>()

  const workspaceState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void } = {
    get<T>(key: string, defaultValue?: T): T {
      return (state.has(key) ? (state.get(key) as T) : (defaultValue as T))
    },
    update(key: string, value: unknown): Thenable<void> {
      state.set(key, value)
      return Promise.resolve()
    },
    keys(): readonly string[] {
      return Array.from(state.keys())
    },
    setKeysForSync(_keys: readonly string[]): void {
      // no-op in unit tests
    },
  }

  return { workspaceState } as unknown as vscode.ExtensionContext
}

describe("ContributionTracker", () => {
  test("records completed edit tool updates with line stats", () => {
    const tracker = new ContributionTracker(createFakeContext())
    tracker.recordFromPart(
      "session-1",
      {
        type: "tool",
        id: "part-1",
        messageID: "msg-1",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "src/file.ts", oldString: "one\ntwo\n", newString: "one\nthree\nfour\n" },
          metadata: {},
        },
      },
      "/workspace",
    )

    const records = tracker.list("/workspace", 10)
    expect(records).toHaveLength(1)
    expect(records[0]?.filePath).toBe("src/file.ts")
    expect(records[0]?.tool).toBe("edit")
    expect(records[0]?.additions).toBe(2)
    expect(records[0]?.deletions).toBe(1)
  })

  test("ignores non-completed tool states and deduplicates repeated part IDs", () => {
    const tracker = new ContributionTracker(createFakeContext())
    const basePart = {
      type: "tool",
      id: "part-dup",
      messageID: "msg-dup",
      tool: "write",
      state: {
        input: { filePath: "README.md", content: "hello\nworld\n" },
        metadata: { filediff: { before: "", after: "hello\nworld\n" } },
      },
    }

    tracker.recordFromPart(
      "session-2",
      {
        ...basePart,
        state: { ...basePart.state, status: "running" },
      },
      "/workspace",
    )
    expect(tracker.list("/workspace")).toHaveLength(0)

    tracker.recordFromPart(
      "session-2",
      {
        ...basePart,
        state: { ...basePart.state, status: "completed" },
      },
      "/workspace",
    )
    tracker.recordFromPart(
      "session-2",
      {
        ...basePart,
        state: { ...basePart.state, status: "completed" },
      },
      "/workspace",
    )

    expect(tracker.list("/workspace")).toHaveLength(1)
  })

  test("clears stored records", async () => {
    const tracker = new ContributionTracker(createFakeContext())
    tracker.recordFromPart(
      "session-3",
      {
        type: "tool",
        id: "part-clear",
        tool: "fast_edit_file",
        state: {
          status: "completed",
          input: { filePath: "src/a.ts", oldString: "a\n", newString: "a\nb\n" },
          metadata: {},
        },
      },
      "/workspace",
    )

    expect(tracker.list("/workspace")).toHaveLength(1)
    await tracker.clear("/workspace")
    expect(tracker.list("/workspace")).toHaveLength(0)
  })
})
