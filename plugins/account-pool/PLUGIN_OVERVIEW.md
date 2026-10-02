Keep a Claude Code or Codex thread running when one account hits its limit. The Account Pooler puts every account you own behind a local hub and picks the account for each request.

## What you get

- A pool of Claude and Codex accounts, added by importing the login already on the machine, signing in through the browser, or pasting an Anthropic API key.
- Accounts run one after another in priority order, with ties following the order added. New conversations stay on the current fallback even when an earlier account recovers. Existing conversations keep their own account until it becomes unavailable.
- Drag handles set the account order within each provider in settings (keyboard: Space to pick up, arrow keys to move, Space to drop, Escape to cancel), with the same operation available through `bb pool account reorder <claude|codex> <id>...`.
- Live limit windows per account and model family in the plugin's settings page, and the same numbers from `bb pool status`.
- A routing switch per provider and a bypass per thread, so one thread can go straight to its own credentials.

## How it works

The hub serves Anthropic Messages and OpenAI Responses endpoints. Routed providers report **Proxied** and receive a machine-scoped hub token. Accounts in error are skipped. The switch threshold defaults to 98 percent. Claude extra usage and Codex credits are fallbacks: usable subscription accounts take precedence, and conversations return when quota recovers. Exhausted accounts are rechecked before fallback. Codex spending-control and explicit credit-depletion restrictions block routing even below the threshold. The pool does not enable extra usage, purchase credits, or change spending limits. Settings shows “Extra usage available” only for reported allowance, never current billing activity. CLI and RPC status expose the same observations. Secrets stay on the server and tokens refresh in the background.

The pool waits once on the same account for short temporary rate limits. Longer holds return Retry-After for pinned conversations while new conversations can advance. A model-family limit detours requests for that family without moving the session’s main pin or the provider cursor. The pool commits a new account after a successful response; a failed attempt across every account retains the previous binding. The current account and session pins survive hub restarts. Session pins expire after 30 idle minutes, with the 4,096 most recently used pins retained.

The pool uses HTTP/1.1 and honors standard proxy environment variables. Connection failures log error codes without credentials or request contents.

## Nested bb servers

A bb server started inside another bb server's thread detects the parent's pooler and enables this plugin. Choose in settings or with `bb pool parent`:

- **proxy** (default): keep a local hub with its own machine tokens and forward pooled traffic to the parent, so the parent's token never reaches this server's agents. Routing is contributed only for providers the parent can serve.
- **isolate**: neutralise the inherited routing and use this instance's own accounts, or each provider's own credentials.

Proxied traffic authenticates as the parent machine's token, so the parent attributes it to itself.

## Requirements

Accounts you own and are permitted to use this way.

Experimental: routing, storage, and CLI may change.

## For agents

`bb pool account add|list|remove|enable|disable|priority|reorder`, `bb pool status`, `bb pool routing <claude|codex> [--off]`, `bb pool config`, `bb pool config set`, `bb pool parent [proxy|isolate]`, `bb pool token rotate`, and `bb pool bypass <thread-id>`. Every command takes `--json` and `--help`; `bb pool --help` lists the commands and `bb pool <command> --help` prints its arguments, options, and rules.
