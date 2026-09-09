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

Use `bb machine lifecycle MACHINE --json` for preservation/retention state,
`--keep` to retain a machine, and `--no-keep` to restore automatic removal.
Defaults are 15-minute idle pause, 24-hour compute lifetime and 30-day retention
after the last thread. Open terminals block idle pause; deadline maintenance
interrupts work and closes them before saving a private filesystem snapshot.
`idleMinutes` and `timeoutMinutes` are plugin settings; zero idle disables pause.
Running compute retains its existing vendor deadline; new compute uses the current
lifetime. Physical resource reservations remain pinned across restore.

An interrupted turn is not replayed. Continue explicitly after restore. Failed
saves retain compute; missing compute or snapshots never trigger an empty fallback.
If the server misses a vendor deadline, explain possible loss since the last save
before explicitly requesting `bb machine resume MACHINE`. Account changes block
lifecycle actions until the original account is restored.

Remove with `bb machine lifecycle MACHINE --remove --yes --json`. This removes
owned environments, compute and private snapshots. Shared standard images remain
cached for future launches. Builds and machines incur Modal usage; obtain task
authorization before allocating them during testing.
