# Repository Overview

This monorepo contains the packaged app plus the runtime services it bundles:

| Package or app                                                     | Role                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [`packages/bb-app`](../packages/bb-app)                            | Published npm package, `npx bb-app@latest` launcher, bundled `bb` CLI entry, and public SDK export. |
| [`apps/desktop`](../apps/desktop)                                  | macOS Electron shell that supervises the packaged runtime and loads the bb web UI.                  |
| [`apps/app`](../apps/app)                                          | Web UI for inspecting projects, threads, environments, and running work.                            |
| [`apps/server`](../apps/server)                                    | HTTP API, WebSocket notifications, state management, and server-owned product policy.               |
| [`apps/host-daemon`](../apps/host-daemon)                          | Host-local runtime that provisions workspaces and runs provider processes.                          |
| [`apps/cli`](../apps/cli)                                          | Scriptable `bb` CLI for users and agents.                                                           |
| [`apps/web`](../apps/web)                                          | getbb.app site: marketing page + bb connect auth/dashboard (TanStack Start on Cloudflare Workers).  |
| [`packages/sdk`](../packages/sdk)                                  | TypeScript SDK used by the CLI, package SDK export, and programmatic clients.                       |
| [`packages/agent-runtime`](../packages/agent-runtime)              | Provider runtime adapters and bridges for Codex, Claude Code, Pi, and ACP agents.                   |
| [`packages/config`](../packages/config)                            | Config parsing, defaults, managed package config schema, and environment variable definitions.      |
| [`packages/db`](../packages/db)                                    | SQLite schema, migrations, and data access helpers.                                                 |
| [`packages/server-contract`](../packages/server-contract)          | HTTP and WebSocket contract between clients and the server.                                         |
| [`packages/host-daemon-contract`](../packages/host-daemon-contract) | Command/event contract between the server and host daemons.                                         |

`bb-app` also exposes a Node scripting SDK:
`import { BBSdk } from "bb-app"`. See
[`packages/bb-app`](../packages/bb-app/README.md#scripting-with-the-sdk).
