// kilocode_change - new file
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogToolCodebaseSearch, type CodebaseSearchConfig } from "./dialog-tool-codebase-search"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { modify, applyEdits, parse } from "jsonc-parser"
import { reconcile } from "solid-js/store"
import path from "path"
import fs from "fs/promises"

export type DialogToolProps = {
  onSelect?: (tool: string) => void
}

// Static list of tools available in the prompt menu
const TOOLS = [
  {
    name: "codebase_search",
    description: "Find files most relevant to the search query using semantic search",
  },
]

function getExistingConfig(sync: ReturnType<typeof useSync>): Partial<CodebaseSearchConfig> | null {
  const raw = (sync.data.config.provider as any)?.kilo?.options?.codebase_search
  if (!raw) return null

  const vectorDb = raw.vectorDb || {}
  return {
    embedModel: raw.embedModel,
    vectorDbType: vectorDb.type ?? "qdrant",
    qdrantUrl: vectorDb.type === "qdrant" ? (vectorDb.url ?? "") : "",
    lancedbPath: vectorDb.type === "lancedb" ? (vectorDb.path ?? "") : "",
    similarityThreshold: raw.similarityThreshold,
    maxResults: raw.maxResults,
  }
}

async function findConfigPath(sync: ReturnType<typeof useSync>): Promise<string> {
  const projectDir = sync.data.path.directory
  const globalConfigDir = sync.data.path.config

  // Priority: .opencode/opencode.jsonc > project/opencode.jsonc > global/opencode.jsonc
  const candidates = [
    projectDir && path.join(projectDir, ".opencode", "opencode.jsonc"),
    projectDir && path.join(projectDir, ".opencode", "opencode.json"),
    projectDir && path.join(projectDir, "opencode.jsonc"),
    projectDir && path.join(projectDir, "opencode.json"),
    globalConfigDir && path.join(globalConfigDir, "opencode.jsonc"),
    globalConfigDir && path.join(globalConfigDir, "opencode.json"),
  ].filter(Boolean) as string[]

  // Find first existing config
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }

  // No existing config - default to project's .opencode directory
  if (projectDir) {
    return path.join(projectDir, ".opencode", "opencode.jsonc")
  }

  // Fall back to global config
  if (globalConfigDir) {
    return path.join(globalConfigDir, "opencode.jsonc")
  }

  // Throw error instead of returning invalid path
  throw new Error("Could not determine config path: no project or global config directory available")
}

async function readConfigFromFile(sync: ReturnType<typeof useSync>): Promise<Partial<CodebaseSearchConfig> | null> {
  try {
    const configPath = await findConfigPath(sync)
    const file = Bun.file(configPath)
    if (!(await file.exists())) {
      return null
    }

    const text = await file.text()
    const config = parse(text) as any
    const raw = config?.provider?.kilo?.options?.codebase_search
    if (!raw) return null

    const vectorDb = raw.vectorDb || {}
    return {
      embedModel: raw.embedModel,
      vectorDbType: vectorDb.type ?? "qdrant",
      qdrantUrl: vectorDb.type === "qdrant" ? (vectorDb.url ?? "") : "",
      lancedbPath: vectorDb.type === "lancedb" ? (vectorDb.path ?? "") : "",
      similarityThreshold: raw.similarityThreshold,
      maxResults: raw.maxResults,
    }
  } catch {
    return null
  }
}

export function DialogTool(props: DialogToolProps) {
  const dialog = useDialog()
  const toast = useToast()
  const sync = useSync()
  const sdk = useSDK()
  dialog.setSize("large")

  async function saveCodebaseSearchConfig(config: CodebaseSearchConfig) {
    try {
      const configPath = await findConfigPath(sync)

      // Build the config object in the expected format
      const vectorDbConfig: any = {
        type: config.vectorDbType,
      }

      if (config.vectorDbType === "qdrant") {
        vectorDbConfig.url = config.qdrantUrl
      } else {
        vectorDbConfig.path = config.lancedbPath
      }

      const codebaseSearchConfig = {
        embedModel: config.embedModel,
        vectorDb: vectorDbConfig,
        similarityThreshold: config.similarityThreshold,
        maxResults: config.maxResults,
      }

      // Read existing config or create empty
      let text = "{}"
      const file = Bun.file(configPath)
      if (await file.exists()) {
        text = await file.text()
      }

      // Use jsonc-parser to modify while preserving comments
      const edits = modify(text, ["provider", "kilo", "options", "codebase_search"], codebaseSearchConfig, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
      const result = applyEdits(text, edits)

      // Ensure directory exists
      const dir = path.dirname(configPath)
      await fs.mkdir(dir, { recursive: true })

      // Write the config
      await Bun.write(configPath, result)

      // Invalidate server config cache and reload
      await sdk.client.config.reload()
      const configResponse = await sdk.client.config.get()
      if (configResponse.data) {
        sync.set("config", reconcile(configResponse.data))
      }

      toast.show({
        variant: "success",
        message: "Codebase search configuration saved to " + configPath,
        duration: 3000,
      })

      props.onSelect?.("codebase_search")
    } catch (error) {
      toast.show({
        variant: "error",
        message: `Failed to save config: ${error instanceof Error ? error.message : String(error)}`,
        duration: 5000,
      })
    }
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const maxWidth = Math.max(0, ...TOOLS.map((t) => t.name.length))
    return TOOLS.map((tool) => ({
      title: tool.name.padEnd(maxWidth),
      description: tool.description,
      value: tool.name,
      category: "Tools",
      onSelect: async () => {
        const config = await readConfigFromFile(sync)
        dialog.replace(() => (
          <DialogToolCodebaseSearch initialConfig={config ?? undefined} onSave={saveCodebaseSearchConfig} />
        ))
      },
    }))
  })

  return <DialogSelect title="Tools" placeholder="Search tools..." options={options()} />
}
