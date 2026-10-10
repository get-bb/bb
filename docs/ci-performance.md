# CI performance

The main CI workflow keeps build, lint/typecheck, two server test shards, eight app test
shards, integration tests, three package test groups, plugin tests, three fork
check shards, and package
smokes independent. Node 24/26 compatibility smokes run on main and manual runs.
Windows runs the nine host packages, an app smoke, a desktop smoke, and
thirteen test shards that cover the remaining suites; see
[windows-ci.md](windows-ci.md).

## PR selection

`Select CI checks` runs before provisioning test runners. Main pushes and manual
runs retain the complete cross-platform matrix. PRs use the pinned Turbo query
against the checked-out merge commit and its first parent, after verifying that
its second parent matches the PR event's head SHA. GitHub can refresh the merge
ref after the event was queued; comparing that ref with the older event base
would incorrectly include intervening main changes. Missing or mismatched merge
history falls back to the event base. Dependency validation and fork selection
use the same comparison base. The planner in
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

Root configuration, CI changes, unknown paths, missing Git history, and invalid
query results fall back to the full matrix. The source NUL guard always runs.
An empty test matrix skips its runners before dependency installation. This
reduces routine PR work; broad changes and cold builds do not have a guaranteed
two-minute completion time.

Before the matrix starts, dependency changes run a full frozen install with
lifecycle scripts disabled. This catches missing lockfile snapshots as well as
outdated manifest entries; `--lockfile-only --frozen-lockfile` does not catch
missing snapshots. The check covers manifests, the lockfile, workspace and pnpm
configuration, and patches. PRs compare with their base SHA; pushes compare with
the event's previous SHA. Manual runs and unavailable history always validate.
Source-only changes skip the extra install. The install has a five-minute limit
inside the planning job's ten-minute budget.

## Fork checks

On pull requests, the fork checker compares the checked-out merge commit with
the comparison base resolved by the planning job. When every changed path belongs to a listed forkable
plugin, only those plugins run. Renames include both old and new paths. Any
shared, unknown, or unlisted-plugin change runs the complete list. Missing
history also runs the complete list. Main and manual runs always check all
plugins, including fresh resolution of published dependencies.

Use `node scripts/check-plugin-forks.mjs --changed-from=<sha> --list` to inspect
the selection without installing or building anything. Remove `--list` to run
it. Explicit plugin directories and `--changed-from` are mutually exclusive.

CI partitions the selected plugins over three runners using `--shard=1/3`,
`--shard=2/3`, and `--shard=3/3`. Each plugin runs exactly once. Selection happens
before partitioning, so small plugin-only changes leave unused shards empty;
those shards skip setup. Each runner retains at most four concurrent plugin
checks. `--list` reports the same shard selection used for execution.

## Setup budgets

CI installs Node and the checksum-verified pnpm executable before restoring
caches. Turbo restores have a one-minute step budget. Linux and Windows skip
pnpm store archives; macOS restores pnpm separately with its own one-minute
budget. A failed pnpm restore selects a fresh store without discarding healthy
Turbo outputs. A failed Turbo restore clears incomplete archives in the saved
cache directory without discarding the dependency store. Individual download
segments also have a one-minute limit. Bun downloads directly instead
of waiting for its executable cache.

Dependency installation has a five-minute step budget in CI. Individual package
fetches have a 30-second timeout with two retries and 1–5-second backoff. pnpm
handles transient fetch failures; the workflow does not repeat the entire
install, including lifecycle scripts, three times. The shared setup action used
by other workflows reuses these tools and fetch settings, but does not impose
the CI workflow's outer step budgets.

On macOS, pnpm can restore the most recent store for the same OS and architecture when a
lockfile changes. The frozen install still resolves the exact lockfile contents
and verifies store integrity. Turbo caches are pruned after restoration and
before successful CI jobs save them. Windows skips the pnpm store archive and
restores Turbo outputs for foundation checks, smokes, and test shards, capped at
256 MB per job to bound transfer and storage costs. The Windows test shards
also drop every entry their own Turbo run summary does not name before saving
(`prune-turbo-cache.mjs --keep-run-summaries`). Windows installs retain
`--ignore-scripts`; foundation checks reuse Windows-only cached results. macOS smoke jobs retain at most 256 MB of Turbo outputs, limited to hashes
referenced by the current run summaries.

PR runs cancel superseded work. Main concurrency groups include the commit SHA,
so different main commits can run concurrently and each successful job saves its
cache. The old shared main group delayed job creation by up to three minutes in
the October 1 sample. Runner provisioning and fleet capacity remain external
limits; removing workflow serialization does not guarantee immediate starts.

### October 6 Windows cache timeouts

In [run 37536497937](https://github.com/get-bb/bb/actions/runs/37536497937), all
sixteen Windows jobs exhausted the 60-second cache restore budget. The app
smoke downloaded an 831 MB pnpm archive in about 15 seconds, then timed out
extracting it. Turbo restoration never started. The install fallback redirected
both caches into temporary directories, so the job rebuilt all 56 tasks and
the cache action could not save those new Turbo outputs. The pnpm post step
also spent 16 seconds attempting to archive the abandoned store.

Windows now skips pnpm archive restoration and saving. This leaves the cache
budget available for the bounded Turbo archive and avoids the forced cold
build on every run. Frozen dependency installation and every test and smoke
check remain enabled. Linux and macOS retain pnpm caching. The baseline run
took 8m58s overall; measure subsequent CI runs before claiming an end-to-end
speedup.

## Test balancing and measurement

Server tests split by file into two Vitest shards. Turbo hashes the shard
arguments, preventing one shard's result from satisfying the other.

Package tests split by package, because some packages use Bun or Node test
runners that do not accept Vitest's shard arguments:

- `packages-host`: host daemon, CLI, agent runtime, provider parity, and database.
- `packages-build`: templates, bb-app, demo server, desktop, and plugin build.
- `packages-other`: every remaining non-plugin package outside app, server, and
  integration. Negative filters automatically include new packages.

The `plugins` group runs `bb-plugin-*`. All groups retain four concurrent Turbo
tasks. Only `packages-build` needs Electron's runtime libraries and Xvfb.

The October 1 investigation sampled 35 completed runs. The 26 successful runs
without retries finished in a median 3m48s. Windows smoke finished last in 15 of
20 runs containing it, with median install/build/package steps of 53s/71s/38s.
Fork checking took a median 2m46s inside its main step; packages and server test
steps took about 2m16s and 2m07s. These are baseline measurements, not projected
improvements. After merge, compare cold and warm runs separately and check that
additional runners do not increase capacity waits or cache eviction.

The September 29, 2026 cold run [36597970177](https://github.com/get-bb/bb/actions/runs/36597970177)
spent five minutes in the original catch-all test step. Its logged Vitest
durations summed to approximately 392 seconds for plugin packages and 579
seconds for other packages. These are aggregate task durations, not predictions
of the new jobs' wall-clock time.

A local Linux arm64 benchmark pinned to four CPUs compared four concurrent
Turbo tasks across `bb-plugin-thread-list`, `bb-plugin-tasks`,
`bb-plugin-account-pool`, and `bb-plugin-provider-codex`. All six runs passed:

| Vitest workers per package | First run | Second run |
| -------------------------- | --------: | ---------: |
| Default                    |     24.5s |      24.9s |
| 2                          |     26.5s |      26.3s |
| 1                          |     41.6s |      41.0s |

The workflow keeps Vitest's defaults. This is a representative local comparison,
not a measurement of the new full workflow on Blacksmith. To repeat it, run
`pnpm exec turbo run test` with the four package filters above,
`--concurrency=4 --force --summarize`, and optionally `-- --maxWorkers=1` or
`-- --maxWorkers=2`.

Every test job uploads `.turbo/runs/*.json` as a `test-timings-<shard>-<attempt>`
artifact retained for seven days. Use execution durations and cache status to
compare cold jobs separately from warm jobs. Compare workflow attempts
separately: a rerun can reuse earlier successful jobs, making the span between
the earliest and latest job misleading. Keep failed and canceled attempts out
of successful-run latency percentiles, but track their frequency separately.

## October 5 declaration-generation investigation

A sample of the 20 most recent successful runs on each sampled day, excluding
reruns using the run API's `run_attempt`, showed these workflow durations:

| Date            | First-attempt runs |  Median |
| --------------- | -----------------: | ------: |
| October 1, 2026 |                 16 |   4m26s |
| October 4, 2026 |                 18 | 4m50.5s |
| October 5, 2026 |                 15 |   7m36s |

These are small time-window samples, not whole-day percentiles. The October 5
sample ends at run [37387186039](https://github.com/get-bb/bb/actions/runs/37387186039).
Full Windows test coverage was added on October 2 in PR #4776. Retain that
coverage when optimizing the now-longer critical path.

In first-attempt run [37386205651](https://github.com/get-bb/bb/actions/runs/37386205651),
the Windows server shards spent 179.3s and 149.8s in
`@get-bb/plugin-sdk#build:types`; the other-packages shard spent 170.5s there.
All three were cache misses. Server shard 1 then spent 124.0s running tests.

The shared declaration emitter compared TypeScript's forward-slash source
filenames against a Windows backslash workspace prefix. That selected no
workspace roots, causing repeated compiler-program construction as declaration
sources loaded. Normalize both paths before selecting roots and checking
program membership. The regression exercises real TypeScript emission and
bounds source-file reads across five entry points, including an equivalent
workspace path with a trailing separator. Before the fix that case read the
first entry six times; afterward it reads it twice. Existing coverage checks
inferred types, ambient declarations, and different compiler options.

The controlled Windows [benchmark run 37389733655](https://github.com/get-bb/bb/actions/runs/37389733655)
compared baseline and fixed emitters on the same Blacksmith four-vCPU Windows
Server 2025 runner, with Node 22.23.2, unchanged dependencies, and Turbo
`--force`. Each build started without the generated declaration directory.
The execution order was baseline, fixed, fixed, baseline:

| Emitter  | First task duration | Second task duration |     Mean |
| -------- | ------------------: | -------------------: | -------: |
| Baseline |            156.813s |             132.999s | 144.906s |
| Fixed    |             18.720s |              20.083s |  19.402s |

Declaration generation was 7.47 times faster (86.6% less task time). All four
runs were cache misses, and SHA-256 manifests for all 17 declaration bundles
matched exactly. The benchmark script and workflow are preserved in commit
`f6abf8ad78` on `bb/ci-windows-declaration-benchmark-thr_jis82m9hmh`; its artifact
contains per-round timings, output hashes, and Turbo execution summaries.

The regular [PR CI run 37389645615](https://github.com/get-bb/bb/actions/runs/37389645615)
passed all 26 active jobs. Its uncached Windows declaration tasks took 20.133s
(server-1), 25.816s (server-2), and 35.365s (packages-other). The full workflow
took seven minutes; the task speedup is not an equivalent whole-workflow
speedup because other test jobs remain on the critical path.

Infrastructure also contributes: run
[37381624894](https://github.com/get-bb/bb/actions/runs/37381624894) had a 118s
maximum job provisioning wait, and its Windows server-1 checkout spent 122s in
the shallow Git fetch. Later-starting jobs in multi-attempt runs must not be
counted as provisioning delays from the original workflow creation time.

## Windows test shards

After the declaration fix the Windows jobs still finished last. In
[PR run 37389645615](https://github.com/get-bb/bb/actions/runs/37389645615) the
seven Windows test shards took 243–417s and the app smoke 378s; the slowest
other job took 264s. The Windows runners have no Defender to exclude
(`Get-MpComputerStatus` reports an invalid class). Two costs are specific to
Windows:

- Setup takes 90–115s per job against about 50s on Linux. Unpacking the pnpm
  store (67,596 files) takes 23–28s against 7s, and `pnpm install` 21–72s
  against 10s.
- Test files run about half as fast. `@bb/app` spent 0.67s per file in
  environment setup and 0.61s in import, against 0.26s and 0.31s on Linux.

The same shard on two identical runners in one run took 181s and 128s, so
compare several copies of a job, never one against one.

The workflow now runs thirteen Windows test shards instead of seven, sized so
each test step takes about 100s on a four-vCPU runner, and splits the app smoke
into an app smoke and a desktop smoke. Test step durations:

| Shard            | Before: suites in the shard      |   Before | After (copies) |
| ---------------- | -------------------------------- | -------: | -------------- |
| `server-N`       | half of `@bb/server`             | 136–172s | 98–113s (3)    |
| `app-N`          | half of `@bb/app`                | 170–213s | 80–107s (4)    |
| `plugins-1`      | every plugin                     |     170s | 99–109s (4)    |
| `plugins-2`      |                                  |          | 69–88s (4)     |
| `packages-host`  | daemon, CLI, parity, integration |     237s | 81s (1)        |
| `integration`    |                                  |          | 65s (1)        |
| `packages-build` | every other package              |     172s | 87–107s (3)    |
| `packages-other` |                                  |          | 90–111s (6)    |

"Before" is run 37389645615. "After" is
[run 37397194886](https://github.com/get-bb/bb/actions/runs/37397194886), which
forced every suite to run; its 26 jobs all passed and took 159–238s each from
start to finish. The combined
app smoke took 251s and 310s with a forced build; split, the app smoke took
204–249s and the desktop smoke 198–239s over four copies each.

Each Windows test shard also carried 256 MB of another job's build outputs in
its Turbo cache. A shard's first restore after a lockfile change falls back to
any Windows job's cache, and a test shard's own entries are a few kilobytes of
logs, so the size budget never evicted the foreign entries. The shards now keep
only the entries their run summary names: one shard went from 131 entries and
255.8 MB to 3 entries and 0.1 MB.

Approaches measured and not adopted:

- Eight-vCPU Windows runners. Test steps roughly halved (71s against 128–181s
  for the same app shard), but those runners started 40–54s after the job was
  created, against 2s, and spent 27–42s in checkout, against 6–10s. End to end
  nothing was gained at twice the per-minute rate. Over seven runs the gap did
  not narrow.
- Two Vitest workers per package, as on Linux: 198s against 181s and 163s
  against 128s for one app shard.
- More suites at once. On eight vCPUs the plugin shard failed 2 of 3 runs at
  four suites and 1 of 4 at three, always in `bb-plugin-provider-codex`; the
  host suites failed 3 of 8 at two. The host daemon suite also failed 3 of 18
  runs on eight vCPUs with nothing beside it, where Vitest runs twice as many
  of its files at once.
- The October 5 install experiment excluded `@bb/mobile` and `@bb/desktop`
  and took 22–27s against 38–40s. Installing only `@bb/app` dependencies took
  17s but `ensure-native-modules` could not find `better-sqlite3`. The October 6
  scoped install below includes `@bb/db` to retain that native prerequisite.
- Running the tarball smoke and desktop packaging at the same time. The tarball
  smoke prunes and packs `packages/bb-app/dist` while packaging copies it.

The full [run 37398047481](https://github.com/get-bb/bb/actions/runs/37398047481)
passed all 37 jobs in 4m54s, against about seven minutes before. Its Windows
server, app, plugin, and `packages-build` shards ran uncached. Counted from
workflow creation, the slowest Windows job finished at 251s and the slowest job
overall, the macOS package smoke, at 291s.

A run now starts sixteen Windows jobs instead of nine, and more of them wait
for a runner. With nine, Windows jobs started within 2s in most sampled runs
and 13–46s late in others. In run 37398047481 all sixteen started 29–57s after
creation, and in the 26-job measurement run the median was 40s and one job
waited 246s. The shard durations above exclude that wait; the 251s figure
includes it. Watch the start delay after merge; fewer, longer shards are the
remedy if it grows.

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

## October 6 scoped Windows installs

The Windows and Linux app shards install the root tools, `@bb/app` and its transitive
dependencies, plus `@bb/db` and its dependencies for `ensure-native-modules`.
They retain the same test commands, sharding, and frozen lockfile. Other test
shards still install the full workspace.

In [benchmark run 37539104123](https://github.com/get-bb/bb/actions/runs/37539104123),
two scoped installs took 36s and 44s; two full installs took 66s and 72s on the
same four-vCPU Windows runner class. Each then ran the same uncached app shard.
This measures dependency setup, not an end-to-end two-minute CI guarantee.

Foundation lint, typecheck, and tests now reuse Windows-only Turbo results,
matching the other Windows jobs. Their saved cache is limited to 256 MB and
entries used by the current run.

## Linux cache isolation

In [run 37539619987](https://github.com/get-bb/bb/actions/runs/37539619987),
the Linux checks job restored a 1,188 MB pnpm archive but hit the shared cache
timeout before Turbo restoration completed. The fallback discarded both cache
locations; only 4 of 207 build/typecheck/lint tasks were reused and execution
took 161 seconds. Linux now omits that archive, while macOS dependency restores
are independent from Turbo. Build and lint/typecheck use separate runners to
avoid competing for the same four CPUs during cold runs.

## App test prerequisites and shard sizing

The app's development dependencies declare the bundled plugins imported by its
tests and stories. This makes scoped installs link each plugin's dependencies
and makes plugin changes invalidate the app's dependent tasks. Before this
fix, fresh Windows app shards failed to resolve React and Plugin SDK imports
from Navigation, BB Guide, and Pi; cached test results had masked the missing
links.

The app suite now contains roughly 585 files. In app-only experiment
[37542453877](https://github.com/get-bb/bb/actions/runs/37542453877), a 195-file
Linux shard took 132 seconds and the workflow passed in 3m24s. Linux now uses
eight shards with the existing two-worker limit. Build and static-check package
filters are separate, so build-only prerequisites no longer cause unrelated
lint/typecheck tasks to run.

Demo-server-only test jobs use a scoped install and omit Electron runtime setup.
Electron libraries and Xvfb run only when the selected tests include desktop.

## Daily health report

The `CI Health` workflow reports the previous 24 hours each day at 07:19 UTC,
with a manual dispatch option. It needs only checkout, Node, and read access to
Actions. `scripts/report-ci-health.mjs` also runs locally with `GITHUB_TOKEN` and
`GITHUB_REPOSITORY` set. It writes `.ci-health/report.md`, `report.json`, and the
normalized run/job evidence in `runs.json`; Actions retains these for 30 days.

The summary separates workflow outcomes from successful first-attempt latency,
job durations, runner-minutes, cache-restore duration, and the jobs that finish
last. Latency ends at the last job's completion, not the run's mutable update
timestamp. Failed steps count distinct affected runs so one bad lockfile does
not become dozens of incidents. Same-commit failed-job recoveries are reported
separately from reruns that remain red. Neither a recovery nor a failed workflow
alone establishes a test flake. Cache transfer time is not a cache hit rate.

The API collector includes every job attempt and paginates jobs. Transient read
failures, including timeouts, disconnects, rate limits with retry hints, and
retryable HTTP errors, get at most three attempts with bounded backoff. Permanent
errors and mutations are not retried. Every inventory page and completed batch
of six runs checkpoints the evidence and rendered report. Incomplete collections
are prominently marked, exclude partially fetched runs from timings and recovery
counts, and fail the reporting step while still uploading diagnostics. The report
splits latency by trigger and measures dependent-job start delay from planning
completion; this includes Actions scheduling and runner provisioning.

Compare several daily artifacts, separating changes in selected work from runtime
gains. Cache restore duration still does not establish task cache-hit rates; inspect
Turbo summaries or logs for those.

## Avoiding repeated setup

Windows app and desktop packaging installs omit `@bb/mobile`; their Turbo build
and smoke dependencies still run. In clean local macOS verification, the server
shard install used 1,445 packages versus 2,325 for a full install. Windows timings
must be measured separately after rollout.

Linux Electron setup queries dpkg before invoking apt. An installed library
satisfies the requirement without refreshing package indexes or upgrading Mesa
and Xvfb on every run. Missing packages still get an apt update and install, and
the job still starts Electron to verify the runtime.

The build job builds and checks the plugin SDK's published version before the
remaining build tasks. Those later tasks reuse its Turbo outputs. A version
mismatch therefore fails earlier without relaxing the published-content guard.

PRs changing only `docs/ci-performance.md`, `docs/windows-ci.md`,
`docs/debugging-and-qa.md`, `docs/filing-issues.md`, or
`docs/cli-guide-and-skill.md` skip the build/test matrix. This is an explicit
allowlist: API documentation and lifecycle diagrams are consumed by tests, and
other documentation, mixed changes, main pushes, and manual runs retain normal
selection or full coverage. Planning guards still run.

The boot smoke waits for the host daemon to connect after the server and plugins
are ready; these are independent startup milestones. It also clears its shutdown
timeout when the process exits, avoiding a 15-second timer that previously kept
the smoke process alive after cleanup.

## October 8 measured follow-up

The PR selection fix addresses an observed stale-base comparison in
[run 37763307104](https://github.com/get-bb/bb/actions/runs/37763307104): checkout
merged onto `5cd546507ed9cf7c721fb9c36cdd026ff336c82d`, while the event supplied
`32f63ea825a241149972c277dc226d754ab90850`. The regression fixture advances main
with an unrelated root configuration change, creates the refreshed merge, and
checks that only the PR's app checks remain selected. Replaying the actual
historical merge reduced the comparison from 259 paths to the three edited plugin
files, selecting two Linux and two Windows test shards instead of fifteen and
thirteen, and skipping unrelated package smokes, provider probing, and dependency
validation. Unknown paths and uncertain history retain conservative coverage.

[Runner experiment 37808851050](https://github.com/get-bb/bb/actions/runs/37808851050)
compared independent npm consumer installs in the tarball smoke. On Windows,
sequential consumer checks took 86.5 seconds for the complete smoke versus 53.9
seconds when the npx entrypoint and SDK consumer ran concurrently. Both jobs
reused 54 of 56 Turbo tasks; the outer smoke steps took 110 and 80 seconds.
The installs use separate directories. Both settle before temporary files are
removed, including on failure. macOS measured 24.7 seconds sequential versus
26.6 seconds concurrent, so it retains sequential consumer checks. These are
paired measurements, not a promised workflow-wide saving.

The same experiment restored an 81 MB macOS Turbo archive bounded to 256 MB,
reused 54 of 56 tasks, and finished its outer smoke step in 44 seconds versus
68 seconds without the archive. macOS package and Node compatibility jobs now
use that cap and retain only the current run's referenced hashes. Package and
compatibility smoke installs omit the mobile workspace, while retaining desktop
and native dependencies. Full cross-platform smokes remain enabled.

[Cold app experiment 37808270869](https://github.com/get-bb/bb/actions/runs/37808270869)
ran the complete Linux app suite with four and eight shards. Summed job runtime
was 496 versus 668 seconds, but the slowest cold test step increased from 81 to
112 seconds with four shards. The workflow retains eight to protect app-only PR
latency and preserve cache reuse between PRs and main.

Narrower Windows installs were also tested against cold suites. Selecting only
the tested packages missed app CSS needed by plugin generation. Adding the app
prerequisites restored host/plugin suites, but build and other-package suites
still required CLI and server generator dependencies outside their declared
closures. The passing host/plugin candidates did not demonstrate faster installs
in the paired run. These speculative install filters are not shipped; the
existing scoped app/server installs and broader remaining installs are retained.
Resolving the PR comparison base avoids paying these setup costs for unrelated
main changes without dropping coverage for changes actually in the PR.

The parent-notification tests wait for their persisted result after advancing the
batch timer. A controlled one-millisecond delay at the existing workspace RPC
responder made five prior assertions fail; all seven tests pass with the wait.
Settings dropdown tests drain deferred unmount cleanup before jsdom teardown.
The storage-retention wide-tree fixture retains twenty directories and two
hundred files, but creates and accounts for independent directories concurrently
instead of performing every filesystem operation serially. No timeout or
assertion was relaxed.

The SDK version check also hit its five-minute timeout twice while fetching all
branches and tags for PR #5220. PR runs now fetch two levels of history and point
the comparison ref at the tested merge's first parent. A fresh shallow fetch of
the actual PR merge verified that Git resolves that parent as the merge base and
that the existing SDK check runs successfully. The push-triggered full-history
checkout then hit the same timeout. SDK checkouts now use `filter: blob:none`
to retain commit history without historical file contents. A fresh fetch of all
branches and tags completed with a 23 MB pack, and the unchanged SDK check passed
against that full-history checkout.

## October 9 reliability and setup follow-up

The October 9 sample covers 299 CI runs created from 00:00 through 22:41
Pacific. Successful first-attempt PR runs had a median of 143.5 seconds and
p90 of 414 seconds; main pushes had a median of 318.5 seconds and p90 of
427 seconds. Windows finished last in 114 of 205 timed runs. These are
pre-change measurements, not projected savings.

Test matrices now carry whether their selected packages include `@bb/mobile`.
The catch-all shard retains mobile dependencies on full runs and affected
mobile PRs, but omits them on other PRs. Linux's other broad test installs also
omit mobile when it is not tested. Existing app/server install closures and
shared generator prerequisites remain intact. This does not restore Windows
pnpm archives or repeat the unsuccessful aggressive filtering experiment above.
Compare dependency-install timings on equivalent Windows jobs before claiming
a speedup; runner provisioning remains outside the workflow's control.

The FUSE installer no longer rewrites the runner's global apt configuration or
forces every download through one mirror. It skips an already-installed runtime,
uses isolated indexes, requires a successful index refresh, and tries Ubuntu's
archive followed by the kernel.org mirror on amd64/i386. Other architectures
use Ubuntu Ports. Both index and package-download failures trigger the next
mirror; exhaustion remains a blocking failure. The installer is also used by
desktop and release packaging.

Standalone fork checks resolve a fresh package lock with lifecycle scripts
disabled, then use `npm ci` to install that exact graph. Resolution and installation
failures have distinct stage names; neither is silently passed or treated as a
source-test failure. CI saves the packed SDK, each fork's manifest and available
lockfile, and its result stage in `plugin-fork-evidence-<shard>-<attempt>` for
seven days. SDK references are relative to the evidence root. A resolution
failure may have no lockfile. Local `--keep` retains the full fork directory,
where `npm ci --legacy-peer-deps` can reproduce its installation without fresh
resolution. Fresh resolution remains part of every selected fork check, so this
improves diagnosis and reproduction rather than hiding upstream availability
failures.

CI Health now separates first-attempt job outcomes from final rerun outcomes,
reports successful step timing distributions, and groups failure/recovery counts
by job and step. Cancelled and unavailable attempts are not passes. Failure groups
are locations, not inferred root causes; same-commit recovery includes registry
and runner failures, not just flaky tests. JSON retains all step timings; Markdown
shows steps with a p90 of at least five seconds. Scheduling delays still include
both Actions scheduling and runner provisioning.

Storage archive-test teardown waits for retained trash-removal work before
removing the parent fixture directory. Provider replay stalls now include event
counts, unanswered request IDs, child exit state, time since output, and the last
2,000 stderr characters. Timeout budgets and replay concurrency are unchanged;
the missing-event failure needs that evidence before changing them.

### Remaining-failure investigation and fresh-install measurement

[Install experiment 38033720968](https://github.com/get-bb/bb/actions/runs/38033720968)
compared three fresh four-vCPU Windows runners per configuration, with Node 22,
pnpm 9.15, the same lockfile, no restored dependency cache, and `--ignore-scripts`.
Only the `!@bb/mobile` filter differed. Full installs took 51.710, 50.393, and
52.105 seconds; excluding mobile took 33.760, 37.256, and 37.777 seconds. Means
were 51.403 and 36.264 seconds: 15.138 seconds (29.5%) saved during installation.
Medians were 51.710 and 37.256 seconds. This small sample measures eligible
broad installs, not app/server closures, scheduling, or end-to-end CI. Full runs
and mobile changes still install mobile where their selected tests need it.
The experiment workflow and raw install artifacts are retained on
`bb/ci-install-benchmark-5324`; its initial setup-only failed attempt is excluded.

The remaining October 9 failure groups were investigated against the failing
logs and current source, including historical feature branches:

| Finding                                                                                 | Evidence and disposition                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows activation checks report a stopped PID alive again                              | Two jobs show the transition. Fixtures now retain `ChildProcess` handles and synchronously check the original child, preserving termination-before-port-release assertions.                                                                                                                                                         |
| Idle Codex reaping reports no stopped process after restart                             | The assertion reopens historical numeric PIDs after starting a replacement. It now observes the runtime's existing completed-exit callback before and after restarting. Production shutdown still waits for child exit.                                                                                                             |
| Replay cursor can release notifications during a write                                  | A real subprocess reproduced the truncate/read race. Empty, malformed, and unreadable cursor contents now keep events gated; explicit `end` and absent-cursor unpaced replay retain their behavior. Regression fails before the fix and passes afterward.                                                                           |
| Historical ACP web-search misses 51 events; Codex exits before initialize               | These remain unexplained historical incidents. The cursor defect does not prove their cause. Full local parity passes; exit, stderr, request, and grammar diagnostics remain enabled for recurrence.                                                                                                                                |
| CI selection and plugin-rename fixture tests exceed five seconds                        | These execute many real Git/Node processes. Only the two observed failing integration cases receive a 30-second budget; fixture subprocesses are bounded. Assertions and ordinary test budgets remain unchanged.                                                                                                                    |
| Linux app worker exits after all 691 assertions pass                                    | Log reports an unexpected worker exit and teardown timeout, without exit code or signal. The named mobile-recents test passes locally; the current Linux shard passes three uncached repetitions (76 files/694 assertions each). No evidence establishes an assertion defect or OOM. No speculative worker-count or timeout change. |
| Linux Git fixture cleanup returns `ENOTEMPTY`                                           | One observed `.git/objects` cleanup error. The successful diff path awaits its children; 100 local and 100 Linux fixture repetitions passed. The full 28-test suite also passed three uncached CI repetitions. No proven root cause and no production retry added.                                                                  |
| Playgrounds/Interactive Answers state, sizing, and controls                             | These plugins are absent from this branch (owning PRs #5293/#5314). Historical Playgrounds state failure reproduced once in 16 executions; an effect-flush candidate passed 16/16. Candidate is preserved separately, not claimed as a proven Windows runtime repair or imported with the unmerged plugin.                          |
| Community/library schema and catalog assertions                                         | Owning feature branch (#5320) already fixes schema omissions (`25f67013b8`), catalog expectations (`f29ae6acbb`), and migration/backfill handling (`f69bf501cd`).                                                                                                                                                                   |
| Desktop process-group cleanup `ESRCH`                                                   | Already fixed by #5287 (`1ae755fce6`).                                                                                                                                                                                                                                                                                              |
| Skill content changes with unchanged size/mtime                                         | Already fixed by #5257 (`9f7c11e9d0`); focused regression passes.                                                                                                                                                                                                                                                                   |
| ACP sign-in command quoting and model-options timeout                                   | Historical ACP-redux package is absent. Current ACP-next has platform-aware quoting tests and a 20-second budget for the multi-discovery integration case.                                                                                                                                                                          |
| Model-discovery “30-second” errors                                                      | Intentional fake-clock failure injection; examples finish in 206–370 ms. Actual failed tests were elsewhere. No performance defect.                                                                                                                                                                                                 |
| In-memory database guard, enrollment/installation telemetry, Pi background recovery     | Failures belong to unmerged feature branches: Windows path-separator source scanning, changed event contracts, or missing `tsx`. Their failing tests are absent here; no demonstrated current CI flake.                                                                                                                             |
| Plugin-settings final autosave assertion                                                | Controlled delayed query notifications reproduce the checked/unchecked assertion race. The test now waits for both the final checkbox and saved-status state, retaining the serialized-save assertions.                                                                                                                             |
| Marketplace cache headers and hidden-sidebar benchmark                                  | Already fixed by #5299 (`ba77afe213`) and `ba5a4c546e`, respectively.                                                                                                                                                                                                                                                               |
| Release-notes expectation                                                               | Feature-branch test used a now-published version; owning fix `aaaa188cf5` selects an unpublished version. Test is absent here.                                                                                                                                                                                                      |
| Bulk generated-import, duplicate-import, stale-path, SDK-doc, type, and budget failures | Source-development failures: invalid template input cascaded into missing generated imports; other logs identify explicit import/type/documentation mismatches. These are not independent intermittent runner failures. Current full CI remains the verification boundary.                                                          |
| npm AWS package 404/ETARGET and FUSE mirror availability                                | External resolution/download failures. FUSE fallback and isolated apt state are fixed; fork checks now retain exact resolution/install evidence. Fresh registry resolution remains deliberate and can still fail upstream.                                                                                                          |

Windows scheduling/provisioning and cold prerequisite duplication remain costs.
In the original successful PR sample with Windows jobs, the first Windows job
started a median 31 seconds after planning and the last at 67 seconds; main
medians were 33 and 76 seconds. These intervals are not pure queue time. Prior
four-versus-eight-vCPU and worker-count experiments above did not justify a
runner upgrade or more workers. Matching Turbo prerequisite hashes enables
reuse only when a compatible cache already exists; concurrent cold shards still
build prerequisites independently. More shards or a shared prerequisite job
would trade startup/dependency costs against test time and require a separate
controlled comparison before changing the pipeline.
