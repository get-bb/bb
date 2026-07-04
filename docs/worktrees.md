# Worktrees and lifecycle scripts

When you start a thread in bb, you can run it in your project's existing
checkout or in a fresh **managed worktree** — a separate working copy on disk
with its own branch. Worktrees let bb work on multiple things in parallel
without touching your main checkout, and they make it easy to throw away
whatever the agent does without affecting the rest of your work.

You can pair managed worktrees with **lifecycle scripts** configured per
project: an init script that runs after worktree creation, and a teardown script
that runs before bb removes the worktree.

## What is a managed worktree?

A managed worktree is a `git worktree` of your project's repo, on a fresh
branch. Under the hood it's `git worktree add` plus some bookkeeping:

- It shares the repo's `.git` state with your main checkout — cheap to
  create, no full clone.
- It gets its own branch so multiple threads can run in parallel.
- It lives at `<BB_DATA_DIR>/worktrees/<environment-id>/<repo-name>` — for
  example, `~/.bb/worktrees/env_abc.../myrepo`.
- When the owning thread is archived or deleted, bb cleans the worktree up
  (`git worktree remove --force`) along with the branch.

## Start a thread in a worktree

In the app, pick **New worktree** in the environment picker when starting
a thread.

From the CLI:

```bash
pnpm bb thread spawn \
  --project <project-id> \
  --new-environment worktree \
  --prompt "..."
```

When you omit `--base-branch`, bb chooses the project's default worktree base,
preferring the origin default branch when safe. Pass `--base-branch <name>`
only when you need a specific base.

## Configure Lifecycle Scripts

Open Project Settings, then use **Worktree Lifecycle** to enter freeform shell
snippets for init and teardown.

Use init for anything the agent will need in a fresh checkout: install
dependencies, copy a `.env`, sync local state, generate tokens, etc. Use
teardown for cleanup that must happen before the worktree is deleted, such as
stopping repo-local services or removing generated local state.

```bash
set -euo pipefail

pnpm install
cp "$BB_SOURCE_PATH/.env.local" "$BB_WORKTREE_PATH/.env.local"
```

Contract:

- Configured scripts run as `env bash -lc <script>` with working directory set
  to the worktree.
- bb injects `BB_WORKTREE_PATH`, `BB_WORKTREE_PHASE`, and `BB_ENVIRONMENT_ID`
  when known. Init scripts also receive `BB_WORKTREE_BRANCH` and
  `BB_SOURCE_PATH` when known.
- stdout and stderr stream into the provisioning transcript for init scripts.
- A non-zero init exit, signal, cancellation, or timeout fails provisioning and
  the thread doesn't start.
- A non-zero teardown exit, signal, or timeout stops deletion and leaves the
  worktree on disk so cleanup can be retried after the script or local state is
  fixed.
- POSIX only — supported on macOS, Linux, and WSL2. Native Windows isn't
  supported.

If the Project Settings init script is blank, bb falls back to a tracked
`.bb-env-setup.sh` file at the root of your project. If bb finds one when it
creates a worktree, it runs the file inside the new worktree before handing the
thread to the agent. The legacy file must be tracked by git; a file that exists
only in your current working copy will not appear in a fresh worktree.

## Cleanup

You don't need to clean up worktrees by hand — bb removes them when the owning
thread is archived or deleted, and the branch goes with it. If a teardown script
is configured, bb runs it before removal. If you want to keep work the agent did,
commit and push (or open a PR) from inside the worktree before letting the thread
go.

## If something isn't working

A few quick checks:

1. If worktree creation fails, look at the thread's provisioning transcript
   in the app. Failures from `git worktree add` (dirty source checkout,
   invalid base branch, conflicting branch name) show up there with the exact
   git error.
2. If an init script does not seem to run, check Project Settings first. If you
   rely on `.bb-env-setup.sh`, make sure it is committed to the branch you're
   working from.
3. If your lifecycle script hangs, remember stdin is closed. Anything that
   prompts for input will time out at 15 minutes.
4. Run the script manually in a clean clone to verify it works outside bb before
   debugging through the provisioning transcript.
