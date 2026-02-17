# Markdown Rendering

**Priority:** P0
**Status:** ✅ Complete
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md), [GitHub Issue #161](https://github.com/Kilo-Org/kilo/issues/161)

## Description

Assistant messages render as plain text. No markdown parsing, no syntax highlighting in code blocks, no clickable links, no formatted lists. This is a major UX gap — all AI assistant responses that contain code, links, or structured content are unreadable.

## Requirements

- Parse and render markdown in assistant text parts
- Syntax highlighting for fenced code blocks (language-aware)
- Render inline code, bold, italic, links, lists, tables
- Streaming optimization: avoid re-parsing entire markdown on every text delta
- Only re-parse when structural changes occur (e.g., new code block opened/closed)
- Sanitize HTML output to prevent XSS in the webview

## Current State

Message.tsx delegates rendering to kilo-ui's `<KiloMessage>` component which internally handles Markdown via `<MarkedProvider>`. Syntax highlighting is provided by shiki (bundled via kilo-ui). All assistant messages render as rich markdown with code blocks, links, lists, etc.

## Gaps

- No markdown parser (e.g., `marked`, `markdown-it`)
- No syntax highlighter (e.g., `highlight.js`, `shiki`)
- No streaming-aware markdown rendering
- No HTML sanitization
- Related to [Code Block Interactions](code-block-interactions.md) which adds copy/expand on top of rendered code blocks
- Related to [Kilo Themed Chat Session](kilo-themed-chat-session.md)

## Implementation Notes

The JetBrains plugin optimizes streaming by tracking code block count:

````typescript
const newCodeBlockCount = (newText.match(/```/g) || []).length
if (newCodeBlockCount !== lastCodeBlockCount) {
  // Structure changed — full re-parse
  setHtml(marked.parse(newText))
} else {
  // Append to last text node (fast path)
  appendToLastTextNode(delta)
}
````

For the initial implementation, a simpler approach works:

1. Use `marked` or `markdown-it` for parsing
2. Use `highlight.js` for syntax highlighting
3. Debounce re-render during streaming (e.g., 50ms)
4. Use `innerHTML` with CSP nonce for rendered HTML

Files to change:

- [`webview-ui/src/components/chat/Message.tsx`](../../webview-ui/src/components/chat/Message.tsx) — replace `TextPartView` with markdown renderer
- New file `webview-ui/src/components/chat/MarkdownRenderer.tsx` — markdown rendering component
- [`webview-ui/src/styles/chat.css`](../../webview-ui/src/styles/chat.css) — markdown and syntax highlighting styles
- `package.json` — add `marked` and `highlight.js` (or alternatives) as dependencies
