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
bb worktree pool set <project-id> <size> [--json]
```

`size` is 0 to 4 per checkout; `0` turns the pool off and deletes its idle
worktrees. Resolve the project id with `bb project list`. Only turn a pool on
when the user asks for it: each warm worktree runs the project's
`.bb-env-setup.sh` in the background, and a warm worktree is replaced (and set
up again) whenever the default base moves.

Only new worktree threads on the default base take a warm worktree, and only
one that is still at the last fetched default base; setup does not run again,
so the thread starts on exactly what setup ran against. Named bases, existing
worktrees and restores build a fresh worktree, and so does a thread that finds
no current warm worktree.

Warm worktrees are ordinary environments held by the Worktree plugin:
`bb environment list --held-by plugin:environment-git-worktree` lists them, and
`bb thread spawn --environment <id>` refuses them. A failed one is deleted and
its error shows in `status`; refills then wait ten minutes. Deleting the project
or removing the machine removes them like any other environment.
