# Task History

**GitHub Issue:** [#167](https://github.com/Kilo-Org/kilo/issues/167)
**Priority:** P1
**Status:** 🔨 Partial

## Description

Persist tasks so that users can continue prior tasks. This includes browsing past tasks, resuming them, and maintaining task state across extension restarts.

## Requirements

- List of past tasks with their initial prompts and timestamps
- Ability to resume/continue a prior task
- Task state persists across VS Code restarts
- Task list is searchable/filterable
- Display task metadata (cost, duration, model used)

## Current State

Basic session history exists:

- [`SessionList.tsx`](../../webview-ui/src/components/history/SessionList.tsx) — now uses kilo-ui `List` component with keyboard navigation and fuzzy search; lists sessions with relative dates
- [`session.tsx`](../../webview-ui/src/context/session.tsx) — create, list, select, load messages

## Gaps

- Session list may not persist across restarts (depends on CLI session storage)
- No search/filter on session history
- No task metadata display (cost, duration, model)
- No confirmation before deleting task history
- Need to verify CLI session persistence behaviour
