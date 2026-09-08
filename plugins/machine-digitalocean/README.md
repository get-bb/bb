# DigitalOcean machines

Catalog plugin providing the `digitalocean` machine provider. Create a standalone
machine from Settings → Machines or through `bb machine create` / the public
machines SDK using this provider. Configure project sources and agent credentials
on the resulting machine separately. The plugin does not create an environment
provider or copy a project checkout.

For a project with a Git remote, the DigitalOcean environment-picker row creates
a machine and selects Project checkout. Core clones/registers the project source
before creating the environment. This shortcut uses the same Region and Size
inputs as standalone creation. Without a project Git remote the checkout shortcut
is hidden; standalone creation and an explicit Personal workspace selection
remain available because the machine provider itself requires no project.

Set the secret plugin setting `DIGITALOCEAN_TOKEN`. The token needs Droplet read,
create, update and delete permissions, image/snapshot read and delete, snapshot creation, reserved-IP read, and tag creation. Each launch
accepts nonsecret `region` and `size` inputs, defaulting to `nyc3` and
`s-2vcpu-4gb`. The Machines-page create picker exposes editable Region and Size
fields with those same defaults. Enter DigitalOcean region and size slugs using
lowercase letters, numbers, and hyphens. Invalid input blocks creation until
corrected. The image is `ubuntu-24-04-x64`. Configure the instance's default
server-access provider before creating machines.

The plugin prepares core enrollment, obtains the public installer command, and
passes its private stdin through cloud-init user data. Cloud-init writes the
bundle to a root-owned 0600 file, feeds it to the installer, removes the file,
and suppresses installer output. It first installs the official x64 Node 22.23.2
binary (with npm), verifies its pinned SHA-256, and adds `/usr/local/bin` to PATH.
Core's installer enrolls the machine and
installs the persistent service. Credentials are absent from plugin progress,
resource records, allocation intents, and command arguments. DigitalOcean and
root on the Droplet can access user data; the enrollment credential is one-time
and short-lived.

## Long-lived dev boxes

Every sleep now quiesces through core, gracefully shuts down (`shutdown`), confirms
off, snapshots the disk and remains off. Busy threads and open terminals prevent
sleep; finish work and close terminals first. Snapshot names encode host identity
and UTC time. Metadata (ID, size and creation time) is durable before pruning.
Snapshot intent belongs to a shutdown generation. After any wake, the next sleep
creates a fresh backup; only retries within the same shutdown reconcile an
uncertain submission. If backup fails after shutdown, status reads **off, backup failed**, the machine
remains suspended and prior backups survive. Retry after waking. Snapshot now
also sleeps the machine; it requires an active machine. This is disk backup,
not a memory checkpoint. Attached volumes need separate protection.

Retention defaults to 2; the plugin setting `snapshotRetention` (1–100) supplies
new-machine defaults. Each box can override `retention`. Only snapshots with the
plugin's host-specific ownership name and matching Droplet resource ID are
pruned. Remove deletes the Droplet and all its plugin-owned snapshots; manual
snapshots and other machines' snapshots survive. Cleanup failures remain retryable.

Idle stop is opt-in: creation accepts `idleMinutes` (null by default), including
in Add machine. Core's policy checks live thread activity and open terminals,
including machines with no threads, and wakes on dispatch. Automatic retirement
remains **never**. Plugin settings expose a machine selector, idle duration,
retention, weekday sleep/wake times, timezone and immediate snapshot/wake/cost.

**Powered-off droplets still bill; snapshot storage bills per GB.** See official
[Droplet pricing](https://docs.digitalocean.com/products/droplets/details/pricing/),
[snapshot pricing](https://docs.digitalocean.com/products/snapshots/details/pricing/)
and [reserved IP pricing](https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/).
Cost is labelled an estimate: live `/v2/sizes` rates, running/off observations,
actual snapshot GB × $0.06/month and account-wide unassigned reserved IPv4 at
$5/month are shown separately. Assigned IPs are free. Machine rows/details,
`bb machine show --json`, and the plugin status/cost commands expose estimates.
Account-wide rates, snapshots and reserved IPs are shared across callers for
30 seconds; concurrent reads coalesce and mutations invalidate the cache.
Sleep JSON always includes saved power/backup status and snapshot ID. Optional
`details.values.cost` is null with `inventoryError` when inventory is unavailable;
status and the UI also retain saved backup state during vendor outages.
Tax, bandwidth, volumes and credits are excluded; this is not an invoice.

### Configure from a local thread

```sh
bb digitalocean configure <host-id> '{"idleMinutes":60,"retention":2,"schedule":{"weekdays":[1,2,3,4,5],"sleep":"19:00","wake":"08:00","timezone":"America/Los_Angeles"}}' --json
bb digitalocean snapshot-now <host-id> --json
bb digitalocean sleep <host-id> --json
bb digitalocean wake <host-id> --json
bb digitalocean status <host-id> --json
bb digitalocean cost <host-id> --json
bb machine show <host-id> --json
bb digitalocean configure <host-id> '{"idleMinutes":null,"retention":2,"schedule":null}' --json
```

Configuration replaces all three fields; omitted fields get their documented
defaults. Saving resets the schedule cursor to now and invalidates previously selected
runs. A run already dispatched through core may finish, but cannot overwrite
the replacement configuration cursor. Commands are backed by the
plugin RPC contract (`configure`, `configuration`, `machines`, `status`, `sleep`,
`wake`) through `bb.sdk.plugins.callRpc`; `snapshot-now` aliases core-backed sleep.
Core lifecycle SDK parity is `bb.sdk.hosts.suspend/resume`, and inventory is
`bb.sdk.hosts.experimental_providerDetails({hostId})`.

The SDK's durable minute cron runs on the **always-on BB server**, never on the
sleeping box. Weekdays use Sunday=0 through Saturday=6. Schedule times require an
IANA timezone. On a missed run or restart, only the latest action in the past
eight days runs; completed cursors are durable. Busy/failed actions retry next
minute until superseded by a newer action. A wake waits for an in-progress
suspension; skipped transitional states remain pending. Waking an active box
is a no-op. Nonexistent spring-DST times are
skipped; repeated autumn times may run twice (already-off/on operations are
skipped). Vendor lifecycle operations always route through core suspend/resume.

Creation prepares enrollment before vendor allocation and awaits a core resource
checkpoint as soon as the allocation ID is known. The checkpoint contains no
bootstrap credentials. Core can remove a cancelled allocation directly from
that checkpoint without rerunning creation, enrollment, or bootstrap.

## Retry and cancellation

The vendor name and tag are a deterministic hash of core's creation key. Before
POST, the plugin persists a small allocation intent. It records the returned ID
even if cancellation arrives during POST, then propagates cancellation. The
create HTTP request has a 30-second deadline; all other requests and polling
honor cancellation. Provisioning is bounded to ten minutes and power actions to
five minutes plus the initiating request.

Retries reconcile the stored ID or tag before doing anything else. An unknown
POST outcome is never followed by another create POST for that key. The plugin
reconciles for up to 30 seconds and returns an explicit unresolved-allocation
failure if no Droplet is visible. DigitalOcean's create reference documents no
idempotency header or unique-name guarantee. A crash after persisting intent but
before POST can therefore leave an unresolved allocation that requires operator
reconciliation. Do not clear that intent until vendor state has been established.

Core owns enrollment/access cleanup. If cloud-init never completes before its
one-time bootstrap expires, this provider has no remote exec channel to deliver
a replacement credential. Remove/reconcile the failed allocation and start a
new machine. A normally enrolled Droplet resumes using its durable credentials.

## Vendor contract references

Request fields and behavior were checked against DigitalOcean's primary API
reference and OpenAPI specification:

- [Create a Droplet](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/droplets_create.yml)
- [Create fields, user-data limit, and permissions](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/models/droplet_create.yml)
- [Tag-filtered lookup](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/droplets_list.yml)
- [Power actions](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/dropletActions_post.yml)
- [Action status](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/dropletActions_get.yml)
- [Delete a Droplet](https://github.com/digitalocean/openapi/blob/main/specification/resources/droplets/droplets_destroy.yml)

Live verification includes core enrollment, project checkout and Git worktree threads, allocation cancellation, and vendor-confirmed cleanup.

Node runtime checksum: [official Node 22.23.2 SHA-256 manifest](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt).

The daemon installer does not install an agent CLI. Preinstall the chosen agent
in the image/template, or run `bb machine provider-cli install <host-id> codex`
and retry the thread. Account Pooler can supply runtime authentication through
the selected server-access grant.

## Logo and trademark

`digitalocean-logo.svg` uses the official DO icon from
[DigitalOcean's press page](https://www.digitalocean.com/press), specifically
`DO Logo Assets/SVG/DO_Logo_icon_black.svg` in its
[logo archive](https://web-platforms.sfo2.cdn.digitaloceanspaces.com/DO%20Logo%20Assets.zip).
The geometry and square viewBox are preserved; editor metadata and redundant
groups are removed, and the single fill inherits `currentColor` for both themes.

The archive contains no separate logo license. DigitalOcean's
[Trademark Usage Guidelines](https://www.digitalocean.com/legal/trademark-usage-guidelines)
reserve the marks, require accurate identification without implied endorsement,
and require express permission for logo use except as authorized by those
guidelines. The mark identifies the service this plugin integrates with; it is
not covered by bb's code license. This product is not affiliated with or
endorsed by DigitalOcean, LLC.
