See your project's commit history as a colored Git graph inside bb. Read-only, including nested repositories on each checkout host.

## What you get

- A Git Graph sidebar with compact rows, colored D3 commit lanes, merge halos, and a hollow HEAD ring.
- Stable graph width prevents column jumps.
- Thread opens preselect its project and source.
- Discovery of root and nested repositories, worktrees, and submodules. Heavy folders such as `node_modules`, `.runtime`, `dist`, and `.git` internals are skipped.
- Explicit repository picker showing each repository's relative path, HEAD branch, and empty state, including an enclosing repository when the project folder lives inside one.
- Folder-source picker with the host name, so projects with checkouts on several machines run Git on the right one.
- Branch selector with Show All, the marked current branch, multi-select history for any set of branches, and optional remote-tracking refs. Remote-only commits and chips stay hidden when remotes are off; remote HEAD aliases are never listed.
- Commit columns: Graph, Description, Author, Date. Compact chips identify HEAD, branches, remotes, and tags; long names have tooltips and overflow uses +N. Includes message search, Refresh, and pagination.
- An Uncommitted changes row connected to the HEAD commit opens staged, unstaged, untracked, and conflicted counts.
- Commit card with full metadata, clickable parents, changed files (with rename detection), and a bb-native diff per file.
- Working copy state: a dirty badge with staged/unstaged/untracked/conflicted counts, or a Clean badge.
- Loading, empty, error, and retry states.

## How it works

The server resolves the project's `local_path` and routes typed RPC to its `hostId`. Filesystem and Git work stays on the machine that owns the checkout. With several folder sources, the requested host is used; otherwise the default is selected.

Git runs read-only through `execFile` with an argv array, no shell, `-C`, and `--` before file paths. `GIT_OPTIONAL_LOCKS=0` prevents index writes, `core.fsmonitor=false` disables fsmonitor, and patches use `--no-ext-diff --no-textconv`. Windows are hidden and commands have timeouts and output caps.

The browser never sends absolute paths: repository keys are re-validated on the host against the source root (climbing paths must match the enclosing `git rev-parse --show-toplevel`), commit hashes must match `^[0-9a-f]{4,40}$`, and file paths are rejected when absolute, traversal-shaped, or option-shaped. The scan is bounded by depth (5), a directory budget (4,000), and a wall-clock budget (4 seconds); its result is cached for 15 seconds. History is paginated (`git log --skip/-n`, 100 commits per page) with `--date-order` across all refs, like VS Code Git Graph. Per-file diffs open through bb's own diff viewer (`experimental_Diff`); patches larger than 1 MB are truncated with a visible notice.

## For agents

The `bb git-graph` command exposes the same data, routed to the default source's host:

- `bb git-graph repos [--project <id>] [--source <id>]` — list discovered repositories with their host.
- `bb git-graph log [n] [--repo <path>] [--grep <text>]` — newest commits with refs.
- `bb git-graph show <hash> [--repo <path>]` — one commit with its changed files.

## Requirements

Git must be installed on the machine that owns the project's folder source (the enrolled host), not necessarily the server. Project checkouts must be `local_path` sources.

## Limitations

- Strictly read-only: no checkout, reset, clean, commit, fetch, pull, or push, and no repository-configured hooks, fsmonitor, external diff, or textconv execution.
- Repositories nested deeper than 5 directory levels, or inside skipped folders such as `node_modules`, are not discovered.
- Merge commits list files and diffs against their first parent.
- Search matches commit messages (case-insensitive); it does not jump to abbreviated hashes.
