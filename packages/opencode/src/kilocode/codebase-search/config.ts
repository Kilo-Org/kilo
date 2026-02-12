// kilocode_change - new file
import { Config } from "@/config/config"
import { CodebaseSearchTypes, CODEBASE_SEARCH_DEFAULTS } from "./types"

export namespace CodebaseSearchConfig {
  /**
   * Get codebase search configuration from Kilo provider options
   * Returns null if not configured
   */
  export async function get(): Promise<CodebaseSearchTypes.Config | null> {
    const config = await Config.get()
    const raw = config.provider?.kilo?.options?.codebase_search

    if (!raw) return null

    // Validate and return
    return CodebaseSearchTypes.Config.parse(raw)
  }

  /**
   * Check if codebase search is configured
   */
  export async function isConfigured(): Promise<boolean> {
    const config = await get()
    return config !== null
  }

  /**
   * Get configuration with defaults applied
   */
  export async function getWithDefaults(): Promise<{
    config: CodebaseSearchTypes.Config
    similarityThreshold: number
    maxResults: number
  } | null> {
    const config = await get()
    if (!config) return null

    return {
      config,
      similarityThreshold: config.similarityThreshold ?? CODEBASE_SEARCH_DEFAULTS.similarityThreshold,
      maxResults: config.maxResults ?? CODEBASE_SEARCH_DEFAULTS.maxResults,
    }
  }

  /**
   * Generate example configuration for error messages
   */
  export function getExampleConfig(): object {
    return {
      provider: {
        kilo: {
          options: {
            codebase_search: {
              embedModel: CODEBASE_SEARCH_DEFAULTS.defaultEmbedModel,
              vectorDb: {
                type: "qdrant",
                url: CODEBASE_SEARCH_DEFAULTS.defaultQdrantUrl,
              },
              similarityThreshold: CODEBASE_SEARCH_DEFAULTS.similarityThreshold,
              maxResults: CODEBASE_SEARCH_DEFAULTS.maxResults,
            },
          },
        },
      },
    }
  }
}
