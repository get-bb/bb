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

`lifecycleOwnerThreadId` is an immutable, optional creation relationship independent
of sidebar `parentThreadId`, fork `sourceThreadId`, visibility and attribution.
Spawn and fork accept a live owner across projects, hosts and environments. Independent threads omit the field. Side chats assign their source;
every workflow worker attempt assigns its origin, including replacements.

Owner archival recursively archives dependents and stops execution while retaining
history under normal archive retention. Owner deletion recursively marks dependents
for deletion in one database statement. The owner row and ownership foreign keys
remain until every dependent finishes storage cleanup. The existing daemon command
stops execution before removing storage; periodic sweeps and reconnect reconciliation
retry failures. Cleanup uses each dependent's own host. Unarchiving an owner does
not restore its dependents; restore them explicitly, owner first. Dependents can
archive/delete independently without archiving/deleting the owner. Deleting an
owning project also deletes cross-project dependents, while deleting only a
dependent project leaves its external owner intact. Explicit Stop
continues to stop only the requested turn/runtime.

Archiving owes a thread `ARCHIVE_UNDO_GRACE_MS` before its teardown runs, so Undo
on the archive toast costs nothing. Inside that window an archived thread keeps
its open terminal sessions, and one that was mid-turn keeps running. The periodic
thread sweep closes the terminals and stops the run once the grace expires;
unarchiving inside the window cancels both, because both are derived from
`archivedAt`. An archived thread whose status is `active` or `stopping` already
counts as live for environment and machine retirement, so neither is torn down
under a run the grace is protecting. A thread start still in flight is not
covered: it is stopped as soon as it is archived, which is what keeps an
unsettled start from leaking a session.

Ownership cannot be updated or cleared. Assigning only at creation to an existing
live thread prevents cycles, self-ownership and reassignment during deletion. The
server validates the owner and inserts the dependent in one immediate database
transaction. Ownership cannot be changed through the update API.
Deletion and archival persist before cleanup effects. Ordinary sidebar children
and visible forks keep their existing policies unless ownership is explicit.

Migration 0121 adds the ownership schema without assigning owners to existing
threads or changing their archive/delete state. New side chats and workflow
worker attempts explicitly assign ownership when created.

### Transport contracts

Two contract packages define the boundaries between components:

**`@bb/server-contract`**: the HTTP + WebSocket API between clients (app, CLI) and the server. Route schemas, request/response types, WebSocket notification types.

**`@bb/host-daemon-contract`**: the protocol between the server and host daemons. Command types, event types, session lifecycle, the local API for app/CLI.

Implementation packages never import across these boundaries. The server doesn't know how workspaces are provisioned. The daemon doesn't know about threads or projects beyond what commands tell it.
