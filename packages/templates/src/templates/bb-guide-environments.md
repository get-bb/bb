---
kind: instruction
title: bb Guide — Environments
summary: Command reference for environment setup, inspection, commits, and merges.
intent: Provide complete environment command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Environment commands

Environments determine where threads run. Multiple threads can share an environment
(e.g., a coding thread and a review thread in the same worktree).

Making your repo work with bb:

  Configure worktree lifecycle scripts from Project Settings > Worktree
  Lifecycle. The init script runs after bb creates a new managed worktree. The
  teardown script runs before bb removes a managed worktree.

  Configure a project run command from Project Settings > Worktree Lifecycle
  too. The sidebar run button starts that command in a terminal from the project
  checkout, and worktree rows start the same command from that worktree. On
  desktop the run appears as a pinned Run tab in the thread's bottom terminal
  dock. While the terminal is starting or running, the button becomes a stop
  button and the sidebar shows the active run state.

  Scripts are freeform POSIX shell snippets. bb runs configured scripts as
  `env bash -lc <script>` with cwd set to the worktree. POSIX shell lifecycle
  scripts are not supported on native Windows.

  bb starts from the host daemon's sanitized environment, then injects
  BB_WORKTREE_PATH, BB_WORKTREE_PHASE (`init` or `teardown`), BB_ENVIRONMENT_ID
  when known, and for init scripts BB_WORKTREE_BRANCH and BB_SOURCE_PATH when
  known.

  The init script runs only for newly-created managed worktree environments. It
  does not run for direct/project-checkout environments, personal scratch
  workspaces, or reconnecting an existing managed worktree. A non-zero exit,
  timeout, signal, or cancellation fails provisioning and bb removes the new
  worktree. Keep optional setup steps non-fatal inside the script if the
  environment should still open.

  The teardown script runs before removal. A non-zero exit, timeout, or signal
  stops deletion and leaves the worktree on disk so cleanup can be retried after
  the script or local state is fixed.

  If the Project Settings init script is blank, bb falls back to a tracked
  .bb-env-setup.sh file at the repo root. A fresh worktree only checks out
  tracked files, so an untracked .bb-env-setup.sh in your source checkout will
  not be present and will not run. The legacy hook runs as
  `env bash .bb-env-setup.sh`.

  New worktrees do not contain gitignored files such as .env.local. To copy
  them from the original checkout, use BB_SOURCE_PATH from an init script:

    source_root=$BB_SOURCE_PATH
    workspace_root=$(pwd -P)

  A real setup script should then copy a fixed list of needed env files if they
  exist in source_root and are missing in workspace_root, warn and continue on
  optional copy failures, then run dependency setup such as pnpm install.

  For files that customize agent instructions and skills (AGENTS.md,
  .bb/AGENTS.md, .bb/skills/), run `bb guide agent-configuration`.

  bb environment show <id>                Show environment details (path, branch, status)

  bb environment update <id>              Update environment metadata
    --merge-base-branch <branch>          Set merge-base branch override
    --clear-merge-base-branch             Clear merge-base override

  bb environment commit <id>              Create a commit in the environment

  bb environment squash-merge <id>        Squash-merge into a target branch
    --merge-base-branch <branch>          Target branch (required)
