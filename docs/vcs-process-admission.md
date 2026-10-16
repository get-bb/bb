# Git and GitHub subprocess admission

BB's host runtime shares a queue across workspace git/gh calls, watcher setup,
provisioning, and bundled plugin module copies. The server-side GitHub plugin
uses the same queue implementation in the server runtime. Budgets are local to
each Node runtime; agent commands, terminals, and other processes are outside
these budgets.

The limits are six admitted process slots in total and two GitHub slots.
Background work can occupy four slots, status work five, and interactive work
six. Git pipelines reserve two slots. An old waiter gains one priority level
every 15 seconds; effective priority and arrival order determine admission.
A saturated GitHub lane does not block eligible git work. Running commands
finish normally; priority applies before spawning. Execution timeouts start
when admitted, and permits remain held through termination cleanup.

Workspace status uses status priority, diff panels and explicit mutations use
interactive priority, and watcher setup, PR polling, fetches, and provisioning
use background priority. The CLI and SDK reach the same workspace handlers.
No daemon wire fields or user configuration changed. The Plugin Guide lists
`experimental_runVcsProcess` for plugins that spawn their own git/gh commands.
