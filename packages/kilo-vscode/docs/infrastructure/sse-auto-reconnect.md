# SSE Auto-Reconnect with Exponential Backoff

**Priority:** P0
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

The SSE connection to the CLI backend has no reconnect logic. If the connection drops (network hiccup, laptop sleep/wake, server restart), the extension goes dead with no recovery path. Users must manually reload the window.

## Requirements

- Auto-reconnect on SSE connection loss with exponential backoff
- Backoff starts at 2s, doubles on each failure, caps at 30s
- Reset backoff delay on successful reconnect
- Add `"reconnecting"` state to [`ConnectionState`](../../src/services/cli-backend/connection-service.ts:7)
- Surface reconnecting state in the webview UI (e.g., banner or status indicator)
- Clean up reconnect timer on intentional disconnect/dispose

## Current State

The [`SSEClient`](../../src/services/cli-backend/sse-client.ts:13) emits `"disconnected"` on error (line 78-83) and stops. No retry logic exists.

[`ConnectionState`](../../src/services/cli-backend/connection-service.ts:7) only supports `"connecting" | "connected" | "disconnected" | "error"` — no `"reconnecting"`.

The webview [`ConnectionState`](../../webview-ui/src/types/messages.ts:6) mirrors this.

## Gaps

- No reconnect logic in [`SSEClient`](../../src/services/cli-backend/sse-client.ts:13)
- No `"reconnecting"` connection state
- No webview UI for reconnecting state
- No backoff/retry timer management
- No cleanup of retry timers on dispose

## Implementation Notes

The JetBrains plugin implements exponential backoff reconnection (2s → 4s → 8s → … → 30s cap). The pattern:

```typescript
// In SSEClient
private reconnectDelay = 2000
private readonly maxReconnectDelay = 30000
private shouldReconnect = true

// On error: schedule reconnect
this.reconnectTimeout = setTimeout(() => {
  this.doConnect(directory)
}, this.reconnectDelay)
this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)

// On success: reset delay
this.reconnectDelay = 2000
```

Files to change:

- [`src/services/cli-backend/sse-client.ts`](../../src/services/cli-backend/sse-client.ts) — add reconnect logic
- [`src/services/cli-backend/connection-service.ts`](../../src/services/cli-backend/connection-service.ts) — add `"reconnecting"` to `ConnectionState`
- [`webview-ui/src/types/messages.ts`](../../webview-ui/src/types/messages.ts) — add `"reconnecting"` to webview `ConnectionState`
- [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx) — show reconnecting state in UI
