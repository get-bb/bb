# Modal sandbox

Creates resumable bb machines in [Modal](https://modal.com) Sandboxes. It is
an official catalog plugin, not installed by default. Installing it adds the
`modal-sandbox` machine provider; it does not add an environment provider.

Choose Modal sandbox in a project's environment picker to create a machine,
have core clone and register that project's checkout, and run the thread through
the Project checkout provider. The machine remains a normal bb execution
target, so later threads can create Git worktrees or use other environment
providers on the same sandbox. New machines require a project and an explicitly
built catalogue image. Pass its `buildId` to `bb machine create`, or promote a
verified image to select it for future Modal machines in the project.

Creation prepares enrollment before vendor allocation and awaits a core resource
checkpoint as soon as the allocation ID is known. The checkpoint contains no
bootstrap credentials. Core can remove a cancelled allocation directly from
that checkpoint without rerunning creation, enrollment, or bootstrap.
Core owns project checkout setup and source registration after the machine
connects, using the `project-checkout` environment row. Agent-provider
readiness runs before dispatch: compatible installed CLIs are reused, missing
CLIs use their registered installer, and credential routes are checked from
the machine. Account Pooler injects credentials at runtime.

## Project images

Use `bb modal project inspect`, `recipe put --stdin --expected-revision 0`,
`context upload`, and `image build --key` to create a project image. All commands
support `--json`; `image logs BUILD --follow` streams bounded cursor pages.
Recipes live in plugin SQLite storage. Context uploads contain tracked files at
an identified commit plus an explicitly reviewed dirty overlay. See the bundled
[command reference](skills/modal-catalogue/SKILL.md) for flags and typed RPC names.

The TypeScript builder prepends a versioned Debian bookworm / Node 22.19 base,
installs pinned Codex and Claude Code CLIs, and embeds the server's credential-free
bb CLI/daemon package with a verified SHA-256 and protocol version. Build provenance
records that package digest. Project Dockerfiles support RUN, COPY, ENV, WORKDIR,
and ARG; FROM and other instructions fail with a source-line error.
Images contain no enrollment or agent login state. Credentials enter only during
runtime bootstrap. Rebuilding requires an explicit request; inspection reports
staleness. GC marks owned images, waits 60 seconds, and rechecks references before
deletion. Machine allocations, project promotion pointers, and verification records
protect builds.

Run `bb modal image verify BUILD --provider codex --key KEY --json` to start a
durable verification. Repeating its key returns the current result. Verification
runs a real agent turn, independently checks the recorded smoke commands and
commit, then suspends and restores the same machine with a filesystem sentinel.
Readiness and smoke checks run again after restore. Successful verification
retains a suspended machine; failed machines remain available for inspection.

`bb modal image use BUILD --project PROJECT --provider codex --expected-revision N`
requires successful verification for that agent. It changes only the project's
Modal image pointer, leaving environment preferences and existing machines alone.
`bb machine ready MACHINE --provider codex --project PROJECT --json` exposes the
same generic readiness checks used before agent dispatch. The recipe's runtime
setup script runs when lockfiles, manifests, ABI or setup inputs change, or when
its smoke checks find missing dependency outputs. Unchanged inputs reuse the
setup stamp. Changed inputs in a dirty tracked checkout block setup for review.
Deadline maintenance and the settings editor follow in parts C and D.

## Lifecycle

Core owns the machine lifecycle. After every live thread on the machine has
been idle for `idleMinutes` and no terminal is open, core asks the plugin to
stop the bb daemon, snapshot the Modal filesystem, and terminate the compute.
A later send restores compute from that snapshot and reconnects the same bb
machine before work continues.

Archiving or deleting the last thread starts a 30-day retirement grace period.
When it expires, core removes the machine's environments through their own
providers first, then asks this plugin to terminate the sandbox and delete its
snapshot. Explicit machine removal follows the same cascade. Creation is
idempotent by core's durable key, including when the sandbox enrolled before a
server or plugin crash.

## What it needs

- A Modal API token. Set its two halves in the plugin's `tokenId` and
  `tokenSecret` settings.
- A git remote when creating through the project picker, because core clones
  and registers that project. Standalone machine creation still selects a
  project build.
- A URL the sandbox can reach this bb at.

## How the sandbox reaches this bb

Configure the instance's default server-access provider so the sandbox can
reach bb. Core's public machine bootstrap helper owns access grants,
enrollment, durable identity, daemon startup, and waiting for a connection.
The plugin supplies Modal exec as the transport, including stdin for secret
bootstrap data. It does not store enrollment credentials in machine resources.

Creation calls bootstrap with the durable creation key and the preinstalled daemon.
Resume calls the same helper with the original key and a preinstalled daemon,
including when a previous attempt left the sandbox running. Core reuses the
identity and restarts the daemon when needed. The plugin has no `serverUrl`
setting; configure access centrally.

The exec adapter stops waiting when cancellation is requested. Modal does not
expose per-exec cancellation, so a command already submitted may continue until
its process timeout. Retries reuse the named sandbox and the bootstrap key.

## Settings

| Setting                | Required | What it is                                                                    |
| ---------------------- | -------- | ----------------------------------------------------------------------------- |
| `tokenId`              | yes      | The token id half of a Modal API token.                                       |
| `tokenSecret`          | yes      | The token secret half of the same token.                                      |
| `appName`              | no       | The Modal app for sandboxes. Defaults to `bb-sandboxes`.                      |
| `environmentVariables` | no       | Secret JSON object injected into the sandbox.                                 |
| `timeoutMinutes`       | no       | Modal sandbox timeout, 1–1440 minutes.                                        |
| `idleMinutes`          | no       | Snapshot after this many idle minutes. Defaults to 15; 0 disables suspension. |
| `cpu`                  | no       | Reserved cores. Blank uses Modal's default.                                   |
| `memoryMiB`            | no       | Reserved memory in MiB. Blank uses Modal's default.                           |

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
