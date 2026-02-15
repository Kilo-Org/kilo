# Repository Initialization

**GitHub Issue:** [#174](https://github.com/Kilo-Org/kilo/issues/174)
**Priority:** P3
**Status:** ✅ Done

## Description

Support for the `/init` command — initialize a repository for agentic engineering. This sets up the project with appropriate configuration files, rules, and conventions for working with Kilo Code.

## Requirements

- Command or button to initialize a repository
- Creates appropriate configuration files (e.g., AGENTS.md, .kilocode/ directory)
- Detects existing project structure and tailors initialization
- May scaffold rules, workflows, or skill configurations
- Should be accessible from VS Code command palette and/or chat UI

## Current State

Initialization is available in the extension via `kilo-code.new.initializeRepository`:

- Command palette trigger opens initialization profile picker (standard/web app/library/backend service)
- Runs `/init` in a freshly created session with progress notifications
- Navigates/focuses the new chat session once initialization starts

## Gaps

- None for migration-plan parity scope
