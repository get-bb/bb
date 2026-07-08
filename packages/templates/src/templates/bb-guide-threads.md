---
kind: instruction
title: bb Guide — Threads
summary: Command reference for thread spawning, inspecting, messaging, and lifecycle.
intent: Provide complete thread command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Thread commands

Every command supports --json for machine-readable output.

Spawning:

  bb thread spawn --project <id> --prompt "..." [options]

    --prompt <prompt>              Initial prompt (required)
    --title <title>                Thread title
    --project <id>                 Project (required)
    --parent-thread <id>           Parent thread
    --parent-self                  Parent to the current thread (BB_THREAD_ID)
    --provider <id>                Provider override
    --model <model>                Model override
    --reasoning-level <level>      Reasoning level: low, medium, high, xhigh, max (provider-dependent)
    --environment <id-or-path>     Attach to an existing environment (ID or workspace path)
    --new-environment <kind>       Create a new environment (worktree)
    --service-tier <tier>          Service tier: fast, default
    --permission-mode <mode>       Permission mode: full, workspace-write, or readonly

  Execution defaults resolve from explicit flags, live parent execution, project defaults, then product defaults.
  When spawning a subagent, pass --permission-mode full unless the user or task explicitly requests restricted access.
  Parenting is opt-in. Inside a thread, pass --parent-self to parent the new thread to the current thread.

Listing:

  bb thread list                           List threads
    --project <id>                         Filter by project
    --parent-thread <id>                   Filter by parent thread
    --archived                             Show only archived threads

Inspecting:

  bb thread show [id]                      Show thread details and pull request status
    --self                                 Target current thread
    --work-status                          Include git working-tree status
    --git-diff                             Include git diff
    --diff-target <type>                   Diff scope: uncommitted, branch_committed, all, commit
    --diff-sha <sha>                       Commit SHA (for --diff-target commit)
    --diff-merge-base <branch>             Override merge-base branch for diff
    --merge-base-branches                  List available merge-base branches

  Shows pull request status for the attached environment branch when available.

  bb thread log [id]                       Show thread event log
    --self                                 Target current thread
    --format <format>                      Output format: json, minimal, verbose
    --limit <count>                        Limit entries
    --after-seq <seq>                      Paginate after sequence number

  bb thread output [id]                    Get the final output of a thread
    --self                                 Target current thread

  bb thread wait <id>                      Wait for a thread status or event (defaults to --status idle)
    --status <status>                      Wait for this status
    --event <type>                         Wait for this event type
    --timeout <seconds>                    Timeout
    --poll-interval <ms>                   Polling interval in milliseconds

Opening files in the thread panel:

  bb thread open <path>                    Open a file in the current BB thread panel
  bb thread open <thread-id> <path>        Open a file in a specific BB thread panel
    --line <number>                        Line number to focus

  Inside a BB thread, BB_THREAD_ID selects the current thread automatically and
  the thread ID argument is omitted. Outside a BB thread, pass the thread ID as
  the first argument.

  Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace. Absolute paths under BB_THREAD_STORAGE open as
  thread-storage files for the current thread. Use this for Markdown or HTML
  artifacts you create for the user so they open in the BB IDE.

Thread terminals:

  Use thread terminals for long-running commands that should stay alive for the
  user, such as dev servers, watch tasks, REPLs, and database consoles. Terminals
  are real PTY sessions scoped to the thread's environment, and they appear in the
  bb UI as terminal tabs.

  bb thread terminal start <id> --command "pnpm dev"
    --title <title>                        Display title
    --cols <n>                             Initial terminal columns
    --rows <n>                             Initial terminal rows
    --attach                               Attach interactively after starting
    --json                                 Print the created terminal session

  bb thread terminal list <id>             List running terminals for a thread

  bb thread terminal attach <terminal-id> <id>
                                            Attach interactively; Ctrl-B d detaches

  bb thread terminal send <terminal-id> <id>
    --text <text>                          Text to send
    --stdin                                Read text from stdin
    --enter                                Append a newline

  bb thread terminal output <terminal-id> <id>
    --since-seq <n>                        Read output chunks from a sequence
    --tail-bytes <n>                       Bound output to latest N bytes
    --limit-chunks <n>                     Bound output to latest N chunks
    --json                                 Print chunks, nextSeq, and truncated

  bb thread terminal wait <terminal-id> <id>
    --contains <text>                      Wait for new output containing text
    --regex <pattern>                      Wait for new output matching regex
    --exit                                 Wait until the terminal exits
    --from-start                           Include existing scrollback
    --timeout <seconds>                    Timeout
    --poll-interval <ms>                   Polling interval

  bb thread terminal resize <terminal-id> <id> --cols <n> --rows <n>
  bb thread terminal stop <terminal-id> <id>

  Terminal commands require an explicit thread ID.

  For a dev server, prefer:

    bb thread terminal start <thread-id> --title "pnpm dev" --command "pnpm dev"
    bb thread terminal wait <terminal-id> <thread-id> --contains "Local:" --timeout 120

  Do not run long-lived servers as one-off foreground commands when the user will
  need to inspect logs, refresh the page, or stop the process later.

Messaging:

  bb thread tell <id> <message>            Send a follow-up message
    --mode <mode>                          Message mode: queue (default), steer, or auto
    --model <model>                        Model override for this turn
    --reasoning-level <level>              Reasoning level override

  bb thread stop [id]                      Stop an active or provisioning thread
    --self                                 Stop current thread

Ownership:

  bb thread update [id]                    Update thread metadata
    --self                                 Target current thread
    --title <title>                        Set title
    --parent-thread <id>                   Assign to a parent thread
    --clear-parent-thread                  Remove parent assignment

Lifecycle:

  bb thread archive [id]                   Archive a thread
    --self                                 Archive current thread

  bb thread unarchive [id]                 Unarchive a thread
    --self                                 Unarchive current thread

  bb thread delete <id>                    Delete permanently
    --yes                                  Skip confirmation

Read-only commands require a thread ID or --self where supported.
Mutating thread lifecycle and messaging commands require an explicit ID or --self.
Terminal commands require an explicit thread ID.
