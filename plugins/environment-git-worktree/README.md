# Worktree

Creates an isolated Git worktree from the project checkout on an enrolled machine. The plugin supplies base-branch inputs, can keep warm worktrees ready, and removes owned worktrees after core retires them. Project sub-threads receive fresh worktrees by default.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider git-worktree`. Use `bb environment providers --json` for its inputs and availability.

New branches start at the selected base without an upstream. Publish with `git push -u origin HEAD` to track the task's remote branch. Existing branches keep their upstream configuration.

Removal deletes the branch the plugin created (recorded in the environment resource) after the worktree is gone, unless another worktree has it checked out or it has commits that are on no remote or tag, not in the recorded base, and not squash-merged into it; commits that survive only on another local branch keep the branch, because a restore could not bring them back. Squash detection compares patch IDs against base commits that touch the same files, and skips bases more than 2,000 commits or branches more than 200 files away. Kept branches and errors are reported in the removal progress, which core writes to the server log. A kept branch is marked with `branch.<name>.bbOwned`, so a restore that reuses it owns it again; other branches a restore reuses, and branches of adopted worktrees, are never deleted. Restoring onto a deleted branch recreates it from the single remote-tracking branch of that name, tracking it, or from the base.

Warm worktrees are opt-in per project (0 to 4 per checkout, on the plugin's settings page or with `bb worktree pool set <project-id> <size>`). The base-branch picker shows how many are ready on the chosen machine next to Default branch, and its last row, Worktree settings, opens the settings page. The server entry keeps that many environments held by this plugin through `bb.sdk.environments.experimental_create({ hold: "plugin" })`: ordinary worktrees at the default base on an unused placeholder branch (`<prefix><environment-id>`), created and set up by core. A create on the default base for an environment that has no holder (never a user-held or pool-refill create) lists this plugin's ready members for the project and machine, reserves the oldest under a lock per project and machine, and reads the remote's default base commit with `git ls-remote` (once per create; when the remote can't be reached it uses the last fetched default base, as a fresh worktree's fetch fallback does, and the create reports that it may be out of date). When the remote base can't be read at all, the member is kept and a fresh worktree is built. The host then checks the member: it fetches the default base if that commit is missing locally, and inside the git ref lock refuses a member that left its placeholder branch with work on it, or whose HEAD is not that commit or an ancestor of it. The lock wait is two seconds: a busy lock or a failed or timed-out call builds a fresh worktree at once. The provider then calls `adopt(memberId, resource)` with a resource naming the placeholder branch, which moves the thread onto the member and records that resource in one core transaction (core keeps the hold until create returns); when core refuses, the next member, or a fresh worktree, is used, and nothing was changed on disk. When the member's HEAD is behind the remote commit, the provider fast-forwards the checkout (`git merge --ff-only`) and calls `setup(path)`, which starts setup at once, so a handed-out member is never older than a fresh worktree would be; otherwise setup does not run again. The create reports "Using a warm worktree at <base> (<commit>)", then waits for the thread's `branchName()` (setup runs meanwhile) and asks the host to rename the placeholder: under the git ref lock the host writes the new name to the worktree's completion file, then runs `git branch -m`. The create returns the member's path with a resource naming the new branch. Removal deletes the branch in the resource and also the one in the completion file, so a restart after the rename, which makes core discard the handed-over member and provision the thread again, leaves no branch behind. A member that is not on the base or was used is deleted, and the next one is tried. The plugin also repairs members on its own: before a handoff and on every reconcile, a member that is not on its placeholder branch is renamed back. It is kept if it has no commits beyond the base and a clean tree, and is otherwise deleted, so core's removal owns that branch. Every two minutes while a pool exists the server fetches the default base, deletes members that are not on it (a rewritten default branch), failed, older than eight hours, or over the size (but never the members of a project whose lookup failed for any reason except 404), and creates one replacement per machine at a time. Project and machine removal delete members through core.

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
