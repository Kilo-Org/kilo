import { Component, For, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
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

interface LevelOption {
  value: PermissionLevel
  label: string
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
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

const AutoApproveTab: Component = () => {
  const { config, updateConfig } = useConfig()

  const permissions = createMemo(() => config().permission ?? {})

  const getLevel = (tool: string): PermissionLevel => {
    return permissions()[tool] ?? permissions()["*"] ?? "ask"
  }

  const setPermission = (tool: string, level: PermissionLevel) => {
    updateConfig({
      permission: { ...permissions(), [tool]: level },
    })
  }

  const setAll = (level: PermissionLevel) => {
    const updated: Record<string, PermissionLevel> = {}
    for (const tool of TOOLS) {
      updated[tool] = level
    }
    updateConfig({ permission: updated })
  }

  return (
    <div data-component="auto-approve-settings">
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
            label={(o) => o.label}
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
                  {tool}
                </div>
                <div
                  style={{
                    "font-size": "11px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                    "margin-top": "2px",
                  }}
                >
                  {TOOL_DESCRIPTIONS[tool] ?? tool}
                </div>
              </div>
              <Select
                options={LEVEL_OPTIONS}
                current={LEVEL_OPTIONS.find((o) => o.value === getLevel(tool))}
                value={(o) => o.value}
                label={(o) => o.label}
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
