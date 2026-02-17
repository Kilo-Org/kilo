# 7.7 Workspace binding & path traversal protections (files + tool execution sandbox)

**What we can confirm from OpenCode code**

- Instance/workspace selection is derived from the inbound `directory` (query/header), and project discovery will attempt to locate a git root; [`Instance.worktree`](../../kilo/packages/opencode/src/project/instance.ts:44) may differ from [`Instance.directory`](../../kilo/packages/opencode/src/project/instance.ts:41) [`Project.fromDirectory()`](../../kilo/packages/opencode/src/project/project.ts:53).
- File reads and directory listings enforce [`Instance.containsPath()`](../../kilo/packages/opencode/src/project/instance.ts:55), which checks lexical containment in either `directory` or `worktree` [`File.read()`](../../kilo/packages/opencode/src/file/index.ts:275) [`File.list()`](../../kilo/packages/opencode/src/file/index.ts:322).
- OpenCode explicitly documents two important limitations: containment is **lexical only** (symlinks inside the project can escape), and Windows cross-drive paths can bypass the check [`../../kilo/packages/opencode/src/file/index.ts`](../../kilo/packages/opencode/src/file/index.ts:280).
- Shell/tool execution runs with `cwd: Instance.directory` (no OS-level sandbox such as chroot/containers). Safety is expected to be enforced by permissions + patterns rather than by process sandboxing [`PermissionNext.evaluate()`](../../kilo/packages/opencode/src/permission/next.ts:231) [`SessionPrompt.shell()`](../../kilo/packages/opencode/src/session/prompt.ts:1343).

**What remains unknown (needs live testing + possibly deeper audit)**

- Whether other endpoints (beyond [`File.read()`](../../kilo/packages/opencode/src/file/index.ts:275) / [`File.list()`](../../kilo/packages/opencode/src/file/index.ts:322)) have equivalent [`Instance.containsPath()`](../../kilo/packages/opencode/src/project/instance.ts:55) enforcement.
- Whether OpenCode resolves paths to realpaths before permission evaluation (current checks are lexical).

**Actionable conclusion**: treat OpenCode’s file boundary checks as “good but not bulletproof”; if we need stronger guarantees, we likely need additional hardening (realpath canonicalization + symlink checks) before trusting it as Kilo’s primary tool executor.
