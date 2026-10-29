---
kind: prompt
title: Resume after a restart
summary: Starts the next turn for a thread that a bb restart, a bb update or a machine restart interrupted.
intent: Let the agent carry on from its timeline without the user having to say "continue", checking the one step the restart may have cut off.
editingNotes: The thread's timeline already holds every finished step, so the message only names what was interrupted. Keep the check-before-continuing line; a stopped command or job may be partly applied, and repeating it may duplicate its effects. Keep saying that the restart, not the user, stopped the work; agents otherwise read the stop as a rejection.
variables:
  restarted: What restarted, already phrased, such as "bb restarted to install an update".
  interrupted: What the restart interrupted, already phrased, such as "while you were running `pnpm test`".
  check: What to check before continuing, already phrased.
---
[bb system]

{{restarted}} {{interrupted}}. {{check}}
