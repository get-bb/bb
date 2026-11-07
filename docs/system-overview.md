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
  host; failures are retried. Once its cleanup is done, a deleted thread is
  queued in `thread_purges`, and the `thread-purge` sweep removes its rows from
  `bb.db` in small batches: 10 ms slices, resting nine times as long while a
  client is connected or a thread is running, and as long otherwise. Each run
  stops after 30 seconds and the next pass carries on. The thread stays hidden
  throughout, and a restart resumes the queue.
- Dependents can be archived or deleted independently of their owner. Deleting
  an owning project also deletes cross-project dependents; deleting only a
  dependent's project leaves its external owner intact.
- Stop affects only the requested turn or runtime.

An archived thread keeps its terminals and any running turn for a short grace
period (`ARCHIVE_UNDO_GRACE_MS`) so Undo restores it intact; after that bb stops
it. During the grace it still counts as live, so its environment and machine
are not retired under it. A thread start still in flight is stopped as soon as
it is archived.

### Background sweeps

The server runs its periodic sweep jobs (`PERIODIC_SWEEP_JOBS` in
`apps/server/src/services/system/periodic-sweeps.ts`) every 10 seconds, and
every job is an item sweep (`item-sweep.ts`). A job lists its items with a
stable key, processes one, and sets how many run at once; the runner owns
everything else:

- A failure is written to `sweep_item_failures` (sweep, item key, attempts,
  retry time, last error), and the remaining items still run.
- The item is left out of later passes until its retry time: 1 minute,
  doubling to at most 1 hour, counted from the pass, or from when it failed
  if it ran past the 60-second detach below. `list` receives these keys as
  `excludedKeys` so queries with a `LIMIT` can leave them out in SQL.
- Each failure logs a warning; from the fifth attempt on, an error.
- A success clears the record. A record whose item has not been listed for an
  hour past its retry time is dropped, and startup drops records of sweeps that
  no longer exist.
- The runner stops waiting for an item after 60 seconds, skips it while it is
  still running, even in an overlapping pass of the same sweep, and records its
  outcome when it settles, so one hung item never holds up its job.
- It yields to the event loop every 8 ms of work.
- A job marked `background` doesn't hold up the rest of the pass; it is
  skipped on later passes until it finishes.

Three constructors cover the shapes: `defineItemSweep` for a list read once per
pass, `defineScanSweep` for a cursor scan that lists again after each batch
until nothing new comes back (event pruning lists each policy's next thread),
and `defineSingleItemSweep` for one bulk statement or maintenance pass.

### Transport contracts

Two contract packages define the boundaries between components:

**`@bb/server-contract`**: the HTTP + WebSocket API between clients (app, CLI) and the server. Route schemas, request/response types, WebSocket notification types.

**`@bb/host-daemon-contract`**: the protocol between the server and host daemons. Command types, event types, session lifecycle, the local API for app/CLI.

Implementation packages never import across these boundaries. The server doesn't know how workspaces are provisioned. The daemon doesn't know about threads or projects beyond what commands tell it.
