# CI performance

The main CI workflow keeps build, lint/typecheck, two server test shards, eight app test
shards, integration tests, three package test groups, two plugin test groups, three fork
check shards, and package smokes independent. Node 24/26 compatibility smokes run on
main and manual runs. Windows runs the nine host packages, an app smoke, a desktop
smoke, and thirteen test shards that cover the remaining suites; see
[windows-ci.md](windows-ci.md).

## PR selection

`Select CI checks` runs before provisioning test runners. Main pushes and manual
runs retain the complete cross-platform matrix. PRs use the pinned Turbo query
against the checked-out merge commit and its first parent, after verifying that
its second parent matches the PR event's head SHA. GitHub can refresh the merge
ref after the event was queued; comparing that ref with the older event base
would incorrectly include intervening main changes. Missing or mismatched merge
history falls back to the event base. `scripts/ci-comparison-base.mjs` resolves
that base; dependency validation and fork selection use the same one. The planner in
`scripts/plan-ci.mjs` narrows the canonical matrices in `scripts/ci-test-shards.json`
to affected tests, including dependents and explicit task inputs. Build and
lint/typecheck run separately for the selected packages.

Frontend-only changes under app/web source or public files and the listed UI
packages retain affected Linux checks; their Windows matrix runs on main.
Frontend build configuration retains Windows checks. Changes to desktop,
packaged-app, SDK, template, or plugin-bundling code retain package smokes on
PRs. Provider changes retain the live provider listing check. App/web-only
changes skip standalone plugin fork checks; shared UI and plugin changes can
still select them through the task graph. Selected checks remain blocking.

PRs changing only `docs/ci-performance.md`, `docs/windows-ci.md`,
`docs/debugging-and-qa.md`, `docs/filing-issues.md`, or
`docs/cli-guide-and-skill.md` skip the build/test matrix. This is an explicit
allowlist: API documentation and lifecycle diagrams are consumed by tests, and
other documentation, mixed changes, main pushes, and manual runs retain normal
selection or full coverage. Planning guards still run.

Root configuration, CI changes, unknown paths, missing Git history, and invalid
query results fall back to the full matrix. The source NUL guard always runs.
An empty test matrix skips its runners before dependency installation. This
reduces routine PR work; broad changes and cold builds do not have a guaranteed
two-minute completion time.

Alongside the matrix, dependency changes run a full frozen install with
lifecycle scripts disabled. This catches missing lockfile snapshots as well as
outdated manifest entries; `--lockfile-only --frozen-lockfile` does not catch
missing snapshots. The check covers manifests, the lockfile, workspace and pnpm
configuration, and patches. PRs compare with the resolved comparison base; pushes
compare with the event's previous SHA. Manual runs and unavailable history always
validate. Source-only changes skip the extra install. The install has a
five-minute limit inside the separate validation job's ten-minute budget.

The plugin SDK version check in `version-lockstep.yml` checks out with
`filter: blob:none`, keeping commit history without historical file contents. PR
runs fetch two levels of history and point the base branch ref at the tested
merge's first parent; pushes fetch all branches and tags.

## Fork checks

The Plugin Fork Check runs in three shards. On pull requests it checks only
the forkable plugins a change touches. Within each shard, Pi and Tasks start
first because their longer checks otherwise extend the tail after shorter
forks finish. CI caps each fork's Vitest at two workers while retaining
four concurrent forks; see
[forkable-plugins.md](forkable-plugins.md) for selection and local commands.

Each selected fork resolves a fresh package lock with lifecycle scripts
disabled, then installs that exact graph with `npm ci`. Resolution and
installation failures report distinct stage names and are never treated as
source-test failures or silently passed. Fresh registry resolution is
deliberate, so upstream availability failures can still fail the check.

CI saves the packed SDK, each fork's manifest and available lockfile, and its
result stage as `plugin-fork-evidence-<shard>-<attempt>` for seven days. SDK
references are relative to the evidence root, and a resolution failure may
have no lockfile. Locally, `--keep` retains the full fork directory, where
`npm ci --legacy-peer-deps` reproduces the installation without fresh
resolution.

## Setup budgets

The pnpm executable cache is keyed by version, OS, architecture, and committed
checksums. Setup verifies restored bytes before reuse; a missing or corrupt
executable triggers a bounded download into a temporary file. Only a verified
complete download replaces the executable, and failed partial downloads are removed.

Bun setup similarly caches and verifies pinned release archives before extraction.
Downloads use direct GitHub release URLs with bounded retries, and the setup step
has a four-minute limit. Cache restore failures fall back to downloading. Archive
checksums come from official release metadata, with portable baseline builds on
x64 runners. These changes reduce exposure to bootstrap download stalls; they do
not establish a reduction in total successful CI time.

CI installs Node and the checksum-verified pnpm executable before restoring
caches. Turbo restores have a one-minute step budget. Linux and Windows skip
pnpm store archives; macOS restores pnpm separately with its own one-minute
budget. Windows can restore a dependency disk with a separate one-minute
budget; a miss or failed restore leaves the normal fresh install in place. On Linux and Windows, extracting the full store archive could exhaust
the shared restore budget before Turbo outputs were restored, and the fallback
then discarded both caches and forced a cold build. A failed pnpm restore
selects a fresh store without discarding healthy Turbo outputs. A failed Turbo
restore clears incomplete archives in the saved cache directory without
discarding the dependency store. Individual download segments also have a
one-minute limit. Bun downloads directly instead of waiting for its executable
cache.

Dependency installation has a five-minute step budget in CI. Individual package
fetches have a 30-second timeout with two retries and 1–5-second backoff. pnpm
handles transient fetch failures; the workflow does not retry the whole
install. The shared setup action used by other workflows reuses these tools and
fetch settings, but does not impose the CI workflow's outer step budgets.

On macOS, pnpm can restore the most recent store for the same OS and
architecture when a lockfile changes. The frozen install still resolves the
exact lockfile contents and verifies store integrity.

Turbo caches are pruned with `scripts/prune-turbo-cache.mjs` after restoration
and before successful jobs save them:

- Linux jobs keep at most 1,024 MB.
- Windows jobs and macOS package and Node compatibility smokes keep at most
  256 MB to bound transfer and storage costs.
- Windows test shards, Windows host packages, Linux lint/typecheck, and the
  package and Node compatibility smokes also drop every entry their own Turbo
  run summary does not name (`--keep-run-summaries`). A first restore after a
  lockfile change can fall back to another job's cache; without this filter
  those foreign entries filled the budget and were never evicted.

Windows installs retain `--ignore-scripts`, and every Windows job reuses
Windows-only Turbo results.

PR runs cancel superseded work. Main concurrency groups include the commit SHA,
so different main commits run concurrently and each successful job saves its
cache. Runner provisioning and fleet capacity remain external limits.

## Dependency install scopes

Jobs install only the dependency closures their selected work needs, with the
same frozen lockfile, test commands, and sharding:

- Linux and Windows app shards install the root tools, `@bb/app` and its
  transitive dependencies, and `@bb/db` with its dependencies so
  `ensure-native-modules` can prepare `better-sqlite3`.
- Windows server shards install the server, host daemon, app, and plugin
  closures; see [windows-ci.md](windows-ci.md#full-test-suite).
- Windows `plugins-2` installs root tools, the selected plugins' dependency
  closures, and app/database closures for generator and native prerequisites.
  It selects plugin names first, then expands positive closures so test
  exclusions cannot remove another package's dependencies.
- Demo-server-only Linux test jobs use a scoped install and omit Electron
  runtime setup.
- Test matrices carry whether their selected packages include `@bb/mobile`.
  Other broad test installs omit mobile unless it is tested, so full runs and
  mobile changes keep mobile coverage.
- Package smokes, Node compatibility smokes, and the Windows app and desktop
  packaging smokes omit `@bb/mobile`, which is outside the desktop and launcher
  dependency chain. Desktop and native dependencies and every Turbo build and
  smoke dependency still run.

Installs narrower than these are not used. Selecting only the tested packages
misses generator prerequisites such as app CSS for plugin generation and the
CLI and server generator dependencies that build and other-package suites need
outside their declared closures.

## Test balancing and timing artifacts

Server tests split by file into two Vitest shards and app tests into eight. App
shards keep app-only PR latency low and preserve cache reuse between PRs and
main. Shard selection uses the `BB_CI_TEST_SHARD` variable, which Turbo hashes
only for those test tasks, so one shard's result cannot satisfy another; see
[windows-ci.md](windows-ci.md#full-test-suite) for why it is not passed after
Turbo's `--`.

Package tests split by package, because some packages use Bun or Node test
runners that do not accept Vitest's shard arguments:

- `packages-host`: host daemon, CLI, agent runtime, provider parity, and database.
- `packages-build`: templates, bb-app, demo server, desktop, and plugin build.
- `packages-other`: every remaining non-plugin package outside app, server, and
  integration. Negative filters automatically include new packages.

The `plugins-1` group runs provider plugins, Tasks, Connect, and the thread list.
`plugins-2` uses negative filters to run every other plugin, including new ones.
All Linux groups run four concurrent
Turbo tasks. The two server shards and integration group use four Vitest workers each; other groups
cap Vitest at two workers with `VITEST_MAX_WORKERS`, which Turbo hashes for
test tasks. Electron's runtime libraries and Xvfb are set up
only when the selected tests include `@bb/desktop`. Electron setup queries
dpkg first and runs apt only for missing packages, then starts Electron to
verify the runtime.

Every test job uploads `.turbo/runs/*.json` as a `test-timings-<shard>-<attempt>`
artifact retained for seven days. Use execution durations and cache status to
compare cold jobs separately from warm jobs. Compare workflow attempts
separately: a rerun can reuse earlier successful jobs, making the span between
the earliest and latest job misleading, and later-starting jobs in a rerun are
not provisioning delays. Keep failed and canceled attempts out of
successful-run latency percentiles, but track their frequency separately.
Identical runners in the same run can differ widely, so compare several copies
of a job rather than one against one.

## Windows test shards

[windows-ci.md](windows-ci.md#full-test-suite) owns the Windows shard
composition, install filters, and concurrency rules. The thirteen shards distribute the app tests across four runners with four
Vitest workers each and keep process-heavy packages in separate groups. Windows setup takes
roughly twice as long as Linux, and test files run about half as fast.

Windows server and other-package shards build SDK declarations
(`@get-bb/plugin-sdk#build:types`) as a prerequisite. The shared declaration
emitter in `packages/plugin-sdk/scripts/shared-declaration-emit.mjs` resolves
TypeScript's forward-slash filenames and the workspace prefix to the same form
before selecting roots; a separator mismatch selects no roots and rebuilds the
compiler program repeatedly. Its test bounds source-file reads across several
entry points.

More shards mean more jobs waiting for a runner. Watch the Windows start delay
in the daily health report; fewer, longer shards are the remedy if it grows.
Concurrent cold shards still build shared prerequisites independently; matching
Turbo hashes help only when a compatible cache exists.

Approaches measured and not adopted:

- Eight-vCPU Windows runners. Test steps roughly halve, but the runners start
  and check out much later, so end-to-end time does not improve at twice the
  per-minute rate.
- More Vitest workers per package on Windows; this slowed app shards.
- More suites at once. Process-heavy suites, including the host daemon, Codex
  provider plugin, and integration suites, time out beside one another; see
  [windows-ci.md](windows-ci.md#windows-runner-rules).
- Running the tarball smoke and desktop packaging in one job; see
  [windows-ci.md](windows-ci.md#app-boot-smoke).

In the tarball smoke, Windows and Linux run the npx entrypoint and SDK consumer
installs concurrently in separate directories; macOS runs them sequentially.
Both settle before temporary files are removed, including on failure.

## Windows dependency-cache measurements

An October 24 investigation sampled six successful CI runs
([40061197725](https://github.com/get-bb/bb/actions/runs/40061197725),
[40056664872](https://github.com/get-bb/bb/actions/runs/40056664872),
[40055907009](https://github.com/get-bb/bb/actions/runs/40055907009),
[40061385407](https://github.com/get-bb/bb/actions/runs/40061385407),
[40061017932](https://github.com/get-bb/bb/actions/runs/40061017932), and
[40060416041](https://github.com/get-bb/bb/actions/runs/40060416041)). Windows
finished last in all six. Across their 75 Windows jobs, dependency installation
took a median 33 seconds and p90 64 seconds. Scheduling and runner startup,
measured from job creation to start, added a median 27 seconds and p90 44 seconds.
The 59 Windows test shards had a median test-step duration of 65 seconds; only
12 finished that step within three seconds. Installation matters on both warm
and cold runs, but is not the entire critical path.

[Archive benchmark 40065135842](https://github.com/get-bb/bb/actions/runs/40065135842)
compared three fresh four-vCPU Windows Server 2025 runners per strategy, with
the same source, Node 22.23.4, pnpm 9.15.0, lockfile, and app/database install
filters. Each installation was followed by the same forced, uncached app test
shard through Turbo. Dependency archives were saved immediately after an
installation with lifecycle scripts disabled, before any build or native-module
preparation. The archives came from the seed job in
[40064989311](https://github.com/get-bb/bb/actions/runs/40064989311); that run's
measurement jobs were discarded after a benchmark timer quoting error.

| Strategy                         | Restore seconds | Frozen-install seconds | Restore + install seconds | Verification                               |
| -------------------------------- | --------------- | ---------------------- | ------------------------- | ------------------------------------------ |
| Fresh install                    | 0, 0, 0         | 24, 32, 32             | 24, 32, 32                | All three app shards passed                |
| pnpm store archive               | 33, 24, 27      | 16, 10, 15             | 49, 34, 42                | All three app shards passed                |
| Installed `node_modules` archive | 40, 24, 25      | 3, 1, 2                | 43, 25, 27                | All three failed native-module preparation |

These are Actions step durations, excluding runner startup, checkout, tool
setup, and cache creation. The scoped pnpm archive was 282 MiB and took eight
seconds to save; the installed-dependency archive was 230 MiB and took nine
seconds to save. In one store restore, download took about one second and
extraction took another 23 seconds. The pnpm trace then found all 1,200 cached
packages within about one second but took another seven seconds to finish
importing them into the workspace.

Re-enabling the pnpm store archive would regress this sample: median restore
plus installation was 42 seconds against 32 seconds for fresh installation,
even before charging cache creation. Restoring installed dependencies made
`pnpm install --frozen-lockfile` succeed quickly, but the actual native-module
check failed with `EPERM` while accessing the restored `prebuild-install`
dependency. A successful install or cache-hit message alone does not establish
a usable dependency tree. Neither archive strategy was adopted.

[Disk benchmark 40065422778](https://github.com/get-bb/bb/actions/runs/40065422778)
then compared three fresh runners per strategy using the same app dependency
scope. An NTFS virtual disk held both pnpm's content-addressable store and its
virtual store. The runner restored one VHDX file and mounted it before running
the unchanged frozen install; workspace `node_modules` links were recreated
by pnpm. This avoids unpacking individual files and preserves the dependency
links inside the virtual store. The benchmark did not restore Turbo outputs.

| Strategy               | Restore seconds | Mount seconds | Frozen-install seconds | Detach seconds | Total dependency setup/cleanup seconds |
| ---------------------- | --------------- | ------------- | ---------------------- | -------------- | -------------------------------------- |
| Fresh install          | 0, 0, 0         | 0, 0, 0       | 22, 39, 25             | 0, 0, 0        | 22, 39, 25                             |
| Cached dependency disk | 5, 3, 3         | 3, 5, 3       | 3, 2, 1                | 2, 1, 2        | 13, 11, 9                              |

All six forced app shards passed, including native-module preparation. Median
dependency setup and cleanup fell from 25 to 11 seconds in this sample. This
is not a measured whole-workflow speedup: runner startup and the test steps
remain, and the disk needs a compatible prior installation. The 289 MiB disk
archive took three seconds to save after a three-second detach in the seed
job; consumers did not save it again. Unlike the package-file archive, its
extraction took about 1.3 seconds in one consumer.

[Broad-install benchmark 40065673929](https://github.com/get-bb/bb/actions/runs/40065673929)
used the normal non-mobile install scope (1,697 packages), with two fresh
runners per strategy. Each consumer ran the complete Windows `packages-build`
test group through Turbo with `--force --concurrency=2`: templates, bb-app,
demo server, desktop, and plugin build.

| Strategy               | Restore seconds | Mount seconds | Frozen-install seconds | Detach seconds | Total dependency setup/cleanup seconds |
| ---------------------- | --------------- | ------------- | ---------------------- | -------------- | -------------------------------------- |
| Fresh install          | 0, 0            | 0, 0          | 44, 30                 | 0, 0           | 44, 30                                 |
| Cached dependency disk | 6, 5            | 6, 6          | 2, 2                   | 1, 2           | 15, 15                                 |

All four consumers passed the uncached build-package tests. That step took
86 and 88 seconds for disk consumers and 175 and 88 seconds for controls;
the small sample and runner variability do not establish a test-execution
speedup. The 656 MiB image took seven seconds to save after a four-second
detach in the seed job. These setup measurements exclude that one-time cache
creation cost; a cache miss must still install dependencies and create the
image. They establish disk reuse as a candidate optimization, without
claiming that changing dependency setup fixes runner queues or uncached test
duration.

[Production-action validation](https://github.com/get-bb/bb/actions/runs/40067670163)
then restored the same non-mobile dependency image across all sixteen Windows
checks. All passed, including both packaging smokes. Restore/mount plus frozen
installation took a median 14 seconds, ranging from 10 to 25 seconds. The
other-package shard still fetched its additional mobile dependencies. This run
used the normal Turbo cache policy; the earlier controlled app and build-package
benchmarks forced test execution.

### Dependency image lifecycle

`.github/actions/windows-dependency-cache` restores a single NTFS VHDX file
containing both the pnpm content store and virtual store. Both live on `P:` so
pnpm can link package files without cross-volume copies. The checkout stays in
its normal location. Each consumer still runs its existing frozen install,
install filters, and lifecycle-script policy; pnpm reconstructs workspace
links and fetches any additional packages, including mobile dependencies when
that shard needs them. Cached test outputs remain separate in Turbo.

The independent `Warm Windows dependencies` job runs on main and manual CI
runs. On an exact miss it creates a fresh disk and installs the non-mobile
workspace with scripts disabled. It detaches the disk, verifies that it is no
longer attached, then saves it before running any builds or native-module
preparation. Consumers never save their mutated copies. The warmer is optional
and no test job waits for it; the first run after dependency changes uses normal
installs, and subsequent runs can reuse the image.

Keys include the lockfile, workspace manifests and pnpm configuration, patches,
the install and disk setup implementation, the declared pnpm version, actual
Node version and architecture, Windows release and runner image version when
available, and workspace/temp paths. There are no partial-key restores. A
missing image, restore failure, invalid disk, missing store directories, or
occupied `P:` leaves pnpm on its ordinary filesystem. The existing install
remains responsible for validating dependencies. Mounted consumer images are
discarded with their ephemeral runners.

The small `diskpart` wrapper is necessary on the current Blacksmith image:
[the maintained Dev Drive action failed](https://github.com/get-bb/bb/actions/runs/40067279701/job/120793062708)
because `New-VHD` and `Dismount-VHD` are unavailable. A fresh ReFS disk using
`diskpart` was also measured in
[40067454032](https://github.com/get-bb/bb/actions/runs/40067454032): disk creation
plus install took 28 and 31 seconds, compared with fresh NTFS installs of 28
and 30 seconds. That sample gives no reason to add a fresh drive to every cold
install; the measured benefit comes from reusing installed dependency files.

### Comparison with other projects

The October 24 source review found established caching and filesystem tools,
but different Windows coverage and no universal fast-install configuration:

- **T3 Code** has no Windows jobs in its normal CI. Its
  [Windows test workflow](https://github.com/pingdotgg/t3code/blob/b24e8ce2df0f09bf01883c6b0010f75497e212b3/.github/workflows/windows-tests.yml#L1-L61)
  is manual-only and uses an ordinary pnpm store archive. An observed
  [manual test job](https://github.com/pingdotgg/t3code/actions/runs/39196778958/job/117881161362)
  spent 67 seconds installing dependencies after a cache miss. Its Windows
  [release targets build on Linux](https://github.com/pingdotgg/t3code/blob/b24e8ce2df0f09bf01883c6b0010f75497e212b3/.github/workflows/release.yml#L681-L732)
  and only verify the packaged artifacts on Windows; platform-independent
  JavaScript is built once and shared. Its Linux setup also
  [records rejecting a store-only Sticky Disk](https://github.com/pingdotgg/t3code/blob/b24e8ce2df0f09bf01883c6b0010f75497e212b3/.github/actions/setup-ci-deps/action.yml#L51-L67)
  because cross-filesystem copies erased the fast mount's benefit.
- **Orca** deliberately
  [omits store restoration for measured Windows PR installs](https://github.com/stablyai/orca/blob/a75cdc828771891fb3554e866ebdb605e0bebdfa/.github/actions/install-node-dependencies/action.yml#L147-L196).
  It uses host-only architecture selection and excludes unused optional CLI
  binaries in its
  [dependency policy](https://github.com/stablyai/orca/blob/a75cdc828771891fb3554e866ebdb605e0bebdfa/pnpm-workspace.yaml#L39-L59).
  One successful [Windows PR job](https://github.com/stablyai/orca/actions/runs/40065723726/job/120788913442)
  installed 1,208 root packages in 13.7 seconds with pnpm 12.14.0 and Node
  24.22.1; the complete dependency action took 34 seconds and a separate
  mobile install took 22.3 seconds. Full unit shards run on Linux; Windows
  runs selected boundary and packaged-app checks. Native outputs are cached
  separately and probed before reuse. The observed time does not isolate the
  effects of pnpm version, architecture selection, runner, or dependency set.
- **VS Code** caches fully installed npm dependencies in a
  [custom 7-Zip archive](https://github.com/microsoft/vscode/blob/1184ad4d45794110deb6b897ea83b15aac44ed89/.github/workflows/node_modules_cache/cache.ps1#L18-L25),
  skips installation on exact hits, and
  [prewarms missing caches from main](https://github.com/microsoft/vscode/blob/1184ad4d45794110deb6b897ea83b15aac44ed89/.github/workflows/pr-node-modules.yml#L1-L43).
  In [PR run 40062837040](https://github.com/microsoft/vscode/actions/runs/40062837040),
  seven Windows jobs each spent 75–77 seconds restoring dependencies and then
  skipped installation. One 1,098 MiB archive took about 62 seconds just to
  extract. This is an established reuse design, not evidence that extraction
  is cheap. Its npm archive traversal is not a verified replacement for
  pnpm's linked layout.

For Windows filesystem setup, an existing implementation was evaluated first.
[`samypr100/setup-dev-drive`](https://github.com/samypr100/setup-dev-drive/tree/562171fe8df7401fdf582d766cd3b6ab80d5b1a0)
supports ReFS or NTFS, remounting cached VHDX files, and post-job cleanup.
[Oxc](https://github.com/oxc-project/oxc/blob/a22c9f2abc74cbc00a75cf3d7ad6adeeb2a22fc1/.github/workflows/ci.yml#L79-L134)
and [Rolldown](https://github.com/rolldown/rolldown/blob/c50bb60abb4adde786c3ca02e0eef1821897d93c/.github/workflows/reusable-native-build.yml#L24-L46)
use it for Windows ReFS Dev Drives; these workflows do not establish that they
cache the entire VHDX. Oxc explicitly copies the workspace before installing
because the copy operation does not preserve pnpm directory links.

Host-only dependency selection was also tested with BB's current pnpm: the
installs took 29 and 31 seconds versus 31 and 50 seconds in the controls, but
failed the desktop contract requiring both x64 and arm64 plugin-build packages.
CI retains both targets and the current pnpm version. A newer pnpm and
sharing platform-independent release JavaScript remain separate optimizations.
Copying T3 Code's or Orca's Linux-first test allocation would change coverage;
the dependency image preserves BB's existing blocking Windows matrix.

## Test runtime and parallelism measurements

A sample of 20 successful first-attempt PR runs on October 24, 2026 excluded
this investigation's cache-validation runs. Nineteen included Windows checks;
Windows finished last in 15. The median Windows tail beyond the final
non-Windows job was 34 seconds. Removing Windows entirely while holding all
other job timings fixed would have saved a median 17.7% of workflow time.
Linux plugin, fork, server, and packaging jobs also constrain completion.
These observations do not justify removing blocking Windows coverage.

The Pi scripted RPC fixture imports the real pinned runtime's `SessionManager`
directly instead of loading its entire public entry point and unrelated CLI/UI
and model dependencies for each child process. Real CLI relocation, public SDK
session persistence, settlement compatibility, and Bun coverage remain. The
Markdown streaming tests reuse independent whole-document reference renders
for identical normalized input within each fixture; every chunk still renders
and compares the incremental implementation.

Controlled runs on the same four-vCPU runner types measured:

| Change                                     | Control | Candidate | Evidence                                                             |
| ------------------------------------------ | ------- | --------- | -------------------------------------------------------------------- |
| Windows Pi fixture                         | 61, 62s | 34, 39s   | [40072329816](https://github.com/get-bb/bb/actions/runs/40072329816) |
| Linux Pi fixture                           | 56, 67s | 41, 38s   | Same run                                                             |
| Linux fork shard 1, prepared prerequisites | 84, 85s | 60, 72s   | [40072767336](https://github.com/get-bb/bb/actions/runs/40072767336) |
| Windows app, longest test step             | 90s     | 63s       | [40073326000](https://github.com/get-bb/bb/actions/runs/40073326000) |
| Linux plugin group, longest test step      | 131s    | 89s       | Same run                                                             |

The fork candidate combines the fixture change, starting Pi first within its
existing shard, and two Vitest workers per fork. One worker regressed the Pi
suite and was rejected. The app comparison combines faster Markdown references
with eight shards instead of four, and includes warm dependency-image restore
on both sides. Both layouts ran the same 6,303 test identities and statuses in
645 files. The first Linux split separated providers from other plugins; its
task union matched all 49 original plugin test tasks with no overlap.

Including queue, setup, and teardown, the app group completed 15 seconds earlier
and the Linux plugin group 39 seconds earlier in that run. These are group
measurements, not additive reductions in total CI latency. Eight app shards add
four Windows jobs; splitting plugins adds one Linux job. Runner cost and queue
pressure increase, and unrelated checks can become the critical path.

The extra four Windows app shards were subsequently rejected: their second
comparison saved 19 seconds but used 31% more app runner time. The retained
configuration keeps four Windows app shards and sets four Vitest workers per
runner. [Worker comparison](https://github.com/get-bb/bb/actions/runs/40074965277)
measured the slowest test step at 82 seconds with three workers, 73 seconds
with four workers, and 137 seconds with only two shards. One 16-vCPU runner
with twelve workers took 160 seconds for the full app suite, before charging
its slower setup. All completed layouts retained the full app test inventory.
More workers in one process pool did not replace distributed execution well.

Further targeted fixes keep the test cases and assertions while removing
avoidable waiting and setup:

- The Connect server-move integration test gates its simulated RPC transport
  before enabling the freeze. Previously an already-started account long poll
  delayed the freeze check by 25 seconds. Both real plugins and the real socket
  still run; the account long-poll deadline has its own test.
- Thread-cache tests keep sequential opening and the same settlement assertions
  while polling immediately-resolving mock queries every millisecond instead
  of waiting 50 milliseconds per thread.
- Three machine-enrollment tests advance timeout timers inside React `act`,
  exercising the same production polling loop without three wall-clock seconds.

Local measurements: Connect integration file 30.96 to 5.99 seconds (12 tests),
thread-query file 4.61 to 1.00 seconds (30 tests), and machine-enrollment file
3.34 to 0.28 seconds (8 tests). Cross-platform measurements are recorded in
[the wait-removal benchmark](https://github.com/get-bb/bb/actions/runs/40075320364).
These are suite measurements, not additive whole-CI savings.

That cross-platform run passed every control and candidate: 143 Connect tests,
410 Tasks tests, and 38 query/enrollment tests per job, with identical case
identities and statuses. Windows Connect steps fell from 36–37 to 12–14 seconds;
Linux Connect steps fell from 34 to 9–11 seconds. Windows query-file execution
fell from 4.66–4.69 to 1.31–1.47 seconds, and enrollment-file execution from
3.37 to 0.39–0.59 seconds. A concurrent experiment deferring Tasks DOM setup
showed no consistent Windows benefit and was not retained.

One app shard with eight workers on a four-vCPU runner took 353 seconds and
failed a retry-button assertion. Increasing concurrency did not fix the
workload; the four-shard, four-worker layout completed with 6,302 passing cases and one
existing skip, matching the other layouts' inventory. No timeouts were increased to make the
oversubscribed configuration pass.

A subsequent full run exposed two timing failures in unchanged tests. The
account API malformed/null-response test now advances a fake clock through its
unchanged 300ms deadline with fixed retry jitter. A fake clock alone was not
sufficient: fixing the random value at 0.66 reproduced a retry landing exactly
on the deadline, changing the error classification. The response-handling test
uses a fixed random value of zero, as the neighboring retry test does. The
stale-answer test also advances fake timers through its unchanged 50ms request
deadline and background refresh windows, retaining expiration, retry suppression,
and recovery assertions without depending on real Windows scheduling. The existing
1,005-supporting-file skill test exposed unnecessary scanner work: recursive
skill traversal resolved and statted ordinary files it could never consume.
The scanner now skips those known regular files after handling `SKILL.md`,
while preserving directory, symlink, boundary, and command traversal. A direct
before/after profile produced identical results and reduced supporting-file
metadata calls from 2,010 to zero; the fixture and its timeout are unchanged.
The bundled provider-bridge runtime changed, requiring SDK patch 0.6.80.

[Windows timing-fix comparison](https://github.com/get-bb/bb/actions/runs/40076120786)
passed both control and candidate replicas, retaining the complete skill-index
and Connect Next suites. The full-run failures demonstrate timing sensitivity;
the controlled baselines passed, so they are not claimed as deterministic
baseline correctness failures.

[Oxc](https://github.com/oxc-project/oxc/blob/a22c9f2abc74cbc00a75cf3d7ad6adeeb2a22fc1/.github/workflows/ci.yml#L77-L134)
overlaps dependency installation with Rust compilation and copies its Windows
workspace onto a Dev Drive. [Rolldown](https://github.com/rolldown/rolldown/blob/c50bb60abb4adde786c3ca02e0eef1821897d93c/.github/workflows/ci.yml#L127-L181)
shares native-build artifacts across consumers. Both also limit ordinary PR
Windows coverage, which this change does not adopt. Their useful general
lesson here is to overlap independent work and avoid repeated expensive setup;
artifact transfer and extra runner startup must be charged to the result.

## Cache maintenance

`CI Cache Maintenance` reports GitHub-visible storage by family and runs daily.
It deletes only recognized pnpm store caches:

- On the default branch, preserve the current lockfile and the two newest
  entries per OS/architecture. Older entries must be at least three days old
  and unused for three days to be eligible.
- On closed pull requests, entries must be at least one day old and unused
  for one day. Open PR caches and other branches are preserved.
- Turbo caches and unrecognized keys are reported but never deleted by this
  workflow. Blacksmith-managed storage may differ from GitHub's inventory.

Manual dispatch defaults to a dry run. Locally, set `GITHUB_REPOSITORY`,
`GITHUB_DEFAULT_BRANCH`, and `GITHUB_TOKEN`, then run
`node scripts/cleanup-actions-caches.mjs`. Add `--apply` to delete the reported
entries. Run from the repository root at the default branch's current commit.
The script finishes paginating and validating inventory and PR states before
issuing any deletion. API requests time out after ten seconds; the maintenance
job has a five-minute budget and is independent of PR checks.

## Linux cache isolation

Linux omits the pnpm store archive so a slow dependency restore cannot exhaust
the shared cache budget and discard Turbo outputs; macOS dependency restores
are independent from Turbo. Build and lint/typecheck use separate runners to
avoid competing for the same four CPUs during cold runs, and their package
filters are separate, so build-only prerequisites do not cause unrelated
lint/typecheck tasks to run.

## App test prerequisites

The app's development dependencies declare the bundled plugins imported by its
tests and stories. This makes scoped installs link each plugin's dependencies
and makes plugin changes invalidate the app's dependent tasks. Without these
declarations, fresh app shards fail to resolve React and Plugin SDK imports
from plugin sources, and cached test results can mask the missing links.

## Daily health report

The `CI Health` workflow reports the previous 24 hours each day at 07:19 UTC,
with a manual dispatch option. It needs only checkout, Node, and read access to
Actions. `scripts/report-ci-health.mjs` also runs locally with `GITHUB_TOKEN` and
`GITHUB_REPOSITORY` set. It writes `.ci-health/report.md`, `report.json`, and the
normalized run/job evidence in `runs.json`; Actions retains these for 30 days.

The summary separates workflow outcomes from successful first-attempt latency,
job durations, runner-minutes, cache-restore duration, and the jobs that finish
last. Latency ends at the last job's completion, not the run's mutable update
timestamp. The report splits latency by trigger and measures dependent-job start
delay from planning completion; this includes both Actions scheduling and runner
provisioning.

First-attempt job outcomes are separate from final rerun outcomes. Cancelled and
unavailable attempts are not passes. Failure and recovery counts are grouped by
job and step, and failed steps count distinct affected runs so one bad lockfile
does not become dozens of incidents. Same-commit failed-job recoveries are
reported separately from reruns that remain red. Failure groups are locations,
not inferred root causes: recoveries include registry and runner failures, and
neither a recovery nor a failed workflow alone establishes a test flake.
`report.json` retains every successful step's timing distribution; the Markdown
shows steps with a p90 of at least five seconds.

The API collector includes every job attempt and paginates jobs. Transient read
failures, including timeouts, disconnects, rate limits with retry hints, and
retryable HTTP errors, get at most three attempts with bounded backoff. Permanent
errors and mutations are not retried. Every inventory page and completed batch
of six runs checkpoints the evidence and rendered report. Incomplete collections
are prominently marked, exclude partially fetched runs from timings and recovery
counts, and fail the reporting step while still uploading diagnostics.

Compare several daily artifacts, separating changes in selected work from runtime
gains. Cache transfer time is not a cache hit rate; inspect Turbo summaries or
logs for task cache hits.

## Avoiding repeated setup

The build job builds and checks the plugin SDK's published version before the
remaining build tasks. Those later tasks reuse its Turbo outputs. A version
mismatch therefore fails earlier without relaxing the published-content guard.

The AppImage FUSE installer (`.github/actions/install-appimage-fuse`) skips an
already-installed runtime and otherwise uses isolated apt indexes without
rewriting the runner's global apt configuration. It requires a successful index
refresh and tries Ubuntu's archive and then the kernel.org mirror on
amd64/i386, or Ubuntu Ports on other architectures. Index and download failures
move to the next mirror; exhausting them is a blocking failure. Desktop and
release packaging use the same installer.

The boot smoke waits for the host daemon to connect after the server and plugins
are ready; these are independent startup milestones. It clears its shutdown
timeout when the process exits so the timer does not keep the smoke process
alive after cleanup.

## Per-file test setup

Server tests that need a database copy a migrated template instead of running
every migration. `@bb/db/testing` builds the template once per run in the
server's Vitest `globalSetup`, and `createMigratedConnection()` copies it. A
server test rejects new `createConnection(":memory:")` setups. Only the template
build, on-disk databases, and migration tests run migrations directly.

In `apps/app`, most test files use jsdom and run isolated in a fresh fork. A
typical file's time is dominated by importing its own module graph and loading
jsdom itself, not by the tests. Two alternatives were rejected:

- `vmForks` reduced environment and import time but increased wall time and
  broke tests.
- Vite's dependency optimizer did not reduce imports and broke
  `importOriginal` mocks.

Merging small files removes only the per-file environment cost. Reusing jsdom
workers across files would remove it for every file, but reverses the rule that
DOM tests run isolated.

## React Compiler cache measurements

App-building jobs preserve `.git/bb-cache/react-compiler` independently of
Turbo task outputs. A changed app build can reuse content-addressed transforms
for unchanged modules. The compiler validates source, configuration, toolchain,
and environment identity and rebuilds corrupt entries. Cache restoration is
optional and bounded to one minute.

[Benchmark run 39842305719](https://github.com/get-bb/bb/actions/runs/39842305719)
used the same source, Node 22, pnpm 9.15, and four-vCPU runners for three
cold/warm pairs per platform, alternating order. Prerequisites were prepared
once; every timed app build ran through Turbo with `--only --force` to prevent
a task-output cache hit. Cold samples cleared compiler entries; warm samples
restored them through Actions cache. All output files matched byte-for-byte
within each platform: 1,751 on Linux and 1,752 on Windows.

| Platform | Cold build seconds | Warm build seconds | Restore seconds | Cache save seconds |
| -------- | ------------------ | ------------------ | --------------- | ------------------ |
| Linux    | 43.0, 36.0, 28.8   | 5.5, 5.6, 4.7      | 1, 1, 0         | 2                  |
| Windows  | 39.6, 35.1, 40.7   | 6.3, 6.8, 7.0      | 2, 1, 2         | 2                  |

Charging each warm sample the measured cache-save cost gives median paired
savings of 27 seconds on Linux and 29 seconds on Windows. These are app-rebuild
measurements on one runner per platform, not total CI savings. They represent
reuse of all compiler transforms; source or toolchain changes can reduce hits.
A first build has no reuse, and a full Turbo build-cache hit already avoids
compilation. Shard counts and selected coverage are unchanged by this fix.

## Dependency validation measurements

Frozen dependency validation runs as a separate `Validate dependencies` job
alongside the matrix when dependency inputs change or the comparison is
unavailable. Planning still determines affected checks, checks source integrity,
and runs the provider-literal ratchet. The install command, frozen-lockfile
requirement, and dependency-change detector are unchanged.

[Benchmark run 39844281314](https://github.com/get-bb/bb/actions/runs/39844281314)
ran three copies of each arrangement against identical source on four-vCPU
Linux runners:

| Replica | Serial planning and validation | Parallel planning | Earlier release |
| ------- | ------------------------------ | ----------------- | --------------- |
| 1       | 39s                            | 13s               | 26s             |
| 2       | 35s                            | 12s               | 23s             |
| 3       | 40s                            | 13s               | 27s             |

Every frozen install passed, including the three separate validation jobs
(34–46 seconds each, including their setup). Median planning time fell from
39 seconds to 13 seconds. These durations start when the job starts; they
exclude runner queue time and do not establish an equal end-to-end CI saving.
The separate job adds runner setup and can itself gate completion. Runs that
already skip dependency validation do not gain this time.

## Rejected resolver filter experiment

[Benchmark run 39843306967](https://github.com/get-bb/bb/actions/runs/39843306967)
compared six alternating before/after pairs per platform with both compiler
cache namespaces warmed and every app build forced through Turbo. All output
files matched. Median paired improvement was only 0.17 seconds on Linux and
0.43 seconds on Windows; two of six pairs on each platform regressed. The
native resolver filter was not retained because the measured benefit was too
small and variable.

## Rejected declaration-bundler cache experiment

[Benchmark run 39845431047](https://github.com/get-bb/bb/actions/runs/39845431047)
tried passing Rollup's module cache between the SDK's declaration bundles. Four
Linux before/after pairs saved a median 4.4 seconds, with one regression. The
first two Windows pairs both regressed by about eight seconds (48 to 56 seconds
and 52 to 60 seconds, rounded from Actions step timings). The remaining Windows
rounds were canceled after those regressions, and the candidate was discarded.
Every completed pair produced identical declarations; all 396 SDK tests also
passed locally. Correctness alone did not justify retaining this optimization.

## Verification of retained changes

[Full CI run 39844633490](https://github.com/get-bb/bb/actions/runs/39844633490)
passed all 45 jobs with compiler caching and parallel validation retained, and
no shard or coverage changes. Workflow creation to last completion was six
minutes. This is an integration result, not a controlled end-to-end speedup
measurement, and the three-minute target remains unmet.

## Reusing replay results and Git fixtures

The provider-parity self-suite runs 48 recorded scenarios through real provider
bridges. Separate conformance files previously repeated 22 of those scenarios:
eight Claude, eight Codex, and six Pi. The self-suite now applies the independent
recorded conformance checks to those existing results before comparing event and
timeline parity. It retains response, schema, grammar, turn-lifecycle, nonempty
output, and provider-cell inventory assertions. This removes 22 subprocess
launches and 77 repeated request-drain gates without changing bridge startup
throttling or coverage.

[Comparison 40104010818](https://github.com/get-bb/bb/actions/runs/40104010818)
and [repeat 40104177343](https://github.com/get-bb/bb/actions/runs/40104177343)
each ran two baseline and candidate replicas on four-vCPU Linux and Windows
runners. All jobs passed. Windows parity test steps took 31–33 seconds before
and 25–31 seconds after (medians 32 and 26 seconds); Linux took 25–26 seconds
before and 21–22 after. Both versions retain 59 test cases, with the three
aggregate conformance cases replaced by their inventory assertions and the
replay assertions moved into the existing cases. Independent mutation checks
confirmed that all five conformance failures still fail the retained Pi replay;
dropped replies also fail the retained Claude and Codex cases.

The update-resolver tests build one real repository with eight commits and both
annotated and lightweight tags, then copy the entire repository and commit map
for each test. Tests still mutate independent refs and objects. This removes
210 repeated Git setup processes across seven cases. In the second comparison,
the unchanged 15-test file took 4.00–4.02 seconds on Windows before and
1.76–3.32 seconds after, including the shared setup. Linux took 0.79–0.94 seconds
before and 0.41–0.55 after. Local shuffled-order verification also passed.

The same runs tested reuse of the SDK declaration emitter's discovery program.
All 20 declaration outputs remained byte-identical across baseline and candidate
on both operating systems, but timing gains were inconsistent: Windows builds
took 19–20 seconds before and 16–29 after; Linux took 15–17 before and 14–19 after.
That compiler change was not retained. Package-group timings include compiler
prerequisites, so test-file savings are not whole-job or workflow savings.

## Linux server worker allocation

[Comparison 40104954325](https://github.com/get-bb/bb/actions/runs/40104954325)
ran both existing server shards with two and four Vitest workers on four-vCPU
Linux runners, twice per arrangement. The measured step includes SDK prerequisites:
Turbo hashes the JSON reporter arguments into prerequisite tasks too, so the
preparation step did not make those cache hits. Four workers passed all four jobs:

| Shard    | Two workers            | Four workers |
| -------- | ---------------------- | ------------ |
| Server 1 | 85, 95s                | 63, 70s      |
| Server 2 | 88s failed, 99s passed | 81, 72s      |

The server test task itself, excluding prerequisites, took 66–79 seconds in the
passing two-worker runs and 46–60 seconds with four workers.

The failed baseline hit the unchanged bundled-dependency rebuild assertion in
`plugin-host-build-policy.test.ts`; its timing is not a successful baseline.
Both arrangements discovered the same 3,681 cases across the two shards
(3,680 passing plus one existing skipped case in the passing runs). Test names
containing a generated `sendAt` timestamp were normalized for inventory comparison.
The server shards use four workers; the integration group also uses four after
the fixture measurements below. Other Linux groups retain two workers per
package, because several Turbo tasks may run concurrently. No shards, runners,
coverage, or timeouts were added.

## Integration fixture setup

Integration harnesses copy a fresh SQLite database from one template built by
the real migrations, then initialize the personal project separately. The scripted
echo provider bundle is built once per worker. Each harness still creates its own
database, registry, server, daemon, provider processes, and sessions.

[Repeated Linux and Windows measurements](https://github.com/get-bb/bb/actions/runs/40137507494)
passed all 77 tests in all 12 jobs on four-vCPU runners with empty Turbo caches.
On Linux, integration task time fell from 39.2–46.5 seconds to 33.1–34.4 seconds
with fixture reuse, then to 24.8–27.1 seconds with four workers. Windows keeps its
default worker count: fixture reuse took 41.6–42.9 seconds, while four workers
took 54.2–68.1 seconds. The Windows baseline varied from 42.5–65.7 seconds, so these
runs do not establish a precise Windows percentage gain. Shard counts and test
inventories remain unchanged.

## Windows package-smoke download reuse

The Windows app smoke uses a dedicated npm download cache for `_cacache` and
`_prebuilds`. It never restores `_npx`, `node_modules`, consumer directories, or
lockfiles. The real npm and npx installations, native lifecycle scripts, registry
metadata checks, and all package assertions still run. Turbo passes the cache
location only to `smoke:tarball`; it remains an uncached task.

Snapshots use an exact key for OS, architecture, actual Node version, the app
manifest, workspace lockfile, and cache-action implementation. There are no
fallback keys: each new dependency identity starts a fresh snapshot rather than
accumulating old local app tarballs across saved versions. A matching snapshot
is immutable; downloads added by that job are not saved over it. Restore has a
one-minute budget and failure falls back to normal npm fetching. npm verifies
cached data when reading it; see [npm cache documentation](https://docs.npmjs.com/cli/cache/).

[Windows comparison 40106037278](https://github.com/get-bb/bb/actions/runs/40106037278)
ran cold, archived-download, and cold-again smokes on each of two runners,
clearing installed npx trees before reuse. Both runners passed every smoke:

| Runner | Cold  | Restored downloads | Cold again |
| ------ | ----- | ------------------ | ---------- |
| 1      | 50.9s | 37.3s              | 43.0s      |
| 2      | 74.3s | 43.9s              | 60.6s      |

Local archive creation took 1–3 seconds and extraction 0–1 second. These timings
do not include GitHub cache transfer. The separately measured Linux benefit was
only a few seconds, so this change scopes the cache to the Windows app smoke.

## Pi timeout tests and fork scheduling

Pi's child-shutdown and hung-model-refresh tests retain real child processes,
RPC acknowledgements, model results, and process-exit assertions. Once the real
child reaches the exercised state, the tests advance only the parent timeout
clock through the eight-second shutdown escalation or five-second refresh
limit. The child keeps its real clock. Polls for actual I/O retain explicit
real-time budgets, and the tests restore the parent clock before teardown.
The version-probe test still waits its full 15 seconds because Node's internal
`execFile` timeout is outside the parent fake timer boundary.

Tasks now starts early within its existing fork shard, alongside the existing
Pi priority. All three shard memberships, four concurrent fork checks, and two
Vitest workers per fork stay the same. In two Linux repetitions of the full
standalone fork check, shard 2 took 86.47/95.05 seconds before and 69.74/83.11
seconds after (means 90.76 to 76.43 seconds, 16%). These measurements include
fresh dependency resolution, install, typecheck, tests, and build after preparing
the SDK and CLI. See [the scheduling experiment](https://github.com/get-bb/bb/actions/runs/40139306094).
Giving Codex early priority instead regressed shard 3 from 59.49/64.15 seconds
to 80.59/82.45 seconds, so that change was discarded. These are fork-command
measurements, not end-to-end CI gains.

A local full Pi run retained all 319 passing tests and seven existing skips.
Reported suite time fell from 31.05 to 24.40 seconds; the shutdown case fell
from 8.13 to 0.22 seconds and the hanging refresh from 5.21 to 0.26 seconds.

## Linux packaging critical path

Linux runs the bb-app tarball smoke and AppImage packaging in one Turbo graph.
Their shared build prerequisites complete once, then the two checks can overlap.
`--continue=dependencies-successful` lets an independent successful branch finish
when the other fails, while still failing CI and blocking tasks with failed
prerequisites. The AppImage mount lifecycle check still runs after packaging.

The tarball smoke copies the Linux package into its temporary directory before
inserting a stale CLI chunk and invoking real `npm pack`. This preserves the
prepack pruning regression check without modifying the shared build output
while Electron reads it. Only root `node_modules` and `.turbo` are excluded;
nested vendored dependencies remain in the fixture.

Within the Linux tarball smoke, the npx and SDK installs run together, followed
by the existing installed-package checks. Repacking finishes before runtime
checks start because its prepack hook prunes the installed tree. Full-stack and
daemon-join checks then run together with separate data directories, reserved
ports, and child environments. Both parallel groups settle, including process
cleanup, before the temporary directory is removed. macOS scheduling is
unchanged; Windows retains its existing parallel installs.

## Windows plugin setup and private Git fixtures

Windows `plugins-2` installs the root tools, selected plugin dependency closures,
and app/database prerequisites. Selecting package names before expanding their
closures preserves dependencies even when their own tests belong to another
shard. At the measured lockfile this reduces Windows dependency snapshots from
1,708 to 1,309, without changing the frozen lockfile or cache rules.

[Cold-install comparison 40410136756](https://github.com/get-bb/bb/actions/runs/40410136756)
used two four-vCPU Windows runners, each with four alternating baseline/candidate
installs into fresh checkouts and stores. Selection-query time is included.
All eight installs passed; both candidate checkouts then passed the complete
plugin shard, including all 48 uncached Turbo tasks and prerequisites.
Mean install time fell from 46.10 to 39.14 seconds (15.1%). A separate clean local
comparison produced byte-identical contents for all 27 generated/runtime files.

Three Git test files prepare one real repository and copy it into each test's
private directory. The squash comparison fixture constructs its two divergent
commits with real `git fast-import`, preserving unique commit identities per
fixture. Tests still exercise real Git, independent working trees, and the same
assertions. Seven old/new fixture comparisons produced identical commit graphs,
subjects, and working-tree state with fixed Git dates, including Unicode paths,
embedded newlines, same-file divergence, and a large payload.

[Fixture comparison 40408582544](https://github.com/get-bb/bb/actions/runs/40408582544)
ran the complete plugin test step after common prerequisite preparation, forcing
all test tasks to execute. The two fixture-only runners each used four alternating
baseline/candidate trials; all eight passed with identical inventories of 2,493
passing tests and 69 existing skips. Mean time fell from 192.49 to 175.85 seconds
(8.6%), saving 16.63 seconds. The install and test measurements are separate stage
comparisons, not a measured end-to-end CI reduction.

The same experiment tried four concurrent packages with one Vitest worker each.
Its two runner comparisons disagreed, and one baseline hit the existing bounded
squash-check assertion. That worker change was discarded; package concurrency,
worker counts, shard counts, and selected tests remain unchanged. Increasing pnpm
network concurrency also failed to improve a separate eight-install comparison
and was discarded.
