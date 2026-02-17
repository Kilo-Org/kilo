# HTTP Request Timeouts

**Priority:** P1
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Description

The HTTP client uses bare `fetch()` with no connect or request timeouts. A hung request (e.g., server is unresponsive but connection stays open) will block the caller indefinitely.

## Requirements

- Add configurable request timeout (default: 60s) using `AbortController`
- Add shorter connect timeout where possible (default: 10s)
- Timeout should abort the request cleanly and throw a descriptive error
- Ensure timeout cleanup on successful response (no leaked timers)

## Current State

[`HttpClient.request()`](../../src/services/cli-backend/http-client.ts:37) calls `fetch()` directly with no `AbortController` or timeout. The only timeout in the codebase is the 30s server startup timeout in [`ServerManager`](../../src/services/cli-backend/server-manager.ts:112).

## Gaps

- No `AbortController` usage in HTTP client
- No request timeout configuration
- No connect timeout
- Hung requests will block indefinitely

## Implementation Notes

The JetBrains plugin uses 10s connect timeout and 60s request timeout. Basic pattern:

```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 60_000)
try {
  const response = await fetch(url, { ...options, signal: controller.signal })
  // ...
} finally {
  clearTimeout(timeout)
}
```

Files to change:

- [`src/services/cli-backend/http-client.ts`](../../src/services/cli-backend/http-client.ts) — add `AbortController` with timeout to `request()`
