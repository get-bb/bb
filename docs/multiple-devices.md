# Using bb on multiple devices

There are two separate ways to use more than one device with bb:

- A browser device is a control surface for one bb server. It can view projects,
  send prompts, and manage threads, but it does not execute them.
- An execution machine runs a host daemon. One bb server can dispatch project
  sources and thread environments across several enrolled machines.

You can use either story independently or combine them.

## Open bb from another browser

The simplest managed route is **bb connect**. Enable the bb connect experiment,
pair the server from Settings → Connect (or `bb connect --code ... --server
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

Enable the **Multi-machine** experiment, open Settings → Machines, and choose
Add machine. Run the generated one-line installer on the computer that should
execute work. It installs and enrolls a host daemon; when bb connect is paired,
the installer also configures the machine credential used to reach the server
through the account gate.

After it connects:

1. Add that machine's project path or clone source in project settings.
2. Select the machine when creating a thread, or use `bb thread spawn --machine
<id-or-name> ...`.
3. Inspect enrolled machines with `bb machine list`.

Machine names are conveniences and may be duplicated; CLI targeting by name
requires an unambiguous match. IDs are always accepted. Removing a machine from
Settings stops bb from dispatching new work to it; revoke a lost machine's bb
connect access from the getbb.app dashboard as well.

Browser access and execution remain independent: opening bb on a laptop does
not enroll that laptop, and enrolling it as a machine does not expose the bb UI.
