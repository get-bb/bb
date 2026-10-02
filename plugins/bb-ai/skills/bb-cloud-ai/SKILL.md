---
name: bb-cloud-ai
description: "Check, turn off, or troubleshoot bb cloud, the hosted service that writes thread titles and commit messages and transcribes voice input for signed-in bb accounts."
---

# bb cloud AI

bb cloud is the `bb` AI service from the `bb-ai` plugin. It writes thread
titles (branch names follow the title) and commit messages and transcribes
voice input for a signed-in bb account, within a daily spend limit per account.

bb cloud is on by default for a signed-in account. A user who turned it off
stays off across restarts and upgrades. While off, it reports not ready,
Automatic skips it, and nothing is sent to getbb.app. It has no settings page.

- `bb ai off [--json]` turns bb cloud off and keeps the bb account signed in;
  `bb ai on [--json]` turns it back on. Only turn it on when the user asks: it
  sends prompt text, diffs, and voice recordings off the machine. Disabling the
  `bb-ai` plugin in Settings → Plugins also stops it.
- `bb ai status [--json]` shows the account, whether bb cloud is on and ready,
  and today's usage.
- `bb ai usage [--json]` shows today's spend against the limit and when it
  resets (00:00 UTC). Titles, commit messages, and voice input share one
  budget.
- Sign in with `bb account login`. Signed out, bb cloud is not ready and
  Automatic skips it.
- Which service handles each task is a core setting:
  `bb settings ai-services set <thread-title|commit-message|voice> bb` picks bb
  cloud, `automatic` tries bb cloud first, then other compatible
  registered services by plugin id and service id in lexicographic order, and `off` turns the
  task off. `bb settings ai-services test thread-title` runs a sample.
- Voice input: without a Codex login, the microphone appears once bb cloud is
  ready. `bb voice transcribe <file> [--type <mime>]` transcribes a recording.
  bb cloud takes WebM, Ogg, MP4/M4A, MP3, WAV, FLAC, and AAC up to 10 MB; it
  reads the format from the MIME type, then the file extension, and refuses
  anything else before contacting getbb.app. A transcription must finish within
  10 seconds.
- When an account's daily limit is used up, bb cloud reports not ready for
  that account until the reset and Automatic moves on; a task set to `bb`
  falls back to the prompt text for titles and `bb: automated commit` for
  commits, and the microphone hides unless another voice service is ready.
  Signing in to a different account clears the limit message.

While bb cloud is on, bb sends the text of a thread's first prompt (titles), the
changed files with a diff excerpt (commit messages), and voice recordings with
a vocabulary hint (voice input) to getbb.app, which forwards them to OpenRouter
model providers with zero data retention. bb stores daily usage totals and, for
30 days, metadata about each request such as its time, model, token counts, and
cost; it never stores prompts, recordings, or replies.
