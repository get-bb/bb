# Worktrees, setup scripts, and teardown scripts

When you start a thread in bb, you can run it in your project's existing
checkout or in a fresh **managed worktree** — a separate working copy on disk
with its own branch. Worktrees let bb work on multiple things in parallel
without touching your main checkout, and they make it easy to throw away
whatever the agent does without affecting the rest of your work.

You can pair a worktree with a **`.worktreeinclude` file** that lists the local
files each new worktree needs, and with a **setup script** that bb runs the
first time the worktree is created — useful for installing dependencies,
generating secrets, or anything else you need before the agent starts.
You can also add a **teardown script** that releases resources outside the
worktree before bb removes it.

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

Omit `--base-branch` for bb's smart default. Explicit values are exact:
`main` is local and `origin/main` is remote.

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

## Run teardown with `.bb-env-teardown.sh`

Commit a file named `.bb-env-teardown.sh` at the project root when setup
creates resources outside the worktree. For example, the script can remove a
database, a proxy registration, a container, or a port reservation.

```bash
#!/usr/bin/env bash
set -euo pipefail

docker rm -f "my-project-${USER}"
```

Contract:

- bb runs the script only when it destroys a managed worktree.
- bb runs `env bash .bb-env-teardown.sh` from the worktree before it removes
  the worktree, so the script can read tracked and generated files.
- stdin is closed. bb records stdout and stderr in the environment destroy
  transcript.
- The script gets a separate 15-minute timeout.
- A non-zero exit, a signal, or a timeout reports a failure. It never stops bb
  from removing the worktree.
- The script receives the same sanitized environment as the setup script.
- POSIX only — supported on macOS, Linux, and WSL2. Native Windows isn't
  supported.

## Jujutsu (colocated) repositories

bb supports [Jujutsu](https://jj-vcs.github.io/jj/) repositories that are
colocated with git (`jj git init --colocate` or `jj git clone --colocate`,
so a real `.git` sits beside `.jj`). jj keeps that `.git` in sync — HEAD is
pinned detached at the working-copy parent and bookmarks export as git
branches — which is what bb reads.

### Threads get a real jj workspace

When a thread's source repository is a colocated jj repository, bb creates the
managed checkout with `jj workspace add` instead of `git worktree add`. The
thread's work is jj-native: it shows up as that workspace's `@` in `jj log`,
`jj op log` can undo it, and `jj workspace list` in your repository shows where
it lives.

- Committing from bb runs `jj commit`, moves the workspace's `bb/...` bookmark
  to the new commit, and exports it so the bookmark is also a git branch you
  can push or open a pull request from.
- Discarding changes runs `jj restore`.
- Squash-merging into a branch works as it does for git worktrees, and the
  target bookmark moves with it.
- Commits an agent makes by running jj itself are picked up automatically.

A jj workspace has no `.git` of its own, so bb registers it as a git worktree
alongside jj and keeps that checkout pinned at `@-`. That is what lets status,
diffs and file reads keep working; jj remains the only thing writing to the
working copy.

One consequence: a plain `git commit` run inside the workspace (by you or by an
agent) doesn't stick. jj never sees it, and the next time bb reads the
workspace the changes show up as uncommitted again — nothing is lost, but the
commit is. Use jj, or bb's own commit action, to commit there.

bb also calls these checkouts what jj calls them. In a jj project the sidebar,
the environment picker, the thread panel, the provisioning transcript and
`bb environment show` all say "workspace" where a git project says "worktree".

### The main workspace

Opening your repository directly (an unmanaged environment) still reads through
the colocated `.git`: status and diffs show jj's working-copy changes, and the
checkout row shows the bookmark at the current commit rather than "detached".
Two actions stay disabled there, because jj manages that checkout: committing
(a git commit would strand the previous working-copy change as an anonymous
head in `jj log`) and branch switching. Use jj for both.

Not supported:

- Pure jj repositories without a colocated `.git`. The colocated git store is
  what bb reads diffs and history from, so bb treats these as non-git
  directories.

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
5. Run `bash .bb-env-teardown.sh` manually before you delete a test worktree.
   Confirm that repeated runs do not fail or remove shared resources.
