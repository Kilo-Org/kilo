import { describe, expect, it } from "bun:test"
import {
  validateAutocompleteSettingUpdate,
  validateConfigPatch,
  validateSettingUpdate,
} from "../../src/services/settings/validation"

describe("validateConfigPatch", () => {
  it("accepts valid config patch and normalizes string fields", () => {
    const result = validateConfigPatch({
      model: "  kilo/auto  ",
      disabled_providers: ["openai", "openai", " anthropic "],
      skills: {
        paths: [" ./skills ", "./skills", "./more"],
      },
      experimental: {
        mcp_timeout: 15000,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.model).toBe("kilo/auto")
    expect(result.value.disabled_providers).toEqual(["openai", "anthropic"])
    expect(result.value.skills?.paths).toEqual(["./skills", "./more"])
  })

  it("rejects unknown top-level keys", () => {
    const result = validateConfigPatch({
      unknown_key: true,
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true)
  })

  it("rejects invalid numeric bounds", () => {
    const result = validateConfigPatch({
      experimental: {
        mcp_timeout: 0,
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.issues.some((issue) => issue.path === "experimental.mcp_timeout")).toBe(true)
  })

  it("accepts MCP config entries with runtime metadata fields", () => {
    const result = validateConfigPatch({
      mcp: {
        demo: {
          type: "remote",
          url: "https://example.com/mcp",
          enabled: true,
          timeout: 10000,
        },
      },
    })

    expect(result.ok).toBe(true)
  })

  it("accepts provider config patches with auth fields", () => {
    const result = validateConfigPatch({
      provider: {
        custom_openai: {
          name: "Custom OpenAI",
          api_key: "sk-test",
          base_url: "https://api.example.com/v1",
          models: {
            "custom/model": { name: "Custom Model" },
          },
        },
      },
    })

    expect(result.ok).toBe(true)
  })
})

describe("validateSettingUpdate", () => {
  it("accepts known boolean setting values", () => {
    const result = validateSettingUpdate("notifications.agent", true)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.key).toBe("notifications.agent")
    expect(result.value.value).toBe(true)
  })

  it("normalizes sound setting values", () => {
    const result = validateSettingUpdate("sounds.errors", " DEFAULT ")

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.value).toBe("default")
  })

  it("rejects unsupported setting keys", () => {
    const result = validateSettingUpdate("terminal.bad", true)

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.issues[0]?.path).toBe("key")
  })
})

describe("validateAutocompleteSettingUpdate", () => {
  it("accepts valid autocomplete updates", () => {
    const result = validateAutocompleteSettingUpdate("enableAutoTrigger", false)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value.key).toBe("enableAutoTrigger")
    expect(result.value.value).toBe(false)
  })

  it("rejects invalid autocomplete values", () => {
    const result = validateAutocompleteSettingUpdate("enableChatAutocomplete", "yes")

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.issues.length).toBeGreaterThan(0)
  })
})
