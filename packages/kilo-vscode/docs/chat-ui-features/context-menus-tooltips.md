# Context Menus & Tooltips

Right-click/context actions and tooltip affordances throughout the chat UI.

## Status

🔨 Partial

## Location

- [`webview-ui/src/components/common/ContextMenu.tsx`](../../webview-ui/src/components/common/ContextMenu.tsx:1)
- Various `StandardTooltip` usage

## Interactions

- Hover tooltips with explanatory text for all interactive buttons
- Context actions via right-click or dedicated menu buttons

## Current Progress

- Chat message rows now support right-click context actions (copy message, open markdown preview)
- Recent session quick-resume entries now have hover tooltips
- Scroll-to-bottom chat control now has hover tooltip
- Todo panel completed-items toggle now has hover tooltip

## Remaining Gaps

- Full audit to ensure all interactive buttons across chat/history/settings have tooltips
- Add/standardize context actions in additional surfaces where parity expects them

## Suggested migration

**Reimplement?** No (UI-only).

- These are presentation-layer affordances; backend migration does not affect them.
- Kilo CLI has similar tooltip infrastructure in its UI package ([`packages/ui/src/components/tooltip.tsx`](https://github.com/Kilo-Org/kilo/blob/main/packages/ui/src/components/tooltip.tsx:1)), but Kilo can keep its current tooltip + context menu components.
