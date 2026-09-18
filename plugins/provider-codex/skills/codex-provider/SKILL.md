---
name: codex-provider
description: "Diagnose BB-specific Codex session controls, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `bb thread` commands.
`bb thread clear-goal <id>` clears its durable active Goal and waits for provider
confirmation. Inspect the thread before recovery actions.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Inspect models on the actual execution host with
`bb provider models codex` using the machine or environment selector.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.

Native async questions remain answerable after the turn ends. Answers use a new
user message, steering active work or starting an idle thread. Native synchronous
questions are enabled in Default mode and keep their original request open until
answered, closed by Codex, or stopped; BB does not apply the TUI countdown.
Use the question card or `bb thread interactions answer`; the SDK uses
`threads.interactions.resolve`. AskUserQuestion remains available for models and
versions without native tools. Secret-marked native requests are rejected; use
a secure credential input tool.
