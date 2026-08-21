# Worktrees and setup scripts

When you start a thread in bb, you can run it in your project's existing
checkout or in a fresh **managed worktree** — a separate working copy on disk
with its own branch. Worktrees let bb work on multiple things in parallel
without touching your main checkout, and they make it easy to throw away
whatever the agent does without affecting the rest of your work.

You can pair a worktree with a **`.worktreeinclude` file** that lists the local
files each new worktree needs, and with a **setup script** that bb runs the
first time the worktree is created — useful for installing dependencies,
generating secrets, or anything else you need before the agent starts.

## What is a managed worktree?

A managed worktree is a `git worktree` of your project's repo, on a fresh
branch. Under the hood it's `git worktree add` plus some bookkeeping:

- It shares the repo's `.git` state with your main checkout — cheap to
  create, no full clone.
- It gets its own branch so multiple threads can run in parallel.
- It lives at `<BB_DATA_DIR>/worktrees/<environment-id>/<repo-name>` — for
  example, `~/.bb/worktrees/env_abc.../myrepo`.
- Once every thread using the environment is archived or deleted, bb cleans the
  worktree up (`git worktree remove --force`) along with the branch.

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

## Copy local files with `.worktreeinclude`

A new worktree checks out tracked files only. Your `.env`, your local
certificates, and anything else git ignores stay behind in your main checkout.

Commit a `.worktreeinclude` file at the root of your repo to list what a
worktree needs. It uses gitignore syntax — one pattern per line, `#` for
comments, `!` to negate an earlier pattern:

```gitignore
# Local credentials the agent needs
.env
.env.*
!.env.example
certs/
```

bb copies every untracked file in the source checkout that matches a pattern,
after it creates the worktree and before it runs `.bb-env-setup.sh`. Your
setup script can therefore read the copied files.

Contract:

- bb copies files. It does not create symlinks, and each worktree gets its own
  copy — an edit inside the worktree does not change your main checkout.
- bb never replaces anything the worktree already has. If the branch tracks a
  file at that path, the tracked file wins and bb reports the skip.
- bb skips symlinks in the source checkout rather than copying their targets,
  and it never writes through a symlink in the worktree.
- A pattern that matches nothing, an unreadable file, or a failed copy is
  reported in the provisioning transcript. Provisioning continues.
- Large directories such as `node_modules` are copied file by file, which is
  slow. Install dependencies in `.bb-env-setup.sh` instead.

## Run setup with `.bb-env-setup.sh`

Drop a file named `.bb-env-setup.sh` at the root of your project. If bb finds
one when it creates a worktree, it runs the script inside the new worktree
before handing the thread to the agent.

Use it for anything the agent will need in a fresh checkout — install
dependencies, sync local state, generate tokens, etc. To bring local files in
from your main checkout, prefer `.worktreeinclude` above.

```bash
#!/usr/bin/env bash
set -euo pipefail

pnpm install
```

Contract:

- The script runs with `env bash`, working directory set to the new worktree.
- stdin is closed. stdout and stderr stream into the thread's provisioning
  transcript in the app.
- A non-zero exit, a signal, or a timeout (15 minutes) fails provisioning and
  the thread doesn't start.
- POSIX only — supported on macOS, Linux, and WSL2. Native Windows isn't
  supported.

## Cleanup

You don't need to clean up worktrees by hand — bb removes them once every
thread using the environment is archived or deleted, and the branch goes with
it. If you
want to keep work the agent did, commit and push (or open a PR) from inside
the worktree before letting the thread go.

Before bb removes the directory, it stops every process whose working
directory is inside the worktree — the agent's provider process, its
background jobs (dev servers, MCP servers, `nohup` jobs), and any process
you started there yourself, such as a shell you `cd`'d into the worktree or
an editor terminal. Each process gets `SIGTERM`, then `SIGKILL` after a
short grace period. Move your own shells out of the worktree before you
delete the environment if you want to keep them.

## If something isn't working

A few quick checks:

1. If worktree creation fails, look at the thread's provisioning transcript
   in the app. Failures from `git worktree add` (dirty source checkout,
   invalid base branch, conflicting branch name) show up there with the exact
   git error.
2. If `.bb-env-setup.sh` doesn't seem to run, make sure it's committed to
   the branch you're working from. A file that exists only in the working
   copy of your main checkout won't appear in the new worktree.
3. If your setup script hangs, remember stdin is closed. Anything that
   prompts for input will time out at 15 minutes.
4. Run `bash .bb-env-setup.sh` manually in a clean clone to verify it works
   outside bb before debugging through the provisioning transcript.
