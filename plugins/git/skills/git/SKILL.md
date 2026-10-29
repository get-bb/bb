---
name: git
description: "Read an environment's git status, changed files, diffs and branches, or mark files Viewed, from the bb CLI; read git status from another plugin."
---

# Git

The plugin runs git in the environment's workspace on its machine. The Diff
tab, the composer's changed-files segment and the Info tab read from it.

```sh
bb git status <environment-id> [--merge-base-branch <branch>] [--json]
bb git branches <environment-id> [--query <text>] [--limit <n>] [--json]
bb git diff <environment-id> --target <target> [--json]
bb git files <environment-id> --target <target> [--ignore-whitespace] [--json]
bb git file <environment-id> --target <target> --path <path> --side old|new [--json]
bb git patch <environment-id> --target <target> --path <path>... [--json]
bb git viewed list|mark|unmark|clear <environment-id> --target <target> ...
```

- `<target>` is `uncommitted`, `branch_committed`, `all` or `commit`.
  Branch targets take `--merge-base-branch`; `commit` takes `--sha`. `file`
  takes `--merge-base-ref <sha>` for branch targets instead.
- `status` includes ahead/behind counts only with `--merge-base-branch`. Each
  file list holds at most 200 entries (tracked changes first); `fileCount` is
  the total. When squash-merge detection hits its limits (1,000 commits,
  1 second), `mergeBase.squashMergeCheckComplete` is false and the counts may
  include commits that were already squash-merged.
- `--ignore-whitespace` counts and diffs with `git -w`: whitespace-only files
  stay listed with +0 -0 and get an empty patch.
- `files --json` reports each file's revision: old and new git modes and blob
  ids (`<oldMode>:<oldBlob>:<newMode>:<newBlob>`). Any content or mode edit,
  including whitespace, changes it; staging does not.
- Viewed is stored per environment and diff target. A file shows as Viewed
  only while its current revision equals the stored one, so new edits
  un-view it. `viewed mark` records the current revision unless you pass
  `--revision`; `viewed list --path` takes up to 500 paths. Mutations print
  `{ "ok": true }` with `--json`.
- The old `bb environment status|diff|diff-files|diff-file|diff-patch|branches|diff-viewed`
  commands still run and print the `bb git` command that replaced them.

`showGitChanges` (default true) shows the composer's changed-files segment;
turn it off with `bb plugin config bb--git set showGitChanges false`.
`showCommitButton` (default false) shows the thread header's Commit action;
turn it on with `bb plugin config bb--git set showCommitButton true`.

Other plugins read the same data through RPC. `status` is a keyed read: pass
environment ids and get one row per id, refreshed after the workspace's files
or refs change.

```ts
experimental_useRpcKeyedQuery({
  pluginId: "bb--git",
  contract: gitRpcContract,
  method: "status",
  keys: [environmentId],
});
```

`bb plugin rpc inspect bb--git` prints the input and output schemas.

Branch targets resolve the requested ref first, then fall back to `origin/<branch>`. If no merge base with HEAD resolves, diff reads report an error instead of an empty diff.
