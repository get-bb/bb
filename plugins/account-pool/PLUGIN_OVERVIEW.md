Keep a Claude Code or Codex thread running when one account hits its limit. The Account Pooler puts every account you own behind a local hub and picks the account for each request.

## What you get

- Claude and Codex accounts added by signing in (browser or device code) or with an Anthropic API key. Each holds its own login, so the pool never signs this machine's Claude Code or Codex out; **Sign in again** renews one in place.
- Accounts run one after another in priority order, with ties following the order added. New conversations stay on the current fallback even when an earlier account recovers. Existing conversations keep their own account until it becomes unavailable.
- Drag handles (or Space and arrow keys) set the account order within each provider in settings, as does `bb pool account reorder <claude|codex> <id>...`.
- Live limit windows per account and model family in the plugin's settings page, and the same numbers from `bb pool status`.
- A routing switch per provider and a bypass per thread, so one thread can go straight to its own credentials.

## How it works

The hub serves Anthropic Messages and OpenAI Responses endpoints. Routed providers report **Proxied** and receive a machine-scoped hub token. Requests go to the best tier with an account: below the switch threshold (default 98 percent), then above it while the provider still allows it, then paid (Claude extra usage, Codex credits, overage for that model, API keys). The pool refuses only when every tier is empty. Errored accounts and Codex spending or credit restrictions are excluded. Exhausted accounts are rechecked before paying or refusing. The pool never enables extra usage, buys credits, or changes limits. Secrets stay on the server and tokens refresh in the background.

The pool waits once on the same account for short temporary rate limits. Longer holds return Retry-After for pinned conversations while new conversations can advance. New conversations follow the current account, which moves when a better tier opens. Existing conversations keep their account while it is in the first two tiers and move up off paid accounts. A model-family limit detours that family without moving the pin or current account. A new account is committed after a successful response. The current account and pins survive restarts; pins expire after 65 idle minutes, keeping the newest 4,096.

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

`bb pool account add|login|list|remove|enable|disable|priority|reorder`, `bb pool status`, `bb pool routing <claude|codex> [--off]`, `bb pool config`, `bb pool config set`, `bb pool parent [proxy|isolate]`, `bb pool token rotate`, and `bb pool bypass <thread-id>`. Every command takes `--json` and `--help`; `bb pool --help` lists the commands and `bb pool <command> --help` prints its arguments, options, and rules.

## Automatic retries

Provider Retry uses pool recovery times. Inspect `bb provider-retry status` or `bb provider-retry explain <thread-id>`.
