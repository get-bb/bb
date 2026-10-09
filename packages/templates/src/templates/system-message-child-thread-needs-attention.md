---
kind: prompt
title: Child thread needs attention
summary: Notifies a parent thread that one of its child threads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and resolve it from context or clarify the child thread's assumption. Otherwise a top-level parent leaves the decision to the user in its child threads banner instead of asking in chat, while a parent that is itself a child thread asks the user so the question reaches the thread above it.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  blockerSummary: Compact summary of the pending interaction, or a fallback sentence when no safe summary is available.
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
  parentIsChildThread?: Any non-empty value when the notified parent thread is itself a child thread whose questions reach its own parent.
---
[bb system]

{{threadMention}} needs help.
{{blockerSummary}}

{{#if parentIsChildThread}}
Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.
{{/if}}
{{#unless parentIsChildThread}}
Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, do not ask the user or restate the question in chat; the user sees and answers it in this thread's child threads banner. End your turn with at most one short line.
{{/unless}}
