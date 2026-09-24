---
name: bb-cloud-ai
description: "Turn on, check, or troubleshoot bb cloud, the opt-in hosted service that writes thread titles and commit messages for signed-in bb accounts."
---

# bb cloud AI

bb cloud is the `bb` AI service from the `bb-ai` plugin. It writes thread
titles (branch names follow the title) and commit messages for a signed-in bb
account, within a daily spend limit per account.

bb cloud is off until the user turns it on. While off, it reports not ready,
Automatic skips it, and nothing is sent to getbb.app.

- `bb ai on [--json]` turns bb cloud on; `bb ai off [--json]` turns it off and
  keeps the bb account signed in. Settings → bb cloud AI has the same switch.
  Only turn it on when the user asks: it sends prompt text and diffs off the
  machine.
- `bb ai status [--json]` shows the account, whether bb cloud is on and ready,
  and today's usage.
- `bb ai usage [--json]` shows today's spend against the limit and when it
  resets (00:00 UTC).
- Sign in with `bb account login`. Signed out, bb cloud is not ready and
  Automatic skips it.
- Which service handles each task is a core setting:
  `bb settings ai-services set <thread-title|commit-message> bb` picks bb
  cloud, `automatic` tries Codex first and then bb cloud, and `off` turns
  generation off. `bb settings ai-services test thread-title` runs a sample.
- When an account's daily limit is used up, bb cloud reports not ready for
  that account until the reset and Automatic moves on; a task set to `bb`
  falls back to the prompt text for titles and `bb: automated commit` for
  commits. Signing in to a different account clears the limit message.

While bb cloud is on, bb sends the text of a thread's first prompt (titles) and
the changed files with a diff excerpt (commit messages) to getbb.app, which
forwards them to OpenRouter model providers with zero data retention. bb stores
daily usage totals and, for 30 days, metadata about each request such as its
time, model, token counts, and cost; it never stores prompts or replies.
