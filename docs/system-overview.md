# System Overview

## The runtime pieces

| Component       | Role                                                                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server**      | Central hub. Stores all state in a SQLite database, exposes an HTTP API, and pushes change notifications over WebSocket. Stateless itself; the DB is the source of truth. Routes work to hosts over the active daemon WebSocket.                                                                                |
| **Host daemon** | Runs on each enrolled execution machine. Connects to the server, handles host RPC requests, provisions workspaces, runs agent provider processes, and posts events back. Exposes a local HTTP API for co-located app and CLI operations such as opening an editor, picking folders, and checking daemon status. |
| **App**         | Web UI for inspecting projects and threads, following progress, and steering work.                                                                                                                                                                                                                              |
| **CLI** (`bb`)  | First-class interface for both users and agents. Same capabilities as the app, scriptable.                                                                                                                                                                                                                      |

## Data model

The core entities and how they relate:

**Project**: the top-level container, usually mapped to a repository. A project has one or more **sources** that say where its code lives. Each local-path source belongs to a specific enrolled host, so one project can map to paths on multiple machines.

**Thread**: the unit of work. Each thread tracks a conversation with an agent provider, has lifecycle state, and produces an append-only stream of **events** (messages, tool calls, file changes, etc.). Threads can be **standard** (does work directly) or **manager** (coordinates other threads). Threads can own child threads for delegation.

**Environment**: the execution context for a thread. It binds a workspace (a directory on disk) to a host. An environment can be **unmanaged** (point at an existing directory), or **managed**. Environments managed by bb will be cleaned up when there are no longer any unarchived threads using it. Multiple threads can share an environment.

**Host**: a long-lived daemon identity for a machine that runs work. A server runs on one host (the server machine, `primaryHostId` in the API) and can enroll additional remote hosts; project sources and environments retain the host boundary.

**Commands and events**: the server talks to daemons over the active daemon WebSocket with host RPC requests. Lifecycle work such as provisioning an environment, starting a thread, or stopping a thread can run asynchronously from the API caller's perspective, and the server settles command side effects when the daemon returns an RPC result. Daemons separately post provider and thread progress as event batches.

## Contracts and boundaries

### Thread lifecycle ownership

`lifecycleOwnerThreadId` is an optional relationship set only at creation and
never changed. It is independent of sidebar `parentThreadId`, fork
`sourceThreadId`, visibility, and attribution. Spawn and fork accept a live
owner across projects, hosts, and environments. Side chats are owned by their
source, and every workflow worker attempt by its origin.

- Archiving an owner recursively archives its dependents and stops their
  execution; unarchiving the owner does not restore them (restore them
  explicitly, owner first).
- Deleting a thread recursively deletes its sidebar children and lifecycle
  dependents, following both relationships at every level, including hidden and
  archived threads. Fork sources alone do not imply deletion. The owner row
  remains until every lifecycle dependent finishes storage cleanup on its own
  host; failures are retried.
- Dependents can be archived or deleted independently of their owner. Deleting
  an owning project also deletes cross-project dependents; deleting only a
  dependent's project leaves its external owner intact.
- Stop affects only the requested turn or runtime.

An archived thread keeps its terminals and any running turn for a short grace
period (`ARCHIVE_UNDO_GRACE_MS`) so Undo restores it intact; after that bb stops
it. During the grace it still counts as live, so its environment and machine
are not retired under it. A thread start still in flight is stopped as soon as
it is archived.

### Daemon resource ledger

Every long-lived process the host daemon starts belongs to one resource in
`apps/host-daemon/src/resource-ledger.ts`: provider bridges (per environment
runtime and the maintenance runtime), setup and teardown hooks, host plugin
workers, the connect-next frpc, the file watcher and short host commands. A
resource has a typed owner (`hostDaemonResourceOwnerSchema`), a deadline (a
fixed time, an idle timeout with per-request leases, or the owner's lifetime),
and is written to `<dataDir>/host-daemon-resources/` before its first process
starts. Lease changes only re-arm the in-memory deadline timer; they are not
written, because restart cleanup stops recorded processes whatever their
deadline. The ledger enforces deadlines by calling the owner's stop and, after a
grace, stopping the recorded process groups itself. On startup, before anything
new runs, the daemon stops every process a previous instance recorded,
verifying each start time so a reused PID is never signalled, and reports the
outcomes in the first session open (`reconciledResources`). The server finishes
hook operations whose processes are confirmed gone.

Ending a resource ends its whole process tree. `DaemonResource.end(stop)` first
snapshots the tree under every recorded process (`snapshotProcessTree` in
`@bb/process-utils`: the recorded process groups, every ppid descendant, and
the group of any descendant that leads one, which catches setsid'd tool shells
and job-control jobs), then runs the owner's graceful stop, then stops whatever
in the snapshot is still alive. `close()` stops what is still recorded; a
successful setup or teardown hook calls `leaveRunning()` instead, so processes
it started on purpose stay with the environment. When the stop cannot be
confirmed, the record stays on disk with its processes so the next start
retries it.

Process identity has one rule. A record holds a pid and the OS's own start
token for it (`probeProcessStart` in `@bb/process-utils`: boot id plus start
ticks on Linux, `ps -o lstart` under `LC_ALL=C TZ=UTC0` on macOS, the CIM
creation time on Windows), read by the same probe with the same pinned
environment when recording and when acting, so time zones and wall clock
changes do not matter. `lstart` has one-second precision, so on macOS a pid
reused within the same second as the recorded process is indistinguishable
from it. The process that spawned a child reads the token
while it still holds the child unreaped, so a late report cannot pick up a
reused pid. Plugin workers report a detached child with its token right away
and a child in the worker's own process group once it has run for a second,
so short commands cost nothing; a worker that crashes before reporting leaves
those children unrecorded. A process is signalled only when its current token matches the record,
along with the descendants and groups reached from a matched process. A record
that cannot be matched (no token yet, an unreadable process, or a group whose
leader is gone while members remain, or a live pid whose token differs from
the record) is never signalled and never counts as exited: the stop is
unverified and the record is kept. Only a pid with no process, and for a group
no member left, counts as gone. Records this daemon version cannot read are
kept and reported unverified. The same rule stops managed processes: their
stop snapshots the child's tree while it still holds the child, signals the
leader through its handle, and stops the rest by token; once the child has
exited it signals nothing. Hook scripts capture
their tree before a timeout or cancel kills them.
Terminals are not recorded: closing one hangs up its shell's process group,
as before, so jobs detached with nohup or disown keep running. Managed processes
(`spawnManagedProcess`, used for provider bridges and ACP agents) sweep the
same way when stopped. A process whose parent exited before the snapshot
(ppid 1, own group) is out of reach; the environment's cwd sweep on destroy
covers those. Host plugin workers run in their own process group, are killed
through their resource, and their idle shutdown is the resource's `idle`
deadline: calls, watches and retained leases hold a lease, and a deadline that
finds the worker busy again re-arms instead of stopping it.

Nothing starts without an owner. `@bb/process-utils` exports no raw spawn
helpers; callers take them from `processesOwnedBy(owner)`, which records every
child (pid and process group) with that owner, and lint bans `child_process`,
`cross-spawn`, `execa` and `node-pty` value imports elsewhere. Long-lived daemon
processes pass their ledger resource. `hostProcessOwner` means the process that
runs the code: the daemon binds it to its `host-command` resource (children
are written to disk only if still running after a second), and a host plugin
worker binds it to IPC reports, with each child's start token, that the daemon
records under the plugin's resource, so a crashed worker's detached children
are stopped too. Worker cleanup starts at the worker's exit, not when its
inherited pipes close.

### Transport contracts

Two contract packages define the boundaries between components:

**`@bb/server-contract`**: the HTTP + WebSocket API between clients (app, CLI) and the server. Route schemas, request/response types, WebSocket notification types.

**`@bb/host-daemon-contract`**: the protocol between the server and host daemons. Command types, event types, session lifecycle, the local API for app/CLI.

Implementation packages never import across these boundaries. The server doesn't know how workspaces are provisioned. The daemon doesn't know about threads or projects beyond what commands tell it.
