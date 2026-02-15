import { describe, expect, it } from "bun:test"
import {
  createEmptyCustomProviderDraft,
  draftToProviderConfig,
} from "../../webview-ui/src/components/settings/providers/custom-provider-utils"

function draftWithModels(modelsJson: string) {
  const draft = createEmptyCustomProviderDraft()
  draft.id = "custom"
  draft.modelsJson = modelsJson
  return draft
}

describe("draftToProviderConfig", () => {
  it("accepts valid models JSON schema", () => {
    const result = draftToProviderConfig(
      draftWithModels(
        JSON.stringify(
          {
            "provider/model": {
              name: "Provider Model",
              status: "active",
              headers: { Authorization: "Bearer abc" },
              variants: { default: { thinking: true } },
            },
          },
          null,
          2,
        ),
      ),
    )

    expect(result.ok).toBe(true)
  })

  it("rejects invalid model status values", () => {
    const result = draftToProviderConfig(
      draftWithModels(
        JSON.stringify({
          "provider/model": {
            status: "unknown",
          },
        }),
      ),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("status")
    }
  })

  it("rejects non-string header values", () => {
    const result = draftToProviderConfig(
      draftWithModels(
        JSON.stringify({
          "provider/model": {
            headers: {
              Authorization: 123,
            },
          },
        }),
      ),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("header")
    }
  })
})
