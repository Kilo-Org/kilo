// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { CodebaseSearchCollection } from "@/kilocode/codebase-search/collection"
import { CodebaseSearchTypes, CODEBASE_SEARCH_DEFAULTS } from "@/kilocode/codebase-search/types"
import { CodebaseSearchEmbeddings } from "@/kilocode/codebase-search/embeddings"
import { formatResults } from "@/tool/codebase-search"

describe("CodebaseSearchCollection", () => {
  test("generates consistent collection names from workspace paths", () => {
    const workspacePath = "/Users/test/projects/my-project"
    const name1 = CodebaseSearchCollection.generateFromWorkspace(workspacePath)
    const name2 = CodebaseSearchCollection.generateFromWorkspace(workspacePath)

    expect(name1).toBe(name2)
    expect(name1).toMatch(/^ws-[a-f0-9]{16}$/)
  })

  test("generates different names for different paths", () => {
    const name1 = CodebaseSearchCollection.generateFromWorkspace("/path/to/project-a")
    const name2 = CodebaseSearchCollection.generateFromWorkspace("/path/to/project-b")

    expect(name1).not.toBe(name2)
  })

  test("returns explicit collection when provided", () => {
    const explicitName = "my-custom-collection"
    const result = CodebaseSearchCollection.get("/any/path", explicitName)

    expect(result).toBe(explicitName)
  })

  test("generates collection when explicit name not provided", () => {
    const workspacePath = "/path/to/project"
    const result = CodebaseSearchCollection.get(workspacePath)
    const expected = CodebaseSearchCollection.generateFromWorkspace(workspacePath)

    expect(result).toBe(expected)
  })

  test("detects Kilo pattern correctly", () => {
    const validName = CodebaseSearchCollection.generateFromWorkspace("/some/path")
    expect(CodebaseSearchCollection.isKiloPattern(validName)).toBe(true)

    expect(CodebaseSearchCollection.isKiloPattern("my-collection")).toBe(false)
    expect(CodebaseSearchCollection.isKiloPattern("ws-12345")).toBe(false)
    expect(CodebaseSearchCollection.isKiloPattern("ws-ghijklmnopqrst")).toBe(false)
  })
})

describe("CodebaseSearchTypes", () => {
  test("validates valid config", () => {
    const validConfig = {
      embedModel: "codestral-embed-2505",
      vectorDb: {
        type: "qdrant" as const,
        url: "http://localhost:6333",
      },
      similarityThreshold: 0.5,
      maxResults: 25,
    }

    const result = CodebaseSearchTypes.Config.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  test("rejects invalid vector db type", () => {
    const invalidConfig = {
      embedModel: "text-embedding-3-small",
      vectorDb: {
        type: "invalid",
        url: "http://localhost:6333",
      },
    }

    const result = CodebaseSearchTypes.Config.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  test("rejects similarity threshold out of range", () => {
    const invalidConfig = {
      embedModel: "text-embedding-3-small",
      vectorDb: {
        type: "qdrant" as const,
      },
      similarityThreshold: 1.5,
    }

    const result = CodebaseSearchTypes.Config.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  test("applies defaults correctly", () => {
    expect(CODEBASE_SEARCH_DEFAULTS.similarityThreshold).toBe(0.4)
    expect(CODEBASE_SEARCH_DEFAULTS.maxResults).toBe(50)
    expect(CODEBASE_SEARCH_DEFAULTS.defaultEmbedModel).toBe("codestral-embed-2505")
  })
})

describe("CodebaseSearchEmbeddings", () => {
  test("detects OpenAI embedding provider", () => {
    expect(CodebaseSearchEmbeddings.getProvider("text-embedding-3-small")).toEqual({
      provider: "openai",
      modelId: "text-embedding-3-small",
    })
    expect(CodebaseSearchEmbeddings.getProvider("text-embedding-3-large")).toEqual({
      provider: "openai",
      modelId: "text-embedding-3-large",
    })
    expect(CodebaseSearchEmbeddings.getProvider("openai-embedding")).toEqual({
      provider: "openai",
      modelId: "openai-embedding",
    })
  })

  test("detects Mistral embedding provider", () => {
    expect(CodebaseSearchEmbeddings.getProvider("codestral-embed-2505")).toEqual({
      provider: "mistral",
      modelId: "codestral-embed-2505",
    })
    expect(CodebaseSearchEmbeddings.getProvider("mistral-embed")).toEqual({
      provider: "mistral",
      modelId: "mistral-embed",
    })
  })

  test("detects Ollama embedding provider", () => {
    expect(CodebaseSearchEmbeddings.getProvider("nomic-embed-text")).toEqual({
      provider: "ollama",
      modelId: "nomic-embed-text",
    })
  })

  test("defaults to OpenAI for unknown models", () => {
    expect(CodebaseSearchEmbeddings.getProvider("unknown-model")).toEqual({
      provider: "openai",
      modelId: "text-embedding-3-small",
    })
  })
})

describe("formatResults", () => {
  test("returns 'no results' message for empty results", () => {
    const output = formatResults("test query", [])
    expect(output).toBe('No relevant code snippets found for query: "test query"')
  })

  test("returns 'no results' message for null/undefined results", () => {
    expect(formatResults("test", null as any)).toContain("No relevant code snippets found")
    expect(formatResults("test", undefined as any)).toContain("No relevant code snippets found")
  })

  test("filters results below similarity threshold", () => {
    const results = [
      { filePath: "/src/a.ts", score: 0.8, startLine: 1, endLine: 10, codeChunk: "code a" },
      { filePath: "/src/b.ts", score: 0.2, startLine: 5, endLine: 15, codeChunk: "code b" },
    ]
    const output = formatResults("test", results, 0.5)
    expect(output).toContain("/src/a.ts")
    expect(output).not.toContain("/src/b.ts")
  })

  test("returns message when all results below threshold", () => {
    const results = [
      { filePath: "/src/a.ts", score: 0.1, startLine: 1, endLine: 10, codeChunk: "code a" },
    ]
    const output = formatResults("test", results, 0.5)
    expect(output).toContain("No relevant code snippets found")
    expect(output).toContain("below similarity threshold of 0.5")
  })

  test("limits results to maxResults", () => {
    const results = [
      { filePath: "/src/a.ts", score: 0.9, startLine: 1, endLine: 10, codeChunk: "code a" },
      { filePath: "/src/b.ts", score: 0.8, startLine: 5, endLine: 15, codeChunk: "code b" },
      { filePath: "/src/c.ts", score: 0.7, startLine: 20, endLine: 30, codeChunk: "code c" },
    ]
    const output = formatResults("test", results, 0.5, 2)
    expect(output).toContain("/src/a.ts")
    expect(output).toContain("/src/b.ts")
    expect(output).not.toContain("/src/c.ts")
  })

  test("formats output with all fields", () => {
    const results = [
      { filePath: "/src/test.ts", score: 0.856, startLine: 10, endLine: 25, codeChunk: "  function hello() {}  " },
    ]
    const output = formatResults("my query", results, 0.5)
    expect(output).toContain("Query: my query")
    expect(output).toContain("File path: /src/test.ts")
    expect(output).toContain("Score: 0.856")
    expect(output).toContain("Lines: 10-25")
    expect(output).toContain("Code Chunk:")
    expect(output).toContain("function hello() {}") // trimmed
  })

  test("handles results without codeChunk", () => {
    const results = [
      { filePath: "/src/test.ts", score: 0.8, startLine: 1, endLine: 5, codeChunk: "" },
    ]
    const output = formatResults("test", results, 0.5)
    expect(output).toContain("File path: /src/test.ts")
    expect(output).not.toContain("Code Chunk:")
  })
})
