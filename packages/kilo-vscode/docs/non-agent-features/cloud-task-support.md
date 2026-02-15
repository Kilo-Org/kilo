# Cloud Task Support

**GitHub Issue:** [#168](https://github.com/Kilo-Org/kilo/issues/168)
**Priority:** P2
**Status:** ✅ Done

## Description

Support for persisting tasks to the Kilo cloud, and restoring sessions that were saved to the Kilo cloud but started on other devices or clients.

## Requirements

- Save task state to Kilo cloud storage
- Restore/resume tasks that were started on other devices or clients
- Sync task history across devices
- Handle conflict resolution when tasks are modified on multiple devices
- Require Kilo authentication for cloud features

## Current State

Cloud task support is implemented for currently exposed backend APIs through Agent Manager:

- Cloud session listing via backend remote session APIs
- Workspace-scoped filtering by git URL
- "Resume Local" continuation flow from cloud transcript context
- Organization-aware cloud access via existing authentication/policy checks

## Gaps

- None for migration-plan parity scope. Full cross-device bidirectional sync/conflict resolution remains backend roadmap work.
