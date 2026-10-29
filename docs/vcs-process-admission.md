# Git and GitHub subprocess admission

BB's host runtime shares a queue across workspace git/gh calls, watcher setup,
provisioning, and bundled plugin module copies. The server-side GitHub plugin
uses the same queue implementation in the server runtime. Budgets are local to
each Node runtime; agent commands, terminals, and other processes are outside
these budgets.

Local git and network work use separate pools so slow remote transfers cannot
hold slots that local reads need. Network work is `gh` plus the git
subcommands `fetch`, `pull`, `push`, `clone`, `ls-remote`, `submodule update`,
and `remote update`, classified from the command's arguments.

The local pool scales with the CPU: it has `availableParallelism() - 2` slots,
clamped between four and six, so eight or more cores give six. Background work
can occupy two fewer slots and status work one fewer. The network pool has four slots, at most two of
them `gh`: background work can occupy two, status work three, and interactive
work four. Git pipelines reserve two local slots. An old waiter gains one
priority level every 15 seconds; effective priority and arrival order determine
admission within each pool, and newer work waits behind an older pipeline until
two slots are free. A saturated GitHub lane does not block eligible network git
work, and neither pool blocks the other. A git or gh call made inside an
admitted operation runs under that operation's permit. Running commands finish
normally; priority applies before spawning. Execution timeouts start when
admitted, and permits remain held through termination cleanup.

Workspace status uses status priority, diff panels and explicit mutations use
interactive priority, and watcher setup, PR polling, fetches, and provisioning
use background priority. Git status and diff reads run in the Git plugin's
host entry, which has its own budget in the plugin host worker and keeps those
priorities. The CLI and SDK reach the same reads through the Git plugin.
The daemon's `workspace.status`, `workspace.diff`, `workspace.diffFiles` and
`workspace.diffPatch` commands are gone (`HOST_DAEMON_PROTOCOL_VERSION` 252);
no user configuration changed. The Plugin Guide lists
`experimental_runVcsProcess` for plugins that spawn their own git/gh commands.
