# Machine providers and server access

### Machine providers: core-owned machines

Register machine resource operations with `bb.experimental_machines.register`.
An explicit environment composition first
creates the machine, then asks its named environment provider for a workspace
on that machine. After a new machine connects, core sets up the project's Git
remote on that host and registers its source before invoking an environment
provider that requires `projectCheckout`, if no source exists yet. This reuses
Set up on machine; machine plugins do not clone projects. An existing source is
reused. Core shares concurrent setup per project/host and recovers a completed
clone at its stable project-ID target after a crash by verifying the remote and
registering its source. Providers without that requirement, including personal workspace, do not
trigger source setup. The Machines page and `bb.sdk.hosts.experimental_create` can instead create
a standalone machine without project context. Project source setup happens later when an environment needs it.

`description` and `icon` are required. The icon supplies the normal provider glyph or plugin-relative SVG; a React icon slot can customize its presentation.

The provider display name and icon are the machine kind shown next to the name
of every machine that provider creates. Manually enrolled machines have no kind.

Set `ephemeral: true` only when the provider creates disposable
compute. Core then automatically requests machine removal when no live thread or
live thread's creating/ready machine launch still needs it, regardless of any
attached environment's retirement policy. The default is false, so manually enrolled machines
and provider-managed machines intended to persist are never removed automatically.

```ts
import type { BbPluginApi, MachineExecutor } from "@get-bb/plugin-sdk";
import { z } from "zod";

export function registerMachine(
  bb: BbPluginApi,
  targets: {
    allocate(request: {
      target: string;
      key: string;
      signal: AbortSignal;
    }): Promise<{ id: string; executor: MachineExecutor }>;
    remove(id: string, signal: AbortSignal): Promise<void>;
    removeByKey(key: string, signal: AbortSignal): Promise<void>;
  },
) {
  bb.experimental_machines.register({
    id: "custom-machine",
    displayName: "Custom machine",
    description: "Create a machine with custom compute.",
    icon: "Server",
    ephemeral: true,
    inputs: z.object({ target: z.string() }),
    async create({ inputs, key, checkpoint, report, signal }) {
      const target = await targets.allocate({
        target: inputs.target,
        key,
        signal,
      });
      const resource = { target: target.id };
      await checkpoint(resource);
      const { hostId } = await bb.experimental_machines.bootstrap({
        key,
        executor: target.executor,
        report,
        signal,
      });
      return {
        status: "created",
        name: `Custom machine ${hostId.slice(-6)}`,
        resource,
      };
    },
    async reconcileCleanup({ key, signal }) {
      await targets.removeByKey(key, signal);
      return { status: "removed" };
    },
    async remove({ resource, signal }) {
      const owned = z.object({ target: z.string() }).parse(resource);
      await targets.remove(owned.target, signal);
      return { status: "removed" };
    },
  });
}
```

A machine is not scoped to a project: nothing about creation names one, and
projects reach a machine later through project sources. Optional Standard
Schema `inputs` are parsed before create and persisted on the launch. Never put
secrets there. Store credentials in plugin settings
and pass a non-secret reference such as a target name in inputs.

Create receives parsed inputs, a stable key, monotonic attempt, durable
progress reporter, and abort signal. It must be
idempotent by key: if enrolment completed before the server crashed, the next
call reuses the already-enrolled host instead of creating another resource.
Call `await checkpoint(resource)` after durable allocation and before
bootstrap. Create's checkpoint is asynchronous and makes
partial allocation recoverable even if enrollment never succeeds. Never put the
bootstrap bundle in resource JSON. Return a readable name and opaque JSON
resource for later lifecycle operations; core uses the host identity reserved
on the launch. `PluginMachineProviderResource` excludes top-level null; use `{}`
when no custom metadata is needed. The example’s `targets` adapter supplies
provider-owned allocation, transport, and idempotent cleanup. Removal
must handle a checkpointed target whose daemon was never installed or enrolled.
Core owns enrollment, identity files, and daemon installation internals.
Without a checkpoint, `reconcileCleanup` discovers and removes allocations by key.
With a checkpoint, `remove` receives the stored resource. Failed cleanup remains
recorded and retries on the core one-minute interval until it succeeds.

Machine registration does not contribute environment-picker entries. Register
an environment composition with required `id`, `displayName`, `icon`,
`machineProviderId` and `environmentProviderId`
to offer a new machine plus a concrete environment. Modal combines its machine
with `project-checkout`; core prepares the missing checkout. CLI users select
`--environment-provider modal-sandbox` without machine selectors and may pass
`--machine-inputs <json>` for the composition's machine inputs. Explicit
`--new-machine <id>` always requires `--environment-provider <id>`.

Suspend and resume are optional but must be declared together. Providers own idle
timing and request pause through the host SDK. Core interrupts active work before
stopping the host daemon and invoking suspend, and resumes before queued execution.
Suspend receives an awaitable `checkpoint(resource)`, which
persists a recoverable opaque resource before destructive cleanup. Use it
after creating a recovery artifact and before terminating the live machine or
deleting an older artifact. A replay receives the last checkpoint.
Resume receives an awaitable `checkpoint(resource)`. Call it immediately after
restoring or allocating compute and before bootstrap. Core fences the provider
owner, lifecycle phase and persisted operation ID, and restart passes the last
checkpoint back with the same enrollment identity. A stale callback rejects.
Allocation checkpoints are recovery records, not filesystem saves: providers
must create any filesystem snapshot themselves. Daemon-connected is not
agent-ready; checkout setup and provider authentication still need to complete.

Standalone `bb machine create` and `bb.sdk.hosts.experimental_create` create a
durable host and follow its progress. `create --no-wait` returns the creating
host ID; `machine show` / `hosts.get` poll it. `machine remove` / `hosts.delete`
cancel creation; closing a client or aborting its signal only stops following.

Persistent-machine removal cascades through the machine's environment providers
before machine remove; failures persist and retry after the core one-minute retry
interval. Ephemeral-machine removal skips environment-provider teardown and never
resumes suspended compute for it. Once compute removal succeeds, core marks every
attached environment destroyed with teardown removed as read-only history.

## Server access

`bb.experimental_serverAccess.register` declares id, displayName, description,
availability, acquire({ key, hostId, signal }) returning a ServerAccessGrant or
`{ status: "failed", message }`, and release({ key, hostId, grantId }). Acquire
is idempotent by key. Return `{ id, serverUrl, headers?: Record<string, string> }`; the grant serves runtime requests as well
as enrolment. Acquire must redeem provider-specific codes server-side and persist
the revocation identity before returning, so release works before enrolment.
Direct grants omit headers. Bootstrap carries the headers. Host metadata stores
the provider id and grant id; pending bootstrap bundles live in server memory.
The failed result's message is deliberate user-safe recovery copy; ordinary
thrown errors stay redacted. Release receives a null grantId when acquire was interrupted. Core persists the
provider before acquisition and retries release by key and hostId. Keep intent and credential-bearing grants in private plugin storage.
Never put credentials in machine inputs, resources, or progress output.

Machines settings select the default. Without a saved selection, core uses the
first registered provider, or direct when none are registered. Core retains the
selected provider for subsequent enrollment of the same machine. The direct provider reads
machineServerUrl, falling back to BB_EXTERNAL_URL. Declaring a URL does not
prove reachability from a sandbox.

Call `recheck()` when access is gained or lost. It broadcasts a configuration-change
notification. Clients reload configuration, which checks provider availability
in parallel with a five-second deadline per check. Invalid output, exceptions,
and timeouts appear unavailable. Machines settings, manual setup, and promptbox
banners use that status; a registered provider alone is not ready.
Availability's optional public `serverUrl` is validated and displayed in Machines
settings when available. An available result without a URL is valid. Reading
configuration never acquires access; the grant's URL is the one used by machines.

### Machine enrollment and bootstrap

`bb.experimental_machines` implements `MachineBootstrapApi` alongside register:

- `bootstrap({ key, executor, report, signal })` prepares or recovers enrollment,
  installs or starts the daemon, waits for its connection, and returns `{ hostId }`.
  Reuse the create key on recovery. Initial installation needs Node, npm, and curl;
  the helper does not install OS packages. Manual setup is built into core and
  uses internal enrollment operations.

A `MachineExecutor` implements `exec({ command, stdin, timeoutMs, signal, onOutput })`
returning `{ exitCode }`. Execute argv through the provider's transport, honor timeout
and cancellation, and keep stdin private. Stream command output through `onOutput`;
core forwards it into progress logs and includes its last 20 lines on nonzero exit.
Do not emit credentials. The helper restarts enrolled identities, including a restored
preinstalled snapshot. Create's awaited checkpoint precedes bootstrap; suspend's
awaited checkpoint persists a recovery artifact before destructive cleanup.

Standalone SDK creation with `wait: false` returns before the manual command is
necessarily ready. Poll `experimental_getEnrollmentCommand({ hostId })` while the
host is creating; null means there is no current command. Stop on connection or
creation failure. Reading does not renew a command; regenerate expired setup explicitly.

### Coordinated suspension

Own idle timing with plugin storage and background schedules. Subscribe to
`experimental_thread.events` and `experimental_terminal.input` to extend your deadline.
Modal extends its deadline for starting threads before environment attachment by
matching the thread to its machine launch key, and for starting and active threads
after attachment through the environment host.

Call `bb.sdk.hosts.experimental_suspend({hostId})` for coordinated suspension. Core accepts follow-ups into the host-wait queue
and drains active turns, setup hooks and terminals with a five-minute bound before
calling your suspend callback. Persisted live thread launches, provisioning environments,
and project checkout setup on the host reject the request with `machine_busy`; an idle
scheduler should retry on its next sweep.
Persist opaque state with `checkpoint(resource)` before
terminating compute. The SDK request returns after suspension starts; observe the
host lifecycle when completion matters. Core serializes resource transitions and restores the same host
identity without rerunning checkout setup.

Your plugin owns vendor observations, expiry scheduling, snapshot identifiers,
cleanup and explicit recovery from loss. Use `bb.background.schedule` plus startup
reconciliation; allow the full core drain bound, snapshot time and scheduler jitter.
Refuse unsafe recovery or preservation after a missed deadline. A dispatch hook can
help communicate status but is bypassable and does not protect terminal/file RPCs.
Expose vendor-specific snapshots and loss information through the plugin’s own RPC and CLI.

The host DTO returned by `bb.sdk.hosts.get({hostId})` shows generic maintenance
state through lifecycle phase and progress. Core does not provide retention or keep controls.
