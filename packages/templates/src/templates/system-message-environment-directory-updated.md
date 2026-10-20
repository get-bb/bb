---
kind: prompt
title: Environment directory updated
summary: Starts the next turn after update_environment_directory moved the thread to a new working directory.
intent: Let the agent continue the interrupted task from the new directory without the user having to say "continue".
editingNotes: Keep it short and task-neutral; the agent already has the prior turn's context.
variables:
  path: Absolute path of the thread's new working directory.
---
[bb system]

This thread now runs in `{{path}}`. Continue the task from your previous turn in this directory.
