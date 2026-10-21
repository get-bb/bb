---
name: git
description: Read workspace Git status, diffs, changed files, branches and Viewed state with the bundled Git plugin.
---

Use `bb git --help` for the current command list. Commands default to this thread's workspace; pass `--environment <id>` to inspect another environment. Every command accepts `--json`.

- `bb git status [--merge-base-branch <branch>]` reads bounded working-tree and optional committed changes.
- `bb git files [--ignore-whitespace]` lists changed-file metadata, revisions, truncation and initial patches.
- `bb git diff` prints a bounded unified diff; `--json` includes its truncation and file summary.
- `bb git patch --path <path>` reads selected patches. Repeat `--path` for more files; `--ignore-whitespace` uses Git's `-w` behavior.
- `bb git file --path <path> --side old|new` reads full file content. JSON preserves UTF-8/base64, MIME and size metadata. Branch comparisons resolve their merge-base revision.
- `bb git branches [--query <text>] [--selected <branch>] [--limit <1-200>]` lists local and remote candidates.
- `bb git viewed list [--path <path>]` lists persisted Viewed marks; repeated paths limit the lookup. Omitting paths reads the whole target.
- `bb git viewed mark --path <path>` marks the current file revision; `viewed unmark --path <path>` removes it; `viewed clear` clears the target.

Files, diff, patch, file and Viewed commands accept `--target uncommitted|branch_committed|all|commit`, defaulting to uncommitted. Branch comparisons require `--merge-base-branch <branch>`; commit requires `--sha <sha>`. These flags are rejected for incompatible targets.

A file remains Viewed only while its revision matches the stored revision. Whitespace edits change revisions even when ignored for display. File lists are bounded; use filters and selected patches for large workspaces.

The plugin supplies the pinned Diff tab and composer changes segment. Disable Git in Plugins to hide those and core Commit controls. Existing Viewed marks, tab order, shortcut overrides and a disabled Show Git changes preference migrate automatically. Pull request controls remain with core until their separate migration.

Status, files, diff, patch, file and Viewed list are available through MCP read. Viewed mutations and branch listing require MCP run; branch listing can refresh remote refs in the background. Use `bb plugin rpc list bb--git` to discover the same read and Viewed operations for SDK callers. Plugin API contracts are documented in the Plugin Guide.
