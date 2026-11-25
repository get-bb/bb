---
name: tailscale
description: "Check, set up, or remove Tailscale Serve access to this bb (https://<machine>.<tailnet>.ts.net) with bb tailscale."
---

# Tailscale

The tailscale plugin makes this bb reachable at
`https://<machine>.<tailnet>.ts.net` through Tailscale Serve. The tailnet is
the access boundary; there is no bb sign-in on this route.

- `bb tailscale status [--json]` prints the state, the address, the tailnet,
  whether `https://<address>/health` answers from this bb, and what to fix.
  States: `not-installed`, `not-running`, `logged-out`, `needs-approval`,
  `needs-magicdns`, `needs-https` (turn it on at `adminUrl`), `not-served`
  (run setup), `conflict` (443 and bb's own port are both used by other
  services), `served`, `error`. `--json` adds `serve` (`port`, `url`,
  `owner` `bb` | `adopted`, `funnel`) and `https` (`ok`, `error`).
- `bb tailscale setup [--json]` runs
  `tailscale serve --bg --yes --https=443 <bb's loopback URL>` on the server's
  machine, or `--https=<bb's port>` (for example 38886) when 443 is taken. A
  port counts as taken when Tailscale Serve already uses it or something
  already listens on this machine's tailnet address at that port, so it never
  replaces another service's mapping or shadows bb bound to every interface.
  A mapping to bb made by hand is adopted unchanged.
- `bb tailscale teardown [--json]` removes only the mapping bb created; it
  refuses to remove an adopted one and prints the `tailscale serve` command
  that would.

Only run `setup` or `teardown` when the user asks: both change the server
machine's Tailscale configuration.

The plugin changes Serve only on `setup` and `teardown`. Stopping bb or
disabling the plugin (`bb plugin disable bb--tailscale`) leaves the mapping in
place; `teardown` (Settings → Tailscale → Remove) is how to turn it off.

On Linux, a `setup` that fails with an operator message needs
`sudo tailscale set --operator=$USER` on the server's machine first. Never turn
on Tailscale Funnel for bb; `status` warns when it is on.

Install the plugin with `bb plugin install tailscale` (it is an official
plugin bundled with bb but not installed by default).

Once `status` is `served`, bb accepts the address as a request host without
`BB_APP_URL`, and it is the server access route `tailscale` (a private overlay
route). New machines install over the first working route in the Settings →
Machines order; put it first with `bb server access order tailscale`.
`bb server access list` shows every route.
