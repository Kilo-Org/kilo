// kilocode_change - new file
import z from "zod"

/**
 * Configuration types for codebase search
 * These types define the Kilo-specific configuration schema for semantic code search
 */
export namespace CodebaseSearchTypes {
  /**
   * Supported vector database types
   */
  export const VectorDbType = z.enum(["qdrant", "lancedb"])
  export type VectorDbType = z.infer<typeof VectorDbType>

  /**
   * Vector database configuration
   */
  export const VectorDbConfig = z.object({
    type: VectorDbType,
    url: z.string().optional(),
    collection: z.string().optional(),
  })
  export type VectorDbConfig = z.infer<typeof VectorDbConfig>

  /**
   * Full codebase search configuration
   */
  export const Config = z.object({
    embedModel: z.string(),
    vectorDb: VectorDbConfig,
    similarityThreshold: z.number().min(0).max(1).optional(),
    maxResults: z.number().int().positive().optional(),
  })
  export type Config = z.infer<typeof Config>

  /**
   * Search result from vector database
   */
  export const SearchResult = z.object({
    filePath: z.string(),
    score: z.number(),
    startLine: z.number(),
    endLine: z.number(),
    codeChunk: z.string(),
  })
  export type SearchResult = z.infer<typeof SearchResult>

  /**
   * Embedding provider info
   */
  export const EmbeddingProvider = z.object({
    provider: z.string(),
    modelId: z.string(),
  })
  export type EmbeddingProvider = z.infer<typeof EmbeddingProvider>
}

/**
 * Default configuration values
 */
export const CODEBASE_SEARCH_DEFAULTS = {
  similarityThreshold: 0.4,
  maxResults: 50,
  defaultEmbedModel: "codestral-embed-2505",
  defaultQdrantUrl: "http://localhost:6333",
} as const
