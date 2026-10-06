# Machine providers and server access

## Machine providers

Register machine resource operations with `bb.experimental_machines.register`.
`description` and `icon` are required; the icon is a host glyph or a
plugin-relative SVG, and `app.slots.experimental_providerIcon` can customize
its presentation. The provider's display name and icon are the machine kind
shown next to the name of every machine that provider creates. Manually
enrolled machines have no kind.

Set `ephemeral: true` only when the provider creates disposable compute. Core
then automatically requests machine removal when no live thread or live
thread's creating/ready machine launch still needs it, regardless of any
attached environment's retirement policy. The default is false, so manually
enrolled machines and provider-managed machines intended to persist are never
removed automatically.

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
Schema `inputs` are parsed before create and persisted on the launch, where
every plugin can read them. Never put secrets there: store credentials in
plugin settings and pass a non-secret reference such as a target name. The
frontend control for these inputs is the `experimental_machineProviderInputs`
slot (frontend-core-slots.md).

Create receives parsed inputs, a stable key, monotonic attempt, durable
progress reporter, and abort signal. It must be idempotent by key: if
enrollment completed before the server crashed, the next call reuses the
already-enrolled host instead of creating another resource. Call
`await checkpoint(resource)` after durable allocation and before bootstrap, so
partial allocation stays recoverable even if enrollment never succeeds. Never
put the bootstrap bundle in resource JSON. Return a readable name and opaque
JSON resource for later lifecycle operations; core uses the host identity
reserved on the launch. `PluginMachineProviderResource` excludes top-level
null; use `{}` when no custom metadata is needed.
`bb.experimental_machines.getResource(hostId)` reads core's current persisted
resource for a host, or null; any plugin can read it, so it must not contain
credentials. The example's `targets` adapter supplies provider-owned
allocation, transport, and idempotent cleanup.

Removal must handle a checkpointed target whose daemon was never installed or
enrolled. Without a checkpoint, `reconcileCleanup` discovers and removes
allocations by key. With a checkpoint, `remove` receives the stored resource.
Failed cleanup stays recorded and retries every minute until it succeeds.
Persistent-machine removal first removes the machine's environments through
their providers; ephemeral-machine removal skips environment-provider teardown
and never resumes suspended compute for it. Once compute removal succeeds,
core marks every attached environment destroyed, as read-only history.

Suspend and resume are optional but must be declared together. Suspend
receives an awaitable `checkpoint(resource)` that persists a recoverable
opaque resource before destructive cleanup: call it after creating a recovery
artifact and before terminating the live machine or deleting an older
artifact. A replay receives the last checkpoint. Resume receives the same
callback: call it immediately after restoring or allocating compute and
before bootstrap. A restart passes the last checkpoint back with the same
enrollment identity, and a stale callback rejects. Checkpoints are recovery
records, not filesystem saves: providers create any filesystem snapshot
themselves. Daemon-connected is not agent-ready; checkout setup and provider
authentication still need to complete.

### Environment compositions and project sources

Machine registration does not contribute environment-picker entries. Register
an environment composition with `bb.experimental_environments.register` and
required `id`, `displayName`, `description`, `icon`, `machineProviderId` and
`environmentProviderId` to offer a new machine plus a concrete environment;
the composition appears once in the picker, outside existing-host groups.
Choosing it creates the machine, then asks the named environment provider for
a workspace on it. CLI users select `--environment-provider <composition-id>`
without machine selectors and may pass `--machine-inputs <json>` for the
composition's machine inputs. Explicit `--new-machine <id>` always requires
`--environment-provider <id>`.

Machine plugins do not clone projects. After a new machine connects, before
invoking an environment provider that requires `projectCheckout`, core sets up
the project's Git remote on that host and registers its source if none exists
yet; an existing source is reused. Providers without that requirement,
including personal workspace, do not trigger source setup.

### Creating machines from the SDK and CLI

`bb.sdk.hosts.experimental_listProviders()` discovers machine providers and
their input schemas. `bb.sdk.hosts.experimental_create({ machineProviderId,
inputs, key?, wait?, signal? })` creates a standalone machine and returns a
public Host; `inputs: null` is for a provider that accepts no inputs. Supply a
stable `key` for idempotent retries. Creation does not create an environment
or a thread; project source setup happens later when an environment needs it.
By default it waits until the host is active; `wait: false` returns the
creating host for polling with `bb.sdk.hosts.get`. `bb machine create`
(`--no-wait`) and `bb machine show` are the CLI equivalents. Deleting the host
(`bb.sdk.hosts.delete`, `bb machine remove`) cancels creation; closing a
client or aborting its signal only stops following.

With `wait: false` the manual enrollment command may not be ready yet. Poll
`bb.sdk.hosts.experimental_getEnrollmentCommand({ hostId })` while the host
is creating; null means there is no current command. Stop on connection or
creation failure. Reading does not renew a command; regenerate expired setup
explicitly.

`bb.sdk.hosts.experimental_suspend({ hostId })` and
`bb.sdk.hosts.experimental_resume({ hostId })` require the provider's paired
suspend/resume operations. They return the updated public Host (HTTP 202)
once the tracked operation starts; read its lifecycle state for completion.
`bb.sdk.hosts.experimental_retryCleanup({ hostId })` retries failed provider
teardown. `bb.sdk.hosts.get({ hostId })` also returns nullable
`connectMachineId` from trusted gate metadata; host lists do not expose it.

### Machine enrollment and bootstrap

`bb.experimental_machines` implements `MachineBootstrapApi` alongside register:

- `bootstrap({ key, executor, report, signal })` prepares or recovers
  enrollment, installs or starts the daemon, waits for its connection, and
  returns `{ hostId }`. Reuse the create key on recovery. Initial installation
  needs Node, npm, and curl on the machine; the helper does not install OS
  packages. It restarts enrolled identities, including a restored
  preinstalled snapshot.

A `MachineExecutor` implements
`exec({ command, stdin, timeoutMs, signal, onOutput })` returning
`{ exitCode }`. Execute argv through the provider's transport, honor timeout
and cancellation, and keep stdin private. Stream command output through
`onOutput`; core forwards it into progress logs and includes its last 20 lines
on nonzero exit. Do not emit credentials.

### Coordinated suspension

Your plugin owns idle timing, vendor observations, expiry scheduling, snapshot
identifiers, cleanup, and explicit recovery from loss. Keep deadlines in
plugin storage with `bb.background.schedule` plus startup reconciliation, and
subscribe to `experimental_thread.events` and `experimental_terminal.input` to
extend them (for example, while a thread on the machine is active).

Call `bb.sdk.hosts.experimental_suspend({ hostId })` when the deadline passes.
Core accepts follow-ups into the host-wait queue and drains active turns,
setup hooks and terminals with a five-minute bound before calling your suspend
callback. Persisted live thread launches, provisioning environments, and
project checkout setup on the host reject the request with `machine_busy`; an
idle scheduler should retry on its next sweep. Persist opaque state with
`checkpoint(resource)` before terminating compute. Core restores the same host
identity without rerunning checkout setup.

Allow the full drain bound, snapshot time, and scheduler jitter, and refuse
unsafe recovery or preservation after a missed deadline. A dispatch hook can
help communicate status but is bypassable and does not protect terminal/file
RPCs. Expose vendor-specific snapshots and loss information through the
plugin's own RPC and CLI. The host DTO from `bb.sdk.hosts.get({ hostId })`
shows generic maintenance state through lifecycle phase and progress; core
provides no retention or keep controls.

## Server access

`bb.experimental_serverAccess.register` declares how a new machine reaches
this server: `id`, `displayName`, `description`, `availability()`,
`acquire({ key, hostId, signal })` returning a `ServerAccessGrant` or
`{ status: "failed", message }`, and `release({ key, hostId, grantId })`.

Acquire is idempotent by key and returns
`{ id, serverUrl, headers?: Record<string, string> }`; the grant serves
runtime requests as well as enrollment, and direct grants omit headers.
Acquire must redeem provider-specific codes server-side and persist the
revocation identity before returning, so release works before enrollment.
The failed result's message is user-facing recovery copy; ordinary thrown
errors stay redacted. Release receives a null `grantId` when acquire was
interrupted; core retries release by key and hostId. Keep intent and
credential-bearing grants in private plugin storage. Never put credentials in
machine inputs, resources, or progress output.

Machines settings select the default provider. Without a saved selection,
core uses the first registered provider, or direct when none are registered,
and it keeps the selected provider for later enrollment of the same machine.
The direct provider reads `machineServerUrl`, falling back to
`BB_EXTERNAL_URL`. Declaring a URL does not prove reachability from a sandbox.

Call `recheck()` when access is gained or lost. Clients then reload
configuration, which checks provider availability in parallel with a
five-second deadline per check; invalid output, exceptions, and timeouts
appear unavailable. Machines settings, manual setup, and promptbox banners use
that status; a registered provider alone is not ready. Availability's optional
public `serverUrl` is validated and displayed in Machines settings. Reading
configuration never acquires access; the grant's URL is the one machines use.
