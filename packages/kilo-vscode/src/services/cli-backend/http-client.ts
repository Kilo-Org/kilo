import type {
  ServerConfig,
  SessionInfo,
  MessageInfo,
  MessagePart,
  AgentInfo,
  ProfileData,
  ProviderAuthAuthorization,
  ProviderListResponse,
  McpStatus,
  McpConfig,
} from "./types"

/**
 * HTTP Client for communicating with the CLI backend server.
 * Handles all REST API calls for session management, messaging, and permissions.
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly authUsername = "opencode"

  constructor(config: ServerConfig) {
    this.baseUrl = config.baseUrl
    // Auth header format: Basic base64("opencode:password")
    // NOTE: The CLI server expects a non-empty username ("opencode"). Using an empty username
    // (":password") results in 401 for both REST and SSE endpoints.
    this.authHeader = `Basic ${Buffer.from(`${this.authUsername}:${config.password}`).toString("base64")}`

    // Safe debug logging: no secrets.
    console.log("[Kilo New] HTTP: 🔐 Auth configured", {
      username: this.authUsername,
      passwordLength: config.password.length,
    })
  }

  /**
   * Make an HTTP request to the CLI backend server.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { directory?: string; allowEmpty?: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    }

    if (options?.directory) {
      headers["x-opencode-directory"] = options.directory
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    // Read the raw response first so we can produce useful errors when JSON is empty/truncated.
    const rawText = await response.text()

    // Non-2xx: try to extract an error message from JSON, otherwise fall back to raw text.
    if (!response.ok) {
      let errorMessage = response.statusText
      if (rawText.trim().length > 0) {
        try {
          const errorJson = JSON.parse(rawText) as { error?: string; message?: string }
          errorMessage = errorJson.error || errorJson.message || errorMessage
        } catch {
          errorMessage = rawText
        }
      }

      console.error("[Kilo New] HTTP: ❌ Request failed", {
        method,
        path,
        status: response.status,
        errorMessage,
      })

      throw new Error(`HTTP ${response.status}: ${errorMessage}`)
    }

    // 2xx but empty body: return undefined (cast to T). Some endpoints like
    // POST /session/{id}/message can return 200 with no body; results arrive via SSE.
    if (rawText.trim().length === 0) {
      if (options?.allowEmpty) {
        return undefined as T
      }

      console.error("[Kilo New] HTTP: ❌ Empty response body", {
        method,
        path,
        status: response.status,
      })
      throw new Error(`HTTP ${response.status}: Empty response body`)
    }

    try {
      return JSON.parse(rawText) as T
    } catch (error) {
      console.error("[Kilo New] HTTP: ❌ Invalid JSON response", {
        method,
        path,
        status: response.status,
        rawSnippet: rawText.slice(0, 400),
      })
      throw error
    }
  }

  // ============================================
  // Session Management Methods
  // ============================================

  /**
   * Create a new session in the specified directory.
   */
  async createSession(directory: string): Promise<SessionInfo> {
    return this.request<SessionInfo>("POST", "/session", {}, { directory })
  }

  /**
   * Get information about an existing session.
   */
  async getSession(sessionId: string, directory: string): Promise<SessionInfo> {
    return this.request<SessionInfo>("GET", `/session/${sessionId}`, undefined, { directory })
  }

  /**
   * List all sessions in the specified directory.
   */
  async listSessions(directory: string): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>("GET", "/session", undefined, { directory })
  }

  /**
   * Delete a session permanently.
   */
  async deleteSession(sessionId: string, directory: string): Promise<void> {
    await this.request<void>("DELETE", `/session/${sessionId}`, undefined, { directory, allowEmpty: true })
  }

  /**
   * Update a session (e.g. rename its title).
   */
  async updateSession(sessionId: string, updates: { title?: string }, directory: string): Promise<SessionInfo> {
    return this.request<SessionInfo>("PATCH", `/session/${sessionId}`, updates, { directory })
  }

  // ============================================
  // Provider Methods
  // ============================================

  /**
   * List all providers with their models, connection status, and defaults.
   */
  async listProviders(directory: string): Promise<ProviderListResponse> {
    return this.request<ProviderListResponse>("GET", "/provider", undefined, { directory })
  }

  // ============================================
  // Agent/Mode Methods
  // ============================================

  /**
   * List all available agents (modes) from the CLI backend.
   */
  async listAgents(directory: string): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>("GET", "/agent", undefined, { directory })
  }

  // ============================================
  // Messaging Methods
  // ============================================

  /**
   * Send a message to a session.
   */
  async sendMessage(
    sessionId: string,
    parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }>,
    directory: string,
    options?: { providerID?: string; modelID?: string; agent?: string },
  ): Promise<void> {
    const body: Record<string, unknown> = { parts }
    if (options?.providerID && options?.modelID) {
      // Backend expects model selection as a nested object: { model: { providerID, modelID } }
      body.model = { providerID: options.providerID, modelID: options.modelID }
    }
    if (options?.agent) {
      body.agent = options.agent
    }

    await this.request<void>("POST", `/session/${sessionId}/message`, body, { directory, allowEmpty: true })
  }

  /**
   * Get all messages for a session.
   */
  async getMessages(sessionId: string, directory: string): Promise<Array<{ info: MessageInfo; parts: MessagePart[] }>> {
    return this.request<Array<{ info: MessageInfo; parts: MessagePart[] }>>(
      "GET",
      `/session/${sessionId}/message`,
      undefined,
      { directory },
    )
  }

  // ============================================
  // Control Methods
  // ============================================

  /**
   * Abort the current operation in a session.
   */
  async abortSession(sessionId: string, directory: string): Promise<boolean> {
    await this.request<void>("POST", `/session/${sessionId}/abort`, {}, { directory, allowEmpty: true })
    return true
  }

  /**
   * Trigger context compaction (summarization) for a session.
   */
  async summarize(sessionId: string, providerID: string, modelID: string, directory: string): Promise<boolean> {
    return this.request<boolean>(
      "POST",
      `/session/${sessionId}/summarize`,
      { providerID, modelID, auto: false },
      { directory, allowEmpty: true },
    )
  }

  // ============================================
  // Question Methods
  // ============================================

  /**
   * Reply to a question request with user answers.
   */
  async replyToQuestion(requestID: string, answers: string[][], directory: string): Promise<void> {
    await this.request<void>("POST", `/question/${requestID}/reply`, { answers }, { directory, allowEmpty: true })
  }

  /**
   * Reject (dismiss) a question request.
   */
  async rejectQuestion(requestID: string, directory: string): Promise<void> {
    await this.request<void>("POST", `/question/${requestID}/reject`, {}, { directory, allowEmpty: true })
  }

  // ============================================
  // Permission Methods
  // ============================================

  /**
   * Respond to a permission request.
   */
  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
    directory: string,
  ): Promise<boolean> {
    await this.request<void>(
      "POST",
      `/session/${sessionId}/permissions/${permissionId}`,
      { response },
      { directory, allowEmpty: true },
    )
    return true
  }

  // ============================================
  // Profile Methods
  // ============================================

  /**
   * Get the current user's profile from the kilo-gateway.
   * Returns null if not logged in or if the request fails.
   */
  async getProfile(): Promise<ProfileData | null> {
    try {
      return await this.request<ProfileData>("GET", "/kilo/profile")
    } catch {
      return null
    }
  }

  // ============================================
  // Auth Methods
  // ============================================

  /**
   * Remove authentication credentials for a provider.
   * Used for logout when called with "kilo".
   */
  async removeAuth(providerId: string): Promise<boolean> {
    return this.request<boolean>("DELETE", `/auth/${providerId}`)
  }

  /**
   * Initiate OAuth authorization for a provider.
   * Returns the authorization URL and instructions.
   */
  async oauthAuthorize(providerId: string, method: number, directory: string): Promise<ProviderAuthAuthorization> {
    return this.request<ProviderAuthAuthorization>(
      "POST",
      `/provider/${providerId}/oauth/authorize`,
      { method },
      { directory },
    )
  }

  /**
   * Complete OAuth callback for a provider.
   * For "auto" method providers (like kilo), this blocks until polling completes.
   */
  async oauthCallback(providerId: string, method: number, directory: string): Promise<boolean> {
    return this.request<boolean>("POST", `/provider/${providerId}/oauth/callback`, { method }, { directory })
  }

  // ============================================
  // MCP Methods
  // ============================================

  /**
   * Get the status of all MCP servers.
   */
  async getMcpStatus(): Promise<Record<string, McpStatus>> {
    return this.request<Record<string, McpStatus>>("GET", "/mcp")
  }

  /**
   * Add or update an MCP server configuration.
   */
  async addMcpServer(name: string, config: McpConfig): Promise<Record<string, McpStatus>> {
    return this.request<Record<string, McpStatus>>("POST", "/mcp", { name, config })
  }

  /**
   * Connect an MCP server by name.
   */
  async connectMcpServer(name: string): Promise<boolean> {
    return this.request<boolean>("POST", `/mcp/${encodeURIComponent(name)}/connect`)
  }

  /**
   * Disconnect an MCP server by name.
   */
  async disconnectMcpServer(name: string): Promise<boolean> {
    return this.request<boolean>("POST", `/mcp/${encodeURIComponent(name)}/disconnect`)
  }
}
