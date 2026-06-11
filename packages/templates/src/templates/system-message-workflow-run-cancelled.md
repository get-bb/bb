---
kind: prompt
title: Workflow Run Cancelled
summary: Notifies a manager that a workflow run anchored to its thread was cancelled.
intent: Inform the manager so it can update the user; cancelled runs are never revived.
editingNotes: Deliberately terse — cancellation is usually user-initiated, so the manager needs the fact, not instructions.
variables:
  runId: The cancelled workflow run's ID.
  workflowName: The run's workflow name.
---
[bb system]

Workflow run {{runId}} ({{workflowName}}) was cancelled.
