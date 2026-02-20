import { describe, it, expect } from "bun:test"
import { reorderTabs, applyTabOrder, firstOrderedTitle, reconcileOrder } from "../../webview-ui/agent-manager/tab-order"

describe("reorderTabs", () => {
  const tabs = ["a", "b", "c", "d"]

  it("moves an item forward", () => {
    expect(reorderTabs(tabs, "a", "c")).toEqual(["b", "c", "a", "d"])
  })

  it("moves an item backward", () => {
    expect(reorderTabs(tabs, "c", "a")).toEqual(["c", "a", "b", "d"])
  })

  it("swaps adjacent items", () => {
    expect(reorderTabs(tabs, "a", "b")).toEqual(["b", "a", "c", "d"])
  })

  it("returns undefined when from equals to", () => {
    expect(reorderTabs(tabs, "a", "a")).toBeUndefined()
  })

  it("returns undefined when from is not found", () => {
    expect(reorderTabs(tabs, "x", "a")).toBeUndefined()
  })

  it("returns undefined when to is not found", () => {
    expect(reorderTabs(tabs, "a", "x")).toBeUndefined()
  })

  it("does not mutate the original array", () => {
    const original = ["a", "b", "c"]
    reorderTabs(original, "a", "c")
    expect(original).toEqual(["a", "b", "c"])
  })
})

describe("applyTabOrder", () => {
  const items = [
    { id: "a", name: "Alice" },
    { id: "b", name: "Bob" },
    { id: "c", name: "Carol" },
  ]

  it("reorders items according to custom order", () => {
    const result = applyTabOrder(items, ["c", "a", "b"])
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"])
  })

  it("appends items not in the order", () => {
    const result = applyTabOrder(items, ["b"])
    expect(result.map((i) => i.id)).toEqual(["b", "a", "c"])
  })

  it("skips order IDs that are not in items", () => {
    const result = applyTabOrder(items, ["x", "c", "y", "a"])
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"])
  })

  it("returns original array when order is undefined", () => {
    const result = applyTabOrder(items, undefined)
    expect(result).toBe(items)
  })

  it("returns original array when order is empty", () => {
    const result = applyTabOrder(items, [])
    expect(result).toBe(items)
  })

  it("handles empty items", () => {
    expect(applyTabOrder([], ["a", "b"])).toEqual([])
  })

  it("preserves item properties", () => {
    const result = applyTabOrder(items, ["b", "a", "c"])
    expect(result[0]).toEqual({ id: "b", name: "Bob" })
  })
})

describe("firstOrderedTitle", () => {
  const items = [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }, { id: "c", title: "" }, { id: "d" }]

  it("returns first titled item from custom order", () => {
    expect(firstOrderedTitle(items, ["b", "a"], "fallback")).toBe("Beta")
  })

  it("skips items without titles in order", () => {
    expect(firstOrderedTitle(items, ["d", "c", "b"], "fallback")).toBe("Beta")
  })

  it("falls back to first titled item when order has no matches", () => {
    expect(firstOrderedTitle(items, ["x", "y"], "fallback")).toBe("Alpha")
  })

  it("falls back to first titled item when order is undefined", () => {
    expect(firstOrderedTitle(items, undefined, "fallback")).toBe("Alpha")
  })

  it("returns fallback when no items have titles", () => {
    expect(firstOrderedTitle([{ id: "a" }, { id: "b", title: "" }], ["a", "b"], "fallback")).toBe("fallback")
  })

  it("returns fallback for empty items", () => {
    expect(firstOrderedTitle([], ["a"], "fallback")).toBe("fallback")
  })
})

describe("reconcileOrder", () => {
  it("returns stored order unchanged when it matches current IDs", () => {
    expect(reconcileOrder(["a", "b", "c"], ["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  it("appends new IDs not in stored order", () => {
    // Stored order had [a, b], a new tab "c" was added
    expect(reconcileOrder(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  it("removes stale IDs no longer in current", () => {
    // Stored order had [a, b, c], tab "b" was closed
    expect(reconcileOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"])
  })

  it("preserves custom ordering while adding new tabs", () => {
    // User reordered to [b, a], then a new tab "c" was added
    expect(reconcileOrder(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"])
  })

  it("handles empty stored order by returning current IDs", () => {
    expect(reconcileOrder([], ["a", "b"])).toEqual(["a", "b"])
  })

  it("handles empty current IDs", () => {
    expect(reconcileOrder(["a", "b"], [])).toEqual([])
  })

  describe("regression: reorder a newly added tab immediately", () => {
    it("new tab should be reorderable after reconcile", () => {
      // Stored order from a previous drag: [s2, s1]
      // A third session s3 was just added to the worktree
      const stored = ["s2", "s1"]
      const current = ["s2", "s1", "s3"]

      // Reconcile should include s3
      const reconciled = reconcileOrder(stored, current)
      expect(reconciled).toEqual(["s2", "s1", "s3"])

      // Now the user drags s3 to position of s2 — this must succeed
      const reordered = reorderTabs(reconciled, "s3", "s2")
      expect(reordered).toEqual(["s3", "s2", "s1"])
      expect(reordered).not.toBeUndefined()
    })

    it("without reconcile, reorderTabs fails on the new tab", () => {
      // This demonstrates the bug: stored order doesn't contain s3
      const stored = ["s2", "s1"]
      const reordered = reorderTabs(stored, "s3", "s2")
      // reorderTabs returns undefined because "s3" is not in stored
      expect(reordered).toBeUndefined()
    })
  })
})
