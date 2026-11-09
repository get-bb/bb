# Worktree

Creates an isolated Git worktree from the project checkout on an enrolled machine. The plugin supplies base-branch inputs, runs workspace setup, and removes owned worktrees after core retires them. Project sub-threads receive fresh worktrees by default.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider git-worktree`. Use `bb environment providers --json` for its inputs and availability.

New branches start at the selected base without an upstream. Publish with `git push -u origin HEAD` to track the task's remote branch. Existing branches keep their upstream configuration.

Removal deletes the branch the plugin created (recorded in the environment resource) after the worktree is gone, unless another worktree has it checked out or it has commits that are on no remote or tag, not in the recorded base, and not squash-merged into it; commits that survive only on another local branch keep the branch, because a restore could not bring them back. Squash detection compares patch IDs against base commits that touch the same files, and skips bases more than 2,000 commits or branches more than 200 files away. Kept branches and errors are reported in the removal progress, which core writes to the server log. A kept branch is marked with `branch.<name>.bbOwned`, so a restore that reuses it owns it again; other branches a restore reuses, and branches of adopted worktrees, are never deleted. Restoring onto a deleted branch recreates it from the single remote-tracking branch of that name, tracking it, or from the base.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.

Removal refuses worktrees with worktree-local refs under `refs/worktree/`,
`refs/bisect/`, or `refs/rewritten/`, or unfinished merge, cherry-pick, revert,
rebase, bisect, or sequencer state, even when Git status is clean. Preserve or
delete those refs, or finish or abort the operation, before retrying retirement.
These checks share bb's checkout and worktree metadata locks; they do not block
unrelated external Git writers.

Existing-worktree inputs (`{"kind":"existing","path":"/absolute/worktree"}`)
reuse the project's recorded environment on the selected machine before running
provider creation. Its ownership and cleanup behavior stay intact. When the path
has no environment, the plugin validates it against Git and adopts it without
taking ownership; retiring that environment leaves the worktree on disk.

Default and named bases share one comparison: use the remote when local is
equal or behind, and preserve local commits when ahead, diverged or unknown.
Remote-only branches are usable too. Explicit remote names and fully qualified
refs are honored exactly. Selected remote bases are fetched before creation.
When the plugin chose `origin/<name>` itself and that fetch fails for any
reason other than cancellation, it creates the worktree from the last fetched
`origin/<name>` and reports the failure and the commit it used in the
provisioning progress. That ref already contains every local commit, because
it is only chosen when local is equal or behind. An explicit `origin/<name>`
still fails, and `refs/remotes/origin/<name>` uses the last fetched ref without
fetching. The resolved base is returned and stored with the environment; this does not
refresh existing worktrees before later agent turns.
