# Connection State UI (Loading / Error / Reconnecting)

**Priority:** P0
**Status:** ✅ Done
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

The chat view renders regardless of connection state. When the extension is connecting, reconnecting, or in an error state, users see an empty chat with no feedback. The UI should show appropriate loading spinners, error messages, and retry options.

## Requirements

- Show a loading spinner with "Connecting to Kilo..." when connection state is `"connecting"`
- Show a reconnecting indicator when connection state is `"reconnecting"` (depends on [SSE Auto-Reconnect](../infrastructure/sse-auto-reconnect.md))
- Show an error panel with message and "Retry" button when connection state is `"error"`
- Show an initializing state while server is starting
- Only render the chat interface when connection state is `"connected"`

## Current State

Implemented:

- [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx:1) gates chat/history rendering by `useServer().connectionState()`
- [`webview-ui/src/components/LoadingPanel.tsx`](../../webview-ui/src/components/LoadingPanel.tsx:1) renders connecting/initializing/reconnecting states
- [`webview-ui/src/components/ErrorPanel.tsx`](../../webview-ui/src/components/ErrorPanel.tsx:1) renders error/disconnected with retry callback
- [`webview-ui/src/context/server.tsx`](../../webview-ui/src/context/server.tsx:1) tracks `connecting | connected | reconnecting | disconnected | error` and exposes `retryConnection()`

## Implementation Notes

```tsx
// In App.tsx or ChatView.tsx:
<Switch fallback={<ChatInterface />}>
  <Match when={server.connectionState() === "connecting"}>
    <LoadingPanel message="Connecting to Kilo..." />
  </Match>
  <Match when={server.connectionState() === "reconnecting"}>
    <LoadingPanel message="Reconnecting..." showSpinner />
  </Match>
  <Match when={server.connectionState() === "error"}>
    <ErrorPanel message={server.error()} onRetry={() => reconnect()} />
  </Match>
</Switch>
```

Files to change:

- [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx) or [`webview-ui/src/components/chat/ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx) — add connection state gating
- New file `webview-ui/src/components/LoadingPanel.tsx` — loading spinner component
- New file `webview-ui/src/components/ErrorPanel.tsx` — error display with retry
- [`webview-ui/src/styles/chat.css`](../../webview-ui/src/styles/chat.css) — styles for loading/error states
