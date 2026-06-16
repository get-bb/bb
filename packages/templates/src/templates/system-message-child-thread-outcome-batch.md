---
kind: prompt
title: childThread Outcome Batch
summary: Notifies a parent thread about one or more childThread outcomes.
intent: Give the parent thread compact outcome context without forcing immediate action for every childThread.
editingNotes: Keep this concise. The updates variable is a server-formatted singular or plural outcome body with rich thread mention ranges attached by the server.
variables:
  updates: "Rendered childThread outcome message body."
---
[bb system]

{{updates}}
