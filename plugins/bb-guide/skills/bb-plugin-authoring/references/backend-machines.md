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
bb.experimental_machines.register({
  id: "custom-machine",
  displayName: "Custom machine",
  description: "Create a machine with custom compute.",
  icon: "Server",
  ephemeral: true,
  inputs: z.object({ target: z.string() }),
  async create({ inputs, key, checkpoint, report, signal }) {
    const target = await allocateTarget({ target: inputs.target, key, signal });
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
  async remove({ resource }) {
    const owned = z.object({ target: z.string() }).parse(resource);
    await disconnectTarget(owned.target);
    return { status: "removed" };
  },
});
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
bootstrap bundle in resource JSON. Return a readable name and private JSON
resource for later lifecycle operations; core uses the host identity reserved
on the launch. Core falls back to the provider display name plus a short
identity suffix for older providers that omit the name.
`allocateTarget` and `disconnectTarget` above
stand for provider-owned allocation, transport, and idempotent cleanup; removal
must handle a checkpointed target whose daemon was never installed or enrolled.
Core owns enrollment, identity files, and daemon installation internals.
Automatic unresolved cleanup retries are bounded to a 30-minute launch window;
unresolved cleanup remains recorded for operator reconciliation.

Machine registration does not contribute environment-picker entries. Register
an environment composition with `machineProviderId` and `environmentProviderId`
to offer a new machine plus a concrete environment. Modal combines its machine
with `project-checkout`; core prepares the missing checkout. CLI users select
`--environment-provider modal-sandbox` without machine selectors and may pass
`--machine-inputs <json>` for the composition's machine inputs. Explicit
`--new-machine <id>` always requires `--environment-provider <id>`.

Suspend and resume are optional but must be declared together. Providers own idle
timing and request pause through the host SDK. Core interrupts active work before
stopping the host daemon and invoking suspend, and resumes before queued execution.
Suspend receives `checkpoint(resource)`, which synchronously
persists a recoverable private resource before destructive cleanup. Use it
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
the provider id and grant id; pending
bootstrap credentials are encrypted separately by core.
The failed result's message is deliberate user-safe recovery copy; ordinary
thrown errors stay redacted. Release receives a null grantId when acquire was interrupted. Core persists the
provider before acquisition and retries release by key and hostId. Keep intent
and credential-bearing grants in secret storage; only non-secret revocation
metadata belongs in KV.

`attention()` optionally returns a user-safe diagnostic or null,
synchronously or asynchronously. Machines settings displays it independently of
availability; never include credentials or raw provider payloads.

Machines settings select the default. Without a saved selection, core uses the
first registered provider, or direct when none are registered. Plugins can pass ServerAccessSelection
to the machine enrolment/bootstrap APIs. The direct provider reads
machineServerUrl, falling back to BB_EXTERNAL_URL. Declaring a URL does not
prove reachability from a sandbox.

### Machine enrollment and bootstrap

`bb.experimental_machines` implements `MachineBootstrapApi` alongside register:

- `bootstrap({ key, executor?, access?, report, signal })` prepares or recovers
  enrollment, installs or starts the daemon, waits for its
  connection, and returns `{ hostId }`. When `executor` is omitted, it waits for
  the user to run the manual command. Reuse the same key and access selection
  used before the create checkpoint. Initial installation needs Node, npm, and
  curl; the helper does not install OS packages.

A `MachineExecutor` implements `exec({ command, timeoutMs, signal, stdin? })`
returning `{ exitCode, stdout, stderr }`. Execute argv through the provider's
transport, honor timeout and cancellation, and keep stdin private.
The helper suppresses remote output and reports fixed progress messages. It
restarts enrolled identities, including a restored preinstalled snapshot.
Create's awaited checkpoint precedes bootstrap; suspend's awaited checkpoint
persists a recovery artifact before destructive cleanup.

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
