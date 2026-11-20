# Using bb on multiple devices

There are two separate ways to use more than one device with bb:

- A browser device is a control surface for one bb server. It can view projects,
  send prompts, and manage threads, but it does not execute them.
- An execution machine runs a host daemon. One bb server can dispatch project
  sources and thread environments across several enrolled machines.

You can use either story independently or combine them.

In both stories one computer runs the bb server. It stores your threads, the
database, and settings, and every browser and execution machine connects to it.
Pick a computer that stays on, such as a desktop, home server, or VM: while the
server machine is asleep or off, nothing can reach bb and running threads may
stop. Settings → Machines badges it `server` once several machines are
connected, `bb machine list` shows `server` in its Role column, and the server
machine cannot be removed.

## Open bb from another browser

The simplest managed route is **bb connect**. Sign the server in to your bb
account from Settings → bb connect (or `bb account login`, or
`bb connect --code ...` with a dashboard code), then open its getbb.app URL.
The server owns the tunnel and reconnects after restart.

For a private tailnet route, keep bb on its loopback default and install the
official Tailscale plugin on the server's machine (Plugins → Browse →
Tailscale), then choose Settings → Tailscale → **Set up**. From the CLI:

```bash
bb plugin install tailscale
bb tailscale setup
```

Setup publishes bb through Tailscale Serve at
`https://<machine>.<tailnet>.ts.net` (on bb's own port, such as `:38886`, when
another service already uses 443), and bb accepts that address without
`BB_APP_URL`. A Serve mapping to bb that you made by hand is adopted unchanged. Tailscale must be installed
and signed in on the server's machine, with MagicDNS and HTTPS certificates on
in the tailnet; `bb tailscale status` says what is missing. **Remove** (or
`bb tailscale teardown`) turns off only the mapping bb created. Tailscale ACLs
are the access boundary for this route; do not expose the server through
Funnel or the public internet. bb connect URLs require the paired account
owner's session.

Existing remote host daemons that target a direct tailnet IP or
`http://<machine>.<tailnet>.ts.net:38886` must migrate before restarting an
upgraded server. Prefer pairing bb connect and re-adding the machine from
Settings → Machines so its installer records the account-gated route. The
private alternative is to set up the Tailscale plugin, drag it to the top of
Settings → Machines → How devices reach this server (or run
`bb server access order tailscale`), and re-run the Add machine installer.

### Local network

With the **Reach machines over several routes** experiment (`serverRoutes`,
on for early adopters), add **Local network** from **Add a route** in
Settings → Machines → How devices reach this server (or run
`bb server access add local-network`) and bb also listens on this
computer's private LAN addresses, without a restart. Devices and machines on
that network then reach bb at `http://<LAN address>:38886`; the address is
shown in Settings and `bb server access list`. Connected machines learn the
route the next time their session opens and Settings → Machines shows "via
Local network" for those using it.

Devices on that network still have to sign in (see [Sign in](#sign-in)), but
the traffic is plain HTTP that anyone on the network can read. Add it only for
a network you trust, and never on public Wi-Fi.

Every route is optional and each keeps its own trust boundary: the local
network trusts the network, the Tailscale route trusts the tailnet's ACLs, a
Manual address trusts whatever fronts it, and bb connect trusts the account
gate.
`bb server access order` sets which one devices try first. Each time a machine
connects it checks every route at once and uses the first that answers,
favoring routes higher in the order. It stays on that route until the
connection drops, then picks again, so a machine whose route stops answering
moves to the next one within seconds, keeping its session if it reconnects
within 30 seconds. Attachments and daemon updates stay on an
encrypted (HTTPS) route while a machine uses the local network, unless the
local network is the only route.

`npx bb-app --server-bind-host 0.0.0.0` serves bb on every IPv4 interface, so
other devices on a trusted network can open `http://<lan-ip>:38886` and sign in.

### Sign in

Every request to bb needs a credential, including requests from the server
machine itself. bb never trusts a request for its address: Tailscale Serve,
nginx, socat or an SSH forward all reach the server from loopback, and some of
them hide the real client. What each client uses:

| Client                                                                      | Credential                                                                      | Setup                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bb` CLI, agents and scripts on the server machine                          | the local token in `<data dir>/local-access-token` (readable only by your user) | none: the CLI reads it for a loopback `BB_SERVER_URL`; set `BB_DATA_DIR` if the server uses another data directory |
| bb desktop app on the server machine                                        | a browser session it creates from the local token                               | none                                                                                                               |
| A browser on the server machine                                             | an HttpOnly session cookie                                                      | open the sign-in link `npx bb-app` prints at startup, or run `bb access pair --open`                               |
| A browser elsewhere (LAN, Tailscale, reverse proxy)                         | an HttpOnly session cookie                                                      | enter a pairing code                                                                                               |
| bb mobile app, desktop app on a remote server, `bb` CLI on another computer | a token bound to a key that never leaves the device (DPoP)                      | enter a pairing code; `bb access login --code <code>` for the CLI                                                  |
| Execution machines                                                          | their machine key                                                               | none: the daemon's loopback proxy signs agents' `bb` commands in                                                   |
| A browser bb connect signed in                                              | the bb connect gate's verdict                                                   | bb account sign-in                                                                                                 |

To sign a device in:

1. Make a one-time code on something already trusted: run `bb access pair`
   on the server machine, or open Settings → Devices → **Sign in another
   device** on a signed-in device (QR code, the code, and a countdown). Codes
   last 10 minutes and work once.
2. On the new device, open bb and enter the code, or scan the QR code.
3. Settings → Devices and `bb access list` show every signed-in device;
   **Revoke** or `bb access revoke <id>` signs one out at once and closes its
   open connections.

Browser sessions end after 30 days without use. Device-bound sessions renew
while the device uses them and end after 30 days without use; their access
tokens last an hour, and a token copied off the network is useless without the
device's key. The bb mobile app's and desktop app's web views get a cookie that
lasts at most an hour and is renewed by the app with its key.

A sign-in made over HTTPS (Tailscale Serve, a TLS reverse proxy) is never
accepted over plain HTTP: the browser cookie is `Secure`, the server refuses it
on an HTTP request, and the CLI sends a token only to the exact origin it signed
in at. Ten wrong codes within five minutes pause code sign-in for a few
minutes.

A local MCP client uses the local address `bb mcp status` prints with the
header `Authorization: Bearer bbl_<contents of local-access-token>`.

Inside a container, `0.0.0.0` listens on the container's IPv4 interfaces; the
container runtime must still publish that port to the host (for example,
`docker run -p 3000:3000 ...`). Host firewall and upstream network rules also
remain separate from bb's bind setting.

### Use editors installed on the browser device

Local editor integration is optional. It connects the remote bb page to the
loopback-only helper started by the bb desktop app or `npx bb-app` on the
computer running the browser. The helper discovers installed editors and opens
paths without exposing its API to the network.

If that browser should open work-host files in its local editor, first make
sure bb is running on the browser device. Verify `ssh <work-host>` succeeds
there, then map the server/work-host to that SSH target:

```bash
npx bb-app client ssh-target set <bb-server-origin> <ssh-target> --host-id <work-host-id>
```

Copy the work-host ID from `bb machine list`. `--host-id` may be omitted when
the server has exactly one machine. A browser running on an enrolled execution
machine needs no SSH mapping for that same machine: connected daemons report
their helper ports to the server, and the browser discovers the matching local
helper after you enable integration.

Then open Settings → Files in that browser and enable **Local editor
integration**. The browser may ask once for permission to connect to software
on the computer. bb does not request that permission during normal remote page
loads; it is only needed for discovering and launching local editors.

If Settings reports that it cannot connect to the helper:

1. Confirm the bb desktop app or `npx bb-app` is running on the browser device.
2. Confirm the browser allows local network access for the bb page.
3. A helper enrolled with this exact server trusts its origin automatically.
   For a separate local bb helper serving a custom HTTPS or Tailscale browser,
   configure that exact origin with
   `npx bb-app config set BB_APP_URL <origin>` and restart bb.
4. Return to Settings → Files and choose **Retry**.

Phones and tablets need no helper; editor-launch actions are simply unavailable.

## Use the bb mobile app

The bb mobile app is a client for a bb server; it runs nothing itself. Over
bb connect it pairs the same way the desktop app does: the phone enrolls as a
connect machine with its own credential, which works for every bb on the
account. The getbb.app dashboard lists the phone under Devices, where you
can remove it.

1. Sign the bb server in to your bb account first (Settings → bb account, `bb account login`, or `bb connect --code …`).
2. Mint a pairing code for the phone: Settings → Mobile → **Add mobile device** (QR code plus the code as text, with a countdown), or run
   `bb connect machine-code` (`--json` prints
   `{code, serverUrl, apex, expiresAt}`).
3. In the mobile app, add a server over bb connect and scan the QR code or type
   the code. Codes last 10 minutes and work once.

The phone keeps its credential in the device keychain and mints sessions from
it; it never holds the server's pairing secret. A session lasts seven days and
renews while the phone is in use. To cut a phone off, remove it from the
getbb.app dashboard; its session stops working within about 20 seconds.
Every phone
takes one of the account's machine slots, so a machine-limit error means an
unused device should be removed first. On a trusted network the app can also
use a direct server URL (Tailscale Serve or `--server-bind-host 0.0.0.0`); it
asks for a pairing code the first time, like a browser. What the phone cannot do is listed in
[platform-support.md](platform-support.md#mobile-app).

The dashboard folds devices that have not been used for 14 days under "Show N
unused"; expanding the fold offers **Remove N unused**. A device paired by a current
bb app that is never used within 14 days of pairing is removed automatically.

### Push notifications on a self-hosted server

The built-in Push notifications plugin sends each notification's thread title
and a short plain-text preview through Expo, so a self-hosted server must reach
`https://exp.host`; it needs no Apple or Google key. An Expo push token can only
send notifications to one app installation, but treat it as private. Device
commands are in the `push-notifications` plugin skill; the relay URL and proxy
settings are in [configuration.md](configuration.md).

## Point the desktop app at another bb

The desktop app's Server menu lists "This Mac", every bb connect server on the
account, and a custom URL. When you select a remote server, the app stops
starting a bb server on this Mac. It starts one again only when you select
"This Mac".

To reach bb connect without a local server, the app enrolls itself once as a
connect machine. That step needs the local server, so the first switch to a
remote server still starts it. The app keeps its own credential, encrypted with
the OS keychain, and never holds the server's pairing secret. The app appears in
the getbb.app dashboard under Devices, named after the computer, where
you can remove it. After a removal, the app drops the
credential and asks the local server again.

To point the desktop app at a direct server (a custom URL such as a LAN or
Tailscale address), enter a pairing code in its window the first time. The app
keeps a device key for that server, encrypted with the OS keychain, and renews
its sign-in while you use it.

A remote server has no realtime link for keybindings and theme. The app re-reads
them when it starts, when it becomes active, and every five minutes.

## Add an execution machine

Open Settings → Machines and choose Add a machine. Run the generated one-line
installer on the computer that should
execute work. Choose Windows in the dialog for a PowerShell command; a Windows
machine needs Node.js 22.19 or newer and Git for Windows, and its daemon starts
when you sign in to Windows. It installs and enrolls a host daemon; when bb connect is paired,
the installer also configures the machine credential used to reach the server
through the account gate. Without bb connect, set up the Tailscale plugin; the
installer targets the first working route in the Settings → Machines order, so
with Tailscale first it targets `https://<machine>.<tailnet>.ts.net`; the loopback listener
is not directly reachable from another machine. When bb connect is not paired and
the server URL is a loopback or unspecified address, the dialog does not show an
installer. It asks you to set up machine access first by choosing the address
machines should use. Once access is ready, the dialog also names the server
machine the new machine will depend on.

The installer always installs the exact host-only `bb-app` package exposed by
that server at `/install/bb-app.tgz`: the host daemon, provider/plugin workers,
native host dependencies, and bundled `bb` CLI, but no web app or server. A
`bb-app` already on PATH, or the npm registry, is used only when the server
provides no package. The installer verifies the route's SHA-256 digest and
skips reinstalling an identical artifact. Like `/install.sh`, the package route
is public. npm installs the package into the machine's bb data directory, not
its system-wide global prefix, so enrollment needs neither `sudo` nor a PATH
change.

Each joined server gets its own daemon instance, data directory
(`~/.bb-machines/<server-host>`, override with `BB_DATA_DIR` when running the
installer), local API port, and launchd/systemd service. The installer persists
the selected port in that data directory. Subsequent runs reuse it; pass
`--host-daemon-port <port>` to the installer to override the selection. One machine can therefore
serve several bb servers at once, and joining never touches a full local bb
install's `~/.bb`. Each instance keeps its own `bb-app` under that data
directory and self-updates against its own server, so servers running different
bb versions on one machine remain isolated.

On Linux, the installer uses the current user's systemd manager (or a system
unit when run as root on a non-container systemd host). If the user bus is
unavailable on a systemd host, installation fails before enrolling or creating
a unit; rerun it from a systemd user session. In containers and on machines without systemd
as init, the installer runs a detached daemon instead. Set
`BB_INSTALL_SKIP_SERVICE=1` only when a detached daemon is acceptable: no
service starts it after a reboot. The temporary daemon used
for a first join is not supervised. When the installer starts a previously
joined daemon without a service, its launcher restarts it after crashes and
self-updates while the launcher remains running.

The installed launchd/systemd service enables `--auto-update`. If session open
reports a newer server protocol, the daemon downloads the server artifact,
verifies its SHA-256 digest, updates its private install, then exits so the
service manager restarts it. Failed attempts fall back to normal reconnect behavior with a persisted
exponential retry backoff from 5 seconds to 5 minutes. Settings → Machines and
`bb machine retry-update <id-or-name>` can bypass the current backoff. A daemon
never downgrades itself to an older server protocol. To opt out, remove
`--auto-update` from
`~/Library/LaunchAgents/app.getbb.host-daemon.<server>.plist` or
`~/.config/systemd/user/bb-host-daemon-<server>.service`, then reload the
service.

After it connects:

1. To create a project from that machine, choose New project, select the
   machine, and browse to its folder. To map an existing project there instead,
   add its path or clone source in project settings.
2. Select the machine when creating a thread, or use `bb thread spawn --machine
<id-or-name> ...`.
3. Inspect enrolled machines with `bb machine list`.

Machine names are conveniences and may be duplicated; CLI targeting by name
requires an unambiguous match. IDs are always accepted. Removing a machine from
Settings stops bb from dispatching new work to it; remove a lost machine's bb
connect access from the getbb.app dashboard as well.

Browser access and execution remain independent: opening bb on a laptop does
not enroll that laptop, and enrolling it as a machine does not expose the bb UI.
