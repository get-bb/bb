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
    --base-branch <branch>         Base branch for a new managed worktree
    --machine <id-or-name>         Run on a machine (--host is an alias)
    --service-tier <tier>          Service tier: fast, default
    --permission-mode <mode>       Permission mode: full, workspace-write, or readonly
    --folder <id>                  Create the thread in a folder
    --visibility <visibility>      visible (default) or hidden
    --file <path>                  Host-readable absolute or uploaded file path
    --image <path>                 Host-readable absolute or uploaded image path
    --origin-kind <kind>           Create a fork or side-chat thread
    --source-thread <id>           Source thread for fork/side-chat
    --source-seq-end <seq>         Last included source event sequence

  Execution defaults resolve from explicit flags, live parent execution, project defaults, then product defaults.
  When spawning a subagent, pass --permission-mode full unless the user or task explicitly requests restricted access.
  Parenting is opt-in. Inside a thread, pass --parent-self to parent the new thread to the current thread.
  Hidden threads are for plugin/background workers. They remain addressable by
  ID while staying out of sidebar organization, unread/pending favicon
  attention, and native parent notifications. Ordinary list, search, history,
  folder, lifecycle, parent-operation, and direct-open behavior is unchanged.
  A machine selector accepts an exact ID or an unambiguous name. It works with
  an unmanaged --environment path, --new-environment worktree, or the personal
  workspace. It cannot be combined with an existing environment ID because that
  environment already selects its machine. Without the flag, local/primary
  machine resolution is unchanged.

Listing:

  bb thread list                           List threads
    --project <id>                         Filter by project
    --parent-thread <id>                   Filter by parent thread
    --archived                             Show only archived threads
    --folder <id>                          Filter by folder
    --unfiled                              Show only threads outside folders

  bb thread search <query>                 Search threads and messages
  bb thread history <id>                   List prompt history

Folders:

  bb thread folder list
  bb thread folder create <name>
  bb thread folder rename <id> <name>
  bb thread folder delete <id> [--yes]

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
    --timeout <seconds>                    Timeout in seconds (default: 1200 / 20 min)
    --poll-interval <ms>                   Polling interval in milliseconds

Opening threads and files in the app:

  bb thread open <path>                    Open a file in the current BB thread panel
  bb thread open <thread-id> [path]        Open a thread, optionally with a panel file
    --line <number>                        Line number to focus
    --split <placement>                    right, down, left, top, or replace (requires Thread splits)

  Inside a BB thread, BB_THREAD_ID selects the current thread automatically and
  the thread ID argument is omitted for file-only opens. Pass an explicit thread
  ID with --split to open another thread. Outside a BB thread, pass the thread ID
  as the first argument. A thread already open in a pane is focused instead of
  duplicated. Edge placement creates panes through the eighth pane; at eight
  panes, it replaces the focused pane.
  Enable the "Thread splits" experiment in Settings → Experiments before using
  --split; ordinary thread/file opens without --split remain available while off.
  Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace. Absolute paths under BB_THREAD_STORAGE open as
  thread-storage files for the current thread. Use this for Markdown or HTML
  artifacts you create for the user so they open in the BB IDE.

Messaging:

  bb thread tell <id> <message>            Send a follow-up message
    --mode <mode>                          Message mode: queue (default), steer, or auto
    --model <model>                        Model override for this turn
    --reasoning-level <level>              Reasoning level override
    --file <path>                          Host-readable absolute or uploaded file path
    --image <path>                         Host-readable absolute or uploaded image path

  By default, tell queues: if the agent is working, the message is delivered
  after the current turn finishes. Use --mode steer to send immediately into
  the active turn. Prefer steer for urgent redirects; prefer queue for
  non-urgent follow-ups that can wait until the agent is free.

  bb thread stop [id]                      Stop an active or provisioning thread
    --self                                 Stop current thread

Ownership:

  bb thread update [id]                    Update thread metadata
    --self                                 Target current thread
    --title <title>                        Set title
    --parent-thread <id>                   Assign to a parent thread
    --clear-parent-thread                  Remove parent assignment
    --folder <id>                          Move into a folder
    --clear-folder                         Remove folder assignment

  bb thread read [id]                      Mark read
  bb thread unread [id]                    Mark unread
  bb thread reorder-pinned <id> [--after <id>] [--before <id>]

Queued messages:

  bb thread queue list <thread-id>
  bb thread queue create <thread-id> <message>
  bb thread queue update <thread-id> <message-id> <message>
  bb thread queue send <thread-id> <message-id> [--mode auto|steer]
  bb thread queue reorder <thread-id> <message-id> [--after <id>] [--before <id>]
  bb thread queue group <thread-id> <boundary-id> --prefix <comma-separated-ids>
  bb thread queue delete <thread-id> <message-id>

Persisted panel tabs:

  bb thread tabs show <thread-id>
  bb thread tabs set <thread-id> --expected-revision <n> --tabs-json '<json>'

Lifecycle:

  bb thread archive [id]                   Archive a thread (and children/side chats)
    --self                                 Archive current thread

  bb thread unarchive [id]                 Unarchive a thread
    --self                                 Unarchive current thread

  bb thread delete <id>                    Delete permanently
    --yes                                  Skip confirmation

Read-only commands require a thread ID or --self where supported.
Mutating thread lifecycle and messaging commands require an explicit ID or --self.
