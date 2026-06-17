---
kind: prompt
title: Child thread outcome batch
summary: Notifies a parent thread about one or more child thread outcomes.
intent: Give the parent thread compact outcome context without forcing immediate action for every child thread.
editingNotes: Keep this concise. The updates variable is a server-formatted singular or plural outcome body with rich thread mention ranges attached by the server.
variables:
  updates: "Rendered child thread outcome message body."
---
[bb system]

{{updates}}
