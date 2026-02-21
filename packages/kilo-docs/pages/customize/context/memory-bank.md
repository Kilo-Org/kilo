---
title: "Memory Bank (Deprecated)"
description: "Migrate legacy Memory Bank content to AGENTS.md"
---

# Memory Bank (Deprecated)

Memory Bank has been deprecated in Kilo Code in favor of `AGENTS.md`.

If you already have Memory Bank content, it may still work in some clients, but `AGENTS.md` is now the recommended and portable source of truth.

## Why Migrate to AGENTS.md

- Works across tools (Kilo Code, Cursor, Windsurf, and other `AGENTS.md`-compatible tools)
- Lives at project root and is easy to version with your code
- Replaces legacy Memory Bank status behavior that is not guaranteed in all clients/modes

## Migration Steps

1. Locate your existing Memory Bank notes in one of these legacy locations:
   - `.kilocode/rules/memory-bank/`
   - `.kilocode/memory-bank/`
2. Create or open `AGENTS.md` in your project root.
3. Copy the rules and project context you still want into clearly named sections in `AGENTS.md`.
4. Keep mode-specific rules in `.kilocode/rules/` when needed, and put cross-tool guidance in `AGENTS.md`.
5. Remove or archive old Memory Bank files after validating the new behavior.

## Suggested AGENTS.md Structure

```markdown
# Project Overview
- What this repo does

## Coding Standards
- Language/style conventions

## Architecture
- Key boundaries and patterns

## Testing
- Required commands and coverage expectations

## Constraints
- Security, performance, and deployment requirements
```

## Related Docs

- [agents.md](/docs/customize/agents-md)
- [Custom Rules](/docs/customize/custom-rules)
- [Migrating from Cursor or Windsurf](/docs/getting-started/migrating)
