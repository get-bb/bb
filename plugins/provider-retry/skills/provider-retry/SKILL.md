---
name: provider-retry
description: "Diagnose automatic retries of BB turns after provider subscription-window limits."
---

# Provider retry

The plugin is enabled on fresh installations. When a turn fails on a structured
Codex or Claude Code subscription-window limit with a reset time, a provider
overload, or a connection failure, it queues a retry of the original turn
(via `bb.sdk.threads.retry`) rather than constructing a new prompt. Subscription
retries wait for the window; overload and connection failures use exponential
backoff. Authentication, payment, and unknown errors are not retried. A new
user message or a stop cancels a waiting retry.

A pending retry is an ordinary durable queued row and survives restart. Inspect
it with `bb thread queue list <thread-id>` and inspect the failed turn before
manually retrying it; avoid duplicating an existing queued retry.

Use the core `bb thread retry` command for an intentional manual retry. Follow
its live help for selection and scheduling flags.
