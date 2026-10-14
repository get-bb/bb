---
name: mcp
description: Connect ChatGPT, Claude or another MCP client to this bb, and list or disconnect the apps that have access.
---

# bb MCP server

The MCP server plugin lets an MCP client control this bb. It is off by default. Turn it on in Settings → Plugins or with `bb plugin enable bb--mcp`.

## Addresses

`bb mcp status [--json]` prints both addresses.

- **Remote**: `https://<your bb connect address>/mcp`. This needs a signed-in bb account (`bb account login`) and bb connect. Add it as a custom connector in ChatGPT or Claude. The app sends you to a bb account page where you approve access for this bb.
- **Local**: `http://127.0.0.1:<port>/api/v1/plugins/bb--mcp/http/mcp`. Apps on the same machine can use it without signing in. It has the same trust as the `bb` CLI on that machine. Requests from web pages are refused.

## What approving an app grants

Access is all or nothing. An approved app can run any `bb` command: it can see everything in this bb, and it can start and message agents and open terminals, which run commands and change files on the machines this bb controls. Approve only apps you trust, and disconnect the ones you no longer use.

## Connected apps

- `bb mcp clients [--json]` lists the remote apps with access to this bb.
- `bb mcp revoke <grant-id> [--json]` disconnects one. The app loses access within about a minute.

The bb account dashboard lists the same apps under Connected apps.

## Tools the client sees

- `search` finds `bb` commands for a task.
- `read` runs a JavaScript snippet that can call only commands that inspect bb. It is marked read-only so the app can run it without asking you each time; it is not a separate permission.
- `run` runs a JavaScript snippet that can call any `bb` command.

Snippets call `bb.cli([...argv])` or `bb.json([...argv])` and run in a sandbox on the bb server with no network or file access. A snippet is stopped after 25 seconds, after 3 seconds of computation, or when it runs out of its 64 MB of memory, and runs at most 4 `bb` commands at a time.

Three commands cannot run over MCP because they need an interactive terminal or never exit: `bb terminal attach`, `bb plugin dev`, and `bb browser watch`.

## Protocol

The endpoint speaks MCP 2026-07-28 and also answers 2025-era clients. It is stateless: there are no sessions.
