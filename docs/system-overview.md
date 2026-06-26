# System Overview

## The runtime pieces

| Component       | Role                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Server**      | Central hub. Stores all state in a SQLite database, exposes an HTTP API, and pushes change notifications over WebSocket. Stateless itself; the DB is the source of truth. Routes work to hosts over the active daemon WebSocket.                                           |
| **Host daemon** | Runs on the local machine. Connects to the server, handles host RPC requests, provisions workspaces, runs agent provider processes, and posts events back. Exposes a local HTTP API for the app and CLI to do machine-local things (open editor, pick folders, check daemon status). |
| **App**         | Web UI for inspecting projects and threads, following progress, and steering work.                                                                                                                                                                                             |
| **CLI** (`bb`)  | First-class interface for both users and agents. Same capabilities as the app, scriptable.                                                                                                                                                                                     |

## Data model

The core entities and how they relate:

**Project**: the top-level container, usually mapped to a repository. A project has one or more **sources** that say where its code lives. Sources retain a host ID boundary, but supported project sources currently point at the primary local host.

**Thread**: the unit of work. Each thread tracks a conversation with an agent provider, has lifecycle state, and produces an append-only stream of **events** (messages, tool calls, file changes, etc.). Threads can be **standard** (does work directly) or **manager** (coordinates other threads). Threads can own child threads for delegation.

**Environment**: the execution context for a thread. It binds a workspace (a directory on disk) to a host. An environment can be **unmanaged** (point at an existing directory), or **managed**. Environments managed by bb will be cleaned up when there are no longer any unarchived threads using it. Multiple threads can share an environment.

**Host**: a long-lived daemon identity for the machine that runs work. bb currently supports one primary local host; the host boundary remains in the data model for future expansion.

**Commands and events**: the server talks to daemons over the active daemon WebSocket with host RPC requests. Lifecycle work such as provisioning an environment, starting a thread, or stopping a thread can run asynchronously from the API caller's perspective, and the server settles command side effects when the daemon returns an RPC result. Daemons separately post provider and thread progress as event batches.

## Contracts and boundaries

Two contract packages define the boundaries between components:

**`@bb/server-contract`**: the HTTP + WebSocket API between clients (app, CLI) and the server. Route schemas, request/response types, WebSocket notification types.

**`@bb/host-daemon-contract`**: the protocol between the server and host daemons. Command types, event types, session lifecycle, the local API for app/CLI.

Implementation packages never import across these boundaries. The server doesn't know how workspaces are provisioned. The daemon doesn't know about threads or projects beyond what commands tell it.
