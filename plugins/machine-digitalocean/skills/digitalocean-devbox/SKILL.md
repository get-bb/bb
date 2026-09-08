---
name: digitalocean-devbox
description: "Configure or operate a long-lived DigitalOcean BB dev box: idle stop, weekday sleep/wake, snapshots, immediate wake, inventory and estimated cost."
---

Use `bb machine list --json` to select an existing DigitalOcean host. Run from
an always-on local thread/server. The DigitalOcean plugin must be configured
with its secret DIGITALOCEAN_TOKEN setting; never print the token.

- `bb digitalocean status <host-id> --json` reads backups, configuration and live costs.
- `bb digitalocean configure <host-id> '<config-json>' --json` replaces settings.
- `bb digitalocean snapshot-now <host-id> --json` quiesces, gracefully shuts down,
  confirms off, snapshots and stays off. Requires active machine and idle threads
  with no open terminals. `sleep` is equivalent.
- `bb digitalocean wake <host-id> --json` resumes through core. Core also wakes
  automatically on dispatch.
- `bb digitalocean cost <host-id> --json` and `bb machine show <host-id> --json`
  show live vendor inventory with estimates.

Configuration example:

```json
{
  "idleMinutes": 60,
  "retention": 2,
  "schedule": {
    "weekdays": [1, 2, 3, 4, 5],
    "sleep": "19:00",
    "wake": "08:00",
    "timezone": "America/Los_Angeles"
  }
}
```

`idleMinutes`: null disables (default); otherwise 1–43200 minutes. Empty machines
also idle-stop. Retirement stays never. `retention`: 1–100, default 2; the global
`snapshotRetention` setting sets new-machine defaults. `schedule`: null disables;
otherwise Sunday=0, explicit IANA timezone and HH:mm times. Configuration saves
reset the cursor. Omitted fields get defaults, so send the complete desired state.

The durable minute schedule catches up only the latest action within eight days.
Busy sleep retries next minute until superseded. Spring DST missing times skip;
autumn repeated times may run twice. All power operations use core, not direct
vendor actions. SDK equivalents: `bb.sdk.hosts.suspend/resume`,
`bb.sdk.hosts.experimental_providerDetails`, and the plugin RPC contract methods
`configure`, `configuration`, `machines`, `status`, `sleep`, `wake`.

Powered-off droplets still bill; snapshot storage bills per GB. Link
[Droplet pricing](https://docs.digitalocean.com/products/droplets/details/pricing/)
and [snapshot pricing](https://docs.digitalocean.com/products/snapshots/details/pricing/).
Snapshot cost uses actual stored GB × $0.06/month. Account-wide unassigned IPs
are shown separately at $5/month. These are estimates, excluding tax, bandwidth,
volumes and credits. Do not describe sleep as compute cost savings.

After sleep verify off and a snapshot ID/size. If status is `off, backup failed`,
keep the machine off and preserve prior backups; report it clearly. Wake then
retry sleep to reconcile. Removal deletes the Droplet and its plugin-owned
snapshots only; verify cleanup through status/vendor inventory and exact 404s.
Never delete user snapshots or unrelated resources.
