---
name: worktree
description: "Inspect or change a project's warm worktree pool, which keeps set-up worktrees ready so new worktree threads on the default base start without waiting."
---

# Warm worktrees

Use `bb worktree pool status --json` to see which projects keep warm
worktrees, how many are ready or preparing on each checkout, the default base
they sit on, and how many threads took one or missed since the server started.

```sh
bb worktree pool status [--json]
bb worktree pool set <project-id> <size> [--host <host-id>] [--json]
bb worktree pool folders <project-id> [<folder>...] [--host <host-id>] [--json]
```

`size` is 0 to 4 per checkout; `0` turns the pool off and deletes its idle
worktrees. Without `--host` it sets the project's count, which every machine
with a checkout keeps. With `--host` (an id from `bb host list`) it sets that
machine's own count, which wins over the project's; the size `project` makes
the machine follow the project's count again. Status JSON gives each checkout's
effective `size` and its own `hostSize` (`null` when it follows the project). Resolve the project id with `bb project list`. Only turn a pool on
when the user asks for it: each warm worktree runs the project's
`.bb-env-setup.sh` in the background, and it is replaced every eight hours or
when the default branch is rewritten.

Only new worktree threads on the default base take a warm worktree. bb reads
the remote's current default base with `git ls-remote` while the title is
generated (falling back to the last fetched base when the remote can't be
reached). A warm worktree at that commit starts the thread without setup; one
behind it is fast-forwarded to that commit and `.bb-env-setup.sh` runs again
before the thread starts, so the thread always starts on the current base with
setup run against it. Named bases, existing worktrees and restores build a
fresh worktree, and so does a thread that finds no usable warm worktree.

A worktree thread can also branch the project's other git repositories
(`bb project folder list <project-id>`). List them in the inputs:
`bb thread spawn --environment-provider git-worktree --environment-inputs
'{"branch":{"kind":"default"},"folders":["/abs/folder"]}'`. Each listed folder
gets its own worktree next to the main one, on the thread's branch and from that
repository's default branch, and the thread works in that worktree instead of
the shared folder; folders not listed stay shared. Each new folder worktree
runs its own `.bb-env-setup.sh` before the main worktree's, in the order
listed, and its `.bb-env-teardown.sh` after the main one's. Removing the
environment removes every worktree and the branches bb made.

`bb worktree pool folders <project-id> <folder>...` makes the project's warm
worktrees also branch those folders, with every setup finished; list no
folders to stop. Folders are set per machine, because each machine's
checkout has its own folder paths: pass `--host <host-id>` when the project
has checkouts on more than one machine, and list that machine's paths
(`bb project folder list <project-id> --machine <host-id>`). A warm worktree
goes only to a new thread that branches
exactly the same folders, so set the pool's folders to the set threads
usually pick. Others build fresh worktrees; members with other folders are
replaced. On handoff, a folder worktree behind its repository's default
branch is fast-forwarded and its `.bb-env-setup.sh` runs again, then the main
worktree's; folders that did not move are not set up again.

Warm worktrees are ordinary environments held by the Worktree plugin:
`bb environment list --held-by plugin:environment-git-worktree` lists them, and
`bb thread spawn --environment <id>` refuses them. A failed one is deleted and
its error shows in `status`; refills then wait ten minutes. Deleting the project
or removing the machine removes them like any other environment, and
disabling or uninstalling the Worktree plugin releases them.
