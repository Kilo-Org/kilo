# Mode Switcher

**GitHub Issue:** [#162](https://github.com/Kilo-Org/kilo/issues/162)
**Priority:** P2
**Status:** ✅ Complete

## Description

Users should be able to switch between modes (e.g., Code, Architect, Ask, Debug, etc.).

## Requirements

- Display available modes
- Allow switching between modes during a session
- Show the currently active mode
- Mode affects how the AI agent behaves (different system prompts, tool access, file restrictions)
- Accessible from the chat UI (e.g., dropdown or button group)

## Current State

[`ModeSwitcher.tsx`](../../webview-ui/src/components/chat/ModeSwitcher.tsx) implements a popover-based agent/mode selector listing all available agents with descriptions. Selection is persisted via `session.selectAgent()`. Integrated into [`PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx). Agent data is fetched via the `listAgents` HTTP endpoint and `AgentsLoadedMessage`.

## Gaps

- No mode list UI component
- No mode selection mechanism in the webview
- Need to determine CLI endpoints for listing modes and switching active mode
- Need to communicate mode restrictions (e.g., file patterns, available tools) to the UI
