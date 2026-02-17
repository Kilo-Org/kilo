import { test, expect } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"

test("ollama provider is auto-registered with default models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["ollama"]).toBeDefined()
      expect(providers["ollama"].name).toBe("Ollama")
      expect(providers["ollama"].models["llama3.2"]).toBeDefined()
      expect(providers["ollama"].models["llama3.1"]).toBeDefined()
      expect(providers["ollama"].models["mistral"]).toBeDefined()
    },
  })
})

test("ollama provider uses custom baseURL from config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          provider: {
            ollama: {
              options: {
                baseURL: "http://remote-ollama:11434",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["ollama"]).toBeDefined()
      expect(providers["ollama"].models["llama3.2"].options.baseURL).toBe("http://remote-ollama:11434/v1")
    },
  })
})

test("ollama provider supports API key for secured instances", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          provider: {
            ollama: {
              options: {
                baseURL: "http://secured-ollama:11434",
                apiKey: "test-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["ollama"]).toBeDefined()
      const model = providers["ollama"].models["llama3.2"]
      expect(model.options.baseURL).toBe("http://secured-ollama:11434/v1")
      expect(model.options.apiKey).toBe("test-api-key")
    },
  })
})

test("ollama models have zero cost", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const model = providers["ollama"].models["llama3.2"]
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
    },
  })
})

test("ollama provider can be disabled", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
          disabled_providers: ["ollama"],
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["ollama"]).toBeUndefined()
    },
  })
})
