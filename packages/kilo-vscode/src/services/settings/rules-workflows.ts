import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as vscode from "vscode"

const ALLOWED_EXTENSIONS = [".md", ".txt"] as const

type RuleKind = "rule" | "workflow"
type RuleScope = "global" | "local"

type ToggleMap = Record<string, boolean>

export interface RulesCatalogItem {
  path: string
  name: string
  enabled: boolean
}

export interface RulesCatalog {
  rules: { global: RulesCatalogItem[]; local: RulesCatalogItem[] }
  workflows: { global: RulesCatalogItem[]; local: RulesCatalogItem[] }
}

interface RulePathInput {
  kind: RuleKind
  scope: RuleScope
  workspaceDir?: string
}

interface CreateRuleFileInput extends RulePathInput {
  filename: string
}

interface FileMutationInput extends RulePathInput {
  filePath: string
}

interface ToggleRuleFileInput extends FileMutationInput {
  enabled: boolean
}

export class RulesWorkflowsService {
  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  async list(workspaceDir?: string): Promise<RulesCatalog> {
    return {
      rules: {
        global: await this.readDirectory({ kind: "rule", scope: "global" }),
        local: workspaceDir ? await this.readDirectory({ kind: "rule", scope: "local", workspaceDir }) : [],
      },
      workflows: {
        global: await this.readDirectory({ kind: "workflow", scope: "global" }),
        local: workspaceDir ? await this.readDirectory({ kind: "workflow", scope: "local", workspaceDir }) : [],
      },
    }
  }

  async createFile(input: CreateRuleFileInput): Promise<void> {
    const targetDirectory = this.getDirectory(input)
    await fs.mkdir(targetDirectory, { recursive: true })

    const filename = this.normalizeFilename(input.filename)
    const filePath = path.join(targetDirectory, filename)

    await this.ensurePathInsideScope(filePath, input)

    if (await this.fileExists(filePath)) {
      throw new Error(`File already exists: ${filename}`)
    }

    const initialContent = input.kind === "workflow" ? this.workflowTemplate(filename) : this.ruleTemplate(filename)
    await fs.writeFile(filePath, initialContent, "utf8")

    const toggles = await this.readToggles(input)
    toggles[filePath] = true
    await this.writeToggles(input, toggles)

    await this.openFile({ ...input, filePath })
  }

  async openFile(input: FileMutationInput): Promise<void> {
    const resolved = await this.resolveAndValidatePath(input)
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resolved))
  }

  async deleteFile(input: FileMutationInput): Promise<void> {
    const resolved = await this.resolveAndValidatePath(input)
    await fs.unlink(resolved)

    const toggles = await this.readToggles(input)
    if (resolved in toggles) {
      delete toggles[resolved]
      await this.writeToggles(input, toggles)
    }
  }

  async toggleFile(input: ToggleRuleFileInput): Promise<void> {
    const resolved = await this.resolveAndValidatePath(input)
    const toggles = await this.readToggles(input)
    toggles[resolved] = input.enabled
    await this.writeToggles(input, toggles)
  }

  private async readDirectory(input: RulePathInput): Promise<RulesCatalogItem[]> {
    const directory = this.getDirectory(input)
    if (!(await this.fileExists(directory))) {
      return []
    }

    const toggles = await this.readToggles(input)
    const entries = await fs.readdir(directory, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) => ALLOWED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase() as (typeof ALLOWED_EXTENSIONS)[number]))
      .map((entry) => {
        const absolutePath = path.join(directory, entry.name)
        return {
          path: absolutePath,
          name: entry.name,
          enabled: toggles[absolutePath] ?? true,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private getDirectory(input: RulePathInput): string {
    if (input.scope === "global") {
      return input.kind === "workflow"
        ? path.join(os.homedir(), ".kilocode", "workflows")
        : path.join(os.homedir(), ".kilocode", "rules")
    }

    if (!input.workspaceDir) {
      throw new Error("Open a workspace folder to manage local rules/workflows.")
    }

    return input.kind === "workflow"
      ? path.join(input.workspaceDir, ".kilocode", "workflows")
      : path.join(input.workspaceDir, ".kilocode", "rules")
  }

  private toggleStorageKey(input: RulePathInput): string {
    if (input.kind === "workflow") {
      return input.scope === "global" ? "globalWorkflowToggles" : "localWorkflowToggles"
    }
    return input.scope === "global" ? "globalRulesToggles" : "localRulesToggles"
  }

  private async readToggles(input: RulePathInput): Promise<ToggleMap> {
    const key = this.toggleStorageKey(input)
    const raw =
      input.scope === "global"
        ? this.extensionContext.globalState.get<ToggleMap>(key)
        : this.extensionContext.workspaceState.get<ToggleMap>(key)
    return raw ? { ...raw } : {}
  }

  private async writeToggles(input: RulePathInput, toggles: ToggleMap): Promise<void> {
    const key = this.toggleStorageKey(input)
    if (input.scope === "global") {
      await this.extensionContext.globalState.update(key, toggles)
      return
    }
    await this.extensionContext.workspaceState.update(key, toggles)
  }

  private normalizeFilename(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) {
      throw new Error("Filename is required")
    }

    const baseName = path.basename(trimmed).replace(/[^a-zA-Z0-9._-]+/g, "-")
    if (!baseName) {
      throw new Error("Filename is invalid")
    }

    const ext = path.extname(baseName).toLowerCase()
    if (!ext) {
      return `${baseName}.md`
    }
    if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
      throw new Error(`Unsupported file extension: ${ext}. Use .md or .txt`)
    }
    return baseName
  }

  private async resolveAndValidatePath(input: FileMutationInput): Promise<string> {
    const resolved = path.resolve(input.filePath)
    await this.ensurePathInsideScope(resolved, input)

    if (!(await this.fileExists(resolved))) {
      throw new Error(`File does not exist: ${path.basename(resolved)}`)
    }

    return resolved
  }

  private async ensurePathInsideScope(candidatePath: string, input: RulePathInput): Promise<void> {
    const baseDirectory = path.resolve(this.getDirectory(input))
    const resolved = path.resolve(candidatePath)
    const baseCanonical = await this.realpathOrResolved(baseDirectory)
    const candidateCanonical = await this.realpathOrResolved(resolved)
    const relative = path.relative(baseCanonical, candidateCanonical)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Requested file path is outside the allowed rules/workflows directory")
    }
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async realpathOrResolved(targetPath: string): Promise<string> {
    try {
      return await fs.realpath(targetPath)
    } catch {
      return path.resolve(targetPath)
    }
  }

  private workflowTemplate(filename: string): string {
    return `# ${filename}\n\nDescribe when this workflow should be used.\n\n1. First step\n2. Second step\n`
  }

  private ruleTemplate(filename: string): string {
    return `# ${filename}\n\nDescribe the rule intent and boundaries.\n\n- Guideline 1\n- Guideline 2\n`
  }
}
