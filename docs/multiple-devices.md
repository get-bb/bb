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
npx bb-app client ssh-target set <bb-server-origin> <ssh-target>
```

Then open Settings → Files in that browser and enable **Local editor
integration**. The browser may ask once for permission to connect to software
on the computer. bb does not request that permission during normal remote page
loads; it is only needed for discovering and launching local editors.

If Settings reports that it cannot connect to the helper:

1. Confirm the bb desktop app or `npx bb-app` is running on the browser device.
2. Confirm the browser allows local network access for the bb page.
3. For a custom HTTPS or Tailscale origin, configure that exact origin with
   `npx bb-app config set BB_APP_URL <origin>` and restart bb.
4. Return to Settings → Files and choose **Retry**.

Phones and tablets need no helper; editor-launch actions are simply unavailable.

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

The installer always installs the exact `bb-app` package exposed by that
server at `/install/bb-app.tgz`; a `bb-app` already on PATH is reused, and the
npm registry consulted, only when the server provides no package. Version
strings cannot distinguish unpublished builds, so this keeps remote machines
aligned with development and pre-release servers whose build may not exist on
npm. The package route is public like `/install.sh`: `bb-app` is public
software, and exposing an unpublished build slightly early through a paired
tunnel is an accepted tradeoff. npm installs the package into the machine's bb
data directory, not its system-wide global prefix, so enrollment needs neither
`sudo` nor a PATH change.

Each joined server gets its own daemon instance, data directory
(`~/.bb-machines/<server-host>`, override with `BB_DATA_DIR` when running the
installer), local API port, and launchd/systemd service. The installer persists
the selected port in that data directory and atomically reserves it under
`~/.bb-machines/host-daemon-ports/`, including when `BB_DATA_DIR` points
elsewhere. Subsequent runs reuse the reservation; pass `--host-daemon-port
<port>` to the installer to override the selection. One machine can therefore
serve several bb servers at once, and joining never touches a full local bb
install's `~/.bb`. Each instance keeps its own `bb-app` under that data
directory and self-updates against its own server, so servers running different
bb versions on one machine remain isolated.

The installed launchd/systemd service enables `--auto-update`. If session open
reports a newer server protocol, the daemon downloads the server artifact,
updates its private install, then exits so the service manager restarts it.
Failed attempts fall back to normal reconnect behavior with a persisted
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
Settings stops bb from dispatching new work to it; revoke a lost machine's bb
connect access from the getbb.app dashboard as well.

Browser access and execution remain independent: opening bb on a laptop does
not enroll that laptop, and enrolling it as a machine does not expose the bb UI.
