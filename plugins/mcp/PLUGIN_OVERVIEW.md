Control bb from ChatGPT, Claude, or any other app that speaks the Model Context Protocol. Ask the app to check on your agents, start a thread, or answer a question an agent is waiting on.

## What you get

- A remote MCP address at your bb connect URL, signed in to with your bb account.
- A local MCP address for apps on the same machine.
- An approval page on your bb account, so an app gets in only when you say so.
- A list of connected apps that you can disconnect at any time.

## How it works

The app sees three tools. `search` finds `bb` commands. `read` and `run` execute a short script that calls the `bb` command line, so the app can do anything the CLI can and combine several steps in one call. Scripts run in a sandbox on your bb server. `read` accepts only commands that inspect bb, so an app can run it without asking you each time. `run` accepts any command.

Access is all or nothing. An approved app can start and steer agents, which run commands and change files on the machines this bb controls, so approve only apps you trust.

## CLI

- `bb mcp status [--json]`: show the remote and local addresses.
- `bb mcp clients [--json]`: list the remote apps that have access.
- `bb mcp revoke <grant-id> [--json]`: disconnect an app.
