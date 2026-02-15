# Settings UI

**GitHub Issue:** [#170](https://github.com/Kilo-Org/kilo/issues/170)
**Priority:** P1
**Status:** 🔨 Partial

## Description

Replicate the settings that are available in OpenCode (CLI) and allow users to customize them through the VS Code extension UI.

## Requirements

- Settings UI that mirrors OpenCode's configuration options
- Organized into logical tabs/sections
- Settings persist and sync with CLI configuration
- Changes take effect immediately or with clear save/apply semantics
- Include all major setting categories: providers, models, behaviour, display, etc.

## Current State

15-tab settings shell exists, migrated to kilo-ui `Tabs` component. Multiple tabs now have working controls and backend persistence, including:

- [`ProvidersTab`](../../webview-ui/src/components/settings/ProvidersTab.tsx) (model defaults and provider allow/deny lists)
- [`AgentBehaviourTab`](../../webview-ui/src/components/settings/AgentBehaviourTab.tsx) (default agent + per-agent behavior + skills, instructions, and custom commands)
- [`AutoApproveTab`](../../webview-ui/src/components/settings/AutoApproveTab.tsx) (tool permission levels + presets)
- [`BrowserTab`](../../webview-ui/src/components/settings/BrowserTab.tsx) (browser automation toggles)
- [`CheckpointsTab`](../../webview-ui/src/components/settings/CheckpointsTab.tsx) (snapshot toggle)
- [`DisplayTab`](../../webview-ui/src/components/settings/DisplayTab.tsx), [`AutocompleteTab`](../../webview-ui/src/components/settings/AutocompleteTab.tsx), [`NotificationsTab`](../../webview-ui/src/components/settings/NotificationsTab.tsx), [`ContextTab`](../../webview-ui/src/components/settings/ContextTab.tsx), [`TerminalTab`](../../webview-ui/src/components/settings/TerminalTab.tsx), [`ExperimentalTab`](../../webview-ui/src/components/settings/ExperimentalTab.tsx), [`LanguageTab`](../../webview-ui/src/components/settings/LanguageTab.tsx), [`PromptsTab`](../../webview-ui/src/components/settings/PromptsTab.tsx), and [`AboutKiloCodeTab`](../../webview-ui/src/components/settings/AboutKiloCodeTab.tsx).

## Gaps

- Need to determine which CLI endpoints expose/accept configuration

## Recent Improvements

- Added centralized settings validation in extension host (`src/services/settings/validation.ts`) for:
  - config patch updates (`updateConfig`)
  - VS Code-backed settings updates (`updateSetting`)
  - autocomplete settings updates (`updateAutocompleteSetting`)
- Invalid updates are now rejected with explicit validation error messages and webview rollback/re-sync behavior.
- Added settings import/export controls (`AboutKiloCodeTab`) for JSON backup/restore workflows.
- Added MCP server management UI in Agent Behaviour settings (add/update/remove + connect/disconnect + status refresh).
- Added rules/workflows file management in Agent Behaviour settings (local/global list, create, open, delete, and per-file enable toggles).
- Added VS Code setting for commit-message diff filtering (`kilo-code.new.git.commitMessageExcludeGlobs`).
- Added VS Code settings for code-action prompt templates (`kilo-code.new.codeActions.explainTemplate`, `fixTemplate`, `improveTemplate`).
