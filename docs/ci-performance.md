# CI performance

The main CI workflow keeps build/typecheck/lint, two server test shards, three app test
shards, integration tests, three package test groups, plugin tests, three fork
check shards, and package
smokes independent. Node 24/26 compatibility smokes run on main and manual runs.
Windows runs the nine host packages, an app smoke, a desktop smoke, and
thirteen test shards that cover the remaining suites; see
[windows-ci.md](windows-ci.md).

## Fork checks

On pull requests, the fork checker compares the checked-out merge commit with
the event's base SHA. When every changed path belongs to a listed forkable
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
caches. Optional pnpm and Turbo restores share a one-minute step budget. A
timeout falls back to a cold install using fresh cache directories. Individual
download segments also have a one-minute limit. Bun downloads directly instead
of waiting for its executable cache.

Dependency installation has a five-minute step budget in CI. Individual package
fetches have a 30-second timeout with two retries and 1–5-second backoff. pnpm
handles transient fetch failures; the workflow does not repeat the entire
install, including lifecycle scripts, three times. The shared setup action used
by other workflows reuses these tools and fetch settings, but does not impose
the CI workflow's outer step budgets.

pnpm can restore the most recent store for the same OS and architecture when a
lockfile changes. The frozen install still resolves the exact lockfile contents
and verifies store integrity. Turbo caches are pruned after restoration and
before successful CI jobs save them. Windows restores the pnpm store for every
job, and Turbo outputs for the smokes and the Windows test shards, capped at
256 MB per job to bound transfer and storage costs. The Windows test shards
also drop every entry their own Turbo run summary does not name before saving
(`prune-turbo-cache.mjs --keep-run-summaries`). Windows installs retain
`--ignore-scripts`; foundation tests still run with `--force`. macOS smoke jobs
still omit Turbo caching.

PR runs cancel superseded work. Main concurrency groups include the commit SHA,
so different main commits can run concurrently and each successful job saves its
cache. The old shared main group delayed job creation by up to three minutes in
the October 1 sample. Runner provisioning and fleet capacity remain external
limits; removing workflow serialization does not guarantee immediate starts.

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
- Installing without `@bb/mobile` and `@bb/desktop` took 22–27s against
  38–40s. It was left out because it saves 14s and makes the Windows install
  differ from every other job. Installing only `@bb/app`'s dependencies took
  17s but `ensure-native-modules` could not find `better-sqlite3`.
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
