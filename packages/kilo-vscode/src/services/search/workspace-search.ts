import { execFile as execFileCb } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)

export interface SearchMatch {
  file: string
  line: number
  column: number
  text: string
  score: number
}

export interface SearchQueryOptions {
  literal?: boolean
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ")
}

function tokenizeQuery(query: string): string[] {
  return normalizeQuery(query)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length >= 2)
}

async function runRipgrep(
  cwd: string,
  pattern: string,
  maxResults: number,
  options: SearchQueryOptions = {},
): Promise<SearchMatch[]> {
  const perFileLimit = Math.max(1, Math.min(20, Math.ceil(maxResults / 10)))
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--max-columns",
    "300",
    "--max-count",
    String(perFileLimit),
    "--smart-case",
    "--hidden",
    "-g",
    "!.git",
    ...(options.literal ? ["--fixed-strings"] : []),
    pattern,
    ".",
  ]

  const { stdout } = await execFile("rg", args, {
    cwd,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })

  const matches: SearchMatch[] = []
  const lines = stdout.split("\n")
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    try {
      const payload = JSON.parse(line) as Record<string, unknown>
      if (payload.type !== "match") {
        continue
      }
      const data = payload.data as Record<string, unknown>
      const pathText = ((data.path as Record<string, unknown>)?.text as string | undefined) ?? ""
      const submatches = Array.isArray(data.submatches) ? (data.submatches as Array<Record<string, unknown>>) : []
      const firstSubmatch = submatches[0]
      const lineText = ((data.lines as Record<string, unknown>)?.text as string | undefined)?.trimEnd() ?? ""
      const lineNumber = typeof data.line_number === "number" ? data.line_number : 1
      const column = typeof firstSubmatch?.start === "number" ? firstSubmatch.start + 1 : 1
      if (!pathText) {
        continue
      }
      matches.push({
        file: pathText,
        line: lineNumber,
        column,
        text: lineText,
        score: 0,
      })
      if (matches.length >= maxResults) {
        break
      }
    } catch {
      // Ignore malformed JSON rows from ripgrep output.
    }
  }

  return matches
}

function scoreMatches(matches: SearchMatch[], query: string): SearchMatch[] {
  const q = normalizeQuery(query).toLowerCase()
  const terms = tokenizeQuery(query)
  return matches
    .map((match) => {
      const file = match.file.toLowerCase()
      const text = match.text.toLowerCase()
      let score = 0

      if (text.includes(q)) score += 12
      if (file.includes(q)) score += 10
      for (const term of terms) {
        if (file.includes(term)) score += 5
        if (text.includes(term)) score += 3
      }

      return { ...match, score }
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
}

export class WorkspaceSearchService {
  async searchText(
    query: string,
    cwd: string,
    maxResults = 100,
    options: SearchQueryOptions = {},
  ): Promise<SearchMatch[]> {
    const normalized = normalizeQuery(query)
    if (!normalized) {
      return []
    }
    const matches = await runRipgrep(cwd, normalized, maxResults, options)
    return scoreMatches(matches, normalized)
  }

  /**
   * Lightweight semantic-ish search:
   * - Searches full query first.
   * - Expands with term-level ripgrep and re-ranks by filename + line relevance.
   */
  async semanticSearch(query: string, cwd: string, maxResults = 80): Promise<SearchMatch[]> {
    const normalized = normalizeQuery(query)
    if (!normalized) {
      return []
    }

    const terms = tokenizeQuery(normalized)
    const byKey = new Map<string, SearchMatch>()

    const seed = await runRipgrep(cwd, normalized, maxResults, { literal: true })
    for (const match of seed) {
      byKey.set(`${match.file}:${match.line}:${match.column}`, match)
    }

    for (const term of terms.slice(0, 5)) {
      const termMatches = await runRipgrep(cwd, term, Math.max(30, Math.floor(maxResults / 2)), { literal: true })
      for (const match of termMatches) {
        const key = `${match.file}:${match.line}:${match.column}`
        if (!byKey.has(key)) {
          byKey.set(key, match)
        }
      }
    }

    const ranked = scoreMatches(Array.from(byKey.values()), normalized)
    return ranked.slice(0, maxResults)
  }
}

export interface IndexedFileEntry {
  file: string
  tokens: string[]
}

export interface IndexSnapshot {
  createdAt: string
  workspace: string
  files: IndexedFileEntry[]
}

function tokenizePath(filePath: string): string[] {
  const normalized = filePath.toLowerCase()
  const base = path.basename(normalized)
  const stem = base.replace(/\.[a-z0-9]+$/i, "")
  return Array.from(
    new Set(
      `${normalized} ${stem}`
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  )
}

export class SimpleCodeIndexService {
  private snapshot: IndexSnapshot | null = null

  async rebuild(workspaceDir: string): Promise<IndexSnapshot> {
    const { stdout } = await execFile("rg", ["--files", "--hidden", "-g", "!.git"], {
      cwd: workspaceDir,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    })
    const files = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 50_000)
      .map((file) => ({
        file,
        tokens: tokenizePath(file),
      }))

    this.snapshot = {
      createdAt: new Date().toISOString(),
      workspace: workspaceDir,
      files,
    }
    return this.snapshot
  }

  getSnapshot(): IndexSnapshot | null {
    return this.snapshot
  }

  async search(query: string, workspaceDir: string, maxResults = 50): Promise<Array<{ file: string; score: number }>> {
    const normalized = normalizeQuery(query).toLowerCase()
    if (!normalized) {
      return []
    }
    const terms = tokenizeQuery(normalized)
    const snapshot = this.snapshot?.workspace === workspaceDir ? this.snapshot : await this.rebuild(workspaceDir)

    const scored = snapshot.files
      .map((entry) => {
        let score = 0
        if (entry.file.toLowerCase().includes(normalized)) {
          score += 14
        }
        for (const term of terms) {
          if (entry.tokens.includes(term)) score += 5
          if (entry.file.toLowerCase().includes(term)) score += 2
        }
        return { file: entry.file, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))

    return scored.slice(0, maxResults)
  }
}
