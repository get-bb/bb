---
name: connect-next
description: "Debug bb connect's nearest-region tunnel (bb connect next, the Fly gate) for this bb: status, on, off."
---

# bb connect regions (connect next)

The connect-next plugin serves bb connect from the nearest region through
bb's Fly gate. It is on by default and runs only while this bb is signed in to
its bb account (`bb account status`) and bb connect's Remote access is on
(`bb connect status`; `bb connect off` turns this off too). This bb then also
answers at `https://<label>.next.<account domain>`; `status` prints the exact
address. Give users the bb connect URLs (`bb connect expose` prints them); the
next address is for debugging.

- `bb connect-next status [--json]` prints the label, the address, and the
  state: `off` (the switch or bb connect's Remote access is off; `--json` has
  `enabled` and `remoteAccess`), `signed-out`, `connecting`, `connected`,
  `refused` (the gate refused the server credential), `waiting` (the gate has
  not enabled this server yet during the rollout; it retries about every ten
  minutes and is not an error), `offline` (the gate can't be reached), or
  `error` (the plugin couldn't start the tunnel; `lastError` says why).
- `bb connect-next on [--json]` turns it on; `bb connect-next off [--json]`
  turns it off. Neither touches bb connect or the account sign-in.
- The switch is the plugin setting `enabled`, so
  `bb plugin config bb--connect-next set enabled true` works too.

Only turn it on or off when the user asks.

Port shares: every port shared from the bb server's machine with
`bb connect expose <port>` also answers at
`https://<label>--<port>.next.<account domain>` while connect next is on
(owner session only, like the bb connect share). `bb connect expose --json`
carries it as `nextUrl`, and `bb connect-next status` lists each share as
`share <port>  <url>  <state>` (`--json`: `shares[]` with `port`, `url`,
`state` `pending` | `active` | `refused`, and `error`).

Shares from other enrolled machines (`bb connect expose <port> --host
<machine>`) answer at `https://<machine-label>--<port>.next.<account domain>`
while connect next is on; the machine's own daemon runs the tunnel while the
machine shares a port. `bb connect-next status` prints a
`machine <name> (<host id>)  <label>  <state>` line per machine with its
`share` lines (`--json`: `machines[]` with `hostId`, `hostName`, `label`,
`state` `idle` | `connecting` | `connected` | `refused` | `waiting` |
`offline` | `error`, `lastError`, and `shares[]`). A machine missing from the
list shares nothing or runs a bb too old for connect next machine tunnels.

If `bb connect-next` is not found, the plugin was disabled:
`bb plugin enable bb--connect-next` turns it back on.
