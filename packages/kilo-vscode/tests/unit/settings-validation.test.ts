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

  it("accepts opencode-style provider fields and preserves options", () => {
    const result = validateConfigPatch({
      provider: {
        custom_provider: {
          id: "custom_provider",
          name: "Custom Provider",
          api: "openai",
          npm: "@ai-sdk/openai-compatible",
          env: ["OPENAI_API_KEY", " OPENAI_API_KEY ", "OPENAI_BASE_URL"],
          whitelist: ["provider/model-a", "provider/model-a", "provider/model-b"],
          blacklist: ["provider/model-c"],
          options: {
            apiKey: "sk-live",
            baseURL: "https://example.com/v1",
            enterpriseUrl: "https://enterprise.example.com",
            timeout: 60000,
            setCacheKey: true,
            customFlag: "on",
          },
          models: {
            "provider/model-a": {
              name: "Model A",
              status: "active",
              options: {
                temperature: 0.2,
              },
            },
          },
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const provider = result.value.provider?.custom_provider
    expect(provider?.env).toEqual(["OPENAI_API_KEY", "OPENAI_BASE_URL"])
    expect(provider?.whitelist).toEqual(["provider/model-a", "provider/model-b"])
    expect(provider?.options?.apiKey).toBe("sk-live")
    expect(provider?.options?.customFlag).toBe("on")
    expect(provider?.models?.["provider/model-a"]?.name).toBe("Model A")
  })

  it("normalizes legacy provider aliases into options", () => {
    const result = validateConfigPatch({
      provider: {
        alias_provider: {
          name: "Alias Provider",
          api_key: "sk-legacy",
          base_url: "https://legacy.example.com/v1",
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    const provider = result.value.provider?.alias_provider
    expect(provider?.api_key).toBeUndefined()
    expect(provider?.base_url).toBeUndefined()
    expect(provider?.options?.apiKey).toBe("sk-legacy")
    expect(provider?.options?.baseURL).toBe("https://legacy.example.com/v1")
  })

  it("drops invalid provider timeout values during normalization", () => {
    const result = validateConfigPatch({
      provider: {
        timeout_provider: {
          options: {
            timeout: -5,
            apiKey: "sk-test",
          },
        },
      },
    })

    expect(result.ok).toBe(false)
  })
})

describe("validateSettingUpdate", () => {
  it("accepts model startup defaults", () => {
    const providerResult = validateSettingUpdate("model.providerID", "kilo")
    const modelResult = validateSettingUpdate("model.modelID", "kilo/gateway-default")

    expect(providerResult.ok).toBe(true)
    expect(modelResult.ok).toBe(true)
  })

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
