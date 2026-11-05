Serves bb connect from the region nearest you, through bb's Fly gate. It is on by default and follows bb connect: it runs only while this bb is signed in to your bb account and bb connect's Remote access is on, so turning Remote access off turns this off too.

## What you get

- Remote access to this bb served from the nearest region. This bb also answers at `https://<label>.next.getbb.app` (`next.<account domain>`), and ports you share with `bb connect expose`, from this bb's machine or another enrolled machine, answer there too.
- A switch in Settings, "Nearest region", and one line of status. While bb rolls this out, a bb the gate has not enabled yet shows "Not yet available for this bb" and checks again every few minutes; nothing is wrong.
- `bb connect-next status`, `bb connect-next on`, and `bb connect-next off` for debugging. Add `--json` for machine-readable output.

## How it works

The plugin downloads frp's client, `frpc` 0.71.0, from its GitHub release, checks it against a pinned SHA-256, and runs it. `frpc` makes an outbound WebSocket connection to `tunnel.next.getbb.app` (`tunnel.next.<account domain>`), signs in with this bb's label and the server credential bb account holds, and forwards visitors' requests to a separate tunnel listener on this bb. That listener only accepts requests the gate has signed for this server, so local access stays as it is. The plugin restarts `frpc` if it stops and closes it when you turn the switch off, turn Remote access off, or sign out. Each shared port is one more `frpc` proxy that goes straight to `127.0.0.1:<port>`; sharing or unsharing a port changes the list without restarting `frpc`. On other machines the host daemon does the same with the machine's label and machine credential, and only for the domain the machine enrolled with.

## Requirements

The bb account plugin, signed in to your getbb.app account, and the connect plugin with Remote access on. Each enrolled machine runs its own `frpc` from its host daemon while it shares a port; a machine whose bb predates this release keeps only its bb connect share until it updates.
