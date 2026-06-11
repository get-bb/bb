---
kind: prompt
title: Workflow Run Paused
summary: Notifies a manager that a workflow run anchored to its thread was interrupted and is resumable.
intent: Informational paused signal, distinct from the single terminal settlement message; the run resumes only on explicit request, never automatically.
editingNotes: Keep the resume command and the "completed prefix is preserved" clause so managers know resuming replays finished agents free instead of re-billing them.
variables:
  runId: The interrupted workflow run's ID.
  workflowName: The run's workflow name.
  reason: Why the run was interrupted (the recorded failure reason, or a host-unavailable default).
---
[bb system]

Workflow run {{runId}} ({{workflowName}}) was paused: {{reason}}. The completed prefix is preserved — resume it from the run page or with `bb workflow resume {{runId}}`.
