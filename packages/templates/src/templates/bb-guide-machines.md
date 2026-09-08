---
kind: instruction
title: bb Guide — Machines
summary: Command reference for listing and targeting execution machines.
intent: Explain execution-machine discovery and selection from the CLI.
editingNotes: Keep the user-facing noun machine; internal APIs and types use Host.
---
Machine commands

A machine is a host daemon that can run thread environments. Add remote or
plugin-provisioned machines under Settings → Machines.

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
  bb machine resume <id-or-name>          Resume a suspended machine
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
the server generate one, or supply a stable key for retries. SIGINT aborts create
and exits 130; core cleans up any checkpointed allocation.

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

Set General → Server URL reachable by machines, or run `bb settings general
machineServerUrl https://bb.example.com`. An unset value uses BB_EXTERNAL_URL.
General shows the effective URL and source. Set Default machine access with
`bb settings general defaultMachineAccess direct` or `connect`; `null` uses
paired Connect first, then direct when a URL exists. `bb settings show --json`
includes provider availability and the effective selection. Machines use this
access for ongoing runtime requests, including account-pool endpoints.

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

The installer accepts `--bootstrap-env <NAME>` and uses the same enrollment command. It installs a private CLI and supplies `~/.local/bin/bb` without replacing an existing path. Non-login transports can use `command -v bb` with `~/.local/bin/bb` as a fallback. Linux machines without a systemd user session run a detached daemon; systemd and launchd machines receive a persistent service.

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
