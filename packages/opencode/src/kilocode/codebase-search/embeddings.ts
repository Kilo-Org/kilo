// kilocode_change - new file
import { Auth } from "@/auth"
import { CodebaseSearchTypes } from "./types"

/**
 * Embedding provider implementations for codebase search
 * Supports OpenAI, Mistral, and Ollama (local) embedding providers
 */
export namespace CodebaseSearchEmbeddings {
  /**
   * Map embed model name to provider and model ID
   */
  export function getProvider(model: string): CodebaseSearchTypes.EmbeddingProvider {
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

    // Default to OpenAI
    return { provider: "openai", modelId: "text-embedding-3-small" }
  }

  /**
   * Generate embedding using OpenAI
   */
  export async function generateOpenAI(
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
    const [firstResult] = data?.data || []
    const { embedding } = firstResult || {}
    if (!embedding) {
      throw new Error("OpenAI returned no embedding data")
    }
    return embedding
  }

  /**
   * Generate embedding using Mistral
   */
  export async function generateMistral(
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

  /**
   * Generate embedding using Ollama (local)
   */
  export async function generateOllama(text: string, model = "nomic-embed-text"): Promise<number[]> {
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

  /**
   * Auth map type for provider credentials
   */
  type AuthMap = Map<string, { type: string; access?: string; key?: string } | undefined>

  /**
   * Generate embedding using the configured provider
   */
  export async function generate(text: string, embedModel: string, authMap: AuthMap): Promise<number[]> {
    const { provider, modelId } = getProvider(embedModel)

    if (provider === "openai") {
      const openaiAuth = authMap.get("openai")
      if (!openaiAuth) {
        throw new Error("OpenAI API key not found. Please configure openai provider in auth settings.")
      }
      const apiKey = openaiAuth.type === "oauth" ? openaiAuth.access : openaiAuth.key
      if (!apiKey) {
        throw new Error("OpenAI API key not found in auth configuration.")
      }
      return generateOpenAI(text, apiKey, modelId)
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
      return generateMistral(text, apiKey, modelId)
    }

    if (provider === "ollama") {
      return generateOllama(text, modelId)
    }

    throw new Error(`Unsupported embedding provider: ${provider}. Supported providers: openai, mistral, ollama`)
  }

  /**
   * Build auth map from stored auth credentials
   */
  export async function buildAuthMap(): Promise<AuthMap> {
    const authMap: AuthMap = new Map()

    const openaiAuth = await Auth.get("openai")
    const mistralAuth = await Auth.get("mistral")

    if (openaiAuth) authMap.set("openai", openaiAuth)
    if (mistralAuth) authMap.set("mistral", mistralAuth)

    return authMap
  }
}
