// Session types from @kilocode/cli
export interface SessionInfo {
  id: string
  title: string
  directory: string
  parentID?: string
  share?: string
  time: {
    created: number
    updated: number
    archived?: number
  }
}

// Session status from SessionStatus.Info
export type SessionStatusInfo =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" }

// Token usage shape returned by the server on assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Message types from MessageV2
export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  // Present on assistant messages
  cost?: number
  tokens?: TokenUsage
}

// Part types - simplified for UI display
export type MessagePart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; tool: string; state: ToolState }
  | { type: "reasoning"; id: string; text: string }

export type ToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
  | { status: "error"; input: Record<string, unknown>; error: string }

// Permission request from PermissionNext.Request
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

// SSE Event types - based on BusEvent definitions
export type SSEEvent =
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties: Record<string, never> }
  | { type: "session.created"; properties: { info: SessionInfo } }
  | { type: "session.updated"; properties: { info: SessionInfo } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatusInfo } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "message.updated"; properties: { info: MessageInfo } }
  | { type: "message.part.updated"; properties: { part: MessagePart; delta?: string } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | {
      type: "permission.replied"
      properties: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | { type: "todo.updated"; properties: { sessionID: string; items: TodoItem[] } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied"; properties: { sessionID: string; requestID: string; answers: string[][] } }
  | { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

// Question types from Question module
export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

// Agent/mode info from the CLI /agent endpoint
export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
}

// Provider/model types from provider catalog

// Model definition from provider catalog
export interface ProviderModel {
  id: string
  name: string
  inputPrice?: number
  outputPrice?: number
  contextLength?: number
  releaseDate?: string
  latest?: boolean
  // Actual shape returned by the server (Provider.Model)
  limit?: { context: number; input?: number; output: number }
}

// Provider definition
export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

// Response from provider list endpoint
export interface ProviderListResponse {
  all: Record<string, Provider>
  connected: string[]
  default: Record<string, string> // providerID → default modelID
}

// Model selection (providerID + modelID pair)
export interface ModelSelection {
  providerID: string
  modelID: string
}

// Server connection config
export interface ServerConfig {
  baseUrl: string
  password: string
}

// Provider OAuth types
export interface ProviderAuthAuthorization {
  url: string
  method: "auto" | "code"
  instructions: string
}

// Profile types from kilo-gateway
export interface KilocodeOrganization {
  id: string
  name: string
  role: string
}

export interface KilocodeProfile {
  email: string
  name?: string
  organizations?: KilocodeOrganization[]
}

export interface KilocodeBalance {
  balance: number
}

export interface ProfileData {
  profile: KilocodeProfile
  balance: KilocodeBalance | null
  currentOrgId: string | null
}

// MCP server status — discriminated union returned by the backend
export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

// MCP server configuration for local (stdio) servers
export interface McpLocalConfig {
  type: "local"
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

// MCP server configuration for remote (SSE) servers
export interface McpRemoteConfig {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  timeout?: number
}

// Union of all MCP server config types
export type McpConfig = McpLocalConfig | McpRemoteConfig
