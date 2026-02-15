# Rules & Workflows

**GitHub Issue:** [#173](https://github.com/Kilo-Org/kilo/issues/173)
**Priority:** P3
**Status:** 🔨 Partial

## Description

Support for rules and workflows. Rules define constraints and guidelines for the AI agent. Workflows define multi-step automated processes.

## Requirements

- View and manage rules (project-level, user-level, global)
- Create/edit/delete rules via the extension UI
- View and manage workflows
- Rules are applied to agent sessions automatically
- UI for browsing `.kilocode/rules/` and similar rule sources

## Current State

Basic rules/workflows management now exists in the Agent Behaviour > Rules subtab:
- Lists workspace/global `.kilocode/rules` files
- Lists workspace/global `.kilocode/workflows` files
- Supports create/open/delete file actions
- Supports per-file enable/disable toggles (persisted in extension state)

The CLI backend still owns runtime behavior; extension currently focuses on discovery and file lifecycle.

## Gaps

- No dedicated workflow execution UI
- Limited metadata beyond enabled/disabled state
- No advanced templates, sharing, or validation flows yet
- Related to [Custom Commands](custom-command-system.md) and [Skills System](skills-system.md)
