# Provider Configuration & Switching

**GitHub Issue:** [#175](https://github.com/Kilo-Org/kilo/issues/175)
**Priority:** P1
**Status:** ✅ Done

## Description

Configure a provider and switch between configured providers. Providers are the AI model backends (e.g., Anthropic, OpenAI, Kilo Gateway, etc.).

## Requirements

- List configured providers
- Add/edit/remove provider configurations (API keys, endpoints, etc.)
- Switch between providers
- Show provider status (connected, error, etc.)
- Provider configuration persists across sessions
- Accessible from settings UI and/or quick-switch in chat

## Current State

Provider data infrastructure is in place. [`provider.tsx`](../../webview-ui/src/context/provider.tsx) context fetches and exposes provider data, connected providers, defaults, and model lists. This powers the [`ModelSelector.tsx`](../../webview-ui/src/components/chat/ModelSelector.tsx) component.

`ProvidersTab` now includes:

- Provider catalog with connected/disconnected status
- Per-provider connect/disconnect actions (OAuth connect + auth removal)
- In-tab lightweight provider diagnostics showing latest connect/disconnect outcome per provider (status message + relative timestamp)
- Custom provider configuration form (add/edit/remove provider entries, API key, base URL, optional models JSON)
- Default/small model selection and provider allow/deny lists

## Gaps

- None for migration-plan parity scope.
