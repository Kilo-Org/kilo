# VSCode Error Notifications for Critical Failures

**Priority:** P1
**Status:** ✅ Done
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

Critical errors (CLI binary not found, server startup failure, connection lost) are only shown inside the webview. If the webview is not visible or hasn't loaded, users get no feedback. Platform-native error notifications should be used for critical failures.

## Requirements

- Show `vscode.window.showErrorMessage()` when CLI binary is missing
- Show `vscode.window.showErrorMessage()` when server fails to start
- Show `vscode.window.showWarningMessage()` when SSE connection is lost (with "Retry" action)
- Avoid notification spam — throttle or deduplicate repeated errors

## Current State

Critical failure paths now surface native VS Code notifications with retry affordances and dedupe guardrails:

- [`src/KiloProvider.ts`](../../src/KiloProvider.ts:1) sends `showErrorMessage` / `showWarningMessage` for startup/connection failures
- Notifications include retry actions where applicable
- Duplicate notification spam is throttled by extension-side deduping logic

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
