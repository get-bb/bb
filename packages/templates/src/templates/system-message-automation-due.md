---
kind: prompt
title: Automation Due
summary: Wraps an automation prompt when re-prompting an existing target thread on schedule.
intent: Mark a turn as originating from a due automation so the agent treats it as a scheduled task.
editingNotes: Keep the marker line stable; downstream parsing keys off the 'bb automation due:' prefix.
variables:
  automationId: The automation ID that triggered this run, e.g. 'auto_abc123'.
  prompt: The automation's configured prompt to run.
---
[bb automation due:{{automationId}}]

{{prompt}}
