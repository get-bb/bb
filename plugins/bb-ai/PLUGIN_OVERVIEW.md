Thread titles, commit messages, and voice input from bb cloud, included with your bb account.

## What you get

- A `bb cloud` AI service for thread titles (branch names follow the title), commit messages, and voice input.
- On by default once you sign in. Turn it off with `bb ai off`, or disable this plugin.
- Automatic tries bb cloud first, then other compatible registered services by plugin id and service id in lexicographic order. The microphone appears once an enabled service is ready.
- Today's usage against your daily limit with `bb ai usage`.

## How it works

Sign in with your bb account. When a task uses bb cloud, bb sends its prompt to getbb.app, which forwards it to OpenRouter model providers with zero data retention: the text of a thread's first prompt for titles, the changed files with a diff excerpt for commit messages, and the recording for voice input. bb stores your daily usage totals and, for 30 days, metadata about each request such as its time, model, token counts, and cost. It never stores prompts, recordings, or replies. Turn bb cloud off with `bb ai off`; your bb account stays signed in.

## For agents

`bb ai status` and `bb ai usage` report readiness and spend. `bb ai off` turns bb cloud off and `bb ai on` turns it back on; turn it on only when the user asks. `bb settings ai-services set <task> bb` picks bb cloud for a task, and `bb voice transcribe <file>` tests voice input.

## Requirements

A bb account (`bb account login`).
