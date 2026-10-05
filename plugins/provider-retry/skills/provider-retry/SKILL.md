---
name: provider-retry
description: "Diagnose automatic retries of BB turns after provider overloads and subscription-window limits."
---

# Provider retry

The plugin is enabled on fresh installations. It reacts only to failed Codex
and Claude Code turns and never blocks a send; prior output or tool activity
does not prevent a retry. It queues the original input verbatim, marked
agent-only, for one of two failures:

- A structured provider overload: retried after a short delay that doubles on
  each attempt.
- A subscription-window limit with a reported reset time: retried shortly
  after the window opens, with random spread so threads on one account do not
  wake together. Credit and spend limits are not retried.

A turn gets at most four automatic retries. The `maximumWait` setting
(`6 hours` by default, or `24 hours` or `No limit`) skips a subscription-limit
retry whose reset is farther away:
`bb plugin config provider-retry set maximumWait "24 hours"`.

A pending retry is an ordinary durable queued row, shown on the thread's queue
card with its reason and time, and survives restart.

```sh
bb provider-retry status [thread-id] [--json]
bb provider-retry retry <thread-id> [--json]
bb provider-retry cancel <thread-id> [--json]
```

`status` defaults to the current thread and lists every thread outside one.
`retry` sends the pending row now; `cancel` deletes it. Inspect the failed turn
before retrying manually, and avoid duplicating an existing queued retry. Use
the core `bb thread retry` command for an intentional manual retry of a turn
with no pending row; follow its live help for selection and scheduling flags.
