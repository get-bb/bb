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

Settings shows the bundled Dockerfile as a read-only reference. `bb modal image
show [--json]` reads the same file without requiring credentials or starting a
build. Typed RPC: `image.definition` returns `{dockerfile}`.

The plugin builds the bundled Dockerfile automatically on first launch and reuses
its content-addressed image. The Dockerfile supplies tools, not the BB daemon.
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

The plugin checks expiry every minute, starting coordinated suspension 15 minutes
before expiry. Core drains turns/hooks/terminals within five minutes. The plugin
reserves another six minutes for daemon stop and snapshot creation. With 11 minutes
or less remaining, it reports unsafe preservation instead of promising a save.
Short lifetimes or a stopped/disabled server can miss the deadline. Failed saves
retain compute and retry while enough time remains. A lost machine never silently
restores stale state. A durable checkpoint from interrupted planned suspension can
resume safely. Continue interrupted turns explicitly after restore.

Remove with `bb machine remove MACHINE --yes --json`. This removes
owned environments, compute and private snapshots. Shared standard images remain
cached for future launches. Builds and machines incur Modal usage; obtain task
authorization before allocating them during testing.
