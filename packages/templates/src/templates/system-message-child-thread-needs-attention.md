---
kind: prompt
title: Child thread needs attention
summary: Notifies a parent thread that one of its child threads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and resolve it from context or clarify the child thread's assumption; otherwise leave the decision to the user in the child threads banner instead of asking in chat.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  blockerSummary: Compact summary of the pending interaction, or a fallback sentence when no safe summary is available.
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} needs help.
{{blockerSummary}}

Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, do not ask the user or restate the question in chat; the user sees and answers it in this thread's child threads banner. End your turn with at most one short line.
