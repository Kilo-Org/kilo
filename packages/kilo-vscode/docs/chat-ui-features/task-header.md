# Task Header

**GitHub Issue:** [#166](https://github.com/Kilo-Org/kilo/issues/166)
**Priority:** P0
**Status:** ✅ Complete

## Description

A task header displayed at the top of the chat session that provides key context about the current task.

## Requirements

- Display the initial prompt/task description
- Show cost so far (token usage / monetary cost)
- Show context size (tokens in context window)
- Include a button to manually trigger context compaction
- Update in real-time as the task progresses

## Current State

[`TaskHeader.tsx`](../../webview-ui/src/components/chat/TaskHeader.tsx) implements the task header with session title, cost display (formatted USD), context token usage with percentage bar, and a compact button with tooltip. Uses kilo-ui `IconButton` and `Tooltip`. Integrated into [`ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx).

## Gaps

- No task header component
- No cost tracking displayed in the UI (cost data may be available from CLI)
- No context size indicator
- No context compaction trigger (CLI may support this via an endpoint)
- Need to determine what SSE events or HTTP endpoints provide cost/context data
