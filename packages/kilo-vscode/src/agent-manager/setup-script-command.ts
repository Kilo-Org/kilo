/** Build the platform-appropriate command string for running a setup script. */
export function buildSetupCommand(
  script: string,
  env: { worktreePath: string; repoPath: string },
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `set "WORKTREE_PATH=${env.worktreePath}" && set "REPO_PATH=${env.repoPath}" && call "${script}"`
  }
  return `WORKTREE_PATH="${env.worktreePath}" REPO_PATH="${env.repoPath}" sh "${script}"`
}
