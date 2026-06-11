---
kind: prompt
title: Workflow Run Completed
summary: Notifies a manager that a workflow run anchored to its thread completed.
intent: Wake the manager to fetch the structured result and report to the user.
editingNotes: Keep the single `bb workflow show` instruction — it is the message's own fetch step, not polling.
variables:
  runId: The completed workflow run's ID.
  workflowName: The run's workflow name.
---
[bb system]

Workflow run {{runId}} ({{workflowName}}) completed. Fetch the result with `bb workflow show {{runId}}`.
