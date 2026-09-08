# Tailscale machines

Discover existing Linux and macOS devices visible to the bb server's local
Tailscale client, enrol them with ordinary OpenSSH, and optionally give them a
private return path through Tailscale Serve. Machines never suspend or retire
automatically. Removal invokes bb's identity-checked uninstall; it does not
remove the computer, project files, or Tailscale membership.

## Setup

Install/sign in to Tailscale on the **bb server host**. On macOS the plugin
uses `/Applications/Tailscale.app/Contents/MacOS/Tailscale` when present;
otherwise it uses `tailscale` on PATH. Local discovery requires no API key,
auth key or cloud account. It is the current node's peer view, not an
administrative inventory or a promise of reachability.

Enable ordinary SSH on the chosen target (Remote Login on macOS). Configure
public-key/agent authentication and trusted host keys from the server to the
full device DNS name. Password and host-key prompts are disabled; existing
SSH configuration applies. The target needs Node 22.19+ and npm on its SSH
login-shell PATH. An optional absolute Node bin directory can supply a
user-local runtime without editing shell profiles. This plugin does not
install Node or enable Tailscale SSH. Tailscale SSH on macOS requires the
open-source tailscaled variant; ordinary SSH over the tailnet works with the
Mac app.

In Settings → Machines → Add machine → Tailscale machine, select the device
and enter its OS username. Discovery never chooses the first device for you.
The default access choice is Tailscale; select the checkbox to use the
instance's default instead. Existing installations for other bb servers are
kept separate by core's installer. Another identity at the same endpoint is
not replaced. Do not delete a launch record to bypass an ownership refusal.

## Private server access

`bb tailscale status` returns the exact loopback URL of this instance. Choose
an unused HTTPS port and create a **dedicated root mapping** with the server's
Tailscale CLI, after inspecting `tailscale serve status --json`:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:<this-bb-server-port>
bb tailscale configure 8443
bb tailscale status
```

On the Mac app use its absolute CLI path above. Tailnet HTTPS must be enabled;
initial consent may require a tailnet administrator. Network policy must
allow server → device TCP 22 and device → server on the chosen Serve port.
The plugin never runs Serve mutations, Funnel, or global reset. `configure`
only verifies the live mapping and saves its port and server identity.
The picker offers the same verification control. Preserve existing mappings.
Remove the explicitly owned mapping with `tailscale serve --https=8443 off`
after its dependent machines have been removed, never `serve reset`.

The mapping must forward `/` exclusively to `bb.server.loopbackBaseUrl`, use
HTTPS, and have no Funnel enabled on that authority. Installer, enrolment,
WebSocket, account-pool and plugin runtime traffic all use this endpoint.
bb authentication remains required. A machine's grant uses `kind: direct`;
releasing one grant leaves the shared mapping alone. Every availability check
and acquisition rereads Tailscale status/configuration, including after a bb
restart. Certificate eligibility must include the server's DNS name; a stale
mapping is not ready when tailnet HTTPS has been disabled. Changing the saved
authority is refused: restore it rather than stranding existing machines. If intentionally migrating endpoints, remove
all dependent machines first and reinstall the plugin to clear its state.

“Server URL reachable by machines” may remain empty. It applies only to
Direct URL access. Select Tailscale explicitly as default machine access to
use it with SSH or other already-networked providers; Automatic does not
silently select Tailscale. A DO/Modal machine must already have suitable
networking before using this endpoint; this plugin does not join cloud
machines to the tailnet.

## CLI and SDK

```sh
bb tailscale devices
bb tailscale status
bb tailscale configure 8443
bb machine create --provider tailscale --inputs '{"deviceId":"<id-from-devices>","username":"dev"}'
bb thread spawn --project <git-project-id> --new-machine tailscale --machine-inputs '{"deviceId":"<id>","username":"dev"}' --environment-provider project-checkout --environment-inputs '{}' --prompt 'Inspect the workspace'
bb machine remove <host-id>
```

The thread example uses a project with a Git remote accessible from the new
machine. Core clones that project before attaching the checkout; empty checkout
inputs select its default path. Tailscale declares no default environment row,
so `--environment-provider` is required with `--new-machine`.

The core SDK equivalent is `sdk.hosts.create({ machineProviderId: "tailscale",
projectId: null, inputs: { deviceId, username } })`. Full inputs add
`nodeDirectory: null | "/absolute/bin"` and
`accessProviderId: "tailscale" | "default"`; defaults are filled at validation.
The plugin's typed `tailscaleContract` exposes `devices(null)`,
`accessStatus(null)`, and `configure({ port })` via public plugin RPC, matching
the three CLI commands. External SDK consumers use
`sdk.plugins.callRpc({ pluginId: "machine-tailscale", method: "accessStatus",
input: null, outputSchema: accessStatusSchema })` (schema in `contract.ts`).
Device ownership is reserved across concurrent
Tailscale launches; core's remote identity guard protects cross-provider
conflicts. Offline/renamed devices block cleanup until the original trusted
target returns. Cancellation never stores bootstrap bundles in resource/KV
records or logs. Core owns enrolment credentials and daemon lifecycle. If a launch was cancelled
before its checkpoint, `experimental_reconcileCleanup` releases only a saved
reservation proven not to have started bootstrap. An uncertain started
installation requires its checkpoint for identity-checked cleanup.

## Verification

```sh
pnpm exec turbo run typecheck lint test --filter=bb-plugin-machine-tailscale --filter=bb-machine-ssh --filter=bb-plugin-environment-ssh-machine
```

Tests cover malformed/stale inventory, Serve routing/privacy/drift, retries,
concurrent adoption, cancellation before/after installation, ownership-checked
cleanup, private stdin and picker input/access behavior. Shared OpenSSH tests
retain strict host-key, quoting, timeout and process-output bounds.

## Logo and references

The monochrome icon comes from Tailscale's official [press kit](https://tailscale.com/press),
[October 2025 brand archive](https://cdn.sanity.io/files/w77i7m8x/production/a426ba5f63316745e108a18a6dbbfed6970752fd.zip),
`Tailscale Logo/svg/Blk/Tailscale_icon_blk_rgb.svg`. Geometry and opacity are
unchanged; XML metadata and CSS were removed and the fill uses currentColor.
The logo is a Tailscale trademark, distributed under the press kit's brand
usage guidance, not relicensed under this repository's software licence.
No separate open-source logo licence was supplied in the archive.

- [Tailscale CLI](https://tailscale.com/kb/1080/cli)
- [Serve](https://tailscale.com/kb/1312/serve)
- [Tailscale SSH platform requirements](https://tailscale.com/kb/1193/tailscale-ssh)
