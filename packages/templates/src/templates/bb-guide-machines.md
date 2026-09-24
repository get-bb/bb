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
`manual` provider (Manual machine setup). Add machines under Settings → Machines
or from the composer machine picker.

One machine runs the bb server. It stores threads, the database, and settings,
and every other machine and app connects to it. Settings → Machines badges it
`server` once there are several persistent machines, and `bb machine list` shows
`server` in its Role column. Keep the server machine on: while it is asleep or
off, nothing can reach bb and running threads may stop. The server machine
cannot be removed.

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

`bb-app`, `bb-server`, and `bb-host-daemon` capture service stdout and stderr
directly under the selected data directory in `logs/server-stdio.log` and
`logs/host-daemon-stdio.log`. These files append across restarts and contain
console output and startup errors; rotating application logs remain separate.
Use `tail -F` to follow them without coupling service logging to the terminal.

bb machine list List persistent machines with role,
ID, type, connection status, and
relative last-seen time
--all Include disposable provider
sandboxes
--json Print the raw host list
bb machine providers List installed machine providers
--json Include inputs schemas and policy
bb machine create --provider <id> Create a standalone machine
--key <idempotency-key> Reuse this creation on retries
--inputs <JSON> Non-secret provider inputs
--json Print the created machine as JSON
bb machine enroll --bootstrap-file <path>
--bootstrap-env <NAME> Alternative private bundle source
bb machine show <id-or-name> Show machine details
bb machine rename <id-or-name> <name> Rename a machine
bb machine retry-update <id-or-name> Retry a pending daemon update now
bb machine reconcile <id-or-name> Reconcile compute with core’s recorded state
bb machine suspend <id-or-name> Suspend a provider-managed machine
bb machine resume <id-or-name> Resume a machine (already active is a no-op)
bb machine retry-cleanup <id-or-name> Retry failed teardown now
bb machine remove <id-or-name> [--yes] Revoke and remove a machine
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

Standalone create does not create a thread or workspace. Omit inputs to use the
provider defaults; supply JSON when its schema requires additional values. Omit
`--key` to let the server generate one, or supply a stable key for retries.
Creation is durable:
`--no-wait` returns the creating host ID immediately; otherwise the CLI polls
that host until active. SIGINT stops following and exits 130 while creation
continues. `bb machine list` includes machines still being created. It lists persistent
machines only; pass `--all` to include the disposable sandboxes that
environment providers create per thread.
Use `bb machine show <host-id>` to inspect progress and `bb machine
remove <host-id>` to cancel and clean up. The SDK provides
`hosts.experimental_create`; pass `wait: false` to receive the creating host and
poll it with `hosts.get`. Aborting a caller signal never cancels the server operation. A connected daemon does not
yet imply an agent-ready checkout and authenticated provider.

`bb machine reconcile` / `hosts.experimental_reconcile` is an explicit request,
not a core timer. For a machine core records as suspended, it runs the provider’s
save-and-stop operation. The API returns HTTP 202 immediately; the CLI polls
machine status until completion. Active machines and lifecycle
operations already in progress are left alone. Plugins request suspension
separately when their idle policy decides an active machine should pause.

Suspend and resume are available only when the machine provider implements
both operations. Retry cleanup is accepted only for a retiring machine whose
provider teardown failed.

Updates commands

One consolidated view of bb and provider CLI updates across machines — the
CLI counterpart of Settings → Updates and the sidebar Updates badge.

bb updates [status] Show bb-app and provider CLI update
status for every machine
--machine <id-or-name> Limit to one machine
--json Print the aggregate as JSON
bb updates apply Run every available provider CLI
install/update, one at a time
--machine <id-or-name> Limit to one machine
--json Print per-target results as JSON
bb updates app [status] Show whether bb can update itself,
the available version, and the last result
--json Print the status as JSON
bb updates app apply Download the update and restart bb into it
--yes Interrupt running threads without asking
--no-wait Return once the update starts
--json Print the final status as JSON
bb updates app dismiss Mark the last update result as seen

`bb updates apply` covers provider CLIs only. `bb updates app apply` updates
bb itself when it was started with `--in-app-updates` from `npx bb-app` (or a
global `bb-app`) or with `pnpm start` from a `main` checkout: it installs the new version next to the
running one and restarts into it. It does not roll back if the new version
fails to start. Source checkouts update only from a clean `main` that
fast-forwards to `origin/main`.
Desktop users update through the desktop app's relaunch; development servers
and `bb-server` cannot update themselves. Connected daemons follow the server
version automatically.

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
does not set up a project source and remains available until explicitly removed.
Machines created for threads retire after their last live thread is archived
when the provider declares them ephemeral.

For project creation and sources, `--root`/`--path` refers to a path on the
selected connected machine. Omit the selector to keep the existing local CLI
machine fallback (normally the server machine). Pass `--clone` to source add
instead of `--path` to clone the project's Git remote there; `--remote-url` and
`--target-path` optionally override the clone inputs.

## Server access

Set Machines → Server URL reachable by machines, or run `bb settings general
machineServerUrl https://bb.example.com`. An unset value uses BB_EXTERNAL_URL.
Select Manual to show the URL input. Set Default machine access with
`bb settings general defaultMachineAccess direct` or `connect`; `null` uses
the first registered access provider, or direct when none is registered. An
unpaired provider reports setup required. `bb settings show --json` includes
fresh provider availability and the effective selection; failed or timed-out
checks report unavailable without acquiring a grant. Settings and creation
banners refresh this status when the access provider signals a change. Machines use this
access for ongoing runtime requests, including account-pool endpoints.

The Tailscale plugin can supply private machine access without a Direct URL.
Use `bb tailscale devices`, `bb tailscale status`, and `bb tailscale configure
<port>` to discover devices and validate a dedicated existing HTTPS Serve
mapping. Choose Tailscale explicitly; it is not selected by default.
The plugin skill documents SSH prerequisites and safe endpoint cleanup.

## Move the server

Moving the server is experimental and off by default. Turn on the `serverMove`
experiment in Settings → Experiments or with
`bb settings experiment serverMove true`; until then Settings → Machines hides
Move server here, and `bb server move`, `bb server export`, and deleting an old
server copy from the server are refused.

Agents must not move a server, abandon a move, or unlock an old copy without
the user's explicit confirmation in the conversation. Run `--check`, show the
user the checklist, and wait for their confirmation; don't pass `--yes` to skip
the confirmation on their behalf.

A move copies the server's data (database, settings, plugin data, attachments)
to another persistent machine, points every machine and app at it, and keeps the
old computer running as a regular machine. Worktrees, thread storage, and
checkouts stay on the machines that own them.

  bb server move --to <id-or-name>        Stop all work and move the server
    --check                               Print the checklist and stop
    --address <url>                       New server address (direct setups)
    --archive-existing-data               Move bb server data on the target aside
    --yes                                 Skip the confirmation
    --json                                Print the final move status
  bb server move status                   Show the steps, or the last move
  bb server move cancel                   Cancel before the switch starts
    --yes                                 Abandon a move that needs recovery without asking
  bb server export --out <file>           Export a running server
  bb server import <file>                 Install an export on this computer
    --data-dir <dir>                      Target data directory
  bb server unlock                        Let this computer's old copy start again
    --force                               Skip the new-server health check
  bb server allow-connect                 Turn bb connect on for an imported copy
  bb server delete-old-copy               Delete the old copy a move left here
  bb server install-machine-service       Keep this computer connected after a move

When the target never confirms that it took over, the move waits in
`recovery_required`: the old server stays up and read-only, and bb finishes the
move on its own once the target answers. `bb server move` and
`bb server move status` exit 2 in that state and name the exits:
`bb server move cancel` abandons the move and keeps the server here (it asks
first, since abandoning while the target took over leaves two servers; `--yes`
skips the question), and `bb server unlock` recovers an old copy that stopped.

`--check` exits nonzero while a blocker remains. With bb connect, machines and
apps keep the same URL. A direct-address server needs `--address`: the URL every
machine and app will use to reach the new server. Existing bb server data on the
target is archived to `<dir>.before-move-<date>` only with
`--archive-existing-data`; it is never merged. The move follows the steps until
the new server takes over; SIGINT stops following while the move continues.
Failure or cancellation before the switch leaves the server where it was.

`bb server export` streams a gzip archive to a 0600 file and keeps it only when
it matches the SHA-256 digest the server sent. The archive is not encrypted and
holds the server's credentials and plugin secrets, so keep it private; `--json`
prints `path`, `sizeBytes`, `sha256`, and that `warning`.
`bb server import` works offline: it refuses a data directory that has `bb.db`
or a running bb, refuses an export made by a newer bb or by a server with the
`serverMove` experiment off, asks you to re-export an archive encrypted by an
older bb, and applies path fixups when the imported server first starts. If an
import was interrupted, rerunning `bb server import` rolls it back first from
`server-import-journal.json` (`--json` reports `rolledBackInterruptedImport:
true`), and a server move to that machine does the same;
until then bb refuses to start a server on that directory. Stop the original
server before starting the imported one; two servers holding the same bb
connect credential take each other's tunnel.

An imported server starts with bb connect off (`server-connect-hold.json`).
`bb server allow-connect [--data-dir <dir>] [--yes] [--json]` removes the hold
once the original server is stopped (`--json` prints `dataDir` and
`connectHoldRemoved`); bb connect starts the next time that server starts.

After a move, the old computer's data directory keeps `server-moved.json`, so
bb there refuses to start the old server and runs as a regular machine.
`bb server delete-old-copy` deletes the server files left behind and keeps that
lock. The desktop app installs the persistent, self-updating service a
CLI-installed machine gets as soon as its server moves, and on later launches
if the service is missing; until that succeeds (it needs Node.js 22.19 or newer
on the PATH), the app keeps that machine connected only while it is open and
explains why once. After a move from `bb-app`, or to retry by hand,
`bb server install-machine-service [--data-dir <dir>] [--yes] [--json]` installs
the same service: it needs
Node.js 22.19 or newer on the PATH, stops bb running from that directory, and
runs `install-machine.sh --adopt --data-dir <dir>`, which keeps the machine ID,
downloads the new server's bb-app package, and installs the launchd or systemd
service (`--json` prints `dataDir`, `serverUrl`, `toHostName`, and
`serviceFile`). `bb server unlock` refuses while that service exists. `bb server unlock` removes the lock as a last resort: everything since
the move is lost on that copy, and the new server must be stopped first. It
refuses while the new server still answers (`<serverUrl>/health`, or
`/api/v1/system/version` with this computer's machine grant for bb connect)
unless `--force` is passed, and bb on that computer starts the old server within a few
seconds. It also
removes `serverUrl`, `serverHeaders`, `machineCredential`, and
`connectMachineId` from that directory's `config.json`. Both
default to `BB_DATA_DIR` or `~/.bb` and accept `--data-dir <dir>`; neither
calls a server. The SDK equivalents are `sdk.experimental_server.checkMove`,
`startMove`, `moveStatus`, `cancelMove`, and `export`. In the desktop app,
picking This Mac on macOS or This Computer on Linux after a move starts the
local-copy safety check when the old copy was kept. It asks for confirmation
before unlocking and removes the machine service if one exists. If the old copy
was deleted, the app shows where the server went.

## Local daemon lifecycle

`install-machine.sh --adopt --data-dir <path>` installs the service for a data
directory that is already enrolled, reading its machine ID from `auth.json` and
its server address and headers from `config.json`; `bb server
install-machine-service` runs it for the directory a server move left behind.

Reconnect a disconnected machine whose server access or host key was revoked
or became stale, without changing its BB host ID:

  bb machine reconnect <id-or-name>       Print a short-lived reconnect command and wait for reconnection
    --json                                Print the command and expiry without waiting

Run the printed command on the affected machine. It is a one-time enrollment
command for the existing host ID. Fetching the installer releases the machine's
access grant and acquires a new one from the same provider; if that fails, run
the command again. The machine then re-enrolls: it replaces `auth.json` with a
new host key, replaces the server-access headers, and restarts the owned daemon
service. Environments, workspaces, and thread associations are kept.

The command reuses the data directory the machine's daemon last reported, so it
works unchanged for a custom `BB_DATA_DIR` and for `~/.bb` on a computer that a
server moved away from; an explicit `BB_DATA_DIR` still takes precedence. Before
downloading anything, the installer refuses a directory that does not hold this
machine, which is what happens when the command runs on another computer.
The server's own machine cannot be reconnected this way.

`install-machine.sh --start|--stop|--uninstall --host-id <id>` starts, stops or removes an
owned local installation. Optional `--server-url <url>` and `--data-dir <path>`
assert the expected installation. BB_DATA_DIR is treated as an assertion too.
An identity mismatch refuses the operation. These commands are local machine
primitives; `bb machine remove` asks the server to remove the provider resource.
They verify the canonical installer-owned directory, enrolled identity, and
service or process ownership before acting. Stop and uninstall safely succeed
when no matching installation exists; start requires an installation. They
refuse the default BB data directory. Stopping a daemon is distinct from
`bb machine suspend`, which invokes provider suspension and polls until the machine
is paused. `bb machine resume` likewise waits for provider restore and bootstrap.

## Enroll a preinstalled machine

`bb machine enroll --bootstrap-file <path>` or `bb machine enroll --bootstrap-env <NAME>` consumes a versioned private enrollment bundle prepared by core. Supply exactly one source. The environment source is removed from the CLI process environment after reading it; files remain under the caller's ownership. Neither command prints the bundle or credentials.

The CLI refuses another host or server identity in the selected machine directory. Repeating enrollment with the same persisted identity succeeds without exchanging the credential again, including when the original bundle expired. Machine data defaults to `~/.bb-machines/<server-host>`; `BB_DATA_DIR` can select another isolated machine directory, but enrollment refuses the default `~/.bb` directory unless its `host-id` already names this machine.

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

`bb machine create --provider manual` waits for a private enrollment command,
prints it once, and follows the host until the daemon connects. Run that command on the target
machine; it installs bb if needed. Server access is resolved through the selected
default access provider, just like SSH or cloud machines. `--no-wait` returns the
creating host ID. The CLI prints the enrollment command and its expiry while it
follows. This command is built transiently from the in-memory pending bundle;
durable host progress contains no credential. After enrollment or removal, the
host-keyed command endpoint returns no command. Treat it as a credential.

Use `bb machine show <host-id>` to recover progress and
`bb machine remove <host-id>` to cancel and revoke enrollment/access. Stopping
the CLI or closing the dialog only stops following; creation continues.
Manual machines never idle-suspend or automatically retire and do not expose
suspend/resume. Removing one revokes its server access without executing on the
machine. Run the original installer with `--uninstall --host-id <host-id>` on that box, with its
original `BB_DATA_DIR` if explicitly configured, to remove its installation.

## Machine environment

Use `--project <id>` on `bb machine env list|set|unset` for project overrides;
omit it for global settings. Project overrides follow the project across
machines and worktrees, including the primary host. Empty strings override;
unset restores inheritance. List masks all values and includes inherited global
rows for project scope. Set and unset update a single variable atomically.

Settings → Environment variables edits machine variables and has a scope
selector under its header. Project settings → Advanced settings opens the same editor for that
project. Changes apply
to the next agent turn and new terminals/commands. Project values are passed per
operation and never installed into the daemon's global environment. They override
global values; provider contributions retain precedence. All scopes share an
encrypted database table and the existing machine-environment encryption key.


Repository setup receives freshly resolved machine variables on each dispatch,
including recovery. Values are sent transiently to the setup process and are
not stored in provisioning requests. Existing attached paths skip setup.

`bb machine env list --json` lists global machine variables and built-in GitHub
health. `bb machine env set NAME [--note text] --json` reads its value
from stdin, removing one trailing newline; values are never accepted in argv.
`bb machine env unset NAME --json` removes an override. All values are encrypted in the database and never returned by list or set.

Settings → Environment variables edits variables inline. Add, remove,
then Save variables; Discard changes leaves saved values
untouched. Saved secrets can be replaced but never revealed. The automatic
GH_TOKEN row shows server login health; a custom GH_TOKEN overrides it. User variables
override built-in values on every connected host, including the primary host.
Agent-provider variables win over these host values for agent turns. The server synchronizes these values into the daemon environment at connection
and whenever settings change. Background commands and newly launched processes
inherit them, including git and gh operations. Removing an override restores the
original daemon value. Existing processes and terminals retain their launch
environment. Environment synchronization does not restart cached provider
runtimes; they retain their launch environment until recreated. Runtime output is forwarded as-is,
so commands and providers can print contributed values.

Plugin host calls start immediately using the current environment while any calls
are active in that plugin worker. Changed or removed machine variables take
effect on the next call after all active calls finish. Continuous overlapping
calls can keep the previous values until the worker becomes idle.

The server's gh login provides GitHub credentials, a Git environment-only HTTPS
helper and SSH rewrites, and commit identity to non-primary hosts. The primary
host uses its local Git authentication unless a user supplies an explicit global
or project GH_TOKEN. The built-in row reports logged in,
not logged in, or overridden. No credentials are installed in images or global
Git config. SDK: system.machineEnvironment() and
system.replaceMachineEnvironment({ variables }). Replacement is atomic; pass
every row to retain, using value: null for an unchanged saved secret.

Thread startup does not install or update agent CLIs, probe authentication, or validate workspace fingerprints. Core runs repository setup when creating an owned environment and teardown before removing it. Resume does not rerun setup.

`bb machine list --json` includes lifecycle phase, progress, and any suspension or resume error.
Maintenance interrupts active turns and closes terminals before saving. Submit a
new continuation turn after restore; interrupted turns are never reported successful.

Resuming a machine restores its provider state without rerunning environment setup.

Automatic GitHub credential forwarding to non-primary hosts is enabled by default. Use
`bb settings general machineGitCredentialsEnabled false` to stop forwarding the
server gh credentials to machines; `true` enables them again. In Settings →
Environment variables, the automatic GH_TOKEN switch controls the same setting.
This does not log the server out or suppress an explicit custom GH_TOKEN.
Changes apply to new turns, setup commands and terminals.

Manual enrollment commands display the server expiry timestamp as a countdown.
After expiry, Add a machine offers Generate new command: it cancels the old
attempt and creates a fresh one. Manual owns the command and expiry in memory;
polling does not renew it. Restart machine setup if the plugin or server restarts.

For a new thread on a new Modal sandbox, select the environment composition:
`bb thread spawn --project <id> --environment-provider modal-sandbox --prompt "..."`.
It creates the machine, prepares the project checkout, and runs environment setup.
Progress and failures appear in the thread's provisioning details. If cloning
fails, the machine remains available for retry or explicit removal.
`--new-machine <id>` requires an explicit `--environment-provider <id>`; machine
providers do not implicitly choose an environment.
