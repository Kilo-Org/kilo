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

15-tab settings shell exists, migrated to kilo-ui `Tabs` component. [`BrowserTab`](../../webview-ui/src/components/settings/BrowserTab.tsx) has real settings controls (enable/disable, system Chrome, headless toggles using kilo-ui `Switch`). [`LanguageTab`](../../webview-ui/src/components/settings/LanguageTab.tsx) has a working locale selector using kilo-ui `Select`. The remaining 13 tabs are still stubs.

## Gaps

- All tabs are stubs — no actual form controls or settings values
- No settings read/write integration with CLI backend
- No settings validation
- Need to determine which CLI endpoints expose/accept configuration
- No import/export settings functionality
