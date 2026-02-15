# Cloud Task Support

**GitHub Issue:** [#168](https://github.com/Kilo-Org/kilo/issues/168)
**Priority:** P2
**Status:** 🔨 Partial

## Description

Support for persisting tasks to the Kilo cloud, and restoring sessions that were saved to the Kilo cloud but started on other devices or clients.

## Requirements

- Save task state to Kilo cloud storage
- Restore/resume tasks that were started on other devices or clients
- Sync task history across devices
- Handle conflict resolution when tasks are modified on multiple devices
- Require Kilo authentication for cloud features

## Current State

Partial cloud continuation support exists through Agent Manager:

- Cloud session listing via backend remote session APIs
- Workspace-scoped filtering by git URL
- "Resume Local" flow that starts a local continuation session from cloud transcript context

True task persistence/sync remains local-first via CLI session storage.

## Gaps

- No full bidirectional cloud task sync infrastructure
- No conflict resolution strategy
- No dedicated cloud task history UI outside Agent Manager
- Depends on [Task History](task-history.md) being implemented first
- Depends on [Authentication](authentication-organization-enterprise-enforcement.md) for Kilo cloud access
