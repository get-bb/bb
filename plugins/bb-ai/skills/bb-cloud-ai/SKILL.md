---
name: bb-cloud-ai
description: "Check or troubleshoot bb cloud, the hosted service that writes thread titles and commit messages for signed-in bb accounts."
---

# bb cloud AI

bb cloud is the `bb` AI service from the `bb-ai` plugin. It writes thread
titles (branch names follow the title) and commit messages for a signed-in bb
account, within a daily spend limit per account.

- `bb ai status [--json]` shows the account, whether bb cloud is ready, and
  today's usage.
- `bb ai usage [--json]` shows today's spend against the limit and when it
  resets (00:00 UTC).
- Sign in with `bb account login`. Signed out, bb cloud is not ready and
  Automatic skips it.
- Which service handles each task is a core setting:
  `bb settings ai-services set <thread-title|commit-message> bb` picks bb
  cloud, `automatic` tries Codex first and then bb cloud, and `off` turns
  generation off. `bb settings ai-services test thread-title` runs a sample.
- When the daily limit is used up, bb cloud reports not ready until the reset
  and Automatic moves on; a task set to `bb` falls back to the prompt text for
  titles and `bb: automated commit` for commits.

Prompts (the start of a thread, or the diff for a commit) go to getbb.app, which
forwards them to OpenRouter model providers that keep no data. bb stores usage
totals only.
