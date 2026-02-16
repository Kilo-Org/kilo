import type { KiloConnectionService } from "../cli-backend"

export interface EnhancePromptRequestMessage {
  type: "enhancePrompt"
  text?: string
}

export interface EnhancedPromptResponseSender {
  postMessage(message: { type: "enhancedPrompt"; text?: string }): void
}

const ENHANCE_PROMPT_PREFIX = `You rewrite user prompts to be clearer, more specific, and more actionable.
Return only the rewritten prompt text.
Do not include markdown formatting, code fences, bullet points, explanations, or surrounding quotes.

Original prompt:
`

const ENHANCE_PROMPT_SUFFIX = `

Rewritten prompt:
`

const ENHANCE_MAX_TOKENS = 384
const ENHANCE_TEMPERATURE = 0.3

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value
  }
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === `"` && last === `"`) || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim()
  }
  return value
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("```")) {
    return trimmed
  }
  const noStart = trimmed.replace(/^```[^\n]*\n?/, "")
  return noStart.replace(/```$/, "").trim()
}

function cleanEnhancedPrompt(raw: string): string {
  let cleaned = stripCodeFence(raw)
  cleaned = cleaned.replace(/^rewritten prompt:\s*/i, "").trim()
  cleaned = stripWrappingQuotes(cleaned)
  return cleaned.trim()
}

/**
 * Handles prompt enhancement requests from the webview by calling the backend FIM endpoint.
 */
export async function handleEnhancePromptRequest(
  message: EnhancePromptRequestMessage,
  responseSender: EnhancedPromptResponseSender,
  connectionService: KiloConnectionService,
): Promise<void> {
  const input = message.text?.trim()
  if (!input) {
    responseSender.postMessage({ type: "enhancedPrompt" })
    return
  }

  try {
    const state = connectionService.getConnectionState()
    if (state !== "connected") {
      throw new Error(`CLI backend is not connected (state: ${state})`)
    }

    const client = connectionService.getHttpClient()
    let enhanced = ""

    await client.fimCompletion(
      `${ENHANCE_PROMPT_PREFIX}${input}${ENHANCE_PROMPT_SUFFIX}`,
      "",
      (chunk) => {
        enhanced += chunk
      },
      {
        maxTokens: ENHANCE_MAX_TOKENS,
        temperature: ENHANCE_TEMPERATURE,
      },
    )

    const cleaned = cleanEnhancedPrompt(enhanced)
    if (!cleaned) {
      throw new Error("Empty enhanced prompt")
    }

    responseSender.postMessage({ type: "enhancedPrompt", text: cleaned })
  } catch {
    responseSender.postMessage({ type: "enhancedPrompt" })
  }
}

