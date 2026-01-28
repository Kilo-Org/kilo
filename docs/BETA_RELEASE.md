# Beta Release

## How to Release

1. Go to **GitHub Actions** → **publish-beta**
2. Click **Run workflow**
3. Optionally enter a version (e.g., `1.2.0-beta.1`)
4. Click **Run workflow**

The workflow builds all platform binaries, publishes to npm with `@beta` tag, and creates a GitHub pre-release.

## How Users Install

```bash
npm install -g @kilocode/cli@beta
```

## Files

- `.github/workflows/publish-beta.yml` - GitHub Actions workflow
- `packages/opencode/script/pack-beta.ts` - Beta pack script
- `packages/opencode/NPM_README.md` - npm package README

## Notes

- Beta releases use the `@beta` npm tag (won't auto-update stable users)
- Requires `NPM_TOKEN` secret in GitHub
- Version format: `0.0.0-beta-{timestamp}` (auto) or `1.2.0-beta.1` (manual)
