# Kilo Gateway Support

**GitHub Issue:** [#176](https://github.com/Kilo-Org/kilo/issues/176)
**Priority:** P0
**Status:** 🔨 Partial (In progress)

## Description

Support for using the Kilo Gateway — Kilo's cloud-hosted model proxy that provides access to AI models through Kilo's infrastructure.

## Requirements

1. Model used should be the default model for Kilo Gateway
2. Login should be based on whatever user is logged into the CLI at the time (until such time as we support logging in via the extension)
3. Kilo Gateway should appear as a provider option
4. Should work seamlessly with the Kilo authentication flow

## Current State

Auth flow works ([`DeviceAuthCard.tsx`](../../webview-ui/src/components/DeviceAuthCard.tsx)), profile/balance display exists ([`ProfileView.tsx`](../../webview-ui/src/components/ProfileView.tsx)). The CLI backend handles Kilo Gateway connections.

## Gaps

- No explicit Kilo Gateway provider selection in the UI
- No default model selection for Kilo Gateway
- Need to verify CLI-side Kilo Gateway integration is complete
- Need to ensure auth token is passed correctly to CLI for gateway access
- Related to [Provider Configuration](provider-configuration.md) and [Model Switcher](model-switcher.md)
