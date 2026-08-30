# Rift Arcs

The Rift plugin gives BB one Arc control surface for the host, local Apple
Container, and remote providers. Rift owns lifecycle state, persistence,
provider credentials, and guest execution. The plugin is a typed ACP adapter;
it does not implement a parallel lifecycle service.

Install Rift so `rift-acp` is on the selected host's `PATH`, then install this
official plugin from BB's plugin catalog. The plugin adds the **Arcs** page,
the `acp-rift` provider, and the `bb arc` command.

```sh
bb plugin install rift --yes
bb arc connect
bb arc list --json
bb arc create --backend=apple-container --size=a1.small --json
bb arc thread --id=<arc-id> --project=<project-id> --prompt=<text> --json
```

The selected Arc is persisted with the BB thread. Later starts, turns, and
resumes derive the same Rift session affinity without copying provider secrets
into BB configuration or the guest.

The Arcs page refreshes after lifecycle changes, reconnects, window focus or
visibility changes, and manual refresh. Live `arc/changed` notifications are
not negotiated until BB has a durable provider subscription transport.

URL authorization is currently delivered only when exactly one eligible BB
web client is connected. A shared BB server must therefore be operated as one
trusted user boundary until browser-initiator binding is available.
