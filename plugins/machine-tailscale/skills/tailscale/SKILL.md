---
name: tailscale
description: Discover existing tailnet machines and configure private bb server access through an existing Tailscale Serve endpoint.
---

Use `bb tailscale devices` for the bb server host's visible candidates. Select
an explicit device ID and OS username; check ordinary SSH authentication and
host-key trust to its full DNS name. The target needs Node 22.19+ and npm.
`nodeDirectory` can name an absolute bin directory when Node is outside PATH.
No Tailscale API or auth key is needed.

Run `bb tailscale status` for this instance's loopback URL and private-access
status. Inspect the server's `tailscale serve status --json` before proposing
one dedicated HTTPS root mapping to that loopback URL. On macOS the CLI is
`/Applications/Tailscale.app/Contents/MacOS/Tailscale`. Configure only the
specific unused port authorized by the operator; never use Funnel or reset.
`bb tailscale configure <port>` validates the existing mapping without changing
Tailscale configuration. The saved authority must stay stable for enrolled
machines. Per-machine release does not remove a shared Serve endpoint.

Create through `bb machine create --provider tailscale --inputs
'{"deviceId":"<id>","username":"<user>"}'` or the machine input picker.
Optional `accessProviderId: "default"` uses the instance default; otherwise
Tailscale private access is required. The Direct URL setting may be empty.
This plugin does not provision computers or join cloud machines to a tailnet.

Remove with `bb machine remove <host-id>` only when that machine should be
unenrolled and its identity-owned bb installation uninstalled. Preserve the
computer, tailnet membership and unrelated installations. Retry cleanup if
the original device is offline. After removing every dependent machine,
remove only the owned Serve mapping (`tailscale serve --https=<port> off`).
