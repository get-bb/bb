Thread titles and commit messages from bb cloud, included with your bb account.

## What you get

- A `bb cloud` AI service for thread titles (branch names follow the title) and commit messages.
- Off until you turn it on in Settings → bb cloud AI or with `bb ai on`.
- Once on, Automatic uses it when Codex is not signed in: Settings → AI services tries Codex first, then bb cloud.
- Today's usage against your daily limit in this plugin's settings and with `bb ai usage`.

## How it works

Sign in with your bb account and turn bb cloud on. When a task uses bb cloud, bb sends its prompt to getbb.app, which forwards it to OpenRouter model providers with zero data retention: the text of a thread's first prompt for titles, and the changed files with a diff excerpt for commit messages. bb stores your daily usage totals and, for 30 days, metadata about each request such as its time, model, token counts, and cost. It never stores prompts or replies. Turn bb cloud off with `bb ai off` or the switch in its settings; your bb account stays signed in.

## For agents

`bb ai status` and `bb ai usage` report readiness and spend. `bb ai on` and `bb ai off` change the opt-in; turn it on only when the user asks. `bb settings ai-services set <task> bb` picks bb cloud for a task.

## Requirements

A bb account (`bb account login`).
