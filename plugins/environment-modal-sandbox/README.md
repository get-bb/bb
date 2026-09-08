# Modal sandbox

Creates resumable bb machines in [Modal](https://modal.com) Sandboxes. It is
an official catalog plugin, not installed by default. Installing it adds the
`modal-sandbox` machine provider; it does not add an environment provider.

Choose Modal sandbox in a project's environment picker to create a machine,
clone and register that project's checkout, and run the thread there through
the Project checkout provider. The machine remains a normal bb execution
target, so later threads can create Git worktrees or use other environment
providers on the same sandbox. You can also create a projectless sandbox from
Settings → Machines → Add machine and configure project sources later.

Creation prepares enrollment before vendor allocation and awaits a core resource
checkpoint as soon as the allocation ID is known. The checkpoint contains no
bootstrap credentials. Core can remove a cancelled allocation directly from
that checkpoint without rerunning creation, enrollment, or bootstrap.
The plugin also checkpoints the project source ID once registration completes;
core owns teardown after creation failures.

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
- A git remote when creating through the project picker, because the sandbox
  clones and registers that project. Standalone machine creation does not need
  a project.
- Codex credentials. Put `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN` in the
  plugin's `environmentVariables` setting, or bake a valid root-user login
  into a custom image. The plugin installs or updates Codex and authenticates
  it while creating the machine.
- A URL the sandbox can reach this bb at.

## How the sandbox reaches this bb

Configure the instance's default server-access provider so the sandbox can
reach bb. Core's public machine bootstrap helper owns access grants,
enrollment, durable identity, daemon startup, and waiting for a connection.
The plugin supplies Modal exec as the transport, including stdin for secret
bootstrap data. It does not store enrollment credentials in machine resources.

Creation calls bootstrap with the durable creation key and installs the daemon.
Resume calls the same helper with the original key and a preinstalled daemon,
including when a previous attempt left the sandbox running. Core reuses the
identity and restarts the daemon when needed. The plugin has no `serverUrl`
setting; configure access centrally.

After the machine connects, the plugin installs or updates Codex, applies
configured credentials, and verifies provider readiness. Private repositories
need credentials in the image or injected environment.

The exec adapter stops waiting when cancellation is requested. Modal does not
expose per-exec cancellation, so a command already submitted may continue until
its process timeout. Retries reuse the named sandbox and the bootstrap key.

## Settings

| Setting                | Required | What it is                                                                    |
| ---------------------- | -------- | ----------------------------------------------------------------------------- |
| `tokenId`              | yes      | The token id half of a Modal API token.                                       |
| `tokenSecret`          | yes      | The token secret half of the same token.                                      |
| `appName`              | no       | The Modal app for sandboxes. Defaults to `bb-sandboxes`.                      |
| `image`                | no       | Registry tag with Node 22+, npm, git, and curl.                               |
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
