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

For a private network route, install Tailscale on the server machine and browser
devices, then configure the URL they will open:

```bash
npx bb-app config set BB_APP_URL http://<machine>.<tailnet>.ts.net:38886
```

Start bb with `npx bb-app` and open that URL. A Tailscale IP works in place of
MagicDNS. For microphone and clipboard APIs, put bb behind Tailscale Serve and
use HTTPS:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:38886
npx bb-app config set BB_APP_URL https://<machine>.<tailnet>.ts.net
```

Tailscale ACLs are the access boundary for this route; do not expose the server
through Funnel or the public internet. bb connect URLs require the paired
account owner's session.

If a browser on another computer should open work-host files in its local
editor, run bb's local helper there, verify `ssh <work-host>` succeeds, and map
the server/work-host to that SSH target:

```bash
npx bb-app client ssh-target set <bb-server-origin> <ssh-target>
```

Phones and tablets need no helper; editor-launch actions are simply unavailable.

## Add an execution machine

Open Settings → Machines and choose Add machine. Run the generated one-line
installer on the computer that should
execute work. It installs and enrolls a host daemon; when bb connect is paired,
the installer also configures the machine credential used to reach the server
through the account gate.

The installer always installs the exact `bb-app` package exposed by that
server at `/install/bb-app.tgz`; a `bb-app` already on PATH is reused, and the
npm registry consulted, only when the server provides no package. Version
strings cannot distinguish unpublished builds, so this keeps remote machines
aligned with development and pre-release servers whose build may not exist on
npm. The package route is public like `/install.sh`: `bb-app` is public
software, and exposing an unpublished build slightly early through a paired
tunnel is an accepted tradeoff.

Each joined server gets its own daemon instance, data directory
(`~/.bb-machines/<server-host>`, override with `BB_DATA_DIR` when running the
installer), and launchd/systemd service. One machine can therefore serve
several bb servers at once, and joining never touches a full local bb
install's `~/.bb`. Each instance self-updates against its own server, but
instances currently share the global `bb-app` binary, so servers running
different bb versions on one machine can still fight over it.

The installed launchd/systemd service enables `--auto-update`. If session open
reports a newer server protocol, the daemon downloads and globally installs the
server artifact, then exits so the service manager restarts it. Failed attempts
fall back to normal reconnect behavior with a persisted exponential retry
backoff from 5 seconds to 5 minutes. Settings → Machines and `bb machine
retry-update <id-or-name>` can bypass the current backoff. A daemon never
downgrades itself to an older server protocol. To opt out, remove
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
