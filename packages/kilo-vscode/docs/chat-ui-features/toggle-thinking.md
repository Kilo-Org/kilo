# Toggle Thinking

**GitHub Issue:** [#172](https://github.com/Kilo-Org/kilo/issues/172)
**Priority:** P2
**Status:** 🔨 Partial (linked [PR #127](https://github.com/Kilo-Org/kilo/pull/127))

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

Prompt input now includes a "Thinking" cycle control in [`PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx:1) that:

- Detects model variants from provider metadata
- Cycles variant (`off → variant1 → variant2 ...`) for the currently selected agent
- Persists choice by updating `config.agent[agentName].variant`
- Uses friendly variant labels when provider metadata exposes `label` / `name` / `title` / `displayName` (falls back to formatted key names)

## Gaps

- UX still uses cycle behavior; no dedicated dropdown or explicit per-model variant picker
- Need end-to-end validation across providers to confirm which variants map to “thinking on/off” semantics
