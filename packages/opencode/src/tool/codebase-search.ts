import z from "zod"
import { Tool } from "./tool"
import { createHash } from "crypto"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import { Auth } from "../auth"
import { Log } from "../util/log"
import DESCRIPTION from "./codebase-search.txt"

const log = Log.create({ service: "tool.codebase-search" })

interface QdrantSearchResponse {
  status: string
  result: Array<{
    id: string
    score: number
    payload: {
      filePath: string
      startLine: number
      endLine: number
      codeChunk: string
      [key: string]: any
    }
  }>
}

// Helper function to generate collection name from workspace path (matches Kilo Code extension pattern)
function generateCollectionName(workspacePath: string): string {
  const hash = createHash("sha256").update(workspacePath).digest("hex")
  return `ws-${hash.substring(0, 16)}`
}

// Helper function to map embed model to provider and model ID
function getEmbeddingProvider(model: string): { provider: string; modelId: string } {
  const lowerModel = model.toLowerCase()

  if (lowerModel.includes("text-embedding")) {
    return { provider: "openai", modelId: model }
  }
  if (lowerModel.includes("codestral") || lowerModel.includes("mistral")) {
    return { provider: "mistral", modelId: model }
  }
  if (lowerModel.includes("nomic")) {
    return { provider: "ollama", modelId: model }
  }
  if (lowerModel.includes("openai")) {
    return { provider: "openai", modelId: model }
  }

  return { provider: "openai", modelId: "text-embedding-3-small" }
}

// Helper function to generate embedding using OpenAI
async function generateOpenAIEmbedding(
  text: string,
  apiKey: string,
  model = "text-embedding-3-small",
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI embeddings API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// Helper function to generate embedding using Mistral
async function generateMistralEmbedding(
  text: string,
  apiKey: string,
  model = "codestral-embed-2505",
): Promise<number[]> {
  const response = await fetch("https://api.mistral.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mistral embeddings API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// Helper function to generate embedding using Ollama (local)
async function generateOllamaEmbedding(text: string, model = "nomic-embed-text"): Promise<number[]> {
  const response = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Ollama embeddings API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.embedding
}

// Helper function to generate embedding
async function generateEmbedding(text: string, embedModel: string, authMap: Map<string, any>): Promise<number[]> {
  const { provider, modelId } = getEmbeddingProvider(embedModel)

  if (provider === "openai") {
    const openaiAuth = authMap.get("openai")
    if (!openaiAuth) {
      throw new Error("OpenAI API key not found. Please configure openai provider in auth settings.")
    }
    const apiKey = openaiAuth.type === "oauth" ? openaiAuth.access : openaiAuth.key
    if (!apiKey) {
      throw new Error("OpenAI API key not found in auth configuration.")
    }
    return generateOpenAIEmbedding(text, apiKey, modelId)
  }

  if (provider === "mistral") {
    const mistralAuth = authMap.get("mistral")
    if (!mistralAuth) {
      throw new Error("Mistral API key not found. Please configure mistral provider in auth settings.")
    }
    const apiKey = mistralAuth.type === "oauth" ? mistralAuth.access : mistralAuth.key
    if (!apiKey) {
      throw new Error("Mistral API key not found in auth configuration.")
    }
    return generateMistralEmbedding(text, apiKey, modelId)
  }

  if (provider === "ollama") {
    return generateOllamaEmbedding(text, modelId)
  }

  throw new Error(`Unsupported embedding provider: ${provider}. Supported providers: openai, mistral, ollama`)
}

// Helper function to search Qdrant
async function searchQdrant(
  vector: number[],
  qdrantUrl: string,
  collection: string,
  apiKey: string,
  limit: number,
  pathPrefix?: string,
): Promise<Array<{ filePath: string; score: number; startLine: number; endLine: number; codeChunk: string }>> {
  const url = new URL(qdrantUrl)
  url.pathname = `/collections/${collection}/points/search`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "api-key": apiKey,
  }

  const body: any = {
    vector,
    limit,
    with_payload: true,
    score_threshold: 0,
  }

  if (pathPrefix) {
    body.filter = {
      must: [
        {
          key: "filePath",
          match: {
            prefix: pathPrefix,
          },
        },
      ],
    }
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Qdrant search API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as QdrantSearchResponse

  return data.result.map((item) => ({
    filePath: item.payload.filePath,
    score: item.score,
    startLine: item.payload.startLine,
    endLine: item.payload.endLine,
    codeChunk: item.payload.codeChunk,
  }))
}

// Helper function to format search results
function formatResults(
  query: string,
  results: Array<{ filePath: string; score: number; startLine: number; endLine: number; codeChunk: string }>,
  similarityThreshold = 0.4,
  maxResults = 50,
): string {
  if (!results || results.length === 0) {
    return `No relevant code snippets found for query: "${query}"`
  }

  const filteredResults = results.filter((result) => result.score >= similarityThreshold)

  if (filteredResults.length === 0) {
    return `No relevant code snippets found for query: "${query}" (results below similarity threshold of ${similarityThreshold})`
  }

  const limitedResults = filteredResults.slice(0, maxResults)

  let output = `Query: ${query}\nResults:\n\n`

  for (const result of limitedResults) {
    output += `File path: ${result.filePath}\n`
    output += `Score: ${result.score.toFixed(3)}\n`
    output += `Lines: ${result.startLine}-${result.endLine}\n`
    if (result.codeChunk) {
      output += `Code Chunk:\n${result.codeChunk.trim()}\n`
    }
    output += "\n"
  }

  return output
}

export const CodebaseSearchTool = Tool.define("codebase-search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("The search query in natural language (required)"),
    path: z.string().describe("Optional directory path to filter results (relative to workspace)").default(""),
  }),
  async execute(params, ctx) {
    const workspacePath = Instance.worktree || Instance.directory
    if (!workspacePath) {
      throw new Error("No workspace directory found")
    }

    // Ask for permission
    await ctx.ask({
      permission: "codebase-search",
      patterns: [params.query, ...(params.path ? [params.path] : [])],
      always: ["*"],
      metadata: {
        query: params.query,
        path: params.path,
      },
    })

    const config = await Config.get()

    const codebaseSearch = config.provider?.kilo?.options?.codebase_search

    if (!codebaseSearch) {
      throw new Error(
        "Codebase search is not configured. Please configure in opencode.json:\n" +
          JSON.stringify(
            {
              provider: {
                kilo: {
                  options: {
                    codebase_search: {
                      embedModel: "codestral-embed-2505",
                      vectorDb: {
                        type: "qdrant",
                        url: "http://localhost:6333",
                      },
                      similarityThreshold: 0.4,
                      maxResults: 50,
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
      )
    }

    const { embedModel, vectorDb, similarityThreshold = 0.4, maxResults = 50 } = codebaseSearch

    if (!embedModel) {
      throw new Error(
        "embedModel is not configured. Please set provider.kilo.options.codebase_search.embedModel in opencode.json",
      )
    }

    if (!vectorDb) {
      throw new Error(
        "vectorDb is not configured. Please set provider.kilo.options.codebase_search.vectorDb in opencode.json",
      )
    }

    if (vectorDb.type === "qdrant") {
      if (!vectorDb.url) {
        throw new Error(
          "Qdrant URL is not configured. Please set provider.kilo.options.codebase_search.vectorDb.url in opencode.json",
        )
      }
    } else if (vectorDb.type === "lancedb") {
      throw new Error("LanceDB is not yet supported for codebase search. Please use Qdrant.")
    } else {
      throw new Error(`Unsupported vector database type: ${vectorDb.type}. Supported types: qdrant`)
    }

    // Auto-generate collection name if not specified
    const collection = vectorDb.collection || generateCollectionName(workspacePath)

    // Get auth keys
    const openaiAuth = await Auth.get("openai")
    const mistralAuth = await Auth.get("mistral")
    const qdrantAuth = await Auth.get("qdrant")

    if (!qdrantAuth) {
      throw new Error("Qdrant API key not found. Please configure qdrant provider in auth settings.")
    }
    const qdrantApiKey = qdrantAuth.type === "oauth" ? qdrantAuth.access : qdrantAuth.key
    if (!qdrantApiKey) {
      throw new Error("Qdrant API key not found in auth configuration.")
    }

    const authMap = new Map<string, any>()
    if (openaiAuth) authMap.set("openai", openaiAuth)
    if (mistralAuth) authMap.set("mistral", mistralAuth)

    try {
      const embedding = await generateEmbedding(params.query, embedModel, authMap)

      const results = await searchQdrant(
        embedding,
        vectorDb.url,
        collection,
        qdrantApiKey,
        maxResults,
        params.path || undefined,
      )

      const output = formatResults(params.query, results, similarityThreshold, maxResults)

      return {
        title: `Codebase search: ${params.query}`,
        output,
        metadata: {},
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes("not found") || errorMessage.includes("not configured")) {
        throw error
      }

      throw new Error(
        `Codebase search failed: ${errorMessage}\n\nPlease ensure:\n1. Your vector database (${vectorDb.type}) is running and accessible\n2. The collection "${collection}" exists and has indexed data\n3. Your embedding provider API key is configured correctly`,
      )
    }
  },
})
