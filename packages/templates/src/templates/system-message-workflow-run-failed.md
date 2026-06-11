---
kind: prompt
title: Workflow Run Failed
summary: Notifies a manager that a workflow run anchored to its thread failed.
intent: Wake the manager to inspect the failure and decide next steps.
editingNotes: "The failure suffix is pre-formatted by the caller (': <reason>' or empty) because a reason is not always recorded."
variables:
  runId: The failed workflow run's ID.
  workflowName: The run's workflow name.
  failureSuffix?: "Formatted failure suffix like ': script_invalid', or empty string when no reason was recorded."
---
[bb system]

Workflow run {{runId}} ({{workflowName}}) failed{{failureSuffix}}.
