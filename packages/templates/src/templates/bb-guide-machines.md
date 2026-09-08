---
kind: instruction
title: bb Guide — Machines
summary: Command reference for listing and targeting execution machines.
intent: Explain execution-machine discovery and selection from the CLI.
editingNotes: Keep the user-facing noun machine; internal APIs and types use Host.
---
Machine commands

A host is an identity and daemon connection. A machine is a host with a
provider-owned lifecycle. The local host has no machine provider. Every other
host is a machine, including existing machines enrolled with the built-in
`manual` provider (Existing machine). Add machines under Settings → Machines
or from the composer machine picker.

The server listens on loopback by default. Remote execution machines need
a server access provider: paired bb Connect, or a configured direct URL reachable
from the target, such as a private Tailscale Serve URL. A configured URL alone
does not prove reachability.

The Settings installer first uses the exact `bb-app` tarball served by that bb
server at `/install/bb-app.tgz`; only servers that do not implement the route
(HTTP 404) fall back to the npm registry. npm installs bb-app under this
machine enrollment's bb data directory, so the installer needs neither `sudo`
nor a global npm configuration. Installed launchd/systemd services pass
`--auto-update`. On a newer server protocol mismatch, the daemon downloads that
same artifact, updates its private install, and exits for the service manager to
restart. Failed attempts use a persisted exponential backoff that starts at 5
seconds and caps at 5 minutes. A daemon never auto-downgrades to an older server
protocol. Use Settings → Machines or `bb machine retry-update` to bypass the
current backoff after a transient failure.

To opt out, remove `--auto-update` from the launchd plist or systemd user unit
and reload that service. Foreground/manual `bb-app host-daemon` runs leave it off
unless you pass `--auto-update` explicitly.

  bb machine list                         List machines with ID, connection
                                          status, and relative last-seen time
    --json                                Print the raw host list
  bb machine ready <machine> --provider <id> --project <id> --json
                                         Check CLI, auth and checkout readiness
  bb machine providers [--project <id>]   List installed machine providers
    --json                                Include inputs schemas and policy
  bb machine create --provider <id>       Create a standalone machine
    --key <idempotency-key>                Reuse this creation on retries
    --inputs <JSON>                       Non-secret provider inputs
    --project <id-or-name>                 Optional project context
    --json                                Print the created machine as JSON
  bb machine enroll --bootstrap-file <path>
    --bootstrap-env <NAME>                Alternative private bundle source
  bb machine start --host-id <id>         Start an owned local daemon
  bb machine stop --host-id <id>          Stop an owned local daemon
  bb machine uninstall --host-id <id>     Remove an owned local installation
  bb machine show <id-or-name>            Show machine details
  bb machine join-code                    Create a machine pairing code
  bb machine rename <id-or-name> <name>   Rename a machine
  bb machine retry-update <id-or-name>    Retry a pending daemon update now
  bb machine suspend <id-or-name>         Suspend a provider-managed machine
  bb machine resume <id-or-name>          Resume a machine (already active is a no-op)
  bb machine retry-cleanup <id-or-name>   Retry failed teardown now
  bb machine remove <id-or-name> [--yes]  Revoke and remove a machine
  bb machine provider-cli status <machine>
  bb machine provider-cli install <machine> <provider-id>
    --action <install|update>

Each machine has a permission limit: the highest permission mode any thread on
that machine can run with. The default is Full Access. A thread that asks for
more resolves down to the limit, and a provider that supports no mode under the
limit cannot run there. Set it in Settings → Machines → the machine → Permission
limit; that page also shows the machine's projects, provider CLIs, update state,
and rename/remove. There is no CLI or SDK command to set it, and a paired
machine cannot set it for any machine, so a sandbox machine can stay at Full
Access while your laptop stays lower. `bb machine list --json` and `bb machine
show` report the current limit.

Standalone create does not create a thread or workspace. Without `--project`,
creation is global; project selectors accept an exact name or ID. Omitted inputs
are null; supply JSON when the provider schema requires it. Omit `--key` to let
the server generate one, or supply a stable key for retries. Creation is durable:
`--no-wait` returns the launch ID immediately; otherwise the CLI follows progress through server retries until ready or a terminal failure. Launch status includes `terminal` to distinguish retryable failures.
SIGINT stops following and exits 130 while creation continues. Use
`bb machine status <launch-id>` to poll and `bb machine cancel <launch-id>`
to explicitly cancel and clean up, including retrying cleanup after automatic
reconciliation has stopped. The SDK provides `hosts.submit`, `hosts.launch`,
`hosts.follow`, and `hosts.cancel`; `hosts.create` submits and follows. Aborting
a caller signal never cancels the server operation. A connected daemon does not
yet imply an agent-ready checkout and authenticated provider.

Suspend and resume are available only when the machine provider implements
both operations. Retry cleanup is accepted only for a retiring machine whose
provider teardown failed.

Updates commands

One consolidated view of bb and provider CLI updates across machines — the
CLI counterpart of Settings → Updates and the sidebar Updates badge.

  bb updates [status]                     Show bb-app and provider CLI update
                                          status for every machine
    --machine <id-or-name>                Limit to one machine
    --json                                Print the aggregate as JSON
  bb updates apply                        Run every available provider CLI
                                          install/update, one at a time
    --machine <id-or-name>                Limit to one machine
    --json                                Print per-target results as JSON

`bb updates apply` covers provider CLIs only. Update bb-app itself with the
printed upgrade command (`npx bb-app@latest`) or the desktop app's relaunch;
connected daemons then follow the server version automatically.

Machine selectors accept either an exact machine ID or an unambiguous machine
name. `--host` is an alias for `--machine`.

  bb thread spawn --project <id> --machine <id-or-name> --prompt "..."
  bb thread spawn --project <id> --new-machine <provider-id> --prompt "..."
    --machine-inputs <json>
  bb project create --name "..." --root <path> --machine <id-or-name>
  bb project source add <projectId> --machine <id-or-name> --path <path>

For thread spawning, machine targeting works with an unmanaged workspace path,
a new managed worktree, or the personal workspace. Do not combine it with an
existing environment ID: the reused environment already selects its machine.
`--new-machine` creates through a machine provider and uses its advertised
environment row when declared. Otherwise add `--environment-provider <id>`
(required for SSH). Use `--environment-inputs <json>` for workspace configuration,
separately from `--machine-inputs <json>`. Machine inputs are persisted and
readable by plugins; never put secrets there. Store credentials in plugin settings and pass only
non-secret configuration or references.

When `--new-machine` selects an environment provider requiring a project
checkout, core clones the project's Git remote and registers a source on the
connected machine before creating that environment. Existing sources are reused.
Automatic setup uses a stable per-project target and shares concurrent setup on
the same host. After a server restart, it registers a completed checkout whose
remote matches instead of cloning again; a conflicting target is refused.
The project needs a Git remote and the machine needs Git access to it. Choosing
Personal workspace first does not clone a project. Standalone `bb machine create`
does not set up a project source.

For project creation and sources, `--root`/`--path` refers to a path on the
selected connected machine. Omit the selector to keep the existing local CLI
machine fallback (normally the primary machine). Pass `--clone` to source add
instead of `--path` to clone the project's Git remote there; `--remote-url` and
`--target-path` optionally override the clone inputs.

## Server access

Set Machines → Server URL reachable by machines, or run `bb settings general
machineServerUrl https://bb.example.com`. An unset value uses BB_EXTERNAL_URL.
Select Manual to show the URL input. Set Default machine access with
`bb settings general defaultMachineAccess direct` or `connect`; `null` uses
bb connect, with setup required if unpaired. Manual never becomes the default implicitly. `bb settings show --json`
includes provider availability and the effective selection. Machines use this
access for ongoing runtime requests, including account-pool endpoints.

The Tailscale plugin can supply private machine access without a Direct URL.
Use `bb tailscale devices`, `bb tailscale status`, and `bb tailscale configure
<port>` to discover devices and validate a dedicated existing HTTPS Serve
mapping. Choose Tailscale explicitly; it is not selected by default.
The plugin skill documents SSH prerequisites and safe endpoint cleanup.

## Local daemon lifecycle

`bb machine start|stop|uninstall --host-id <id>` starts, stops or removes an
owned local installation. Optional `--server-url <url>` and `--data-dir <path>`
assert the expected installation. BB_DATA_DIR is treated as an assertion too.
An identity mismatch refuses the operation. These commands are local machine
primitives; `bb machine remove` asks the server to remove the provider resource.
They verify the canonical installer-owned directory, enrolled identity, and
service or process ownership before acting. Stop and uninstall safely succeed
when no matching installation exists; start requires an installation. They
refuse the default BB data directory. Stopping a daemon is distinct from
`bb machine suspend`, which invokes provider suspension and updates server state.

## Enroll a preinstalled machine

`bb machine enroll --bootstrap-file <path>` or `bb machine enroll --bootstrap-env <NAME>` consumes a versioned private enrollment bundle prepared by core. Supply exactly one source. The environment source is removed from the CLI process environment after reading it; files remain under the caller's ownership. Neither command prints the bundle or credentials.

The CLI refuses another host or server identity in the selected machine directory. Repeating enrollment with the same persisted identity succeeds without exchanging the credential again, including when the original bundle expired. Machine data defaults to `~/.bb-machines/<server-host>`; `BB_DATA_DIR` can select another isolated machine directory, but enrollment refuses the default `~/.bb` directory.

The manual copy command fetches `/install.sh` using a short-lived `X-BB-Enrollment` header. The server supplies the bootstrap only for a pending, unexpired, uncancelled manual enrollment whose credential has not been consumed; downloaded responses are not cached. The command contains no bootstrap JSON or access-provider credentials.

The installer accepts `--bootstrap-env <NAME>` and uses the same enrollment command. It installs a private CLI and supplies `~/.local/bin/bb` without replacing an existing path. Non-login transports can use `command -v bb` with `~/.local/bin/bb` as a fallback. Linux machines without a systemd user session run a detached daemon; systemd and launchd machines receive a persistent service.

Machine bootstrap v2 supplies optional server request headers. `bb machine enroll`
persists them privately as `serverHeaders`; the launcher passes `BB_SERVER_HEADERS`
to the daemon for enrollment, connection and runtime requests. Server-access
plugins redeem provider codes on the server. Pending encrypted v1 bundles are
upgraded by the server when prepared again.


Delivered enrollment bundles from v1 remain valid until their expiry. The CLI accepts both file and environment forms, upgrades the bundle to v2 headers locally, and persists legacy Connect redemption before enrollment so a retry reuses it. The installer upgrades v1 environment bundles before authenticated artifact downloads.
## DigitalOcean dev boxes

`bb digitalocean configure <host-id> '<config-json>'` sets `idleMinutes` (null
turns idle stop off), `retention` (default 2), and `schedule` (null disables;
otherwise `weekdays` 0–6, `sleep`/`wake` HH:mm, and explicit IANA `timezone`).
`bb digitalocean snapshot-now <host-id>` drains through core, gracefully shuts
down, confirms off, snapshots and remains off. `sleep` does the same; `wake`
resumes through core. Busy threads and open terminals prevent sleep. Core also
wakes on dispatch. Empty boxes participate in opt-in idle stop; retirement stays
never. `status` and `cost` show live inventory and estimates; all accept `--json`.
`bb machine show <host-id> --json` includes provider inventory in `providerDetails`.

Powered-off droplets still bill; snapshot storage bills per GB. See
https://docs.digitalocean.com/products/droplets/details/pricing/ and
https://docs.digitalocean.com/products/snapshots/details/pricing/ . Configure a
weekday schedule from the plugin settings or CLI on an always-on BB server.
The latest missed action within eight days runs after recovery; busy sleep
retries each minute until superseded. See the plugin skill for DST and cleanup.

Resume waits for any in-progress suspension before waking; an already-active
machine is left active. DigitalOcean sleep JSON retains saved power/backup
status if inventory is unavailable (`details.values.cost: null` and
`inventoryError`). Shared inventory reads cache for 30 seconds and invalidate
on mutations. Schedule changes invalidate selected, undispatched runs.

Create DigitalOcean dev boxes from Settings → Machines or
`bb machine create --provider digitalocean --inputs '{}' --json`, without a
project. SDK creation uses `machineProviderId: "digitalocean", projectId: null,
inputs: {}`. Enrolled boxes appear as machine sections in the composer picker;
DigitalOcean contributes no new-machine/project-checkout shortcut row.

Existing machines

`bb machine create --provider manual` prints a private enrollment command and
follows the launch until the daemon connects. Run that command on the target
machine; it installs bb if needed. Server access is resolved through the selected
default access provider, just like SSH or cloud machines. `--no-wait` returns the
launch ID and command once enrollment is prepared; `--json` includes the command
in `command`. This command is fetched transiently from the encrypted pending
bundle; durable progress contains no credential. After enrollment or cancellation,
the command endpoint returns nothing. Treat this short-lived command as a credential.

Use `bb machine status <launch-id>` to recover progress and
`bb machine cancel <launch-id>` to cancel and revoke enrollment/access. Stopping
the CLI or closing the dialog only stops following; creation continues.
Manual machines never idle-suspend or automatically retire and do not expose
suspend/resume. Removing one revokes its server access without executing on the
machine. Run `bb machine uninstall --host-id <host-id>` on that box, with its
original `BB_DATA_DIR` if explicitly configured, to remove its installation.

## Machine environment

`bb machine env list --json` lists global machine variables and built-in GitHub
health. `bb machine env set NAME [--note text] --json` reads its value
from stdin, removing one trailing newline; values are never accepted in argv.
`bb machine env unset NAME --json` removes an override. All values are encrypted in the database and never returned by list or set.

Settings → Machines → Machine environment edits variables inline. Add, remove,
or import .env rows, then Save variables; Discard changes leaves saved values
untouched. Saved secrets can be replaced but never revealed. The automatic
GH_TOKEN row shows server login health; a custom GH_TOKEN overrides it. User variables
override built-in values for all enrolled machine hosts, excluding local hosts.
Agent-provider variables win over these host values for agent turns. Changes
apply to the next turn, setup operation, or newly opened BB terminal; existing
terminals retain their launch environment.

The server's gh login provides GitHub credentials, a Git environment-only HTTPS
helper and SSH rewrites, and commit identity. The built-in row reports logged in,
not logged in, or overridden. No credentials are installed in images or global
Git config. SDK: system.machineEnvironment(), system.setMachineEnvironment({
name, value, note }), and system.unsetMachineEnvironment(name).

Provider-managed machine turns check readiness before dispatch. `bb machine ready`
checks the same CLI installation, credential routing reachability, and project
workspace setup. It returns ready checks or a blocked stage/code/message.
Compatible CLIs are reused. Core owns repository setup and teardown for
environments whose provider returns ownsPath: true. Readiness checks the recorded
setup outcome against the checkout inputs; it never runs a separate recipe script.
The repo hook owns dependency caching and its unchanged-input no-op path.

`bb machine lifecycle MACHINE --json` shows the vendor expiry, planned maintenance,
last successful snapshot, recovery state and automatic retention removal deadline.
Use `--keep` to prevent automatic retention removal, or `--no-keep` to restore it.
Maintenance interrupts active turns and closes terminals before saving. Submit a
new continuation turn after restore; interrupted turns are never reported successful.

`bb machine lifecycle MACHINE --remove --yes --json` removes retained compute and snapshots through the normal machine removal path. `--keep` prevents automatic retention deletion; `--no-keep` restores it. After filesystem restore, core reruns the owned checkout’s idempotent setup hook to restart services; hook failure blocks readiness.

Automatic machine GitHub credentials are enabled by default. Use
`bb settings general machineGitCredentialsEnabled false` to stop forwarding the
server gh credentials to machines; `true` enables them again. In Machines →
Advanced settings, the automatic GH_TOKEN switch controls the same setting.
This does not log the server out or suppress an explicit custom GH_TOKEN.
Changes apply to new turns, setup commands and terminals.
