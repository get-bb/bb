# Modal sandbox

Run reusable BB machines in Modal. Install the optional official plugin, connect
its token in Settings → Plugins → Modal sandbox, select a project, and create a
machine. The project picker exposes **New sandbox** under **New machine**.

## Standard image

Settings lets you edit, save, or reset the Dockerfile used for future machines
across all projects. Agents can use the same saved definition through the CLI:

```sh
bb modal image show > Dockerfile
bb modal image set --file ./Dockerfile
bb modal image show --json
bb modal image reset
```

Only one `FROM` followed by `RUN`, `ENV`, `WORKDIR`, or `USER` is supported.
Comments and line breaks are preserved. There is no build context, `COPY`, `ADD`,
or multi-stage build. Invalid definitions leave the saved version unchanged.
Saving/resetting does not build or allocate compute; existing machines and their
snapshots are unaffected. The last saved definition applies to new launches.
The override is stored by this plugin and survives reloads; reset uses the bundled
Dockerfile from the installed plugin version.

`--file` resolves relative to the invoking CLI directory. In a BB thread it reads
from that thread's host; without thread context it reads on the server's primary
host. Remote callers without thread context can use the typed RPC with file text.
All commands accept `--json` as the final flag. `image.definition`, `image.set`
(input `{dockerfile}`), and `image.reset` are available through `modalRpcContract`
and `sdk.plugins.callRpc`. They return `{dockerfile, customized}`. Definitions
are limited to 65,536 characters. Editing needs no Modal credentials.

The plugin ships a [Dockerfile](Dockerfile) with Debian, Node, Git/GitHub CLI,
build tools, Python, bubblewrap, ripgrep, jq, pnpm, Pi, Codex and Claude Code. It
contains no BB daemon, project files, enrollment state or credentials. The image
is named by the Dockerfile's SHA-256 and reused within the Modal account. The
first launch builds and publishes it automatically; later launches reuse it.
Changing the Dockerfile creates a new image version for future machines. Modal
also caches build layers. There is no project recipe, uploaded context,
smoke-test gate or image promotion.

Machine creation reports image preparation and allocation progress. Build failures
surface on the machine launch and may be retried. Cancelling a launch prevents
subsequent sandbox allocation; an image build already submitted to Modal can
finish and remain cached. Shared standard images are not removed with a machine.

Core prepares enrollment before allocation. As soon as the sandbox ID is known,
the plugin awaits a durable resource checkpoint before bootstrap, so cancellation
cleanup does not need to allocate or enroll again. Core installs the matching BB
daemon on demand using Modal exec, enrolls the machine and waits for its connection.
Restore uses the same bootstrap API, reusing an enrolled daemon from the snapshot when available.
Bootstrap credentials travel through stdin and are never persisted in machine
resources. Core owns machine access grants and runtime credential injection.

Core clones the selected project and runs its `.bb-env-setup.sh`. Use that hook to
install project dependencies and start services; failures remain visible in the
launch logs. The hook must be idempotent because it runs again after filesystem
restore. Environment teardown uses the core `.bb-env-teardown.sh` hook. Attached,
user-maintained checkouts skip owned-environment hooks. `.worktreeinclude` does not
apply to fresh clones; configure runtime files and secrets through core Machine
environment settings.

## Settings and commands

| Setting                  | Meaning                                                   |
| ------------------------ | --------------------------------------------------------- |
| `tokenId`, `tokenSecret` | Required Modal token, entered in secret settings.         |
| `appName`                | Modal app, default `bb-sandboxes`.                        |
| `idleMinutes`            | Pause after idle, default 15; 0 disables idle suspension. |
| Sandbox size presets     | Named CPU and memory reservations for new machines.       |
| Images                   | Named Dockerfiles or existing Modal image IDs.            |

Use `bb modal account inspect --json` to validate credentials
without allocating resources. Create with
`bb machine create --provider modal-sandbox --json`, or SDK
`hosts.experimental_create({machineProviderId:"modal-sandbox",key})`. Machine creation
accepts optional configured names in `{"preset":"Large","image":"Node 22"}`.
With one or zero choices, the default applies and the composer shows no extra
chip. Account inspection is also available through the
plugin's typed `modalRpcContract` (`account.inspect`) and `sdk.plugins.callRpc`.
See the [command reference](skills/modal-sandboxes/SKILL.md).

## Lifecycle

The idle pause defaults to 15 minutes and applies to existing machines without a
reload. Compute lifetime is fixed at Modal's 24-hour sandbox maximum. Open
terminals prevent idle pause. There is no automatic retention removal.

Manual and idle pauses snapshot the filesystem before terminating compute. Core
blocks new work, interrupts turns and closes terminals; the plugin stops the
daemon, saves the filesystem and durably records the snapshot before termination.
Core defers pause while persisted state ties a live thread launch or provisioning
environment to the machine, or while project checkout setup is pending. Resume
preserves host identity without rerunning setup. Interrupted turns are not replayed.

There is no pre-expiry scheduler. A sandbox that stays active for its full
24-hour lifetime stops without a guaranteed final snapshot. Changes
since the last successful pause may be lost. Pause before the timeout to save work.
Failed saves retain compute while it still exists.
`bb modal machine inspect HOST_ID --json` exposes vendor state, expiry and the saved image. Missing
compute never silently becomes an empty checkout or an older snapshot. A checkpoint
from an interrupted planned suspension remains recoverable.

Use `bb machine list --json` for core state and `bb modal machine inspect HOST_ID --json` for Modal diagnostics. The plugin RPC `machine.inspect` returns the same result. Remove explicitly with `bb machine remove MACHINE --yes`.
Account identity remains pinned; restore the original account before lifecycle
operations. Removal deletes private snapshots and compute, retaining the shared
standard image. Removing lost compute can remain blocked on core checkout cleanup.

## Prerequisites

Modal credentials, a project Git remote and access to it, and a configured core
server-access route reachable from the sandbox are required. Agent authentication
is needed to run agent turns. Image builds and running machines incur Modal usage;
this plugin does not provision anything merely by being installed or connected.

## Logo and trademark

The bundled `modal-logo.svg` is an unmodified copy of
[`Modal-IconMark-Dark-OneColor.svg`](https://drive.google.com/file/d/1JvQGLrZsQvnpZu5DmUafxXPGHXDk6TsI/view),
the web one-color icon mark in [Modal's current official brand
assets](https://modal.com/brand). The light one-color file published beside it
uses the same geometry; bb supplies the visible color through its icon mask.

Modal's brand-asset folder publishes no separate license or attribution file.
Modal and its logo are trademarks of Modal Labs, Inc., and Modal's
[terms](https://modal.com/legal/terms) reserve its intellectual-property
rights. The mark remains Modal's property and is bundled only to identify the
service this plugin integrates with; no license to reuse it separately is
granted or implied.

## Debug an image

```sh
bb modal image build --json
bb modal sandbox run --json
bb modal sandbox exec SANDBOX -- bash -lc 'node --version && which git'
bb modal sandbox exec SANDBOX --json -- bash -lc 'exit 7'
bb modal sandbox stop SANDBOX --json
```

Build uses the saved Dockerfile and the same account-wide image cache as machine
creation. It returns the image ID and the final 65,536 characters of build logs
when finished; failures include captured logs and the vendor error. Build logs
are collected through Modal 0.10's gRPC middleware because its image builder does
not forward them. This adapter is tied to the pinned vendor SDK. Output is not
streamed to the CLI. An already submitted build can finish after CLI cancellation.

Run builds or reuses that image and returns `sandboxId`, `imageId`, `expiresAt`
and build `logs`. Debug sandboxes expire after 30 minutes, use Modal's default CPU
and memory, and contain no injected BB credentials, daemon, project clone or setup
hook. They are separate from BB Machines and do not snapshot. Files and running
processes remain between exec calls until stop or expiry. Copy successful fixes
into the Dockerfile, save it, and run a new sandbox to verify them.

Exec passes arguments after `--` literally. Use `bash -lc` for shell expressions.
Place BB's `--json` before `--`; command flags after it belong to the command.
Commands have a 60-second timeout and output is capped at 128 KiB per stream with
a truncation marker. Plain output preserves stdout/stderr and the command exit
code; JSON returns `{exitCode,stdout,stderr}` with the same CLI exit status.
Stopping is idempotent for known debug sandboxes. Exec/stop only accept sandboxes
created by this plugin's debug workflow in the original Modal account; they
cannot target arbitrary sandboxes or provider-managed machines. Stop removes
compute without deleting the shared cached image. Expired IDs remain recognizable.

SDK clients use `sdk.plugins.callRpc` with `modalRpcContract`: `image.build({})`,
`sandbox.run({})`, `sandbox.exec({sandboxId,command})`, and
`sandbox.stop({sandboxId})`. Build/run incur Modal usage.
