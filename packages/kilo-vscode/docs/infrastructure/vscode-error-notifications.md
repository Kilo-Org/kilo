# VSCode Error Notifications for Critical Failures

**Priority:** P1
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

Critical errors (CLI binary not found, server startup failure, connection lost) are only shown inside the webview. If the webview is not visible or hasn't loaded, users get no feedback. Platform-native error notifications should be used for critical failures.

## Requirements

- Show `vscode.window.showErrorMessage()` when CLI binary is missing
- Show `vscode.window.showErrorMessage()` when server fails to start
- Show `vscode.window.showWarningMessage()` when SSE connection is lost (with "Retry" action)
- Avoid notification spam — throttle or deduplicate repeated errors

## Current State

All errors are posted to the webview as `{ type: "error" }` messages. No `vscode.window.showErrorMessage()` or `vscode.window.showWarningMessage()` calls exist in the extension host.

The CLI binary check at [`ServerManager.startServer()`](../../src/services/cli-backend/server-manager.ts:52) throws an error string that is caught in [`KiloProvider.initializeConnection()`](../../src/KiloProvider.ts:261) and sent to the webview only.

## Gaps

- No `vscode.window.showErrorMessage()` for server startup failures
- No `vscode.window.showWarningMessage()` for connection loss
- No actionable notifications (e.g., "Retry" button)
- Users may miss errors if webview is collapsed or not focused

## Implementation Notes

```typescript
// In initializeConnection() catch block:
vscode.window.showErrorMessage(`Kilo Code: Failed to start CLI server — ${error.message}`, "Retry").then((action) => {
  if (action === "Retry") this.initializeConnection()
})
```

Files to change:

- [`src/KiloProvider.ts`](../../src/KiloProvider.ts) — add `vscode.window.showErrorMessage()` calls in error paths
- [`src/services/cli-backend/connection-service.ts`](../../src/services/cli-backend/connection-service.ts) — optionally surface critical errors to callers
