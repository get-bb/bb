---
kind: prompt
title: Thread ownership batch
summary: Notifies a parent thread that several child threads were assigned to it or unassigned from it.
intent: Give the parent thread one notice for a group of ownership changes instead of one turn per child thread.
editingNotes: Keep this concise. The updates variable is a server-formatted list of assigned and unassigned threads with rich thread mention ranges attached by the server.
variables:
  updates: "Rendered list of ownership changes."
---
[bb system]

{{updates}}
