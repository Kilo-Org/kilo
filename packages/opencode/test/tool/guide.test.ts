import { describe, it, expect } from "bun:test"
import { GuideEnterTool, GuideExitTool } from "../../src/tool/guide"

describe("Guide Mode Tools", () => {
  describe("GuideEnterTool", () => {
    it("should be defined", () => {
      expect(GuideEnterTool).toBeDefined()
      expect(GuideEnterTool.id).toBe("guide_enter")
    })

    it("should have correct description", () => {
      expect(GuideEnterTool.init).toBeDefined()
    })
  })

  describe("GuideExitTool", () => {
    it("should be defined", () => {
      expect(GuideExitTool).toBeDefined()
      expect(GuideExitTool.id).toBe("guide_exit")
    })

    it("should have correct description", () => {
      expect(GuideExitTool.init).toBeDefined()
    })
  })
})
