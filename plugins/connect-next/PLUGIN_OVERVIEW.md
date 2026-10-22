Beta. Reach this bb at `https://<label>.next.getbb.app` through bb's new Fly gate, as well as at its usual `https://<label>.getbb.app` address. The domain follows the bb account this bb is signed in to (`next.<account domain>`). Both answer at once; bb connect keeps working as before.

## What you get

- A second address for this bb, served from the region nearest you.
- On as soon as you enable this plugin and this bb is signed in to your bb account. A switch in Settings, "Reach this bb at its next address (beta)", turns the address off and on again, with the connection state and the address.
- `bb connect-next status`, `bb connect-next on`, and `bb connect-next off`. Add `--json` for machine-readable output.
- Port shares from this bb's machine (`bb connect expose <port>`) at `https://<label>--<port>.next.getbb.app` too, listed in Settings and in `bb connect-next status`.
- Port shares from your other enrolled machines (`bb connect expose <port> --host <machine>`) at `https://<machine-label>--<port>.next.getbb.app`, with each machine's tunnel state in Settings and in `bb connect-next status`.

## How it works

The plugin downloads frp's client, `frpc` 0.71.0, from its GitHub release, checks it against a pinned SHA-256, and runs it. `frpc` makes an outbound WebSocket connection to `tunnel.next.getbb.app` (`tunnel.next.<account domain>`), signs in with this bb's label and the server credential bb account holds, and forwards visitors' requests to a separate tunnel listener on this bb. That listener only accepts requests the gate has signed for this server, so local access stays as it is. The plugin restarts `frpc` if it stops and closes it when you turn the switch off or sign out. Each shared port is one more `frpc` proxy that goes straight to `127.0.0.1:<port>`; sharing or unsharing a port changes the list without restarting `frpc`. On other machines the host daemon does the same with the machine's label and machine credential, and only for the domain the machine enrolled with.

## Requirements

The bb account plugin, signed in to your getbb.app account, and the connect plugin for port shares. Each enrolled machine runs its own `frpc` from its host daemon while it shares a port; a machine whose bb predates this release keeps only its bb connect share until it updates.
