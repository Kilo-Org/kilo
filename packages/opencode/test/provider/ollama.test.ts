import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import path from "path"

describe("Ollama Provider", () => {
  const projectRoot = path.join(__dirname, "../..")

  describe("Provider Registration", () => {
    it("should include ollama in provider list", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const providers = await Provider.list()
          const ollama = providers["ollama"]

          expect(ollama).toBeDefined()
          expect(ollama.id).toBe("ollama")
          expect(ollama.name).toBe("Ollama")
          expect(ollama.env).toContain("OLLAMA_HOST")
        },
      })
    })

    it("should support OLLAMA_HOST environment variable", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const providers = await Provider.list()
          const ollama = providers["ollama"]

          expect(ollama.env).toContain("OLLAMA_HOST")
        },
      })
    })
  })
})
