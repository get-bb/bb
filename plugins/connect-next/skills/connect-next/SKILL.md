---
name: connect-next
description: "Check or switch the beta next address (https://<label>.next.getbb.app, bb connect next) for this bb."
---

# bb connect next (beta)

The connect-next plugin makes this bb reachable at
`https://<label>.next.getbb.app` through bb's Fly gate, in addition to its
bb connect address `https://<label>.getbb.app`. The domain follows the bb
account it is signed in to (`next.<account domain>`); `status` prints the
exact address. It is on as soon as the
plugin is enabled and needs this bb signed in to its bb account
(`bb account status`).

- `bb connect-next status [--json]` prints the label, the address, and the
  state: `off`, `signed-out`, `connecting`, `connected`, `refused` (the gate
  refused the server credential), `offline` (the gate can't be reached), or
  `error` (the plugin couldn't start the tunnel; `lastError` says why).
- `bb connect-next on [--json]` turns it on; `bb connect-next off [--json]`
  turns it off. Neither touches bb connect or the account sign-in.
- The switch is the plugin setting `enabled`, so
  `bb plugin config bb--connect-next set enabled true` works too.

Only turn it on or off when the user asks.

Port shares: every port shared from the bb server's machine with
`bb connect expose <port>` also answers at
`https://<label>--<port>.next.<account domain>` while connect next is on
(owner session only, like the bb connect share). `bb connect expose` prints
that URL on a second line, and `bb connect-next status` lists each share as
`share <port>  <url>  <state>` (`--json`: `shares[]` with `port`, `url`,
`state` `pending` | `active` | `refused`, and `error`).

Shares from other enrolled machines (`bb connect expose <port> --host
<machine>`) answer at `https://<machine-label>--<port>.next.<account domain>`
while connect next is on; the machine's own daemon runs the tunnel while the
machine shares a port. `bb connect-next status` prints a
`machine <name> (<host id>)  <label>  <state>` line per machine with its
`share` lines (`--json`: `machines[]` with `hostId`, `hostName`, `label`,
`state` `idle` | `connecting` | `connected` | `refused` | `offline` | `error`,
`lastError`, and `shares[]`). A machine missing from the list shares nothing
or runs a bb too old for connect next machine tunnels.

The plugin itself is disabled by default: `bb plugin enable bb--connect-next`
first if `bb connect-next` is not found.
