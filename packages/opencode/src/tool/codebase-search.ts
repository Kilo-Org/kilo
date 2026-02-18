import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Auth } from "../auth"
import { Log } from "../util/log"
import DESCRIPTION from "./codebase-search.txt"
// kilocode_change start - use Kilo-specific modules
import { CodebaseSearchConfig, CodebaseSearchCollection, CodebaseSearchEmbeddings } from "@/kilocode/codebase-search"
// kilocode_change end

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
export function formatResults(
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

export const CodebaseSearchTool = Tool.define("codebase_search", {
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
      permission: "codebase_search",
      patterns: [params.query, ...(params.path ? [params.path] : [])],
      always: ["*"],
      metadata: {
        query: params.query,
        path: params.path,
      },
    })

    // kilocode_change start - use Kilo-specific config module
    const configResult = await CodebaseSearchConfig.getWithDefaults()

    if (!configResult) {
      throw new Error(
        "Codebase search is not configured. Please configure in opencode.json:\n" +
          JSON.stringify(CodebaseSearchConfig.getExampleConfig(), null, 2),
      )
    }

    const { config, similarityThreshold, maxResults } = configResult
    // kilocode_change end

    const { embedModel, vectorDb } = config

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

    // kilocode_change start - use Kilo-specific collection naming
    const collection = CodebaseSearchCollection.get(workspacePath, vectorDb.collection)
    // kilocode_change end

    // Get auth keys
    const qdrantAuth = await Auth.get("qdrant")

    if (!qdrantAuth) {
      throw new Error("Qdrant API key not found. Please configure qdrant provider in auth settings.")
    }
    const qdrantApiKey = qdrantAuth.type === "oauth" ? qdrantAuth.access : qdrantAuth.key
    if (!qdrantApiKey) {
      throw new Error("Qdrant API key not found in auth configuration.")
    }

    // kilocode_change start - use Kilo-specific embeddings module
    const authMap = await CodebaseSearchEmbeddings.buildAuthMap()
    // kilocode_change end

    try {
      // kilocode_change start - use Kilo-specific embeddings module
      const embedding = await CodebaseSearchEmbeddings.generate(params.query, embedModel, authMap)
      // kilocode_change end

      const results = await searchQdrant(
        embedding,
        vectorDb.url!,
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
