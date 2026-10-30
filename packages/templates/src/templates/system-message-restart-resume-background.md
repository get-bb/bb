---
kind: prompt
title: Resume background work after a restart
summary: Explains which awaited background work was interrupted by a restart.
intent: Let the agent recover background work that will no longer report back.
variables:
  jobs: Interrupted background work, formatted as a list.
---
bb restarted while you were waiting on this background work. It will no longer report back. Restart any work you still need, then continue from its results:

{{jobs}}
