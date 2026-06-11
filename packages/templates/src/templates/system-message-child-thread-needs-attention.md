---
kind: prompt
title: Child Thread Needs Attention
summary: Notifies a parent thread that one of its child threads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and either resolve it from context, ask the user, or clarify the worker's assumption.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} needs attention.
It is blocked on a pending interaction. Inspect the thread and decide if you can answer or resolve the question from existing context. If not, ask the user for the missing decision. If the worker is stuck on the wrong assumption, send it a clarifying instruction.
