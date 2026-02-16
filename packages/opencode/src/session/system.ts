import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"

// kilocode_change start
import SOUL from "../kilocode/soul.txt"
// kilocode_change end

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  // kilocode_change start
  export function soul() {
    return SOUL.trim()
  }
  // kilocode_change end

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment(
    model: Provider.Model,
    editorContext?: {
      visibleFiles?: string[]
      openTabs?: string[]
      activeFile?: string
      shell?: string
      timezone?: string
    },
  ) {
    const project = Instance.project
    const envLines = [
      `  Working directory: ${Instance.directory}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Today's date: ${new Date().toDateString()}`,
    ]
    if (editorContext?.shell) {
      envLines.push(`  Default shell: ${editorContext.shell}`)
    }
    if (editorContext?.timezone) {
      envLines.push(`  Timezone: ${editorContext.timezone}`)
    }
    if (editorContext?.activeFile) {
      envLines.push(`  Active file: ${editorContext.activeFile}`)
    }
    if (editorContext?.visibleFiles?.length) {
      envLines.push(`  Visible files: ${editorContext.visibleFiles.join(", ")}`)
    }
    if (editorContext?.openTabs?.length) {
      envLines.push(`  Open tabs: ${editorContext.openTabs.join(", ")}`)
    }
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        ...envLines,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }
}
