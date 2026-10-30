---
kind: instruction
title: bb Guide — Thread inspection
summary: Command reference for listing, inspecting, waiting on, and opening threads.
intent: Document how agents find threads and read their state.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Thread inspection

Read-only commands take a thread ID or --self where supported.

Listing:

  bb thread list                           List threads
    --project <id>                         Filter by project
    --environment <id>                     Filter by environment
    --machine <id-or-name>                 Filter by the machine the environment is on (alias --host)
    --parent-thread <id>                   Filter by parent thread
    --thread <id>                          Only this thread; unknown or deleted IDs are left out (repeatable, up to 200)
    --archived                             Show only archived threads
    --section <id>                         Filter by section
    --unsectioned                          Show only threads outside sections
    --include-hidden                       Include hidden threads

  The table prints ID, Title, Project, and Status. Title uses the thread
  title, then the fallback title from the first prompt, then "-". Long
  titles are cut at 60 characters. Project shows the project name; the
  personal project shows "-". Use --json for the full thread records.

  bb thread search <query> [--limit <1-50>]
                                             Search threads and messages
  bb thread history <id>                   List prompt history

  bb thread count                          Count threads without listing them
    --status <status>                      Count threads in this status: pending, idle, starting, active, stopping, error
    --host <id>                            Count threads whose environment is on this machine
    --provider <id>                        Count threads running on this provider
    --project <id>                         Count threads in this project
    --parent <id|none>                     Count one thread's children, or 'none' for threads with no parent
    --by <dimension>                       Group the count by host, provider, or project

  Counting happens in the database, so use it instead of listing threads and
  counting rows: `bb thread list` pages a bounded window and would miscount
  (SDK: `threads.count({ status, hostId, providerId, projectId, parentThreadId, groupBy })`).
  Archived, deleted, and hidden threads are excluded. Without --by the command
  prints one number; with --by it prints a count per group (threads with no
  host/provider/project group under "-") followed by the total.

Sections:

  bb thread section list
  bb thread section create <name>
  bb thread section rename <id> <name>
  bb thread section delete <id> [--yes]

Inspecting:

  bb thread context [id]                   Show recorded context usage and available breakdown (--self, --json)
  bb thread commands [id]                  List the slash commands the thread's agent has advertised (--self, --json)
  bb thread options [id]                   List the session options the agent reports, with current values (--self, --json)
    --set <option=value>                   Choose a value, applied on the thread's next turn (repeatable)
    --clear <option>                       Drop a choice that has not been applied yet (repeatable)
  bb thread show [id]                      Show thread details and pull request status
    --self                                 Target current thread
    --work-status                          Include git working-tree status
    --git-diff                             Include git diff
    --diff-target <type>                   Diff scope: uncommitted, branch_committed, all, commit
    --diff-sha <sha>                       Commit SHA (for --diff-target commit)
    --diff-merge-base <branch>             Override merge-base branch for diff

  Shows pull request status for the attached environment branch when available.

  `thread context` reads the latest stored context measurement without starting
  a provider request; `--json` prints `{ usage: ... }` (`null` when unavailable).
  Claude Code includes an estimated breakdown when available; other providers
  report totals. When the provider reports the session's cumulative cost,
  `usage.cost` is `{ amount, currency }`. With the `compactExpiredCache`
  experiment on, `usage.compactionOfferAt` is when the provider's prompt cache
  for this context expires (Claude Code and Pi report cache lifetimes); after
  it, `bb thread tell --compact-first` avoids re-reading the context uncached.

  `thread commands` lists the slash commands advertised for the current
  session; ACP agents and Claude Code report these live, so the list is empty
  until the agent sends one. `bb project commands` also lists Claude Code's
  commands before a thread starts. `thread options --set` takes `true` or `false` for an on/off
  option; `bb provider models <provider>` lists the options a model declares.

  bb thread log [id]                       Show thread event log
    --self                                 Target current thread
    --format <format>                      Output format: json, minimal, verbose
    --limit <count>                        Max entries: events for json (oldest first, default 100);
                                           user-message turns for minimal/verbose (newest first, default 20, max 100)
    --after-seq <seq>                      Paginate after sequence number (json only)
    --all                                  Print the whole thread, paging through every entry
    --message <seq>                        Print one message
    --context <count>                      With --message, also print this many messages around it (max 20)

  Human formats end with a notice when older history was omitted; --json warns
  on stderr when more events exist beyond the printed page. Human-format --all
  walks a consistent history snapshot and joins paginated group contents.
  Appends stay outside that walk; rerun the command if a history edit invalidates it.

  bb thread output [id]                    Get the final output of a thread
    --self                                 Target current thread

  bb thread wait <id>                      Wait for a thread status or event (defaults to --status idle)
    --status <status>                      Wait for this status
    --event <type>                         Wait for this event type
    --timeout <duration>                   Seconds, or a duration with a unit: 90s, 20m, 4h (default: 1200s / 20 min)
    --poll-interval <duration>             Milliseconds, or a duration with a unit

Opening threads and files in the app:

  In chat, reference a thread as @thread:thr_abc123, substituting its actual ID.
  BB renders the correct project-aware link; do not construct thread URLs manually.
  (Pasting a bb thread URL into the app composer converts it to the same mention;
  CLI prompts are not converted, so use @thread:<id>.)
  Reference one message as @thread:thr_abc123#msg=42, taking the number from
  sourceSeq in `bb thread search --json`. Read it, or a copied message link
  (…/threads/thr_abc123#msg=42), with `bb thread log thr_abc123 --message 42`.

  bb thread open <path>                    Open a file in the current BB thread panel
  bb thread open <thread-id> [path]        Open a thread, optionally with a panel file
    --line <number>                        Line number to focus
    --split <placement>                    right, down, left, top, or replace (default)
  bb thread pane <action> [thread-id]      Maximize, restore, toggle, spotlight, or clear spotlight

  Inside a BB thread, BB_THREAD_ID selects the current thread automatically and
  the thread ID argument is omitted for file-only opens. Outside a BB thread,
  pass the thread ID as the first argument. A thread already open in a pane is focused instead of
  duplicated. Edge placement creates panes through the eighth pane; at eight
  panes, it replaces the focused pane.
  Pane actions broadcast to connected BB app windows and affect the matching
  already-open pane without changing its split tree, and report how many
  clients received the action (SDK: `threads.paneAction({ threadId, action })`).
  Spotlight focuses that
  pane and dims the others; clear-spotlight focuses it and removes split dimming.
  The app command `pane.maximize.toggle` (default `Mod+Shift+E`) maximizes or
  restores the focused split pane and can be rebound with `bb settings keyboard set`.
  Paths can be thread-relative workspace paths, or absolute paths inside the
  target thread workspace. Absolute paths under BB_THREAD_STORAGE open as
  thread-storage files for the current thread. Use this for Markdown or HTML
  artifacts you create for the user so they open in the BB IDE.

Persisted panel tabs:

  bb thread tabs show <thread-id>
  bb thread tabs set <thread-id> --expected-revision <n> --tabs-json '<json>'

Core Info uses plugin id `core` and tab id `info`; Diff belongs to the Git plugin, plugin id `bb--git` and tab id `diff`. Legacy `thread-info`, `git-diff` and `core` `diff` entries convert automatically without changing their order.

Pinned plugin tabs use `{ "id": "plugin-fixed:<plugin-id>:<tab-id>", "kind": "plugin-fixed", "pluginId": "<plugin-id>", "tabId": "<tab-id>" }`.
The id encodes each plugin/tab id with percent escapes. The app shows registered,
visible tabs and retains saved identities while plugins are hidden or disabled.
The SDK uses `threads.tabs.get({ threadId })` and
`threads.tabs.update({ threadId, expectedRevision, tabs })` for the same state.
Selection stays local to each client. Plugin authors can find registration and
navigation details in the Plugin Guide's Thread side-panel tabs surface.
