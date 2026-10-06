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
The first-party choices are Project checkout (the project's existing directory),
Worktree (a fresh Git worktree), and Personal workspace (a projectless workspace).

Making your repo work with bb:

  If the default environment plugin is disabled or missing, creation fails
  before inserting a thread. Enable the plugin or explicitly choose another
  environment; BB does not silently replace an isolated worktree with a checkout.
  Host-dependent preflight checks require the selected machine to be connected.

  Commit a .bb-env-setup.sh script at the repo root when new bb worktrees need
  repo-specific setup. After bb creates a new managed worktree environment, it
  looks for .bb-env-setup.sh inside that new workspace. If the file is absent,
  provisioning continues with no error.

  The script must be tracked by git. A fresh worktree only checks out tracked
  files, so an untracked .bb-env-setup.sh in your source checkout will not be
  present and will not run.

  BB runs the hook as `env bash .bb-env-setup.sh` with cwd set to the new
  workspace. On Windows it runs the script with the bash that Git for Windows
  installs, so the same script works there; without Git for Windows the hook
  fails with a message naming it. The hook
  inherits the host daemon's sanitized environment: NODE_ENV and every BB_*
  variable are removed, and bb does not inject BB_PROJECT_ID, BB_ENVIRONMENT_ID,
  or BB_SOURCE_PATH.

  Hooks run only in paths bb created and owns, such as new worktrees and
  checkouts bb cloned; attached project checkouts and personal workspaces never
  run hooks. A server restart does not interrupt a running hook, but a daemon
  restart leaves its outcome unknown.

  A non-zero exit, timeout (15 minutes), signal, or cancellation fails provisioning and bb
  removes the new worktree after confirming the script has stopped. An unknown
  hook outcome blocks automatic cleanup and requires inspection before recovery.
  Keep optional setup steps non-fatal inside the
  script if the environment should still open. Provisioning progress reports
  "Running .bb-env-setup.sh" and then ".bb-env-setup.sh finished",
  ".bb-env-setup.sh failed", or ".bb-env-setup.sh cancelled".

  Commit a .bb-env-teardown.sh script at the repo root when setup creates
  resources outside the managed worktree. BB runs the hook as
  `env bash .bb-env-teardown.sh` from the worktree before it removes the
  worktree. The hook receives the same sanitized environment as the setup
  hook, and stdin is closed.

  Teardown has a separate 15-minute timeout. A non-zero exit, timeout, or
  signal reports failure in the destroy transcript, but bb still removes the
  worktree once the script has stopped. An unreachable daemon leaves cleanup
  pending for retry; a hook whose outcome is unknown blocks cleanup with an
  explicit error.

  New worktrees do not contain untracked files such as .env.local. To copy
  them from the source checkout, commit a .worktreeinclude file at the repo
  root. It uses gitignore syntax: one pattern per line, # for comments, ! to
  negate an earlier pattern. bb copies each untracked file in the source
  checkout that matches a pattern:

    .env
    .env.*
    !.env.example
    certs/

  bb copies files only. It follows no symlinks, and it replaces nothing that
  the worktree already has. The copy runs after `git worktree add` and before
  .bb-env-setup.sh, so the setup script can read the copied files. A pattern
  that matches nothing, or a file bb cannot read, is reported in the
  provisioning transcript and does not fail provisioning.

  Large directories such as node_modules are copied file by file. Install
  dependencies in .bb-env-setup.sh instead of listing them here.

  For files that customize agent instructions and skills (AGENTS.md,
  .bb/AGENTS.md, .bb/skills/), run `bb guide agent-configuration`.

  bb environment providers                List registered environment providers in picker order:
                                          Project checkout, Worktree, then other installed providers
                                          by display name; includes id, name, the `requires` facts (host,
                                          projectCheckout, gitCheckout, gitRemote, projectless), and whether
                                          it takes --environment-inputs (--json prints the JSON Schema,
                                          description, icon, and availability)
    --project <id>                        Filter by structural eligibility for this project
    --machine <id-or-name>               Scope structural eligibility to this machine
    --host <id-or-name>                  Alias for --machine

  With --project, providers whose requirements are unmet on every persistent
  machine are omitted, and `--json` reports each provider's
  `machineAvailability` per machine. Add --machine to print that machine's
  availability: `available`, `setup-required`, `unavailable` with the plugin's
  reason, or `unknown` while the background check has not answered. Listing
  never waits on a machine; results can be up to ten minutes old, and thread
  creation checks the selected provider and machine afresh.
  bb environment list                     List environments that are not destroyed
    --project <id>                        Only environments in this project
    --provider <id>                       Only environments this environment provider produced
    --host <id-or-name>                   Only environments on this machine
    --instance-key <key>                  Only the environment its provider named with
                                          this instance key (with --provider, the one
                                          row that provider's launch produced)
    --status <status>                     Only environments in this status: provisioning,
                                          ready, error, destroyed (the only way to see
                                          destroyed rows)
    --limit <n> / --offset <n>            Page through the rows, oldest first
  bb environment delete <id>              Request provider cleanup; refused while threads are
                                          live or stopping. The command returns with cleanup
                                          requested; lifecycle becomes destroyed only after
                                          provider removal completes
  bb environment cleanup <id>             Remove an unused provider-managed environment now
  bb environment show <id>                Show environment details (path, branch, status, lifecycle, retirement deadline and teardown attempts)

  bb environment status <id>              Show workspace status
    --merge-base-branch <branch>          Include merge-base status

  bb environment branches <id>            List local and remote branches
    --query <query>                       Filter branch names
    --limit <count>                       Limit local and remote results

  bb environment paths <id>               Search workspace paths
    --query <query>                       Fuzzy path query
    --limit <count>                       Maximum results
    --files                               Include only files unless combined with --directories
    --directories                         Include only directories unless combined with --files

  bb environment diff <id>                Show file summary and full git diff
  bb environment diff-files <id>          List changed-file metadata
    --target <target>                     uncommitted, branch_committed, all, or commit (required)
    --merge-base-branch <branch>          Required for branch_committed and all
    --sha <sha>                           Required for commit

  bb environment diff-file <id>           Read one side of a changed file
    --target <target>                     Diff target (required)
    --path <path>                         Repository-relative path (required)
    --side <old|new>                      File side (required)
    --merge-base-ref <sha>                Required for branch_committed and all
    --sha <sha>                           Required for commit

  bb environment diff-patch <id>          Fetch selected file patches
    --target <target>                     Diff target (required)
    --path <path>                         Changed path; repeat for multiple files (required)
    --merge-base-branch <branch>          Required for branch_committed and all
    --sha <sha>                           Required for commit

  bb environment update <id>              Update environment metadata
    --merge-base-branch <branch>          Set merge-base branch override
    --clear-merge-base-branch             Clear merge-base override
    --name <name>                         Set display name
    --clear-name                          Clear display name

  bb environment commit <id>              Create a commit in the environment

  bb environment archive-threads <id>     Archive all threads in an environment

  After the last live thread is archived, the environment provider's policy
  sets a retirement deadline; checkout environments never retire. A worktree
  waits five minutes and then tears down: it runs .bb-env-teardown.sh, stops
  every process whose working directory is inside the worktree (the agent
  process, background jobs it left behind, and also shells, editors, or
  servers you started there yourself), removes the worktree, and records the
  environment as destroyed. The branch is kept. Unarchiving a thread inside
  the grace window cancels the teardown. Move your own shells out of the
  worktree first if you want to keep them. Deleting the last thread, or an
  explicit environment or project deletion, skips the grace (including a
  never-retire policy). Failed teardown retries automatically;
  `bb environment show <id>` reports the lifecycle phase, deadline, teardown
  attempt, and failure message.

  `bb environment cleanup <id> [--json]` overrides retention and retry backoff
  to remove an unused provider-managed environment early. It is not a routine
  end-of-task step. It rejects live threads and unmanaged environments,
  succeeds if already removed, and completes asynchronously.

  bb environment pull-request show <id>   Inspect a pull request
  bb environment pull-request ready <id>  Mark a pull request ready
  bb environment pull-request draft <id>  Convert a pull request to draft
  bb environment pull-request merge <id>  Merge a pull request
    --method <method>                     merge, squash, or rebase

Every inspection command accepts an arbitrary environment ID and supports
`--json`. Non-git status/diff responses are reported explicitly. `diff-file`
prints UTF-8 content directly and labels base64 binary content; diff and patch
truncation markers are preserved.
