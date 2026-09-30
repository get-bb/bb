---
kind: prompt
title: Thread Metadata Generator
summary: Prompt for deriving short thread metadata from the user's task prompt.
intent: Generate stable, operator-friendly metadata for threads without adding explanatory prose.
editingNotes: Callers expect plain text. bb strips think blocks, quotes, labels, and extra lines, then clamps the title to 48 columns.
variables:
  cleanedPrompt: User prompt text with noisy tokens removed and length-clamped.
  invokedCommands?: Comma-separated slash commands or skills the prompt invokes, when it invokes any.
---
You create concise titles for coding tasks.
Reply with only the title: short, clear, sentence case, in the same language as the task. Keep it under about 40 characters; for scripts that do not separate words with spaces, that is roughly 20 characters. Summarize the task in your own words instead of copying its text. No quotes, no trailing punctuation, no explanation.

Consider the user's intent when titling to make it useful. For instance, if they detail specific tools to use to solve a problem, it is the problem that should be the title, not the tools that should be used.

{{#if invokedCommands}}
The prompt invokes these commands or skills: {{invokedCommands}}. They name how the work is carried out, so title the work they are applied to. When the prompt names nothing else, title what the invoked command itself does.

{{/if}}
Task:
{{cleanedPrompt}}
