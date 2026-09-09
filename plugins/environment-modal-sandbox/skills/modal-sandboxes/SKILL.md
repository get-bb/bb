---
name: modal-sandboxes
description: Connect Modal and create reusable cloud machines with the bundled standard image, on-demand daemon installation, and snapshot lifecycle.
---

# Modal machines

1. Install `builtin:environment-modal-sandbox` and configure `tokenId` and
   `tokenSecret` in plugin Settings. Do not print credentials. `appName` defaults
   to `bb-sandboxes`; optional `cpu` and `memoryMiB` settings reserve resources.
2. Run `bb modal account inspect --json` to test the connection without allocating
   compute. Exit status 1 means configuration or connection failed; the JSON gives
   a secret-free message. SDK callers use the plugin's `modalRpcContract`
   (`account.inspect`) through `sdk.plugins.callRpc`.
3. Resolve the project with `bb project list --json`. It needs a Git remote,
   credentials to clone it, and machine server access reachable from Modal.
4. Select the project and create a machine in the UI, or run
   `bb machine create --provider modal-sandbox --project PROJECT --json`.
   SDK: `hosts.submit({machineProviderId:"modal-sandbox",projectId,key})`.
   No image or build inputs are accepted. Use a stable creation key for retries.

Settings edits the shared Dockerfile used for future machines. Agents can run
`bb modal image show > Dockerfile`, edit the file, then run `bb modal image set
--file ./Dockerfile`. `bb modal image reset` restores the bundled default.
Append `--json` for structured output. File paths resolve from the CLI directory
on the current thread's host, or the server primary host without thread context.
Typed RPCs `image.definition`, `image.set({dockerfile})`, and `image.reset`
return `{dockerfile, customized}` through `sdk.plugins.callRpc`.

Only one FROM followed by RUN, ENV, WORKDIR, and USER is supported. Comments and
line breaks are preserved; no COPY, ADD, uploaded context, or multi-stage builds.
Maximum length is 65,536 characters. Failed validation leaves the saved definition
unchanged. Save/reset is plugin-wide and affects new machines only; it does not
allocate resources or build. The next launch builds/reuses the content-hashed
image. The bundled default supplies tools, not the BB daemon.
Core installs the matching daemon during initial bootstrap, then handles
machine enrollment, connection, checkout cloning and readiness. Creation progress
reports build/allocation/bootstrap failures. Cancelling a launch prevents subsequent
sandbox allocation, but an already submitted shared image build may finish.

Project dependencies and services belong in `.bb-env-setup.sh`. Core runs it after
creating the checkout and after filesystem restore; make it idempotent and restart
services there. Setup failure blocks readiness. Core also owns
`.bb-env-teardown.sh` for owned environments. Attached user-maintained paths skip
both hooks. Configure runtime secrets through core Machine environment settings;
never bake them into the image. There are no user recipes, context uploads, smoke
verification records or promotion commands.

Use `bb machine lifecycle MACHINE --json` for core suspension state and
`sdk.hosts.experimental_providerDetails({hostId})` for Modal expiry and saved-image
status. Defaults are 15-minute idle pause and 24-hour compute lifetime. There is
no retention/keep policy; remove machines explicitly.

Manual and idle pauses drain BB work, stop the daemon, snapshot the filesystem,
and durably record the snapshot before terminating compute. Resume restores the
saved filesystem and reruns setup. Continue interrupted turns explicitly.

There is no pre-expiry scheduler. If a sandbox runs until its configured timeout
(24 hours by default), changes since the last successful pause may be lost.
Pause before the timeout to save work. Failed saves retain compute while it exists.
Missing compute never silently restores an older snapshot; a checkpoint from an
interrupted planned suspension remains recoverable.

Remove with `bb machine remove MACHINE --yes --json`. This removes
owned environments, compute and private snapshots. Shared standard images remain
cached for future launches. Builds and machines incur Modal usage; obtain task
authorization before allocating them during testing.


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
and build `logs`. Debug sandboxes expire after 30 minutes, use configured CPU and
memory, and contain no injected BB credentials, daemon, project clone or setup
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
