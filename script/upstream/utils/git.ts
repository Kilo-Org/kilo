#!/usr/bin/env bun
/**
 * Git utilities for upstream merge automation
 */

import { $ } from "bun"

export interface BranchInfo {
  current: string
  exists: boolean
}

export interface RemoteInfo {
  name: string
  url: string
}

export async function getCurrentBranch(): Promise<string> {
  const result = await $`git rev-parse --abbrev-ref HEAD`.text()
  return result.trim()
}

export async function branchExists(name: string): Promise<boolean> {
  const result = await $`git show-ref --verify --quiet refs/heads/${name}`.nothrow()
  return result.exitCode === 0
}

export async function remoteBranchExists(remote: string, branch: string): Promise<boolean> {
  const result = await $`git ls-remote --heads ${remote} ${branch}`.text()
  return result.trim().length > 0
}

export async function getRemotes(): Promise<RemoteInfo[]> {
  const result = await $`git remote -v`.text()
  const lines = result.trim().split("\n")
  const remotes: RemoteInfo[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const parts = line.split(/\s+/)
    const name = parts[0] ?? ""
    const url = parts[1] ?? ""
    if (name && !seen.has(name)) {
      seen.add(name)
      remotes.push({ name, url })
    }
  }

  return remotes
}

export async function hasUpstreamRemote(): Promise<boolean> {
  const remotes = await getRemotes()
  return remotes.some((r) => r.name === "upstream")
}

export async function fetchUpstream(): Promise<void> {
  const result = await $`git fetch upstream`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch upstream: ${result.stderr.toString()}`)
  }
}

export async function checkout(ref: string): Promise<void> {
  await $`git checkout ${ref}`
}

export async function createBranch(name: string, from?: string): Promise<void> {
  if (from) {
    await $`git checkout -b ${name} ${from}`
  } else {
    await $`git checkout -b ${name}`
  }
}

export async function deleteBranch(name: string, force = false): Promise<void> {
  if (force) {
    await $`git branch -D ${name}`
  } else {
    await $`git branch -d ${name}`
  }
}

export async function backupAndDeleteBranch(name: string): Promise<string | null> {
  if (!(await branchExists(name))) return null

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backupName = `backup/${name}-${timestamp}`
  const current = await getCurrentBranch()

  // Create backup from the existing branch
  await $`git branch ${backupName} ${name}`

  // Delete the old branch (must not be on it)
  if (current === name) {
    throw new Error(`Cannot backup and delete branch '${name}' while it is checked out`)
  }
  await deleteBranch(name, true)

  return backupName
}

export async function push(remote = "origin", branch?: string, setUpstream = false): Promise<void> {
  const currentBranch = branch || (await getCurrentBranch())
  if (setUpstream) {
    await $`git push -u ${remote} ${currentBranch}`
  } else {
    await $`git push ${remote} ${currentBranch}`
  }
}

export async function pull(remote = "origin", branch?: string): Promise<void> {
  if (branch) {
    await $`git pull ${remote} ${branch}`
  } else {
    await $`git pull ${remote}`
  }
}

export async function commit(message: string): Promise<void> {
  await $`git commit -am ${message}`
}

export async function merge(branch: string): Promise<{ success: boolean; conflicts: string[] }> {
  const result = await $`git merge ${branch}`.nothrow()

  if (result.exitCode === 0) {
    return { success: true, conflicts: [] }
  }

  // Get list of conflicted files
  const conflicts = await getConflictedFiles()
  return { success: false, conflicts }
}

export async function getConflictedFiles(): Promise<string[]> {
  const result = await $`git diff --name-only --diff-filter=U`.text()
  return result
    .trim()
    .split("\n")
    .filter((f) => f.length > 0)
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const result = await $`git status --porcelain`.text()
  return result.trim().length > 0
}

export async function stageAll(): Promise<void> {
  await $`git add -A`
}

export async function stageFiles(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git add ${file}`
  }
}

export async function getCommitMessage(ref: string): Promise<string> {
  const result = await $`git log -1 --format=%s ${ref}`.text()
  return result.trim()
}

export async function getCommitHash(ref: string): Promise<string> {
  const result = await $`git rev-parse ${ref}`.text()
  return result.trim()
}

export async function getTagsForCommit(commit: string): Promise<string[]> {
  const result = await $`git tag --points-at ${commit}`.text()
  return result
    .trim()
    .split("\n")
    .filter((t) => t.length > 0)
}

export async function getAllTags(): Promise<string[]> {
  const result = await $`git tag -l`.text()
  return result
    .trim()
    .split("\n")
    .filter((t) => t.length > 0)
}

export async function getUpstreamTags(): Promise<string[]> {
  const result = await $`git ls-remote --tags upstream`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list upstream tags: ${result.stderr.toString()}`)
  }

  const output = result.stdout.toString()
  const tags: string[] = []

  for (const line of output.trim().split("\n")) {
    const match = line.match(/refs\/tags\/([^\^]+)$/)
    if (match && match[1]) tags.push(match[1])
  }

  return tags
}

export async function abortMerge(): Promise<void> {
  await $`git merge --abort`
}

export async function checkoutOurs(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git checkout --ours ${file}`
  }
}

export async function checkoutTheirs(files: string[]): Promise<void> {
  for (const file of files) {
    await $`git checkout --theirs ${file}`
  }
}
