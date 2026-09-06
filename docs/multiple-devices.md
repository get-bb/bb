# Using bb on multiple devices

There are two separate ways to use more than one device with bb:

- A browser device is a control surface for one bb server. It can view projects,
  send prompts, and manage threads, but it does not execute them.
- An execution machine runs a host daemon. One bb server can dispatch project
  sources and thread environments across several enrolled machines.

You can use either story independently or combine them.

## Open bb from another browser

The simplest managed route is **bb connect**. Pair the server from Settings →
Connect (or `bb connect --code ... --server
...`), then open its getbb.app URL. The server owns the tunnel and reconnects
after restart.

For a private tailnet route, keep bb on its loopback default and publish it
through Tailscale Serve:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:38886
npx bb-app config set BB_APP_URL https://<machine>.<tailnet>.ts.net
```

Start bb with `npx bb-app` and open the HTTPS URL. Tailscale ACLs are the access
boundary for this route; do not expose the server through Funnel or the public
internet. bb connect URLs require the paired account owner's session.

Existing remote host daemons that target a direct tailnet IP or
`http://<machine>.<tailnet>.ts.net:38886` must migrate before restarting an
upgraded server. Prefer pairing bb connect and re-adding the machine from
Settings → Machines so its installer records the account-gated route. The
private alternative is to open bb through the Tailscale Serve URL and re-run
the Add machine installer from there.

For compatibility only, `npx bb-app --server-bind-host 0.0.0.0` restores direct
IPv4 network access. The public API is unauthenticated and permits command
execution and file reads, so use wildcard binding only behind a trusted network
boundary and never through Funnel or the public internet.

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
connect machine with its own credential, which the getbb.app dashboard lists
and can revoke.

1. Pair the bb server with bb connect first (Settings → Remote access, or
   `bb connect --code … --server …`).
2. Turn on the **Mobile app** experiment (Settings → Experiments, or
   `bb settings experiment mobileApp true`). Mobile pairing stays hidden
   without it while the app is in early access.
3. Mint a pairing code for the phone: Settings → Remote access → **Add mobile
   device** (QR code plus the code as text, with a countdown), or run
   `bb connect machine-code` (`--json` prints
   `{code, serverUrl, apex, expiresAt}`).
4. In the mobile app, add a server over bb connect and scan the QR code or type
   the code. Codes last 10 minutes and work once.

The phone keeps its credential in the device keychain and mints short-lived
sessions from it; it never holds the server's pairing secret. To cut a phone
off, revoke it in the getbb.app dashboard machine list. Every phone takes one of
the account's machine slots, so a machine-limit error means an unused device
should be revoked first. On a trusted network the app can also use a direct
server URL (Tailscale Serve or `--server-bind-host 0.0.0.0`) with the same
caveats as a browser. Platforms (iOS first) and what the phone cannot do are
listed in [platform-support.md](platform-support.md).

### Push notifications on a self-hosted server

The built-in Push notifications plugin sends messages through Expo. A
self-hosted server must reach `https://exp.host`. The server needs no Apple or
Google key.

An Expo push token lets its holder send a notification to one app installation.
The token cannot read notifications. It cannot access the phone or authenticate
to the bb server. Treat the token as private because a leak can cause unwanted
notifications.

The server sends a thread title and a short preview. Use these commands to
manage device registrations and inspect the sender:

```bash
bb push-notifications list
bb push-notifications add --token <expo-push-token> --platform ios --label <device-name>
bb push-notifications remove <id>
bb push-notifications status
```

Turn delivery off with `bb plugin disable push-notifications`. The plugin keeps
registrations in its private storage. Enable the plugin to resume delivery.

The `expoPushUrl` plugin setting changes the Expo endpoint. Use it only for a
controlled test service or a compatible relay:

```bash
bb plugin config push-notifications set expoPushUrl <url>
```

The Expo request supports `HTTPS_PROXY` and `NO_PROXY`.

## Point the desktop app at another bb

The desktop app's Server menu lists "This Mac", every bb connect server on the
account, and a custom URL. When you select a remote server, the app stops
starting a bb server on this Mac. It starts one again only when you select
"This Mac".

To reach bb connect without a local server, the app enrolls itself once as a
connect machine. That step needs the local server, so the first switch to a
remote server still starts it. The app keeps its own credential, encrypted with
the OS keychain, and never holds the server's pairing secret. The app appears in
the getbb.app dashboard machine list, where you can revoke it. After a revoke,
the app drops the credential and asks the local server again.

A remote server has no realtime link for keybindings and theme. The app re-reads
them when it starts, when it becomes active, and every five minutes.

## Keep working after the desktop window closes

The desktop app is a client of a bb server, never its owner. On startup it
probes the loopback server port: when a healthy server is already listening
and its recorded version matches the app, the app attaches to it silently.
Otherwise it asks — a different version, or a server it cannot identify,
still gets the already-running dialog, and the app never stops a process it
cannot identify. When nothing answers, the app starts its own server. The
startup cases, in full:

- No server answers: the app starts its own (owned) server.
- The app already started one in this session: it keeps using it, and Quit
  stops it.
- A healthy server the app did not start, same version: attach silently, and
  Quit leaves it running.
- A healthy server of a different version: ask (connect, or stop it and
  start fresh).
- A server with a stale or unreadable process record: ask, and never stop
  what cannot be identified.

Closing the last window never ends the session. On macOS the app stays in
the dock; on Windows it stays in the tray (Open bb brings a window back,
Quit bb quits for real); on Linux closing the last window still quits.
Quitting stops an owned server — in-flight turns on it end — and never
touches an attached one.

To survive Quit and reboot, run the server outside the app and let the app
attach to it on next start. The Add-machine installer below uses exactly
this pattern for host daemons (a per-user scheduled task, or a Run value
when task registration needs elevation); wrapping a `bb-app` server start
in the same per-user shape keeps it across logon, and the app attaches to
it when the versions match.

## Add an execution machine

Open Settings → Machines and choose Add machine. Run the generated one-line
installer on the computer that should
execute work. It installs and enrolls a host daemon; when bb connect is paired,
the installer also configures the machine credential used to reach the server
through the account gate. Without bb connect, open the server through a
Tailscale Serve URL before generating the installer; the loopback listener is
not directly reachable from another machine. When bb connect is not paired and
the server URL is a loopback or unspecified address, the dialog does not show an
installer. It links to Settings → Remote access instead.

The installer always installs the exact host-only `bb-app` package exposed by
that server at `/install/bb-app.tgz`. The package contains the host daemon,
provider/plugin workers, native host dependencies, and bundled `bb` CLI, but no
web app or server. A `bb-app` already on PATH is reused, and the npm registry
consulted, only when the server provides no package. Version strings cannot
distinguish unpublished builds, so the route also publishes a SHA-256 digest.
The installer verifies that digest and uses a conditional request on later runs
to skip an identical installed artifact. The package route is public like
`/install.sh`: `bb-app` is public software, and exposing an unpublished build
slightly early through a paired tunnel is an accepted tradeoff. npm installs
the package into the machine's bb data directory, not its system-wide global
prefix, so enrollment needs neither `sudo` nor a PATH change.

Each joined server gets its own daemon instance, data directory
(`~/.bb-machines/<server-host>`, override with `BB_DATA_DIR` when running the
installer), local API port, and persistent service: a launchd agent on macOS,
a systemd user unit on Linux, and on Windows a per-user scheduled task at
logon (when the installer runs elevated) or otherwise a per-user Run registry
value that starts the daemon at logon. The installer persists
the selected port in that data directory and atomically reserves it under
`~/.bb-machines/host-daemon-ports/`, including when `BB_DATA_DIR` points
elsewhere. Subsequent runs reuse the reservation; pass `--host-daemon-port
<port>` to the installer to override the selection. One machine can therefore
serve several bb servers at once, and joining never touches a full local bb
install's `~/.bb`. Each instance keeps its own `bb-app` under that data
directory and self-updates against its own server, so servers running different
bb versions on one machine remain isolated.

The installed service enables `--auto-update`: the launchd agent, the systemd
user unit, the Windows scheduled task, and the Windows Run-key launcher all
start the same per-enrollment wrapper. If session open
reports a newer server protocol, the daemon downloads the server artifact,
verifies its SHA-256 digest, updates its private install, then exits so the
service manager restarts it. If the identical artifact is already installed,
the server returns `304` and the daemon restarts without downloading or running
npm again.
Failed attempts fall back to normal reconnect behavior with a persisted
exponential retry backoff from 5 seconds to 5 minutes. Settings → Machines and
`bb machine retry-update <id-or-name>` can bypass the current backoff. A daemon
never downgrades itself to an older server protocol. To opt out, remove
`--auto-update` from
`~/Library/LaunchAgents/app.getbb.host-daemon.<server>.plist`,
`~/.config/systemd/user/bb-host-daemon-<server>.service`, or on Windows the
`bb-host-daemon-<server>.cmd` launcher in the enrollment data directory, then
reload or restart the service.

On Windows, run the generated PowerShell command from `Add machine` instead
of the POSIX one-liner: it downloads `install.ps1`, then runs it with
`-ExecutionPolicy Bypass` for that process only. No elevation is needed: an
unelevated installer enrolls with a Run-key launcher and says so. Crash
restarts are best-effort there (see K14 in `KNOWN-ISSUES.md`); use
`schtasks /Run /TN <task>` or rerun the installer to revive a stopped daemon,
and `schtasks /Delete /TN <task> /F` to uninstall the scheduled-task
persistence.

After it connects:

1. To create a project from that machine, choose New project, select the
   machine, and browse to its folder. To map an existing project there instead,
   add its path or clone source in project settings.
2. Select the machine when creating a thread, or use `bb thread spawn --machine
<id-or-name> ...`.
3. Inspect enrolled machines with `bb machine list`.

Machine names are conveniences and may be duplicated; CLI targeting by name
requires an unambiguous match. IDs are always accepted. Removing a machine from
Settings stops bb from dispatching new work to it; revoke a lost machine's bb
connect access from the getbb.app dashboard as well.

Browser access and execution remain independent: opening bb on a laptop does
not enroll that laptop, and enrolling it as a machine does not expose the bb UI.
