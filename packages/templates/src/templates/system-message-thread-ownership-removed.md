---
kind: prompt
title: Thread Ownership Removed
summary: Notifies a parent thread that a child thread is no longer assigned to it.
intent: Let the previous parent know a thread is no longer assigned to it.
editingNotes: Keep the thread mention first in the visible body so collapsed previews show the affected thread.
variables:
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} was unassigned from you.
