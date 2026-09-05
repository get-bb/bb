Keep a Claude Code or Codex thread running when one account hits its limit. The Account Pooler puts every account you own behind a local hub and picks the account for each request.

## What you get

- A pool of Claude and Codex accounts, added by importing the login already on the machine, signing in through the browser, or pasting an Anthropic API key.
- Per-request selection that follows your priority order, then the account with the fewest requests in flight, then the account whose weekly window resets first.
- Live limit windows per account and model family in the plugin's settings page, and the same numbers from `bb pool status`.
- A routing switch per provider and a bypass per thread, so one thread can go straight to its own credentials.

## How it works

The hub runs inside BB and serves an Anthropic Messages endpoint and an OpenAI Responses endpoint. With routing on, BB hands the Claude Code or Codex process a base URL that points at the hub and a token scoped to that machine, and the provider reports **Proxied** in its health row. An account is skipped for a request when it is at or above the switch threshold, on hold, or in error. The threshold defaults to 98 percent of a window. Account secrets stay in the BB data directory on the server machine, and the hub refreshes them in the background.

## Requirements

Accounts you own and are permitted to use this way.

This plugin is experimental. Routing behavior, stored data, and the CLI can change between releases.

## For agents

`bb pool account add|list|remove|enable|disable`, `bb pool status`, `bb pool routing <claude|codex> [--off]`, `bb pool config`, `bb pool config set`, `bb pool token rotate`, and `bb pool bypass <thread-id>`. `list` and `status` take `--json`.
