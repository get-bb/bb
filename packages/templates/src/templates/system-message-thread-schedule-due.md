---
kind: prompt
title: Thread Schedule Due
summary: Wraps a due thread schedule prompt in bb system chrome.
intent: Make system-initiated schedule wakeups explicit without changing the schedule author's prompt.
editingNotes: Keep the schedule prompt body verbatim after the prefix.
variables:
  scheduleId: The due thread schedule ID.
  prompt: The schedule prompt text.
---
[bb schedule due:{{scheduleId}}]

{{prompt}}
