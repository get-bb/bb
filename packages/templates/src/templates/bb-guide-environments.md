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

  Commit a .bb-env-setup.sh script at the repo root when new bb worktrees need
  repo-specific setup. After bb creates a new managed worktree environment, it
  looks for .bb-env-setup.sh inside that new workspace. If the file is absent,
  provisioning continues with no error.

  The script must be tracked by git. A fresh worktree only checks out tracked
  files, so an untracked .bb-env-setup.sh in your source checkout will not be
  present and will not run.

  BB runs the hook as `env bash .bb-env-setup.sh` with cwd set to the new
  workspace. POSIX shell setup scripts are not supported on Windows. The hook
  inherits the host daemon's sanitized environment: NODE_ENV and every BB_*
  variable are removed, and bb does not inject BB_PROJECT_ID, BB_ENVIRONMENT_ID,
  or BB_SOURCE_PATH.

  The hook runs only for newly-created managed worktree environments. It does
  not run for direct/project-checkout environments, personal scratch workspaces,
  or reconnecting an existing managed worktree.

  A non-zero exit, timeout, signal, or cancellation fails provisioning and bb
  removes the new worktree. Keep optional setup steps non-fatal inside the
  script if the environment should still open. Provisioning progress reports
  "Running .bb-env-setup.sh" and then ".bb-env-setup.sh finished",
  ".bb-env-setup.sh failed", or ".bb-env-setup.sh cancelled".

  New worktrees do not contain gitignored files such as .env.local. To copy
  them from the original checkout, locate the source root through git's common
  directory:

    common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
    source_root=$(dirname "$common_dir")
    workspace_root=$(pwd -P)

  A real setup script should then copy a fixed list of needed env files if they
  exist in source_root and are missing in workspace_root, warn and continue on
  optional copy failures, then run dependency setup such as pnpm install.

  bb environment show <id>                Show environment details (path, branch, status)

  bb environment update <id>              Update environment metadata
    --merge-base-branch <branch>          Set merge-base branch override
    --clear-merge-base-branch             Clear merge-base override

  bb environment commit <id>              Create a commit in the environment

  bb environment squash-merge <id>        Squash-merge into a target branch
    --merge-base-branch <branch>          Target branch (required)
