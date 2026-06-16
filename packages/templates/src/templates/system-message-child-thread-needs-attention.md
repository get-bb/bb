---
kind: prompt
title: childThread Needs Attention
summary: Notifies a parent thread that one of its childThreads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and either resolve it from context, ask the user, or clarify the childThread's assumption.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  blockerSummary: Compact summary of the pending interaction, or a fallback sentence when no safe summary is available.
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} needs attention.
{{blockerSummary}}

Inspect this childThread and decide if you can answer or resolve the question from existing context. If not, ask the user for the missing decision. If the childThread is stuck on the wrong assumption, send it a clarifying instruction.
