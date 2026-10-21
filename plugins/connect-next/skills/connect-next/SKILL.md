---
name: connect-next
description: "Check or switch the beta next address (https://<label>.next.getbb.app, bb connect next) for this bb."
---

# bb connect next (beta)

The connect-next plugin makes this bb reachable at
`https://<label>.next.getbb.app` through bb's Fly gate, in addition to its
bb connect address `https://<label>.getbb.app`. The domain follows the bb
account it is signed in to (`next.<account domain>`); `status` prints the
exact address. It is off by default and
needs this bb signed in to its bb account (`bb account status`).

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
`state` `pending` | `active` | `refused`, and `error`). Shares from other
enrolled machines are not on the next address yet.

The plugin itself is disabled by default: `bb plugin enable bb--connect-next`
first if `bb connect-next` is not found.
