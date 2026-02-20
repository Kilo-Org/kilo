import { describe, it, expect } from "bun:test"
import { reorderTabs } from "../../webview-ui/agent-manager/tab-order"

describe("reorderTabs", () => {
  const tabs = ["a", "b", "c", "d"]

  describe("basic reordering", () => {
    it("moves an item forward", () => {
      expect(reorderTabs(tabs, "a", "c")).toEqual(["b", "c", "a", "d"])
    })

    it("moves an item backward", () => {
      expect(reorderTabs(tabs, "c", "a")).toEqual(["c", "a", "b", "d"])
    })

    it("swaps adjacent items forward", () => {
      expect(reorderTabs(tabs, "a", "b")).toEqual(["b", "a", "c", "d"])
    })

    it("swaps adjacent items backward", () => {
      expect(reorderTabs(tabs, "b", "a")).toEqual(["b", "a", "c", "d"])
    })

    it("moves first to last", () => {
      expect(reorderTabs(tabs, "a", "d")).toEqual(["b", "c", "d", "a"])
    })

    it("moves last to first", () => {
      expect(reorderTabs(tabs, "d", "a")).toEqual(["d", "a", "b", "c"])
    })
  })

  describe("no-op cases return undefined", () => {
    it("returns undefined when from equals to", () => {
      expect(reorderTabs(tabs, "a", "a")).toBeUndefined()
    })

    it("returns undefined when from is not in the list", () => {
      expect(reorderTabs(tabs, "x", "a")).toBeUndefined()
    })

    it("returns undefined when to is not in the list", () => {
      expect(reorderTabs(tabs, "a", "x")).toBeUndefined()
    })

    it("returns undefined when both are missing", () => {
      expect(reorderTabs(tabs, "x", "y")).toBeUndefined()
    })
  })

  describe("edge cases", () => {
    it("handles a two-item list", () => {
      expect(reorderTabs(["a", "b"], "a", "b")).toEqual(["b", "a"])
      expect(reorderTabs(["a", "b"], "b", "a")).toEqual(["b", "a"])
    })

    it("handles a single-item list (from === to)", () => {
      expect(reorderTabs(["a"], "a", "a")).toBeUndefined()
    })

    it("handles empty list", () => {
      expect(reorderTabs([], "a", "b")).toBeUndefined()
    })

    it("does not mutate the original array", () => {
      const original = ["a", "b", "c"]
      const copy = [...original]
      reorderTabs(original, "a", "c")
      expect(original).toEqual(copy)
    })
  })

  describe("preserves unrelated items", () => {
    it("only the moved item changes position", () => {
      const result = reorderTabs(["a", "b", "c", "d", "e"], "b", "d")!
      expect(result).toEqual(["a", "c", "d", "b", "e"])
      // All original items are present
      expect(result.sort()).toEqual(["a", "b", "c", "d", "e"])
    })
  })

  describe("round-trip", () => {
    it("moving forward then back restores original order", () => {
      const moved = reorderTabs(tabs, "a", "c")!
      const restored = reorderTabs(moved, "a", "b")!
      // After "a" was moved to index of "c" (["b","c","a","d"]),
      // moving "a" back to index of "b" puts it back at index 0
      expect(restored).toEqual(["a", "b", "c", "d"])
    })
  })
})
