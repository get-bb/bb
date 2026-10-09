---
name: provider-retry
description: "Diagnose automatic retries of BB turns after provider subscription-window limits."
---

# Provider retry

The plugin is enabled on fresh installations. When a turn fails on a structured
Codex or Claude Code subscription-window limit with a reset time, it queues the
failed turn for after the window opens. Core continues accepted input or re-sends input the provider never accepted.

A pending retry is an ordinary durable queued row and survives restart. Inspect
it with `bb thread queue list <thread-id>` and inspect the failed turn before
manually retrying it; avoid duplicating an existing queued retry.

Use the core `bb thread retry` command for an intentional manual retry. Follow
its live help for selection and scheduling flags.

For Account Pooler routes, retry timing comes from the pool’s earliest usable
account for the failed model, including parent pools. A generic provider 429
without quota windows can therefore still schedule a retry. Unknown resets,
authentication failures, and unavailable pool sources do not schedule retries.

Use `bb provider-retry explain [thread-id] [--json]` to inspect the last
recorded decision and why it was skipped. This historical diagnostic survives
restart but does not imply a retry is still pending; use `status` for that.
The plugin RPC `decision.get` accepts `{ threadId }` and returns the same
nullable diagnostic. Decisions before this version was loaded are not backfilled.
