# Toggle Thinking

**GitHub Issue:** [#172](https://github.com/Kilo-Org/kilo/issues/172)
**Priority:** P2
**Status:** ✅ Done (linked [PR #127](https://github.com/Kilo-Org/kilo/pull/127))

## Description

Allow users to enable or disable "thinking" (extended reasoning) for models that support it.

## Requirements

- Toggle control to enable/disable thinking mode
- When thinking is enabled, model uses extended reasoning (e.g., Claude's extended thinking)
- When thinking is disabled, model responds without extended thinking
- Toggle should be accessible from the chat UI (e.g., in prompt input area or task header)
- Setting should persist across sessions

## Current State

Reasoning/thinking blocks render in the chat (collapsible sections in [`Message.tsx`](../../webview-ui/src/components/chat/Message.tsx)).

Prompt input now includes an explicit "Thinking" variant picker in [`PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx:1) that:

- Detects model variants from provider metadata
- Presents explicit per-variant options plus an `off` option for the currently selected agent
- Persists choice by updating `config.agent[agentName].variant`
- Uses friendly variant labels when provider metadata exposes `label` / `name` / `title` / `displayName` (falls back to formatted key names)

## Gaps

- None for migration-plan parity scope
