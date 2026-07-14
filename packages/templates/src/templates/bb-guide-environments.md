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

  For files that customize agent instructions and skills (AGENTS.md,
  .bb/AGENTS.md, .bb/skills/), run `bb guide agent-configuration`.

  bb environment show <id>                Show environment details (path, branch, status)

  bb environment update <id>              Update environment metadata
    --merge-base-branch <branch>          Set merge-base branch override
    --clear-merge-base-branch             Clear merge-base override

  bb environment commit <id>              Create a commit in the environment

  bb environment squash-merge <id>        Squash-merge into a target branch
    --merge-base-branch <branch>          Target branch (required)

  bb environment archive-threads <id>     Archive all threads in an environment

  bb environment pull-request ready <id>  Mark a pull request ready
  bb environment pull-request draft <id>  Convert a pull request to draft
  bb environment pull-request merge <id>  Merge a pull request
    --method <method>                     merge, squash, or rebase

Remote access (bb connect):

  Expose this bb server at <handle>.getbb.app so you can reach it from any
  browser. Claim a handle at https://getbb.app, copy the connect command it
  generates, then run it here to
  pair:

  bb connect --code <code> --server https://<handle>.getbb.app
    --code <code>          One-time pairing code from the dashboard
    --server <url>         https://<handle>.getbb.app (from the dashboard)

  Pairing returns immediately: the bb SERVER redeems the code, stores the
  credential, and holds the tunnel itself — so it stays up as long as bb is
  running and reconnects on restart (no foreground process).
  Without an installed bb, pair via npm:
  `npx -p bb-app@latest bb connect --code <code> --server <url>`.

  bb connect status                       Show the server's connect status
  bb connect off                          Disconnect and forget the pairing
  bb connect expose <port> [--host <name-or-id>]    Share a host's HTTP port
  bb connect unexpose <port> [--host <name-or-id>]  Stop sharing on that host
  bb connect shares [--host <name-or-id>]           List that host's shares
  bb connect servers                      List every bb on this account (handle, url, live)

  Port sharing works from threads on any enrolled host. In a thread,
  `bb connect expose <port>` resolves the thread environment's host; outside a
  thread it defaults to the server host. `--host <name-or-id>` overrides that
  choice for expose, unexpose, and shares. Server-host URLs use
  `https://<server-label>--<port>.getbb.app`; machine-host URLs use
  `https://<machine-label>--<port>.getbb.app` and proxy directly through that
  machine's daemon. Access is owner-session-gated — only viewers signed into
  the owner's getbb.app account can open the URL; it is not a public internet
  link. Agents should run expose from the thread that started the server, share
  the returned URL, and unexpose from the same thread when it stops.
  `bb connect status` shows all shares with host + URL. `shares --json` returns
  the resolved `host` and rows with `hostId`, `hostName`, `port`, and `url`.

  Remote access is owned by the builtin "connect" plugin (Settings → Connect
  shows the URL, QR code, and shared ports). Disabling the plugin
  (`bb plugin disable connect`) cuts off all remote access; re-enable with
  `bb plugin enable connect`.
