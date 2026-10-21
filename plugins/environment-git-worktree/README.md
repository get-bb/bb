# Worktree

Creates an isolated Git worktree from the project checkout on an enrolled machine. The plugin supplies base-branch inputs, runs workspace setup, and removes owned worktrees after core retires them. Project sub-threads receive fresh worktrees by default.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider git-worktree`. Use `bb environment providers --json` for its inputs and availability.

New branches start at the selected base without an upstream. Publish with `git push -u origin HEAD` to track the task's remote branch. Existing branches keep their upstream configuration.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.

Existing-worktree inputs (`{"kind":"existing","path":"/absolute/worktree"}`)
reuse the project's recorded environment on the selected machine before running
provider creation. Its ownership and cleanup behavior stay intact. When the path
has no environment, the plugin validates it against Git and adopts it without
taking ownership; retiring that environment leaves the worktree on disk.

Removal checks for uncommitted files and commits absent from all local remote-tracking refs. If either is present, or the check fails, the worktree is kept. By default, removal uses `git worktree remove` without force; it never recursively deletes a worktree after Git refuses. Core persists an archive retention choice and rechecks it when admitting removal. Git state is checked again after workspace processes stop. Explicit `bb thread archive <id> --discard-worktree` (SDK `worktree: "discard"`) authorizes `git worktree remove --force` after the usual delay. This can delete uncommitted work. Unarchiving cancels that authorization.
