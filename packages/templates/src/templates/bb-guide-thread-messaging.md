---
kind: instruction
title: bb Guide — Thread messaging
summary: Command reference for thread messages, ownership, interactions, and queued messages.
intent: Document how agents talk to threads and manage their queues.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Thread messaging

Messaging commands require an explicit thread ID or --self.

Messaging:

  bb thread tell <id> <message>            Send a follow-up message
  bb thread tell <id> --message-file <path>
                                           Read the message from a file; `-` reads stdin. Use this for
                                           multi-line or Markdown messages: inside double quotes the
                                           shell runs `backticks` and $(...) before bb sees them
    --mode <mode>                          Message mode: steer (default), queue, or auto
    --model <model>                        Model override for this turn
    --reasoning-level <level>              Reasoning level override
    --plan                                 Send the message as the provider's /plan action
    --send-at <when>                       Dispatch at an ISO 8601 timestamp or a duration from now (30s, 10m, 2h, 7d)
    --compact-first                        Compact the idle thread's context, then send when compaction finishes
    --file <path>                          CLI-local absolute path, file: URL, or uploaded file path
    --image <path>                         CLI-local absolute path, file: URL, or uploaded image path

  Tell steers by default, delivering the message immediately into the active
  turn. Use --mode queue for non-urgent follow-ups that can wait until the agent
  is free; --mode auto steers a live turn and starts a new one on an idle
  thread. Input sent while a turn is starting stays in the queue with
  `waitingOn: turn-starting`; `turn/started` wakes it and steers it into that
  turn. A target that is awaiting user interaction (an open question or
  approval) cannot take a prompt; tell then adds the message to the thread's
  queue and dispatches it once the interaction settles. That outcome is not a
  failure, so do not resend. `--json` reports `delivery` as `sent` or `queued`,
  and a queued answer carries the complete row as `queuedMessage`, including
  its `id`, `waitingOn`, and `sendAt`. A deferred message waits for a thread
  that failed while it was deferred, and delivers when the thread is retried.

  --plan sends the same structured /plan command the composer's plan action
  sends, so the agent proposes a plan for approval before executing (Claude
  Code and Codex threads). Providers without a declared plan action reject
  --plan with an error for both spawn and tell. Plain "/plan ..." text is not
  recognized; it reaches the provider as literal text. Approve or deny the proposed plan with
  `bb thread interactions`; `bb thread cancel-plan` leaves Plan mode early.
  SDK callers build the same input with
  `createBuiltinPlanCommandTextInput(text)` from `@bb/sdk` and pass it as
  `input` to `threads.spawn` or `threads.send`.

Ownership:

  bb thread update [id]                    Update thread metadata
    --self                                 Target current thread
    --title <title>                        Set title
    --parent-thread <id>                   Assign to a parent thread
    --clear-parent-thread                  Remove parent assignment
    --section <id>                         Move into a section
    --clear-section                        Remove section assignment
    --model <model>                        Set the sticky model for the next and later turns
    --reasoning-level <level>              Set the sticky reasoning level (provider-dependent)
    --visibility <visibility>              Set visible or hidden
    --parent-notifications <value>         Set auto, stuck, or off (applies to later outcomes)

  Clearing a parent inherits the former parent's section unless --section or
  --clear-section is also supplied. Children released by environment archiving
  also inherit their former parent's section.

  Model and reasoning updates stay within the thread's current provider. BB
  validates them against that provider's current model catalog, applies them on
  the next turn, and keeps using them on later turns until changed.

  bb thread regenerate-title [id]          Replace the title with a generated one
    --self                                 Target current thread

  regenerate-title asks the thread-title AI service (Settings → AI services)
  for a title built from the thread's first task message, its latest user
  messages, and the agent's latest replies, written in the task's language. It
  replaces the current title, including one set by hand, unless that title
  still fits. The title is kept when no service is available or generation
  fails, and the error says why. bb never regenerates on its own.
  SDK: `threads.experimental_regenerateTitle({ threadId })`.

  bb thread read [id]                      Mark read
  bb thread unread [id]                    Mark unread
  bb thread reorder-pinned <id> [--after <id>] [--before <id>]

Interactions:

  bb thread interactions list [id]         List a thread's pending and past interactions
  bb thread interactions show <interaction-id> [id]
                                           Show one interaction (approval details, questions, or a plugin form's data)
  bb thread interactions approve <interaction-id> [id]
                                           Allow a command, file-change, plan, or tool-use approval
  bb thread interactions deny <interaction-id> [id]
                                           Deny an approval
  bb thread interactions grant <interaction-id> [id] --scope turn|session
                                           Grant a permission interaction
  bb thread interactions answer <interaction-id> [id] --choice <questionId=value> --text <questionId=text>
                                           Answer a provider's user question
  bb thread interactions respond <interaction-id> [id] --value '<json>'
                                           Answer a plugin form: a plugin's own request, or a request the agent raised through a provider (kind `<pluginId>/<name>`)
    --self                                 Target current thread (every subcommand)
    --json                                 Machine-readable output (every subcommand)

  `answer` may skip questions that `show` marks Optional.
  `show` prints a plugin form's `Data` so you can shape the `--value` JSON.
  A provider's plugin-defined request cannot be cancelled; stop the thread to
  back out of it.

Queued messages:

  bb thread queue list [<thread-id>] [--wait-holder plugin:<plugin-id>]
  bb thread queue create <thread-id> <message> [--file <path>] [--image <path>]
  bb thread queue update <thread-id> <message-id> <message> [--file <path>] [--image <path>]
                                           create and update also take --message-file <path>
  bb thread queue send <thread-id> <message-id> [--mode auto|steer]
  bb thread queue reorder <thread-id> <message-id> [--after <id>] [--before <id>]
  bb thread queue group <thread-id> <boundary-id> --prefix <comma-separated-ids>
  bb thread queue delete <thread-id> <message-id>

  The `Sender` column identifies agent threads and system notices; user messages
  leave it blank. The SDK and `--json` include `initiator` and `senderThreadId`.
  SDK: `threads.queue.list` (all threads) and
  `threads.queuedMessages.list|send|update|delete` (one thread).

  A queued message is one that could not dispatch yet. It is not in the
  timeline or `thread log` until it dispatches; thread list rows carry
  `queuedWork: none|waiting|failed`. Every one carries a typed reason in its
  `Waiting on` column (`waitingOn.kind` in JSON: `thread-busy`,
  `turn-starting`, `provisioning`, `host-offline`, `interaction`, `time` for
  `Send at`, or `plugin` with `pluginId` and a reason). `queue list` with no thread id lists every
  queued row in the workspace; `--wait-holder plugin:<plugin-id>` narrows it to
  the rows one plugin is holding.

  The `State` column (`state` in the SDK and `--json`) is one of `queued` (next
  behind the running turn), `scheduled` (goes at `Send at`), `waiting` (held by
  its typed reason), `failed_retrying` (an automatic retry is booked),
  `failed_exhausted` (retries spent; waits for you), or `claimed` (a dispatch
  attempt is sending it).

  Failed rows show their failure reason instead of their previous wait, followed
  by a recovery command: `bb thread queue send <thread-id> <message-id>`.
  Use it to retry immediately, including after automatic retries are exhausted.
  Editing the message does not clear its failure or trigger a retry.

  `queue send` dispatches a row now, bypassing every plugin wait and its own
  schedule — the invariants (a running turn, an unfinished workspace, an
  unanswered interaction) still apply, and a message that hits one simply queues
  again. `--mode steer` uses those same send-now bypasses and re-attempts the row
  as a steer; it does not bypass the invariants, so a provisioning row remains
  queued until the workspace is ready.
  `queue delete` discards it instead. Both are always permitted.

  --compact-first runs the same /compact turn as `bb thread compact` and queues
  the message behind it, so it needs an idle or errored thread whose provider
  supports manual compaction; it cannot be combined with --send-at. The SDK
  takes `compactFirst: true` on `threads.send`, which also rejects
  `mode: "steer"`.

  --send-at takes an ISO 8601 timestamp (2026-08-25T09:00, local without an
  offset) or a duration from now (30s, 10m, 2h, 7d). A time that has already
  passed is rejected, as is a bare date, which has no time of day. Several
  queued rows on one thread are normal: two scheduled sends coexist. A
  scheduled spawn creates a `pending` thread and does no environment work (no
  worktree, no setup script) until it is due. The SDK takes `sendAt` in epoch
  milliseconds on `threads.spawn` and `threads.send`.

Application links in messages:

  Use an explicit Markdown link such as `[Review note](reflect://note/Project%20X)`
  or `[Open issue](linear://issue/ABC-123)`. The receiving user clicks the link
  to open it on their viewing device; sending or rendering a message never
  launches an application. Bare custom-scheme text is not auto-linked.

  Enable with `bb settings experiment applicationLinks true` or Settings →
  Experiments → Application links. BB asks before launching unless the user
  chose Always allow for that scheme on this BB site and device. Settings →
  General → Application link approvals can revoke saved choices. Executable
  web schemes and reserved editor-action
  schemes remain blocked. Existing editor file links keep their file-opening
  behavior. Desktop and native mobile clients need application-link support
  (mobile bridge version 3); older clients show an update message. Web browsers
  handle their own OS handoff and cannot reliably report missing applications.
