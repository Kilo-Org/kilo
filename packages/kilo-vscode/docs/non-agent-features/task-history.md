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

- [`SessionList.tsx`](../../webview-ui/src/components/history/SessionList.tsx) — now uses kilo-ui `List` component with keyboard navigation and fuzzy search; lists sessions with relative dates, duration/cost/model pills, and diff summary metadata
- [`session.tsx`](../../webview-ui/src/context/session.tsx) — create, list, select, load messages
- Extension host now caches normalized session history snapshots in global state and serves that cache when the CLI backend is temporarily unavailable.

## Gaps

- Need deeper verification of CLI-backed persistence behavior across multi-workspace and long-retention scenarios
