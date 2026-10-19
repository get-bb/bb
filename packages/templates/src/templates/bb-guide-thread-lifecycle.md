---
kind: instruction
title: bb Guide — Thread lifecycle
summary: Command reference for retrying, stopping, archiving, clearing, compacting, and deleting threads.
intent: Document how agents recover and end threads.
editingNotes: Keep flags accurate against the CLI implementation. Run the json-flag-enforcement and command-output tests after changes.
---
Thread lifecycle

Lifecycle commands require an explicit thread ID or --self.

Lifecycle:

  bb thread stop [id]                      Stop work and release the agent runtime
  bb thread compact [id]                   Request compaction of an idle or errored thread's context
  bb thread clear [id]                     Clear model context for an idle or failed thread
  bb thread cancel-plan [id]               Exit the provider's active Plan mode
  bb thread clear-goal [id]                Clear the provider's active Goal
    --self                                 Target current thread

  cancel-plan and clear-goal wait for the provider to confirm.
  `thread compact` enqueues the same structured /compact turn used by the
  composer. Follow the thread timeline for the eventual compaction result.
  `thread clear` keeps the BB thread, workspace, durable event history, and
  sticky execution settings. Its active timeline starts at one visible
  `Context cleared` boundary, and its next prompt starts a fresh provider
  conversation in the same thread. With
  `bb settings general keepHistoryAfterContextClear true`, earlier messages
  stay visible above that boundary. It is also the recovery for a send refused
  with `provider_session_unavailable` (`details.reason` foreign, ambiguous, or
  invalid: the recorded provider session belongs to another thread or has no
  usable identity).

  bb thread retry [id]                     Retry the thread's failed turn
    --self                                 Target current thread
    --turn <requestId>                     Retry this turn request id specifically; fails when it is not the thread's failed turn
    --send-at <when>                       Dispatch at an ISO 8601 timestamp or a duration from now (30s, 10m, 2h, 7d)
    --reason <text>                        Why it is being retried, shown on the queued row

  Retry re-submits the failed turn by reference: no duplicated user message in
  the timeline, and an attempt number that increments (2 is the first retry).
  What the provider is sent follows its own acceptance record — an input it
  never accepted is re-sent verbatim, while an accepted turn (already in the
  provider's conversation) is continued with a nudge rather than asked twice.
  With no --turn it retries the most recent turn, the
  one whose failure put the thread in error; --turn asserts which turn you mean
  and fails when the thread has moved on, as does retrying a thread that has not
  failed (`no_failed_turn`) or a turn that already has a retry queued
  (`retry_already_queued`). Without --send-at the retry
  is attempted now, and may still queue behind a busy thread or a plugin.
  SDK: `threads.retry({ threadId, turnRequestId?, sendAt?, reason? })`.

  bb thread archive [id]                   Archive a thread (and children/hidden forks)
    --self                                 Archive current thread

  Archive is not a hard stop: for 30 seconds a running turn and the thread's
  terminals keep going, and unarchiving within that window leaves everything in
  place. Use `thread stop` to end a run now.

  `thread stop` preserves the thread history, metadata, environment, and future
  resume behavior. It stops active work and releases an idle agent runtime (bb
  also releases a runtime on its own after 30 idle minutes).
  The command succeeds when no runtime is loaded. Archive a finished hidden
  worker first, then stop it to release memory promptly. A stop that only
  releases an idle runtime adds no interruption: it leaves the timeline and any
  pending interaction of that thread untouched. An explicit stop wins over work
  that is still running: when the machine still runs a turn for a thread the app
  shows as idle or failed, or a turn starts while the stop is being delivered,
  the stop interrupts that turn and waits for the attempt. If the interrupt
  fails, the thread remains stopping; check `bb thread show <id> --json` before
  treating the stop as confirmed.

  bb thread unarchive [id]                 Unarchive a thread
    --self                                 Unarchive current thread

  bb thread restore-environment [id]       Restore a destroyed workspace
    --self                                 Restore current thread

  Archiving a thread retires its environment, and a managed workspace is removed
  from disk once the provider's grace window passes. Sending to a thread whose
  workspace is gone fails; `restore-environment` asks the environment provider
  to build it again and attaches it, leaving the conversation where it was.
  Each provider decides what that means: a worktree is re-created on the branch
  it held, a project checkout switches back to that branch, and a personal
  workspace cannot be restored. It starts no turn — the thread settles back to
  idle with a live workspace (check `canRestoreEnvironment` on `bb thread show
  --json`). Unarchive the thread first; the command is refused while the thread
  is archived, while its workspace is still there, and when the provider does
  not restore, is gone, or its machine is gone. Uncommitted changes in the
  removed workspace are not recoverable.

  bb thread delete <id>                    Delete permanently
    --yes                                  Skip confirmation

  Deleting a thread removes its record immediately, but provider-owned
  environment cleanup is asynchronous. Use `bb environment show <id>` to
  inspect teardown until the lifecycle reaches destroyed. Deleting thread
  storage first stops processes whose working directory is inside it,
  including dev servers in nested checkouts (macOS and Linux only).
