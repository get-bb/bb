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
  Parenting is opt-in. Inside a thread, pass --parent-self to parent the new thread to the current thread.

Listing:

  bb thread list                           List threads
    --project <id>                         Filter by project
    --parent-thread <id>                   Filter by parent thread
    --archived                             Show only archived threads

Inspecting:

  bb thread show [id]                      Show thread details (defaults to BB_THREAD_ID)
    --self                                 Target current thread
    --work-status                          Include git working-tree status
    --git-diff                             Include git diff
    --diff-target <type>                   Diff scope: uncommitted, branch_committed, all, commit
    --diff-sha <sha>                       Commit SHA (for --diff-target commit)
    --diff-merge-base <branch>             Override merge-base branch for diff
    --merge-base-branches                  List available merge-base branches

  bb thread log [id]                       Show thread event log
    --self                                 Target current thread
    --format <format>                      Output format: json, minimal, verbose
    --limit <count>                        Limit entries
    --after-seq <seq>                      Paginate after sequence number

  bb thread output [id]                    Get the final output of a thread (defaults to BB_THREAD_ID)
    --self                                 Target current thread

  bb thread wait [id]                      Wait for a thread status or event (defaults to --status idle)
    --status <status>                      Wait for this status
    --event <type>                         Wait for this event type
    --timeout <seconds>                    Timeout
    --poll-interval <ms>                   Polling interval in milliseconds

Opening files in the IDE:

  bb thread open <file> [id]               Open a file in the thread's IDE side panel (defaults to BB_THREAD_ID)
    --self                                 Target current thread
    --source <source>                      Path root: workspace (default) or thread-storage
    --line <number>                        Line number to scroll to

  When the user asks you to open, show, or pull up a file, use bb thread open so it
  appears in their IDE side panel. The path is workspace-relative (or thread-storage
  relative with --source thread-storage). It opens for any connected client viewing the
  thread now, or when the user next switches to it.

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

Read-only commands infer the thread from BB_THREAD_ID.
Mutating commands require an explicit ID or --self.
