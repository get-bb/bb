# Machine providers and server access

### Machine providers: core-owned machines

Register machine resource operations with `bb.experimental_machines.register`.
Machine providers compose with environment providers: a picker sugar row first
creates the machine, then asks its named environment provider for a workspace
on that machine. After a new machine connects, core sets up the project's Git
remote on that host and registers its source before invoking an environment
provider that requires `projectCheckout`, if no source exists yet. This reuses
Set up on machine; machine plugins do not clone projects. An existing source is
reused. Core shares concurrent setup per project/host and recovers a completed
clone at its stable project-ID target after a crash by verifying the remote and
registering its source. Providers without that requirement, including personal workspace, do not
trigger source setup. The Machines page and `bb.sdk.hosts.create` can instead create
a standalone machine with `project: null`; create is not required to enrol a
project source in that case.

`icon` is optional. Omit it when provider-created machines should look like
ordinary enrolled machines: the Machines page and Add machine show neither a
provider logo nor a provider badge. Declaring it enables the normal provider
glyph, plugin-relative SVG, declared icon, or React icon-slot presentation.

```ts
bb.experimental_machines.register({
  id: "custom-machine",
  displayName: "Custom machine",
  icon: "Server",
  inputs: z.object({ target: z.string() }),
  policy: {
    idleSuspendMs: null,
    retire: { after: "never" },
    removeRetryMs: 60_000,
  },
  async create({ inputs, key, checkpoint, report, signal }) {
    const enrollment = await bb.experimental_machines.prepareEnrollment({ key });
    const target = await allocateTarget({ target: inputs.target, key, signal });
    const resource = { target: target.id, hostId: enrollment.hostId };
    await checkpoint(resource);
    const { hostId } = await bb.experimental_machines.bootstrap({
      key,
      executor: target.executor,
      daemon: { kind: "install" },
      report,
      signal,
    });
    return { status: "created", hostId, resource };
  },
  async remove({ resource }) {
    const owned = z.object({ target: z.string(), hostId: z.string() }).parse(resource);
    await disconnectTarget(owned.target);
    return { status: "removed" };
  },
});
```

`requires.gitRemote` makes the remote non-null when a project is supplied and
filters out projects without one. Optional Standard Schema `inputs` are parsed
before create and persisted in `hosts.machine_provider_selection`. Every plugin
can read them, so never put secrets there. Store credentials in plugin settings
and pass a non-secret reference such as a target name in inputs.

Create receives a nullable project, nullable gitRemote, parsed inputs, a stable
key, monotonic attempt, durable progress reporter, and abort signal. It must be
idempotent by key: if enrolment completed before the server crashed, the next
call returns the already-enrolled host instead of creating another resource.
Prepare enrollment before calling `await checkpoint(resource)` after durable
allocation and before bootstrap. Create's checkpoint is asynchronous and makes
partial allocation recoverable even if enrollment never succeeds. Never put the
bootstrap bundle in resource JSON. Return the host id plus a private JSON resource
for later lifecycle operations. `allocateTarget` and `disconnectTarget` above
stand for provider-owned allocation, transport, and idempotent cleanup; removal
must handle a checkpointed target whose daemon was never installed or enrolled.
Core owns enrollment, identity files, and daemon installation internals.
A definitive rejection before allocation returns `{ status: "failed", failure:
"terminal", allocation: "none", message }`; persist that rejection first. Core
skips allocation reconciliation and settles enrollment/access/the pending host.
Omit `allocation` for unknown outcomes such as timeouts. Automatic unresolved
cleanup retries are bounded to a 30-minute launch window; unresolved cleanup
remains recorded for operator reconciliation.

An `environmentRow` is optional. Providers without one, such as SSH, require
`--environment-provider <id>` alongside `bb thread spawn --new-machine <id>`.

Suspend and resume are optional but must be declared together. Without them,
`policy.idleSuspendMs` must be null. With them, core suspends only after every
live thread is idle and no terminal is open, then resumes before the next send.
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

Standalone `bb machine create` and `bb.sdk.hosts.create` submit a durable launch
and follow its progress. `create --no-wait` / `hosts.submit` return the launch ID;
`machine status` / `hosts.launch` poll it. Only `machine cancel` / `hosts.cancel`
explicitly cancel; closing a client or aborting its signal stops following.

Retirement is either last-thread plus a grace period or never. Removal always
cascades through the machine's environment providers before machine remove;
failures persist and retry after `removeRetryMs`.


## Server access

`bb.experimental_serverAccess.register` declares id, displayName,
availability, acquire({ key, hostId, signal }) returning a ServerAccessGrant,
and release({ key, hostId, grantId }). Acquire is idempotent by key. Return `{ id, serverUrl, headers?: Record<string, string> }`; the grant serves runtime requests as well
as enrolment. Acquire must redeem provider-specific codes server-side and persist
the revocation identity before returning, so release works before enrolment.
Direct grants omit headers. Bootstrap v2 carries the headers; pending encrypted
v1 bundles are upgraded server-side on preparation. Host metadata stores the provider id and grant id; pending
bootstrap credentials are encrypted separately by core.
An Error named `experimental_ServerAccessRecoveryError` exposes its deliberate
user-safe recovery message through the plugin boundary; ordinary errors stay
redacted. Release receives a null grantId when acquire was interrupted. Core persists the
provider before acquisition and retries release by key and hostId. Keep intent
and credential-bearing grants in secret storage; only non-secret revocation
metadata belongs in KV. Delivered v1 bundles upgrade locally to v2 headers in the
CLI and installer, including one-time legacy Connect redemption.

`experimental_attention()` optionally returns a user-safe diagnostic or null,
synchronously or asynchronously. Machines settings displays it independently of
availability; never include credentials or raw provider payloads.

Machines settings select the default. Plugins can pass ServerAccessSelection
to the machine enrolment/bootstrap APIs. The direct provider reads
machineServerUrl, falling back to BB_EXTERNAL_URL. Declaring a URL does not
prove reachability from a sandbox.

### Machine enrollment and bootstrap

`bb.experimental_machines` implements `MachineBootstrapApi` alongside register:

- `enrollments.prepare({ key, access? })` and `prepareEnrollment` return a
  `MachineEnrollment`: pending with a private `EnrollmentBootstrap` and expiry,
  or enrolled with the stable hostId. Keys are scoped to the calling plugin.
- `enrollments.waitForConnection({ enrollmentId, timeoutMs, signal })` and
  `waitForConnection` return `{ hostId }` after the daemon connects.
- `enrollments.cancel({ enrollmentId })` cancels pending enrollment and releases
  its access; an already-enrolled identity retains its credentials and access.
  This does not replace provider cleanup of an allocated resource.
- `installerCommand(bootstrap)` synchronously returns `MachineInstallerCommand`
  `{ command: string[], stdin: string }`. Pass stdin privately; never place the
  bundle in argv, logs, progress, or persisted machine resources.
- `bootstrap({ key, executor, access?, daemon, report, signal })` prepares or
  recovers enrollment, installs or enrolls, starts the daemon, waits for its
  connection, and returns `{ hostId }`. Reuse the same key and access selection
  used before the create checkpoint. `daemon` is `{ kind: "install" }` or
  `{ kind: "preinstalled" }`; the latter needs compatible `bb` and `bb-app`.
  Install needs Node, npm, and curl; the helper does not install OS packages.

A `MachineExecutor` implements `exec({ command, timeoutMs, signal, stdin? })`
returning `{ exitCode, stdout, stderr }`. Execute argv through the provider's
transport, honor timeout and cancellation, and keep stdin private. Optional
`writeFile(path, contents, mode?)` is available to callers; bootstrap uses exec.
The helper suppresses remote output and reports fixed progress messages. It
restarts enrolled identities, including a restored preinstalled snapshot.
Create's awaited checkpoint precedes bootstrap; suspend's synchronous checkpoint
persists a recovery artifact before destructive cleanup.

### Finite machine lifetimes

Optional `experimental_observe({hostId,resource,signal})` returns
`{state:"running"|"suspended"|"missing"|"unknown",expiresAt,resource}` without
allocating or changing identity. `experimental_policy({hostId,resource})` returns
live `{idleSuspendMs,retireAfterMs,deadlineLeadMs}`; null disables a policy.
Core owns the maintenance lease, dispatch exclusion, interruption, retention
warning and keep control. Stop workspace writers before snapshotting. Supply
`suspend.checkpoint(resource, experimental_snapshotAt)` after a successful save
and before terminating compute; do not report an allocation checkpoint as a save.
Reconcile resume by durable name and await its checkpoint before bootstrap.
Failed preservation must retain old compute and report recoverable failure.
`bb.sdk.hosts.experimental_lifecycle({hostId,keep?})` exposes the same lifecycle
state as `bb machine lifecycle MACHINE [--keep|--no-keep] --json`.
