---
name: dev-servers
description: "List or stop the servers a bb thread started, with their ports, from the bb CLI."
---

# Dev servers

The plugin is enabled on fresh installations. It lists the servers that a
thread started: processes that listen on a TCP port and that the thread's
agent started from its shell. It finds them on the machine of the thread's
environment, from the `BB_THREAD_ID` variable that bb sets in agent shells.
A server that outlived its shell, such as one started with `nohup`, still
counts. The agent process does not count, and neither do the processes the
agent starts without its own shell, such as MCP servers. A shell that a
package runner (npm, npx, pnpm, yarn, bun, uvx, pipx) starts does not count as
the agent's shell, so an agent or MCP server launched with `npx` is not
listed. Linux and macOS machines are supported.

```sh
bb dev-servers list [thread-id] [--json]
bb dev-servers stop <pid> [--thread <thread-id>] [--json]
```

`list` defaults to the current thread. Outside a thread it lists the servers
of every thread on every connected machine. Each line gives the thread, the
process id of the server's command, its addresses and ports, and its command
line. When the list is empty, the text says why: the thread has no
environment, its machine is offline, or the platform is not supported.
`--json` returns `{ status, servers }`, where `status` is `ok`,
`no-environment`, `offline`, or `unsupported`, and each server has `threadId`,
`rootPid`, `startedAt`, `command`, `cwd`, `ports`, `hostId`, `hostName`, and
`primaryHost`.

`stop` takes the `rootPid` from `list`. It stops the command that the
agent's shell started (for example `npm` for `npm run dev`) and every process
under it: SIGTERM first, and SIGKILL after 3 seconds for what is still
running. It refuses a pid that is not a listed server of the thread, or a pid
that a new process now uses; the error code is `no_server`. Before SIGKILL it
checks each process's start time again, so it does not kill a process that
took a stopped process's pid. `stop` defaults to the current thread; outside a thread, pass
`--thread`.

The thread's context row above the composer shows the same list as
"Servers", with Open and Stop for each server. Open goes to
`http://localhost:<port>`. It shows only when the server runs on the machine
of the bb server and the app was opened on that machine through a localhost
address; otherwise the row names the machine.
