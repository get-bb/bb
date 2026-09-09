# Modal sandbox

Run reusable BB machines in Modal. Install the optional official plugin, connect
its token in Settings → Plugins → Modal sandbox, select a project, and create a
machine. The project picker exposes **New sandbox** under **New machine**.

## Standard image

Settings displays the bundled Dockerfile, including its comments, as a read-only
reference. `bb modal image show` prints the same file (`--json` returns
`{dockerfile}`); SDK callers use `image.definition` through `modalRpcContract`.
Viewing it needs no Modal credentials and does not start a build.

The plugin ships a [Dockerfile](Dockerfile) with Debian, Node, Git/GitHub CLI,
build tools, Python, ripgrep, jq, pnpm, Pi, Codex and Claude Code. It contains no BB
daemon, project files, enrollment state or credentials. The image is named by the
Dockerfile's SHA-256 and reused within the Modal account. The first launch builds
and publishes it automatically; later launches reuse it. Changing the Dockerfile
creates a new image version for future machines. Modal also caches build layers.
There is no project recipe, uploaded context, smoke-test gate or image promotion.

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
| `timeoutMinutes`         | Compute lifetime, 1–1440 minutes; default 1440.           |
| `idleMinutes`            | Pause after idle, default 15; 0 disables idle suspension. |
| `cpu`, `memoryMiB`       | Resource reservations; blank uses Modal defaults.         |

Use `bb modal account inspect --json` to validate credentials
without allocating resources. Create with
`bb machine create --provider modal-sandbox --project PROJECT --json`, or SDK
`hosts.submit({machineProviderId:"modal-sandbox",projectId,key})`. Machine creation
accepts no custom image inputs. Account inspection is also available through the
plugin's typed `modalRpcContract` (`account.inspect`) and `sdk.plugins.callRpc`.
See the [command reference](skills/modal-sandboxes/SKILL.md).

## Lifecycle

Defaults are a 15-minute idle pause and 24-hour compute lifetime. Open terminals
prevent idle pause. The current idle setting applies to existing machines; new
compute uses the current lifetime. There is no automatic retention removal.

The plugin checks vendor expiry every minute and requests core suspension 15
minutes before expiry. Core blocks new work, interrupts turns and closes terminals
with a five-minute drain limit. The plugin then stops the daemon, saves the
filesystem, durably checkpoints the snapshot and terminates compute. Resume
preserves host identity and reruns setup. Interrupted turns are not replayed.

The scheduler reserves time for drain, daemon stop and saving. If fewer than 11
minutes remain, it reports failure rather than claiming preservation is safe.
Short compute lifetimes, server downtime, disabled plugins or slow cloud operations
can therefore miss preservation. Failed saves retain compute while it exists.
Machine provider details expose vendor state, expiry and the saved image. Missing
compute never silently becomes an empty checkout or an older snapshot. A checkpoint
from an interrupted planned suspension remains recoverable.

Use `bb machine lifecycle MACHINE --json` for core state and `bb machine show
MACHINE --json` for machine details. `sdk.hosts.experimental_providerDetails`
returns Modal status. Remove explicitly with `bb machine remove MACHINE --yes`.
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
