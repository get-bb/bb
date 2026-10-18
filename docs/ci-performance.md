# CI performance

The main CI workflow keeps build, lint/typecheck, two server test shards, eight app test
shards, integration tests, three package test groups, plugin tests, three fork
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

Before the matrix starts, dependency changes run a full frozen install with
lifecycle scripts disabled. This catches missing lockfile snapshots as well as
outdated manifest entries; `--lockfile-only --frozen-lockfile` does not catch
missing snapshots. The check covers manifests, the lockfile, workspace and pnpm
configuration, and patches. PRs compare with the resolved comparison base; pushes
compare with the event's previous SHA. Manual runs and unavailable history always
validate. Source-only changes skip the extra install. The install has a
five-minute limit inside the planning job's ten-minute budget.

The plugin SDK version check in `version-lockstep.yml` checks out with
`filter: blob:none`, keeping commit history without historical file contents. PR
runs fetch two levels of history and point the base branch ref at the tested
merge's first parent; pushes fetch all branches and tags.

## Fork checks

The Plugin Fork Check runs in three shards. On pull requests it checks only
the forkable plugins a change touches; see
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

CI installs Node and the checksum-verified pnpm executable before restoring
caches. Turbo restores have a one-minute step budget. Linux and Windows skip
pnpm store archives; macOS restores pnpm separately with its own one-minute
budget. On Linux and Windows, extracting the full store archive could exhaust
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

The `plugins` group runs `bb-plugin-*`. All Linux groups run four concurrent
Turbo tasks and cap Vitest at two workers with `VITEST_MAX_WORKERS`, which
Turbo hashes for test tasks. Electron's runtime libraries and Xvfb are set up
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
composition, install filters, and concurrency rules. The thirteen shards are
sized so each test step takes about 100 seconds on a four-vCPU runner and
finishes with the slowest Linux job rather than after it. Windows setup takes
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

In the tarball smoke, Windows runs the npx entrypoint and SDK consumer installs
concurrently in separate directories; macOS and Linux run them sequentially.
Both settle before temporary files are removed, including on failure.

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
