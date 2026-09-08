---
name: modal-sandboxes
description: Set up Modal sandboxes for a project, build and verify its stored Dockerfile image, promote it, and manage reusable machines, preservation and cleanup.
---

# Set up Modal sandboxes

Dockerfile recipes are stored per server owner/project in plugin SQLite.
Runtime setup has one repo-owned entry point: `.bb-env-setup.sh`. Inspect the
existing hook and write or update it in the repository when the project needs
one. It should use the image's warm dependency cache, validate its own inputs and
essential outputs, and take a no-op path when nothing changed. Never store a
second setup script in the image recipe.
All commands accept `--json`; CLI and SDK use the typed `modalRpcContract` in
`catalogue/contract.ts` through the existing plugin RPC transport.

- `bb modal project inspect --project X --environment E --json` reads facts,
  lockfiles and hooks without running project scripts.
- `bb modal recipe put --project X --stdin --expected-revision N --json` reads
  a literal Dockerfile or a JSON envelope with `dockerfileText`,
  `contextRules:{include:[],exclude:[]}`, and `smoke:{commands:[],timeoutSeconds:120}`.
  Start at revision 0. Save conflicts report HTTP 409 and the latest revision.
- `bb modal recipe show --project X --json`; `recipe list --cursor ID --limit 50 --json`.
- `bb modal context upload --project X --environment E --recipe R --revision N --json`
  transfers files from E's host. Use `--reviewed-dirty-json '["path"]'` with the
  exact dirty-path list returned by inspect. Review the contents first. Contexts
  contain tracked files at the recorded commit plus this reviewed overlay;
  secrets, caches, `.git`, and `.worktreeinclude` matches are excluded.
  Explicit include rules are required to transfer files. Archives are capped at
  256 MiB, validated in bounded chunks, and expire after 24 hours.
- `bb modal image build --project X --recipe R --revision N --context C --key K --json`
  starts a durable build. Identical inputs reuse a build. Keys cannot change
  payload. Builds are explicit and serialized per Modal account.
- `bb modal image logs B --follow --cursor 0 --json` streams JSON event pages.
  Retention is 10 MiB; truncation is explicit and cursors remain monotonic.
- `bb modal image status B --json`; `image cancel B --json`. Cancelling a running
  build requests cancellation; it does not claim Modal terminated it. Stopping
  log following never cancels a shared build.
- `bb modal image list --project X --json`; `image gc --dry-run --json` previews
  candidates. `image gc --apply --json` marks unused images; after a one-minute
  grace, run it again to delete. Project pointers, verification and machine
  references prevent deletion. Recovery snapshots are excluded.
- `bb modal project configure --project X --expected-revision N --json-input
'{"resources":{"cpuCores":1,"memoryMiB":4096},"policy":{"idleMinutes":15,"lifetimeMinutes":1440,"retentionDays":30}}' --json`.
- `bb modal project show --project X --json` reports configuration and staleness.
  Inspect again to refresh lockfile evidence. Staleness never starts a build.

The versioned base includes Node 22.19.0, Debian bookworm, npm, build tools, bb,
Codex and Claude Code. Its credential-free provenance is in
`/opt/bb-project/base-manifest.json`; the exact server bb package SHA-256 and
daemon protocol version are in `/opt/bb-project/image-manifest.json`. Project Dockerfiles support RUN, COPY,
ENV, WORKDIR and ARG. FROM is supplied by bb. Other instructions, heredocs,
flags, symlinks, submodules and LFS contexts are rejected with actionable errors.
COPY supports literal regular-file paths; use JSON syntax for spaces.
Never include enrollment, server URLs, provider credentials or runtime secrets.

New machines accept `--machine-inputs '{"buildId":"B"}'` with an explicit ready
build for the project. They pin image/account/app/resources/policy in v4 state.
Use `bb modal image verify B --provider codex --key K --json` to start or inspect
a durable verification. It allocates a dedicated machine, runs a real agent smoke
turn and independently checks the stored smoke commands. Failed resources remain
inspectable. Successful verification suspends its machine. Use
`bb modal image use B --project X --provider codex --expected-revision N --json`
to promote only a successfully verified build for that agent. Promotion updates
the Modal image pointer and never changes project environment defaults.
New launches may omit buildId to select that pointer. Optional accountRef (default),
appName, resources and policy are validated and pinned at launch; appName must match
the build. Settings → Plugins → Modal sandbox exposes the same catalogue, build logs, verification, promotion, and per-project policy. The composer’s New machine section has a New sandbox row; existing machine sections show the name and state. Selecting an existing paused sandbox wakes it.

SDK callers import `modalRpcContract` from the plugin and call
`bb.sdk.plugins.callRpc({pluginId:"environment-modal-sandbox", method:"build.get",
input:{buildId}, outputSchema:modalRpcContract["build.get"].output})`.
The RPC method names are `catalogue.projects`, `account.inspect`, `project.sources/inspect/preflight`, `recipe.put/get/list`,
`context.prepare/upload/complete`, `build.start/events/get/cancel`, `image.list/gc`,
`verification.start/get/list`, and `project.configure/show/useImage`. Context upload tokens are scoped transport credentials
and never part of reusable image provenance.

Core runs `.bb-env-setup.sh` after materialising an owned environment and
`.bb-env-teardown.sh` before removing it, including fresh project clones on new
machines. Setup failure blocks readiness. Teardown has a separate 15-minute
timeout; failure is reported without blocking removal. Attaching a user-maintained
local checkout runs neither hook. Readiness checks core's recorded hook outcome
for the checkout's commit and lockfile inputs; it resumes any outstanding recorded restore hook before checking readiness.

`.worktreeinclude` does not apply to a fresh clone on a new machine: there is no
source checkout on that host. Supply local files and secrets through core Machine
environment settings, and keep reusable images credential-free.

Clear the selected image before GC with `project configure --project X --expected-revision N --json-input CONFIG --json`, supplying the current resources and policy from `project show` and setting `usableBuildId` to null. This clears availability for future launches; existing machines and their references remain pinned.

Inspect preservation and retention with `bb machine lifecycle MACHINE --json`.
Defaults are 15-minute idle pause, 24-hour lifetime and 30 days after the last
thread before warned automatic removal. `--keep` prevents automatic removal;
`--no-keep` restores it. Deadline maintenance interrupts active turns and closes
terminals before saving a private no-expiry snapshot and stopping compute. Submit
a new continuation turn after restore; never replay an interrupted external side
effect automatically. Project policy edits take effect without plugin reload.

A failed snapshot retains compute and reports the last successful save. Planned
rotation does not cover a server outage spanning Modal expiry. Lost-since-last-snapshot
blocks dispatch; explain the loss risk before explicitly requesting `bb machine resume`
to recover the last save. Missing snapshot images never become empty checkouts.

## Run the complete project setup

1. Resolve project X with `bb project list --json`, then run `bb modal account inspect --json` and `bb modal project sources --project X --json`. Configure missing Modal secrets through plugin Settings and select a reachable local source. Do not echo credentials or put them in recipes.
2. Inspect that source with `bb modal project inspect --project X --environment E --json`. Read the package manifests, lockfiles and existing hooks. Write or update the repo’s `.bb-env-setup.sh` when missing. It must be idempotent: validate commit/lockfile/toolchain ABI inputs, install from the image’s warm cache only when needed, and start or restart project services. It runs after creation and after every filesystem restore; a restored filesystem does not preserve running processes. Hook failure blocks readiness. Commit the hook, or review its dirty overlay explicitly.
3. Read the stored recipe before editing. Save at its current expected revision, with explicit context include patterns and real smoke commands. Warm dependencies in the Dockerfile without runtime credentials; never enroll a daemon while building. On revision conflict, read and reconcile the latest text without overwriting another editor’s changes.
4. Review context paths and dirty contents, upload, and explicitly build with a unique request key. Follow logs to ready. Retry unchanged inputs to reuse the build; changed Dockerfile or lockfiles require a new explicit build. Unavailable source inspection means “not checked,” never “fresh.” A stale usable image remains selectable.
5. Verify using the agent intended for the thread, inspect verification until passed, then promote with the project’s latest expected revision. A failed smoke cannot be promoted. `bb modal project preflight --project X --provider codex --json` checks verification, account identity and vendor image availability without allocating compute.
6. In the project composer select **New sandbox** under **New machine**, review physical cores, memory and effective policy, then send a real task. Confirm the thread reaches idle and dependency setup used its warm-cache path. Start a second thread from that existing machine’s named section to share the sandbox. Idle pause preserves files; dispatch wakes the same machine and reruns setup to restart services.
7. Inspect lifecycle warnings and the last successful save. Keep a machine with `bb machine lifecycle MACHINE --keep --json`, or remove with `--remove --yes --json`. Archive test threads and remove verification machines too. Clear the project image pointer before GC, preview candidates, apply, wait the grace interval, apply again, and verify the owned Modal inventory is clean. Never delete unrelated account artifacts.

Settings keeps each project’s recipe draft isolated. Save before building; build logs are bounded and follow a monotonic cursor. Import/export moves only Dockerfile text. Verify/use can select a previously verified image as a rollback for future launches. Settings resource estimates use physical cores and GiB memory at linked Modal rates; build, network and agent costs are additional and snapshot storage cost is unknown. There is no invented cost ceiling or automatic build.
