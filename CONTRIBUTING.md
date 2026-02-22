# Contributing to Kilo CLI

See [the Documentation for details on contributing](https://kilo.ai/docs/contributing).

## TL;DR

There are lots of ways to contribute to the project:

- **Code Contributions:** Implement new features or fix bugs
- **Documentation:** Improve existing docs or create new guides
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Kilo Community is [on Discord](https://kilo.ai/discord).

## Developing Kilo CLI

- **Requirements:** Bun 1.3+
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

### Running against a different directory

By default, `bun dev` runs Kilo CLI in the `packages/kilo-cli` directory. To run it against a different directory or repository:

```bash
bun dev <directory>
```

To run Kilo CLI in the root of the repo itself:

```bash
bun dev .
```

### Building a "local" binary

To compile a standalone executable:

```bash
./packages/kilo-cli/script/build.ts --single
```

Then run it with:

```bash
./packages/kilo-cli/dist/kilo-cli-<platform>/bin/kilo
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

### Understanding bun dev vs kilo

During development, `bun dev` is the local equivalent of the built `kilo` command. Both run the same CLI interface:

```bash
# Development (from project root)
bun dev --help           # Show all available commands
bun dev serve            # Start headless API server
bun dev web              # Start server + open web interface

# Production
kilo --help          # Show all available commands
kilo serve           # Start headless API server
kilo web             # Start server + open web interface
```

### Pull Request Expectations

- All PRs must reference an existing issue.
- UI changes must include screenshots or videos (before/after).
- Logic changes must explain how the change was verified.
- PR titles must follow conventional commit style (`feat:`, `fix:`, `docs:`, etc.).

## Issue First Policy

Every pull request must be tied to an existing issue. Include the issue number in the PR body using one of these keywords so GitHub auto-links it:

- `Fixes #123`
- `Closes #123`
- `Resolves #123`

If no issue exists yet, create one first.

## PR Titles

Use a conventional commit prefix in PR titles:

- `feat:` for a new feature
- `fix:` for a bug fix
- `docs:` for documentation-only changes
- `refactor:` for code restructuring without behavior change
- `test:` for tests
- `chore:` for maintenance tasks

Examples:

- `fix: add back button to profile view`
- `docs: add release asset selection guide`

## Issue Template Compliance (CLI and API)

GitHub Issue Forms enforce required fields in the web UI, but `gh issue create` and API-created issues can bypass that form validation. The compliance bot checks for required structure and may auto-close non-compliant issues after about 2 hours.

When creating issues from CLI/API, include the required headings and content exactly as below.

### Bug Report Required Fields

Required:

- `### Description` with a clear problem statement

Recommended (helps triage faster):

- `### Plugins`
- `### Kilo version`
- `### Steps to reproduce`
- `### Screenshot and/or share link`
- `### Operating System`
- `### Terminal`

CLI example:

```bash
cat > bug-issue.md <<'EOF'
### Description
The profile page has no back button, so users cannot return to chat.

### Plugins
None

### Kilo version
1.0.25

### Steps to reproduce
1. Open Kilo
2. Open Profile
3. Observe no back button

### Screenshot and/or share link
N/A

### Operating System
Windows 11

### Terminal
Windows Terminal
EOF

gh issue create --repo Kilo-Org/kilo --title "[BUG] Profile page missing back button" --body-file bug-issue.md
```

### Feature Request Required Fields

Required:

- `### Feature hasn't been suggested before.` with the verification checkbox line
- `### Describe the enhancement you want to request`

CLI example:

```bash
cat > feature-issue.md <<'EOF'
### Feature hasn't been suggested before.
- [x] I have verified this feature I'm about to request hasn't been suggested before.

### Describe the enhancement you want to request
Add release asset naming guidance to the README for new users.
EOF

gh issue create --repo Kilo-Org/kilo --title "[FEATURE]: Clarify release asset naming in README" --body-file feature-issue.md
```

### Question Required Fields

Required:

- `### Question`

CLI example:

```bash
cat > question-issue.md <<'EOF'
### Question
Is there a recommended way to run Kilo in CI with non-interactive approvals?
EOF

gh issue create --repo Kilo-Org/kilo --title "Question: CI mode recommendations" --body-file question-issue.md
```

### Style Preferences

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse.
- **Destructuring:** Avoid unnecessary destructuring.
- **Control flow:** Avoid `else` statements; prefer early returns.
- **Types:** Avoid `any`.
- **Variables:** Prefer `const`.
- **Naming:** Concise single-word identifiers when descriptive.
- **Runtime APIs:** Use Bun helpers (e.g., `Bun.file()`).
