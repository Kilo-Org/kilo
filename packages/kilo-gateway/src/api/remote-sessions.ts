import { KILO_API_BASE } from "./constants.js"

export interface RemoteSessionInfo {
  session_id: string
  title: string
  created_at: string
  updated_at: string
  git_url: string | null
  organization_id: string | null
  last_mode: string | null
  last_model: string | null
  cloud_agent_session_id: string | null
}

type TrpcEnvelope<T> = {
  result?: {
    data?: T
  }
}

type CliSessionsListResult = {
  cliSessions?: RemoteSessionInfo[]
}

type CliSessionWithBlobResult = {
  ui_messages_blob_url?: string | null
}

async function trpcGet<T>(
  procedure: string,
  input: Record<string, unknown>,
  token: string,
  organizationId?: string,
): Promise<T> {
  const url = new URL(`${KILO_API_BASE}/api/trpc/${procedure}`)
  url.searchParams.set("input", JSON.stringify(input))

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
  if (organizationId) {
    headers["x-kilocode-organizationid"] = organizationId
  }

  const response = await fetch(url, { method: "GET", headers })
  if (!response.ok) {
    throw new Error(`tRPC ${procedure} failed: ${response.status}`)
  }

  const payload = (await response.json()) as TrpcEnvelope<T>
  if (!payload.result || payload.result.data === undefined) {
    throw new Error(`tRPC ${procedure} returned invalid payload`)
  }
  return payload.result.data
}

export async function fetchRemoteSessions(
  token: string,
  limit = 50,
  organizationId?: string,
): Promise<RemoteSessionInfo[]> {
  const data = await trpcGet<CliSessionsListResult>("cliSessions.list", { limit }, token, organizationId)
  return Array.isArray(data.cliSessions) ? data.cliSessions : []
}

export async function fetchRemoteSessionMessages(
  token: string,
  sessionId: string,
  organizationId?: string,
): Promise<unknown[]> {
  const data = await trpcGet<CliSessionWithBlobResult>(
    "cliSessions.get",
    { session_id: sessionId, include_blob_urls: true },
    token,
    organizationId,
  )

  const blobUrl = data.ui_messages_blob_url
  if (!blobUrl) {
    return []
  }

  const response = await fetch(blobUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch remote session messages: ${response.status}`)
  }

  const payload = (await response.json()) as unknown
  return Array.isArray(payload) ? payload : []
}
