import { Component, For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { PermissionLevel } from "../../types/messages"

const TOOLS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "skill",
  "lsp",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "codesearch",
  "external_directory",
  "doom_loop",
] as const

const SAFE_TOOLS = ["read", "list", "glob", "grep", "todoread", "webfetch", "codesearch"] as const

interface LevelOption {
  value: PermissionLevel
  label: string
}

interface DurationOption {
  value: number
  label: string
}

interface ScopeOption {
  value: string
  label: string
  tools: readonly string[]
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
]

const TEMP_DURATION_OPTIONS: DurationOption[] = [
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
]

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: "Read file contents",
  edit: "Edit or create files",
  glob: "Find files by pattern",
  grep: "Search file contents",
  list: "List directory contents",
  bash: "Execute shell commands",
  task: "Create sub-agent tasks",
  skill: "Execute skills",
  lsp: "Language server operations",
  todoread: "Read todo lists",
  todowrite: "Write todo lists",
  webfetch: "Fetch web pages",
  websearch: "Search the web",
  codesearch: "Search codebase",
  external_directory: "Access files outside workspace",
  doom_loop: "Continue after repeated failures",
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: "editScope", label: "Edit Scope", tools: ["edit", "todowrite", "task", "skill"] },
  { value: "shellScope", label: "Shell Scope", tools: ["bash"] },
  { value: "networkScope", label: "Network Scope", tools: ["webfetch", "websearch", "codesearch"] },
  { value: "filesystemScope", label: "Filesystem Scope", tools: ["read", "list", "glob", "grep", "external_directory"] },
]

const AutoApproveTab: Component = () => {
  const language = useLanguage()
  const { config, updateConfig } = useConfig()
  const [tempMinutes, setTempMinutes] = createSignal(15)
  const [tempScope, setTempScope] = createSignal(SCOPE_OPTIONS[0].value)
  const [tempUntil, setTempUntil] = createSignal<number | null>(null)
  const [tempPreviousLevels, setTempPreviousLevels] = createSignal<Record<string, PermissionLevel>>({})
  const [now, setNow] = createSignal(Date.now())
  let countdownTimer: ReturnType<typeof setInterval> | undefined

  const permissions = createMemo(() => config().permission ?? {})
  const activeTempScope = createMemo(() => SCOPE_OPTIONS.find((scope) => scope.value === tempScope()) ?? SCOPE_OPTIONS[0])

  const getLevel = (tool: string): PermissionLevel => {
    return permissions()[tool] ?? permissions()["*"] ?? "ask"
  }

  const setPermission = (tool: string, level: PermissionLevel) => {
    updateConfig({
      permission: { ...permissions(), [tool]: level },
    })
  }

  const setScopePermissions = (scopeTools: readonly string[], level: PermissionLevel) => {
    const next = { ...permissions() } as Record<string, PermissionLevel>
    for (const tool of scopeTools) {
      next[tool] = level
    }
    updateConfig({ permission: next })
  }

  const setAll = (level: PermissionLevel) => {
    const updated: Record<string, PermissionLevel> = {}
    for (const tool of TOOLS) {
      updated[tool] = level
    }
    updated["*"] = level
    updateConfig({ permission: updated as Record<string, PermissionLevel> })
  }

  const setSafePreset = () => {
    const updated: Record<string, PermissionLevel> = { "*": "ask" }
    for (const tool of TOOLS) {
      updated[tool] = SAFE_TOOLS.includes(tool as (typeof SAFE_TOOLS)[number]) ? "allow" : "ask"
    }
    updateConfig({ permission: updated as Record<string, PermissionLevel> })
  }

  const remainingMs = createMemo(() => {
    const until = tempUntil()
    if (!until) return 0
    return Math.max(0, until - now())
  })

  const remainingLabel = createMemo(() => {
    const totalSeconds = Math.ceil(remainingMs() / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  })

  const stopTemporaryAutoApprove = () => {
    const previous = tempPreviousLevels()
    const current = permissions()
    const previousEntries = Object.entries(previous)
    if (previousEntries.length > 0) {
      const restored = { ...current } as Record<string, PermissionLevel>
      for (const [tool, level] of previousEntries) {
        restored[tool] = level
      }
      updateConfig({
        permission: restored,
      })
    }
    setTempUntil(null)
    setTempPreviousLevels({})
  }

  const startTemporaryAutoApprove = () => {
    const durationMs = tempMinutes() * 60_000
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return
    }
    const scope = activeTempScope()
    const previous: Record<string, PermissionLevel> = {}
    for (const tool of scope.tools) {
      previous[tool] = getLevel(tool)
    }
    setTempPreviousLevels(previous)
    setTempUntil(Date.now() + durationMs)
    const nextPermissions = { ...permissions() } as Record<string, PermissionLevel>
    for (const tool of scope.tools) {
      nextPermissions[tool] = "allow"
    }
    updateConfig({
      permission: nextPermissions,
    })
  }

  createEffect(() => {
    const until = tempUntil()
    if (!until) {
      if (countdownTimer) {
        clearInterval(countdownTimer)
        countdownTimer = undefined
      }
      return
    }

    if (!countdownTimer) {
      setNow(Date.now())
      countdownTimer = setInterval(() => setNow(Date.now()), 1_000)
    }

    if (now() >= until) {
      stopTemporaryAutoApprove()
    }
  })

  onCleanup(() => {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  })

  return (
    <div data-component="auto-approve-settings">
      {/* Presets */}
      <Card>
        <div style={{ "font-weight": "600", "margin-bottom": "8px" }}>{language.t("settings.permissions.title")}</div>
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <Tooltip value="Allow low-risk tools and keep sensitive tools in ask mode" placement="top">
            <Button size="small" variant="secondary" onClick={setSafePreset}>
              Safe defaults
            </Button>
          </Tooltip>
          <Tooltip value="Allow all configured tools without prompts" placement="top">
            <Button size="small" variant="secondary" onClick={() => setAll("allow")}>
              Full auto
            </Button>
          </Tooltip>
          <Tooltip value="Require approval prompts for all tools" placement="top">
            <Button size="small" variant="secondary" onClick={() => setAll("ask")}>
              Require prompts
            </Button>
          </Tooltip>
        </div>
      </Card>

      <div style={{ "margin-top": "12px" }} />

      <Card>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <div style={{ "font-weight": "600" }}>Temporary scoped auto-approval</div>
          <div style={{ "font-size": "11px", color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
            Allow a selected scope of tools for a limited time window, then automatically restore previous levels.
          </div>
          <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
            <Select
              options={SCOPE_OPTIONS}
              current={SCOPE_OPTIONS.find((option) => option.value === tempScope())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && setTempScope(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <Select
              options={TEMP_DURATION_OPTIONS}
              current={TEMP_DURATION_OPTIONS.find((option) => option.value === tempMinutes())}
              value={(option) => String(option.value)}
              label={(option) => option.label}
              onSelect={(option) => option && setTempMinutes(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <Tooltip value="Start temporary scoped auto-approval" placement="top">
              <Button size="small" variant="secondary" onClick={startTemporaryAutoApprove} disabled={tempUntil() !== null}>
                Start window
              </Button>
            </Tooltip>
            <Tooltip value="Stop and restore previous edit permission" placement="top">
              <Button size="small" variant="ghost" onClick={stopTemporaryAutoApprove} disabled={tempUntil() === null}>
                Stop
              </Button>
            </Tooltip>
            <div style={{ "font-size": "11px", "font-variant-numeric": "tabular-nums" }}>
              <strong>Status:</strong> {tempUntil() ? `active (${remainingLabel()} left)` : "off"}
            </div>
          </div>
          <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
            Scope tools: {activeTempScope().tools.join(", ")}
          </div>
        </div>
      </Card>

      <div style={{ "margin-top": "12px" }} />

      <Card>
        <div style={{ "font-weight": "600", "margin-bottom": "8px" }}>Grouped scope controls</div>
        <For each={SCOPE_OPTIONS}>
          {(scope, index) => (
            <div
              data-slot="settings-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 0",
                "border-bottom": index() < SCOPE_OPTIONS.length - 1 ? "1px solid var(--border-weak-base)" : "none",
                gap: "10px",
              }}
            >
              <div style={{ flex: 1, "min-width": 0 }}>
                <div style={{ "font-size": "12px", "font-weight": "500" }}>{scope.label}</div>
                <div style={{ "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
                  {scope.tools.join(", ")}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <Button size="small" variant="ghost" onClick={() => setScopePermissions(scope.tools, "allow")}>
                  Allow
                </Button>
                <Button size="small" variant="ghost" onClick={() => setScopePermissions(scope.tools, "ask")}>
                  Ask
                </Button>
                <Button size="small" variant="ghost" onClick={() => setScopePermissions(scope.tools, "deny")}>
                  Deny
                </Button>
              </div>
            </div>
          )}
        </For>
      </Card>

      <div style={{ "margin-top": "12px" }} />

      {/* Set All control */}
      <Card>
        <div
          data-slot="settings-row"
          style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "8px 0" }}
        >
          <span style={{ "font-weight": "600" }}>Set all permissions</span>
          <Select
            options={LEVEL_OPTIONS}
            value={(o) => o.value}
            label={(o) =>
              o.value === "allow"
                ? language.t("settings.permissions.action.allow")
                : o.value === "ask"
                  ? language.t("settings.permissions.action.ask")
                  : language.t("settings.permissions.action.deny")
            }
            onSelect={(option) => option && setAll(option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            placeholder="Choose…"
          />
        </div>
      </Card>

      <div style={{ "margin-top": "12px" }} />

      {/* Tool permission list */}
      <Card>
        <div
          data-slot="settings-row"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "8px 0",
            "border-bottom": "1px solid var(--border-weak-base)",
          }}
        >
          <div style={{ flex: 1, "min-width": 0 }}>
            <div
              style={{
                "font-family": "var(--vscode-editor-font-family, monospace)",
                "font-size": "12px",
              }}
            >
              *
            </div>
            <div
              style={{
                "font-size": "11px",
                color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                "margin-top": "2px",
              }}
            >
              Default level for tools without explicit rule
            </div>
          </div>
          <Select
            options={LEVEL_OPTIONS}
            current={LEVEL_OPTIONS.find((o) => o.value === (permissions()["*"] ?? "ask"))}
            value={(o) => o.value}
            label={(o) =>
              o.value === "allow"
                ? language.t("settings.permissions.action.allow")
                : o.value === "ask"
                  ? language.t("settings.permissions.action.ask")
                  : language.t("settings.permissions.action.deny")
            }
            onSelect={(option) => option && setPermission("*", option.value)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </div>
        <For each={[...TOOLS]}>
          {(tool, index) => (
            <div
              data-slot="settings-row"
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "space-between",
                padding: "8px 0",
                "border-bottom": index() < TOOLS.length - 1 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ flex: 1, "min-width": 0 }}>
                <div
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "12px",
                  }}
                >
                  {language.t(`settings.permissions.tool.${tool}.title`)}
                </div>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    "margin-top": "2px",
                  }}
                >
                  {language.t(`settings.permissions.tool.${tool}.description`) || TOOL_DESCRIPTIONS[tool] || tool}
                </div>
              </div>
              <Select
                options={LEVEL_OPTIONS}
                current={LEVEL_OPTIONS.find((o) => o.value === getLevel(tool))}
                value={(o) => o.value}
                label={(o) =>
                  o.value === "allow"
                    ? language.t("settings.permissions.action.allow")
                    : o.value === "ask"
                      ? language.t("settings.permissions.action.ask")
                      : language.t("settings.permissions.action.deny")
                }
                onSelect={(option) => option && setPermission(tool, option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </div>
          )}
        </For>
      </Card>
    </div>
  )
}

export default AutoApproveTab
