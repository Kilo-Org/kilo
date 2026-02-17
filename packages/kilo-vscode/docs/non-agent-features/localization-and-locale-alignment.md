# Localization & locale alignment (Kilo Code ↔ Kilo CLI)

## Implementation Status

**Status: ✅ Complete**

The localization system is fully implemented:

- [`language.tsx`](../../webview-ui/src/context/language.tsx) provides the i18n context with three-layer dict merging (app + kilo-ui + kilo-i18n)
- 16 locale files in [`webview-ui/src/i18n/`](../../webview-ui/src/i18n/): ar, br, bs, da, de, en, es, fr, ja, ko, no, pl, ru, th, zh, zht
- Locale auto-detection: user override → VS Code language → browser default
- [`LanguageTab`](../../webview-ui/src/components/settings/LanguageTab.tsx) provides a working locale selector in settings
- Template interpolation support for dynamic values

## Goal

During the Kilo CLI backend migration, we must keep **UI translations** and **server-facing locale identifiers** consistent.

This document defines the locale set we will support post-migration and the mapping rules we must apply when the Kilo Code extension calls the Kilo CLI server.

## Current state

### Kilo Code locales (today)

Kilo Code currently ships a broader locale set in both:

- `src/i18n/locales/`
- `webview-ui/src/i18n/locales/`

Locales:

`ar, ca, cs, de, en, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-CN, zh-TW`

### Kilo CLI locales (today)

Kilo CLI ships translations as TypeScript dictionaries in:

- `../../kilo/packages/ui/src/i18n/`
- `../../kilo/packages/app/src/i18n/`

Locales (filenames):

`ar, br, da, de, en, es, fr, ja, ko, no, pl, ru, zh, zht`

## Decision

We will **stick to whatever Kilo CLI currently has** as the supported locale set and **remove Kilo-only locales**.

Practical implications:

1. **Supported locales (post-migration)** are exactly:

   `ar, br, da, de, en, es, fr, ja, ko, no, pl, ru, zh, zht`

2. The extension and webview must **not** claim/offer locales that Kilo CLI cannot represent.

3. When the extension calls the Kilo CLI server, it must **normalize** any locale into this supported set (or fall back to `en`).

## Locale code mapping (compatibility layer)

Some Kilo Code locale identifiers represent the same language but use different codes than Kilo CLI.

Mapping rules (when constructing Kilo CLI-facing locale values):

| Kilo Code locale | Kilo CLI locale | Notes                |
| ---------------- | --------------- | -------------------- |
| `pt-BR`          | `br`            | Brazilian Portuguese |
| `zh-CN`          | `zh`            | Simplified Chinese   |
| `zh-TW`          | `zht`           | Traditional Chinese  |

All other supported locales map 1:1 (e.g. `de → de`, `fr → fr`).

## Fallback rules

When the user’s VS Code UI locale is not supported by Kilo CLI (e.g. `nl`, `it`, `tr`, `vi`, …):

1. The extension/webview should fall back to **English UI** (`en`).
2. Server calls must use `en` as the Kilo CLI locale.

## Migration plan requirements

### Required changes (must-do)

- Remove Kilo-only locale assets from:
  - `src/i18n/locales/`
  - `webview-ui/src/i18n/locales/`
- Add a single locale normalization function in the Kilo CLI adapter layer (extension host) to ensure:
  - consistent mapping (`pt-BR → br`, `zh-CN → zh`, `zh-TW → zht`)
  - deterministic fallback to `en`
- Ensure all Kilo CLI-facing requests/events that depend on locale use the normalized locale.

### Tests / validation

- Unit tests for locale normalization:
  - direct pass-through for supported locales
  - the 3 explicit mappings above
  - fallback behavior for unsupported locales (e.g. `nl → en`)

### Phase placement

- **Phase 0**: confirm where/how Kilo CLI expects locale input (header, query param, config, etc.) and document the adapter contract.
- **Phase 2 (MVP chat)**: implement locale normalization for all server interactions used by chat.
- **Before Phase 4**: remove Kilo-only locale assets so UI, marketing, and behavior match the Kilo CLI-backed reality.
