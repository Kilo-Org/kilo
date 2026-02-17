# Settings Migration Plan: Desktop App → VSCode Extension

## Overview

The desktop app (`packages/app`) has settings spread across four tabs:

- **General** — appearance, notifications, sounds, updates, linux display
- **Shortcuts** — keybinds (not applicable to VSCode — handled by VS Code keybindings)
- **Providers** — connect/disconnect providers, custom providers
- **Models** — toggle model visibility per provider

Additionally, backend `Config` (persisted by the CLI server) controls agent behavior, permissions, MCP, commands, and experimental flags. The app's **Permissions** component (`settings-permissions.tsx`) manages per-tool permission levels (allow/ask/deny) via `globalSync.updateConfig({ permission: … })`.

This document maps every setting to an extension tab and describes the implementation path.

---

## 1. Backend Config Settings (via `PATCH /config`)

These are server-side settings stored in the opencode config file. All reads use `GET /config` (with optional `?directory=`), all writes use `PATCH /config` (merges the partial `Config` object).

### 1.1 Mapping to Extension Tabs

| Backend Config Field                 | Type                             | Extension Tab                         | Notes                                                                                                                                            |
| ------------------------------------ | -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `permission`                         | `PermissionConfig`               | **Auto Approve**                      | Per-tool allow/ask/deny — matches app's `settings-permissions.tsx`                                                                               |
| `permission.<tool>`                  | `allow \| ask \| deny`           | **Auto Approve**                      | Tools: read, edit, glob, grep, list, bash, task, skill, lsp, todoread, todowrite, webfetch, websearch, codesearch, external_directory, doom_loop |
| `model`                              | `string`                         | **Providers**                         | Default model (format: `provider/model`)                                                                                                         |
| `small_model`                        | `string`                         | **Providers**                         | Small model for title generation etc.                                                                                                            |
| `default_agent`                      | `string`                         | **Agent Behaviour**                   | Default agent when none specified                                                                                                                |
| `agent`                              | `Record<string, AgentConfig>`    | **Agent Behaviour**                   | Per-agent config (model, prompt, temperature, etc.)                                                                                              |
| `agent.<name>.model`                 | `string`                         | **Agent Behaviour** (Agents subtab)   | Override model per agent                                                                                                                         |
| `agent.<name>.prompt`                | `string`                         | **Agent Behaviour** (Agents subtab)   | Custom system prompt per agent                                                                                                                   |
| `agent.<name>.temperature`           | `number`                         | **Agent Behaviour** (Agents subtab)   | Temperature override                                                                                                                             |
| `agent.<name>.top_p`                 | `number`                         | **Agent Behaviour** (Agents subtab)   | Top-p override                                                                                                                                   |
| `agent.<name>.steps`                 | `number`                         | **Agent Behaviour** (Agents subtab)   | Max agentic iterations                                                                                                                           |
| `agent.<name>.permission`            | `PermissionConfig`               | **Agent Behaviour** (Agents subtab)   | Per-agent permission overrides                                                                                                                   |
| `provider`                           | `Record<string, ProviderConfig>` | **Providers**                         | Custom provider configuration                                                                                                                    |
| `disabled_providers`                 | `string[]`                       | **Providers**                         | Providers to disable                                                                                                                             |
| `enabled_providers`                  | `string[]`                       | **Providers**                         | Exclusive provider allowlist                                                                                                                     |
| `mcp`                                | `Record<string, McpConfig>`      | **Agent Behaviour** (MCP subtab)      | MCP server configurations                                                                                                                        |
| `command`                            | `Record<string, CommandConfig>`  | **Agent Behaviour** (Commands subtab) | Custom commands                                                                                                                                  |
| `instructions`                       | `string[]`                       | **Prompts**                           | Additional instruction file paths                                                                                                                |
| `skills.paths`                       | `string[]`                       | **Agent Behaviour** (Skills subtab)   | Additional skill folder paths                                                                                                                    |
| `skills.urls`                        | `string[]`                       | **Agent Behaviour** (Skills subtab)   | Skill URLs                                                                                                                                       |
| `snapshot`                           | `boolean`                        | **Checkpoints**                       | Enable/disable snapshots                                                                                                                         |
| `share`                              | `manual \| auto \| disabled`     | **Experimental**                      | Sharing behavior                                                                                                                                 |
| `username`                           | `string`                         | **Display**                           | Custom username in conversations                                                                                                                 |
| `watcher.ignore`                     | `string[]`                       | **Context**                           | File watcher ignore patterns                                                                                                                     |
| `formatter`                          | `false \| Record<…>`             | **Experimental**                      | Formatter configuration                                                                                                                          |
| `lsp`                                | `false \| Record<…>`             | **Experimental**                      | LSP configuration                                                                                                                                |
| `compaction.auto`                    | `boolean`                        | **Agent Behaviour**                   | Auto-compaction when context is full                                                                                                             |
| `compaction.prune`                   | `boolean`                        | **Agent Behaviour**                   | Prune old tool outputs                                                                                                                           |
| `tools`                              | `Record<string, boolean>`        | **Experimental**                      | Enable/disable specific tools globally                                                                                                           |
| `layout`                             | `auto \| stretch`                | **Display**                           | Layout mode                                                                                                                                      |
| `experimental.disable_paste_summary` | `boolean`                        | **Experimental**                      | Disable paste summary                                                                                                                            |
| `experimental.batch_tool`            | `boolean`                        | **Experimental**                      | Enable batch tool                                                                                                                                |
| `experimental.primary_tools`         | `string[]`                       | **Experimental**                      | Primary-agent-only tools                                                                                                                         |
| `experimental.continue_loop_on_deny` | `boolean`                        | **Experimental**                      | Continue on permission deny                                                                                                                      |
| `experimental.mcp_timeout`           | `number`                         | **Experimental**                      | MCP request timeout (ms)                                                                                                                         |

### 1.2 Desktop-Only / Not Applicable in VSCode

| Setting                                                 | Reason                                    |
| ------------------------------------------------------- | ----------------------------------------- |
| `theme`                                                 | VSCode owns theming                       |
| `keybinds`                                              | VSCode keybindings system                 |
| `tui.*` (scroll_speed, scroll_acceleration, diff_style) | TUI-specific                              |
| `server.*`                                              | Server managed by extension automatically |

---

## 2. Client-Side Settings (from `app/src/context/settings.tsx`)

These are persisted client-side in the app (localStorage). In the extension, the equivalent would be VS Code's `ExtensionContext.globalState` or webview-local storage.

| App Setting                 | Type      | Extension Tab     | Notes                                                                                             |
| --------------------------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `appearance.font`           | `string`  | **Display**       | Mono font selection — VSCode has its own font settings, could be skipped or kept for webview only |
| `appearance.fontSize`       | `number`  | **Display**       | Font size — same consideration as above                                                           |
| `notifications.agent`       | `boolean` | **Notifications** | Notify when agent completes                                                                       |
| `notifications.permissions` | `boolean` | **Notifications** | Notify on permission requests                                                                     |
| `notifications.errors`      | `boolean` | **Notifications** | Notify on errors                                                                                  |
| `sounds.agent`              | `string`  | **Notifications** | Sound on agent completion                                                                         |
| `sounds.permissions`        | `string`  | **Notifications** | Sound on permission request                                                                       |
| `sounds.errors`             | `string`  | **Notifications** | Sound on error                                                                                    |
| `general.releaseNotes`      | `boolean` | **Experimental**  | Show release notes                                                                                |
| `general.autoSave`          | `boolean` | N/A               | VSCode has its own auto-save                                                                      |
| `updates.startup`           | `boolean` | N/A               | VSCode handles extension updates                                                                  |

---

## 3. Provider & Model Settings (from app)

| Feature                         | Extension Tab | Backend API                                              | Notes                            |
| ------------------------------- | ------------- | -------------------------------------------------------- | -------------------------------- |
| List connected providers        | **Providers** | `GET /provider`                                          | Already implemented in extension |
| Connect provider (OAuth)        | **Providers** | `POST /provider/{id}/oauth/authorize` + `callback`       | Already implemented              |
| Disconnect provider             | **Providers** | `DELETE /auth/{id}` + config `disabled_providers` update | Already implemented              |
| Custom provider (OpenAI-compat) | **Providers** | `PATCH /config` with `provider` field                    | New                              |
| Toggle model visibility         | **Providers** | `PATCH /config` with model visibility config             | New                              |

---

## 4. Implementation Plan

### Phase 1: Infrastructure — Config Read/Write

1. **Add `getConfig()` to [`HttpClient`](src/services/cli-backend/http-client.ts)**

   ```typescript
   async getConfig(directory: string): Promise<Config> {
     return this.request<Config>("GET", "/config", undefined, { directory })
   }
   ```

2. **Add `updateConfig()` to [`HttpClient`](src/services/cli-backend/http-client.ts)**

   ```typescript
   async updateConfig(config: Partial<Config>, directory: string): Promise<Config> {
     return this.request<Config>("PATCH", "/config", config, { directory })
   }
   ```

3. **Add Config types to [`types.ts`](src/services/cli-backend/types.ts)**
   Import or re-define `Config`, `PermissionConfig`, `AgentConfig`, `ProviderConfig` etc. from the SDK types.

4. **Add cached config message pattern in [`KiloProvider`](src/KiloProvider.ts)**
   - `fetchAndSendConfig()` method
   - Handle `requestConfig` message from webview
   - Handle `updateConfig` message from webview (call `httpClient.updateConfig()`, then re-fetch and push)

5. **Add message types to [`messages.ts`](webview-ui/src/types/messages.ts)**
   - `ConfigLoadedMessage` (extension→webview)
   - `RequestConfigMessage` (webview→extension)
   - `UpdateConfigMessage` (webview→extension, carries partial Config)
   - `ConfigUpdatedMessage` (extension→webview, confirmation)

6. **Create config context in `webview-ui/src/context/config.tsx`**
   - Subscribe to `ConfigLoadedMessage`
   - Expose `config()` accessor and `updateConfig(partial)` method
   - `updateConfig` posts `UpdateConfigMessage` to extension, optimistically updates local state

### Phase 2: Populate Existing Tabs with Backend Settings

Each tab should read from the config context and call `updateConfig()` on change.

#### Auto Approve Tab

- Per-tool permission selects (allow/ask/deny) for all 16 tools
- Reference: [`settings-permissions.tsx`](../app/src/components/settings-permissions.tsx)

#### Agent Behaviour Tab

- Default agent selector (`config.default_agent`)
- Compaction settings (`config.compaction.auto`, `config.compaction.prune`)
- **Agents subtab**: Per-agent config — model override, prompt, temperature, top_p, max steps, per-agent permissions
- **MCP subtab**: MCP server configurations (`config.mcp`)
- **Commands subtab**: Custom commands (`config.command`)
- **Skills subtab**: Skill folder paths and URLs (`config.skills`)

#### Providers Tab

- Default model (`config.model`)
- Small model (`config.small_model`)
- Custom provider creation (`config.provider`)
- Provider enable/disable (`config.disabled_providers`, `config.enabled_providers`)
- Model visibility toggles (reference: [`settings-models.tsx`](../app/src/components/settings-models.tsx))

#### Prompts Tab

- Per-agent prompt (`config.agent.<name>.prompt`)
- Additional instructions (`config.instructions`)

#### Checkpoints Tab

- Snapshot toggle (`config.snapshot`)

#### Display Tab

- Username (`config.username`)
- Layout mode (`config.layout`)

#### Context Tab

- Watcher ignore patterns (`config.watcher.ignore`)

#### Notifications Tab

- Client-side notification toggles (agent, permissions, errors)
- Sound selection (agent, permissions, errors)
- These are client-side only; store in VS Code `globalState` or webview localStorage

#### Experimental Tab

- Share mode (`config.share`)
- Formatter config (`config.formatter`)
- LSP config (`config.lsp`)
- Tool toggles (`config.tools`)
- Remaining `config.experimental.*` flags

#### Language Tab

- Already implemented (client-side locale selection)

### Phase 3: Client-Side Settings

For notification and sound settings (not backed by the CLI server):

1. **Option A**: Store in VS Code `globalState` via extension messages (preferred — survives webview reloads)
2. **Option B**: Store in webview `localStorage` (simpler but resets on webview rebuild)

Recommended: Option A — add `SaveLocalSettingMessage` / `LocalSettingLoadedMessage` message types, persist via `context.globalState`.

---

## 5. Settings not relevant for VSCode extension

| Setting                                   | Reason                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `theme` / `colorScheme`                   | VS Code owns theming                                                          |
| `keybinds`                                | VS Code keybindings                                                           |
| `tui.*`                                   | TUI-only settings                                                             |
| `server.*`                                | Server lifecycle managed by extension                                         |
| `general.autoSave`                        | VS Code has native auto-save                                                  |
| `updates.startup`                         | VS Code handles extension updates                                             |
| `appearance.font` / `appearance.fontSize` | VS Code editor font settings (could optionally be kept for webview chat font) |
| Wayland display backend                   | Linux desktop app only                                                        |

---

## 6. Priority Order

1. **P0 — Permissions** (Auto Approve tab): Most impactful for daily use
2. **P0 — Default model/agent** (Providers + Agent Behaviour): Core workflow
3. **P1 — Agent config** (Agent Behaviour): model overrides, temperature, steps
4. **P1 — MCP servers** (Agent Behaviour subtab): Server configuration
5. **P1 — Notifications & sounds** (Notifications tab): User experience
6. **P2 — Prompts/instructions** (Prompts tab): Custom system prompts
7. **P2 — Compaction settings** (Agent Behaviour): Auto-compaction
8. **P2 — Checkpoints/snapshots** (Checkpoints tab): Snapshot toggle
9. **P3 — Display settings** (Display tab): Username, layout
10. **P3 — Context settings** (Context tab): Watcher ignore
11. **P3 — Experimental flags** (Experimental tab): All experimental.\* flags
12. **P3 — Custom providers** (Providers tab): OpenAI-compatible providers
13. **P3 — Model visibility** (Providers tab): Per-model show/hide
