# DigitalOcean machines

Catalog plugin providing the `digitalocean` machine provider. Create a standalone
machine from Settings → Machines or through `bb machine create` / the public
machines SDK using this provider. Configure project sources and agent credentials
on the resulting machine separately. The plugin does not create an environment
provider or copy a project checkout.

Set the secret plugin setting `DIGITALOCEAN_TOKEN`. The token needs Droplet read,
create, update and delete permissions, image read, and tag creation. Each launch
accepts nonsecret `region` and `size` inputs, defaulting to `nyc3` and
`s-2vcpu-4gb`. The image is `ubuntu-24-04-x64`. Configure the instance's default
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

Machines have no idle suspension or automatic retirement. Suspend uses the
DigitalOcean `power_off` action (a hard power-off); resume uses `power_on` and
waits for the existing machine connection. Removal deletes the Droplet. No
filesystem snapshots, copied enrollment code, or plugin daemon supervisor are
involved.

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

No live DigitalOcean validation has been performed.

Node runtime checksum: [official Node 22.23.2 SHA-256 manifest](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt).
