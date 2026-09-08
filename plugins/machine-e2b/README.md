# E2B machines

Catalog plugin providing the `e2b` machine provider through the official E2B
JavaScript SDK. Create a machine from Settings → Machines or the public machines
SDK / `bb machine create`. Configure project sources and agent credentials on
that machine separately. This plugin intentionally registers no environment
provider or provider icon.

For a project with a Git remote, the E2B environment-picker shortcut creates a
machine and selects Project checkout. Core clones/registers the project source;
the machine adapter stays project-agnostic and takes no machine inputs. Without
a project Git remote the checkout shortcut is hidden. Standalone creation and
an explicit Personal workspace selection remain available.

Creation prepares enrollment before vendor allocation and awaits a core resource
checkpoint as soon as the allocation ID is known. The checkpoint contains no
bootstrap credentials. Core can remove a cancelled allocation directly from
that checkpoint without rerunning creation, enrollment, or bootstrap.

## Settings and template

- `E2B_API_KEY`: secret API key for the E2B account.
- `template`: required template name or ID. Use an E2B template based on
  `node:22.23.2-bookworm`, with Node 22.19+, npm, curl, git, build tools and GNU
  coreutils on root's PATH. Rebuild old templates to support SDK stdin closure.
- `timeoutMinutes`: running sandbox lifetime, default 60 minutes. Values up to
  1440 are accepted, subject to your E2B plan's limit.

Build the template with E2B's template SDK and your E2B credentials configured:

```ts
import { Template } from "e2b";

await Template.build(
  Template().fromImage("node:22.23.2-bookworm"),
  "bb-node22",
);
```

Set `template` to `bb-node22`. The plugin runs commands as root and uses the
instance's default server-access provider. Core bootstrap installs/enrolls the
daemon, reuses the durable creation-key identity, and waits for connection.
The plugin does not install OS prerequisites or carry enrollment/supervisor code.

## Lifecycle and retry

After 15 minutes idle, core asks E2B to pause the sandbox with memory preserved.
Resume connects to the existing sandbox (E2B resumes paused sandboxes), then
calls core bootstrap with the original key and a preinstalled daemon. Last-thread
retirement has a 30-day grace period. Removal calls E2B kill directly, including
for paused sandboxes; it does not resume compute first.

Creation discovers running and paused sandboxes by `bbMachineKey` metadata.
A small durable allocation intent prevents a second create request after an
ambiguous response. A returned sandbox ID is persisted before propagating a
cancellation that arrived during create. That create request has its own
30-second bound. Unknown outcomes reconcile by metadata for 30 seconds, then
return an explicit unresolved-allocation failure without another create request.
A crash between saving intent and submission needs operator reconciliation.
Missing/expired sandboxes are not silently replaced under an existing identity.

Executor argv is shell-quoted. Bootstrap credentials travel through SDK stdin,
which is explicitly closed; they are not placed in command arguments, progress,
or resources. GNU `timeout` bounds remote commands, with a one-second kill grace;
the SDK stream gets two seconds of additional cleanup time. Transport failures
and cancellation attempt to kill the command and disconnect its stream.

## Primary references and verification

- [E2B Sandbox lifecycle and metadata discovery](https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/index.ts)
- [E2B command transport implementation](https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/commands/index.ts)
- [E2B API pause/kill behavior](https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/sandboxApi.ts)
- [Official Node Bookworm image](https://github.com/nodejs/docker-node/blob/main/22/bookworm/Dockerfile)

Focused tests cover retries, ambiguous allocation, cancellation, lifecycle,
argv/stdin handling, and nonzero command results. Live verification includes template construction, enrollment, Git worktree
threads, pause/resume, cancellation, server-crash recovery with the same
allocation, and vendor-confirmed cleanup.

The daemon installer does not install an agent CLI. Preinstall the chosen agent
in the image/template, or run `bb machine provider-cli install <host-id> codex`
and retry the thread. Account Pooler can supply runtime authentication through
the selected server-access grant.
