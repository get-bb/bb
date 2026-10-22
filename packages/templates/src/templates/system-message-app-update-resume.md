---
kind: prompt
title: Resume after a bb update
summary: Starts the next turn for a thread that a bb update interrupted.
intent: Let the agent carry on from its timeline without the user having to say "continue", checking the one step the restart may have cut off.
editingNotes: The thread's timeline already holds every finished step, so the message only names what was interrupted. Keep the check-before-continuing line; a stopped command may be half applied.
variables:
  interrupted: What the restart interrupted, already phrased, such as "while you were running `pnpm test`".
  check: What to check before continuing, already phrased.
---
[bb system]

bb restarted to install an update {{interrupted}}. {{check}}
